import { describe, expect, test } from "bun:test"
import {
  buildMeidochoTemplateErrorReport,
  MEIDOCHO_REQUIRED_SLOTS,
  renderMeidochoTemplate,
  validateMeidochoTemplate,
  type MeidochoSlotResolvers,
} from "./template"

const VALID_TEMPLATE = [
  "头部",
  "{{ taskSystemGuide }}",
  "{{ categorySkillsGuide }}",
  "{{ delegationTable }}",
  "{{ oracleSection }}",
  "{{ frontendGuidance }}",
  "{{ fileEditGuidance }}",
  "尾部",
].join("\n")

function fakeSlots(): MeidochoSlotResolvers {
  return {
    taskSystemGuide: () => "TSG",
    categorySkillsGuide: () => "CSG",
    delegationTable: () => "DT",
    oracleSection: () => "OS",
    frontendGuidance: () => "FG",
    fileEditGuidance: () => "FEG",
  }
}

describe("validateMeidochoTemplate", () => {
  test("#given 全部槽位恰好一次 #when 校验 #then 通过", () => {
    const result = validateMeidochoTemplate(VALID_TEMPLATE)
    expect(result.ok).toBe(true)
  })

  test("#given 部分槽位用 omit 注明 #when 校验 #then 通过", () => {
    const template = VALID_TEMPLATE.replace("{{ oracleSection }}", "{{ oracleSection:omit }}")
    const result = validateMeidochoTemplate(template)
    expect(result.ok).toBe(true)
  })

  test("#given 占位符无空格写法 #when 校验 #then 通过", () => {
    const template = VALID_TEMPLATE.replace("{{ taskSystemGuide }}", "{{taskSystemGuide}}")
    const result = validateMeidochoTemplate(template)
    expect(result.ok).toBe(true)
  })

  test("#given 缺少一个槽位 #when 校验 #then 报 missing-slot", () => {
    const template = VALID_TEMPLATE.replace("{{ delegationTable }}\n", "")
    const result = validateMeidochoTemplate(template)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toContainEqual({ kind: "missing-slot", slot: "delegationTable" })
  })

  test("#given 槽位重复出现 #when 校验 #then 报 duplicate-slot", () => {
    const template = `${VALID_TEMPLATE}\n{{ oracleSection }}`
    const result = validateMeidochoTemplate(template)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toContainEqual({ kind: "duplicate-slot", slot: "oracleSection", count: 2 })
  })

  test("#given 同一槽位正常形式和 omit 各一次 #when 校验 #then 报 duplicate-slot", () => {
    const template = VALID_TEMPLATE.replace("{{ oracleSection }}", "{{ oracleSection }}\n{{ oracleSection:omit }}")
    const result = validateMeidochoTemplate(template)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toContainEqual({ kind: "duplicate-slot", slot: "oracleSection", count: 2 })
  })

  test("#given 拼错的占位符 #when 校验 #then 报 unknown-placeholder 并给拼写建议", () => {
    const template = VALID_TEMPLATE.replace("{{ delegationTable }}", "{{ delegateTable }}")
    const result = validateMeidochoTemplate(template)
    expect(result.ok).toBe(false)
    if (result.ok) return
    const unknown = result.issues.find((issue) => issue.kind === "unknown-placeholder")
    expect(unknown).toBeDefined()
    if (unknown?.kind !== "unknown-placeholder") return
    expect(unknown.suggestion).toBe("delegationTable")
    expect(result.issues).toContainEqual({ kind: "missing-slot", slot: "delegationTable" })
  })

  test("#given 完全不认识的占位符 #when 校验 #then 报 unknown-placeholder 且无建议", () => {
    const template = `${VALID_TEMPLATE}\n{{ xyzzy }}`
    const result = validateMeidochoTemplate(template)
    expect(result.ok).toBe(false)
    if (result.ok) return
    const unknown = result.issues.find((issue) => issue.kind === "unknown-placeholder")
    if (unknown?.kind !== "unknown-placeholder") return
    expect(unknown.suggestion).toBeUndefined()
  })

  test("#given 非法修饰词 #when 校验 #then 报 invalid-modifier", () => {
    const template = VALID_TEMPLATE.replace("{{ oracleSection }}", "{{ oracleSection:skip }}")
    const result = validateMeidochoTemplate(template)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.some((issue) => issue.kind === "invalid-modifier")).toBe(true)
  })

  test("#given 空占位符 #when 校验 #then 报 empty-placeholder", () => {
    const template = `${VALID_TEMPLATE}\n{{ }}`
    const result = validateMeidochoTemplate(template)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.some((issue) => issue.kind === "empty-placeholder")).toBe(true)
  })
})

describe("renderMeidochoTemplate", () => {
  test("#given 合法模板 #when 渲染 #then 全部槽位被 resolver 替换", () => {
    const rendered = renderMeidochoTemplate(VALID_TEMPLATE, fakeSlots())
    expect(rendered).toBe(["头部", "TSG", "CSG", "DT", "OS", "FG", "FEG", "尾部"].join("\n"))
  })

  test("#given omit 独占一行 #when 渲染 #then 整行被删除不留空行", () => {
    const template = VALID_TEMPLATE.replace("{{ oracleSection }}", "{{ oracleSection:omit }}")
    const rendered = renderMeidochoTemplate(template, fakeSlots())
    expect(rendered).toBe(["头部", "TSG", "CSG", "DT", "FG", "FEG", "尾部"].join("\n"))
  })

  test("#given omit 与其他文本同行 #when 渲染 #then 位置变空串但保留本行", () => {
    const template = VALID_TEMPLATE.replace("{{ oracleSection }}", "前缀 {{ oracleSection:omit }} 后缀")
    const rendered = renderMeidochoTemplate(template, fakeSlots())
    expect(rendered).toContain("前缀  后缀")
    expect(rendered).not.toContain("OS")
  })

  test("#given 无空格写法占位符 #when 渲染 #then 同样被替换", () => {
    const template = VALID_TEMPLATE.replace("{{ taskSystemGuide }}", "{{taskSystemGuide}}")
    const rendered = renderMeidochoTemplate(template, fakeSlots())
    expect(rendered).toContain("TSG")
  })

  test("#given 每个必需槽位 #when 渲染 #then resolver 都被调用", () => {
    const called = new Set<string>()
    const slots = fakeSlots()
    for (const name of MEIDOCHO_REQUIRED_SLOTS) {
      const original = slots[name]
      slots[name] = () => {
        called.add(name)
        return original()
      }
    }
    renderMeidochoTemplate(VALID_TEMPLATE, slots)
    expect(called.size).toBe(MEIDOCHO_REQUIRED_SLOTS.length)
  })
})

describe("buildMeidochoTemplateErrorReport", () => {
  test("#given 一组问题 #when 生成错误单 #then 包含路径/问题/槽位清单/恢复提示", () => {
    const report = buildMeidochoTemplateErrorReport({
      filePath: "/home/celestia/.omo/prompts/meidocho.md",
      issues: [
        { kind: "missing-slot", slot: "delegationTable" },
        { kind: "unknown-placeholder", name: "delegateTable", suggestion: "delegationTable", line: 41 },
      ],
    })
    expect(report).toContain("模板无效，本条消息已被拦截")
    expect(report).toContain("/home/celestia/.omo/prompts/meidocho.md")
    expect(report).toContain("缺少必需占位符 {{ delegationTable }}")
    expect(report).toContain("{{ delegationTable:omit }}")
    expect(report).toContain("第 41 行")
    expect(report).toContain("你是不是想写 {{ delegationTable }}？")
    expect(report).toContain(MEIDOCHO_REQUIRED_SLOTS.join(", "))
    expect(report).toContain("重新发送消息即可自动恢复")
  })
})
