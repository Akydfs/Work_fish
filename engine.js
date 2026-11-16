/* engine.js —— 排表纯逻辑（不碰 DOM，浏览器和 Node 都能跑）
 * 用法：<script src="./engine.js"></script> 之后用 window.PaiBan.generate(...)
 */
;(function (root) {
  'use strict'

  const BUILDINGS = [
    { key: 'wenhui', label: '文汇楼' },
    { key: 'tiyuguan', label: '体育馆' },
    { key: 'zhiyuan', label: '致远楼' },
  ]

  const DAY_NAMES = ['星期一', '星期二', '星期三', '星期四', '星期五']

  const norm = (s) => String(s).replace(/\s+/g, '')

  /** 从输入文本里取「第X周」「星期Y」 */
  function parseInput(text) {
    const week = text.match(/第\s*([0-9]+)\s*周/)
    if (!week) throw new Error('没找到「第X周」，请检查输入')
    const dayCn = text.match(/星期\s*([一二三四五])/)
    const dayNum = text.match(/周\s*([1-5])/)
    let day
    if (dayCn) day = '一二三四五'.indexOf(dayCn[1]) + 1
    else if (dayNum) day = Number(dayNum[1])
    else throw new Error('没找到「星期X」，请检查输入')
    return { week: Number(week[1]), day }
  }

  /** 下一天；周五 → 下周周一，周次 +1 */
  function nextDay(week, day) {
    if (day < 5) return { week, day: day + 1 }
    return { week: week + 1, day: 1 }
  }

  /** 把「第几周周几」压成连续天序号，用来算间隔 */
  function dayIndex(week, day) {
    return (week - 1) * 5 + (day - 1)
  }

  /** 取某个楼「打扫卫生班级：」下面的行（直到空行或下一个标题） */
  function parseSection(text, label) {
    const lines = text.split(/\r?\n/)
    const target = norm(label + '打扫卫生班级')
    for (let i = 0; i < lines.length; i++) {
      if (norm(lines[i]).startsWith(target)) {
        const out = []
        for (let j = i + 1; j < lines.length; j++) {
          const t = lines[j].trim()
          if (!t) break
          if (t.endsWith('：')) break
          out.push(t)
        }
        return out
      }
    }
    return null
  }

  const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  function cnNum(s) {
    if (/^\d+$/.test(s)) return Number(s)
    return CN_NUM[s] ?? null
  }

  /** 从一段昵称里解析班级 id（如 G26学前教育2班 → 26学前2） */
  function classFromText(line) {
    const s = norm(line)
    let m = s.match(/G?(\d{2})G?学前教育([一二三四五六七八九十\d]+)班/)
    if (m) return `${m[1]}学前${cnNum(m[2])}`
    m = s.match(/G?(\d{2})G?(?:空中乘务|空乘)([一二三四五六七八九十\d]+)班/)
    if (m) return `${m[1]}空乘${cnNum(m[2])}`
    m = s.match(/G?(\d{2})G?旅游管理([一二三四五六七八九十\d]+)班/)
    if (m) return `${m[1]}旅游${cnNum(m[2])}`
    m = s.match(/G?(\d{2})G?市场营销/)
    if (m) return `${m[1]}市场营销`
    m = s.match(/G?(\d{2})G?酒店管理/)
    if (m) return `${m[1]}酒店管理`
    return null
  }

  /** 从打扫行里判断今天是谁的班。known=false 表示没认出来 */
  function detectClass(lines, data) {
    if (!lines) return { known: false, cls: null, reason: 'section-missing' }
    if (lines.some((l) => norm(l) === '无')) return { known: true, cls: null, reason: 'none' }
    for (const [cls, c] of Object.entries(data.contacts)) {
      if (lines.some((l) => l.includes(c.name))) return { known: true, cls, reason: 'name' }
    }
    for (const l of lines) {
      const cls = classFromText(l)
      if (cls && data.contacts[cls]) return { known: true, cls, reason: 'class-text' }
    }
    return { known: false, cls: null, reason: 'unknown-person' }
  }

  /** 在轮换表里前进 steps 格；不在表里就原样返回（罚扫） */
  function advance(cls, steps, rotation) {
    const i = rotation.indexOf(cls)
    if (i < 0) return cls
    const n = rotation.length
    return rotation[(((i + steps) % n) + n) % n]
  }

  function computeNext(text, key, data, mem, week, day, nd) {
    const label = BUILDINGS.find((b) => b.key === key).label
    const rot = data.rotation[key]
    const det = detectClass(parseSection(text, label), data)
    const now = dayIndex(week, day)
    let base = null
    let warn = null

    if (det.known && det.cls) {
      base = det.cls
    } else if (det.known && !det.cls) {
      const m = mem[key]
      if (m && m.cls) {
        base = advance(m.cls, Math.max(0, now - dayIndex(m.week, m.day)), rot)
        warn = `${label}：今天写的是「无」，按上次记录（${m.cls}）推算`
      } else {
        warn = `${label}：今天写的是「无」，又没有历史记录，无法推算，请手动填`
      }
    } else {
      const m = mem[key]
      if (m && m.cls) {
        base = advance(m.cls, Math.max(0, now - dayIndex(m.week, m.day)), rot)
        warn = `${label}：没认出今天打扫的班，按上次记录（${m.cls}）推算`
      } else {
        warn = `${label}：没认出今天打扫的班，请手动填`
      }
    }

    if (base && rot.indexOf(base) < 0) warn = `${label}：${base} 不在轮换表里（罚扫？），保持原样`
    const next = base ? advance(base, 1, rot) : null
    return { base, next, warn, mem: { week: nd.week, day: nd.day, cls: next || base || null } }
  }

  /**
   * 生成下一天。
   * @param text 今天的群消息
   * @param data 导入的数据
   * @param memory 上次的下一天记录 { [building]: {week, day, cls} }
   */
  function generate(text, data, memory = {}) {
    const { week, day } = parseInput(text)
    const nd = nextDay(week, day)
    const ndName = DAY_NAMES[nd.day - 1]
    const warnings = []
    const mem = { ...memory }
    const out = [`第${nd.week}周`, ndName, '']

    for (const b of BUILDINGS) {
      const tt = data.timetable[b.key]
      const has = !!(tt.hasClass[String(nd.week)]?.[ndName])
      out.push(`${b.label}开门人员：`)

      if (!has) {
        out.push('无')
        out.push(`${b.label}打扫卫生班级：`)
        out.push('无')
        out.push('')
        if (b.key !== 'zhiyuan') {
          const st = computeNext(text, b.key, data, mem, week, day, nd)
          mem[b.key] = st.mem
          if (st.warn) warnings.push(st.warn)
        }
        continue
      }

      out.push(...(data.openers[b.key][String(nd.day)] || ['无']))
      out.push(`${b.label}打扫卫生班级：`)

      if (b.key === 'zhiyuan') {
        const classes = tt.classes[String(nd.week)]?.[ndName] || []
        if (classes.length === 0) {
          out.push('无')
        } else {
          for (const c of classes) {
            const contact = data.contacts[c]
            if (!contact) {
              warnings.push(`没有「${c}」的联系人，请补数据`)
              out.push('@' + c)
            } else out.push(contact.display)
          }
        }
      } else {
        const st = computeNext(text, b.key, data, mem, week, day, nd)
        mem[b.key] = st.mem
        if (st.warn) warnings.push(st.warn)
        if (!st.next) {
          out.push('无')
          warnings.push(`${b.label}：无法判断下一个班，请手动填写`)
        } else {
          out.push(data.contacts[st.next]?.display || '@' + st.next)
        }
      }
      out.push('')
    }

    while (out.length && out[out.length - 1] === '') out.pop()
    const lines = out.map((l, i) => (l.startsWith('@') && i < out.length - 1 ? l + ' ' : l))
    return { text: lines.join('\n'), warnings, memory: mem, nextWeek: nd.week, nextDay: nd.day }
  }

  root.PaiBan = {
    BUILDINGS,
    DAY_NAMES,
    parseInput,
    nextDay,
    dayIndex,
    parseSection,
    detectClass,
    advance,
    classFromText,
    generate,
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
