import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  assertMeidochoPromptTemplateUsable,
  configureMeidochoRuntimeTemplate,
  getMeidochoRuntimeTemplateState,
  reconcileMeidochoPromptTemplate,
  resetMeidochoRuntimeTemplate,
} from "./runtime-template"
import type { MeidochoSlotResolvers } from "./template"

const DIR = "/project/a"
const DIR_B = "/project/b"

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

const BROKEN_TEMPLATE = VALID_TEMPLATE.replace("{{ delegationTable }}\n", "")

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

function fakeSlotsB(): MeidochoSlotResolvers {
  return {
    taskSystemGuide: () => "TSG-B",
    categorySkillsGuide: () => "CSG-B",
    delegationTable: () => "DT-B",
    oracleSection: () => "OS-B",
    frontendGuidance: () => "FG-B",
    fileEditGuidance: () => "FEG-B",
  }
}

describe("meidocho runtime template state", () => {
  const fixtureRoot = join(tmpdir(), `meidocho-runtime-template-${Date.now()}`)
  const templatePath = join(fixtureRoot, "meidocho.md")
  let mtimeCounter = 1_700_000_000_000

  function writeTemplate(content: string): void {
    writeFileSync(templatePath, content, "utf8")
    mtimeCounter += 60_000
    const atime = new Date(mtimeCounter)
    utimesSync(templatePath, atime, atime)
  }

  beforeEach(() => {
    mkdirSync(fixtureRoot, { recursive: true })
    resetMeidochoRuntimeTemplate()
  })

  afterEach(() => {
    resetMeidochoRuntimeTemplate()
    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  test("#given 未配置模板 #when configure #then disabled 且 assert/reconcile 全不激活", () => {
    const result = configureMeidochoRuntimeTemplate(DIR, {
      resolvers: fakeSlots(),
      bundledRendered: "BUNDLED",
    })

    expect(result.kind).toBe("disabled")
    expect(() => assertMeidochoPromptTemplateUsable(DIR)).not.toThrow()
    expect(reconcileMeidochoPromptTemplate(DIR, ["BUNDLED"])).toBe(false)
  })

  test("#given 有效模板 #when configure #then active 且 prompt 为渲染结果", () => {
    writeTemplate(VALID_TEMPLATE)

    const result = configureMeidochoRuntimeTemplate(DIR, {
      templateContent: { filePath: templatePath, content: VALID_TEMPLATE },
      resolvers: fakeSlots(),
      bundledRendered: "BUNDLED",
    })

    expect(result.kind).toBe("active")
    if (result.kind !== "active") return
    expect(result.prompt).toContain("TSG")
    expect(result.prompt).not.toContain("{{")
    expect(() => assertMeidochoPromptTemplateUsable(DIR)).not.toThrow()
  })

  test("#given 无效模板 #when configure #then invalid 且 assert 抛出错误单", () => {
    writeTemplate(BROKEN_TEMPLATE)

    const result = configureMeidochoRuntimeTemplate(DIR, {
      templateContent: { filePath: templatePath, content: BROKEN_TEMPLATE },
      resolvers: fakeSlots(),
      bundledRendered: "BUNDLED",
    })

    expect(result.kind).toBe("invalid")
    if (result.kind !== "invalid") return
    expect(result.prompt).toBe("BUNDLED")
    expect(result.errorReport).toContain("缺少必需占位符 {{ delegationTable }}")
    expect(() => assertMeidochoPromptTemplateUsable(DIR)).toThrow(/模板无效，本条消息已被拦截/)
  })

  test("#given 模板读取失败 #when configure #then invalid 且错误单含原因", () => {
    const result = configureMeidochoRuntimeTemplate(DIR, {
      loadFailureReason: "Template file not found: /nope.md",
      resolvers: fakeSlots(),
      bundledRendered: "BUNDLED",
    })

    expect(result.kind).toBe("invalid")
    expect(() => assertMeidochoPromptTemplateUsable(DIR)).toThrow(/模板文件不可读/)
  })

  test("#given active 状态模板被合法修改 #when assert + reconcile #then system 被替换成新渲染", () => {
    writeTemplate(VALID_TEMPLATE)
    configureMeidochoRuntimeTemplate(DIR, {
      templateContent: { filePath: templatePath, content: VALID_TEMPLATE },
      resolvers: fakeSlots(),
      bundledRendered: "BUNDLED",
    })
    const state = getMeidochoRuntimeTemplateState(DIR)
    if (state.kind !== "active") throw new Error("expected active")
    const oldRendered = state.rendered
    const system = [`identity\n${oldRendered}\nenv`]

    writeTemplate(VALID_TEMPLATE.replace("头部", "头部V2"))
    expect(() => assertMeidochoPromptTemplateUsable(DIR)).not.toThrow()

    const swapped = reconcileMeidochoPromptTemplate(DIR, system)
    expect(swapped).toBe(true)
    expect(system[0]).toContain("头部V2")
    expect(system[0]).toContain("identity")
    expect(system[0]).toContain("env")
    expect(reconcileMeidochoPromptTemplate(DIR, system)).toBe(false)
  })

  test("#given active 状态模板被改坏又修复 #when 两轮 assert #then 先拦截后恢复并热替换", () => {
    writeTemplate(VALID_TEMPLATE)
    configureMeidochoRuntimeTemplate(DIR, {
      templateContent: { filePath: templatePath, content: VALID_TEMPLATE },
      resolvers: fakeSlots(),
      bundledRendered: "BUNDLED",
    })
    const state = getMeidochoRuntimeTemplateState(DIR)
    if (state.kind !== "active") throw new Error("expected active")
    const system = [state.rendered]

    writeTemplate(BROKEN_TEMPLATE)
    expect(() => assertMeidochoPromptTemplateUsable(DIR)).toThrow(/缺少必需占位符/)

    writeTemplate(VALID_TEMPLATE.replace("尾部", "尾部V3"))
    expect(() => assertMeidochoPromptTemplateUsable(DIR)).not.toThrow()

    const swapped = reconcileMeidochoPromptTemplate(DIR, system)
    expect(swapped).toBe(true)
    expect(system[0]).toContain("尾部V3")
  })

  test("#given 注册时模板无效之后修复 #when assert + reconcile #then bundled 被换成有效渲染", () => {
    writeTemplate(BROKEN_TEMPLATE)
    configureMeidochoRuntimeTemplate(DIR, {
      templateContent: { filePath: templatePath, content: BROKEN_TEMPLATE },
      resolvers: fakeSlots(),
      bundledRendered: "BUNDLED-BODY",
    })
    const system = ["identity\nBUNDLED-BODY\nenv"]

    writeTemplate(VALID_TEMPLATE)
    expect(() => assertMeidochoPromptTemplateUsable(DIR)).not.toThrow()

    const swapped = reconcileMeidochoPromptTemplate(DIR, system)
    expect(swapped).toBe(true)
    expect(system[0]).toContain("TSG")
    expect(system[0]).toContain("identity")
  })

  test("#given 连续两次热更新且 core 每次重建原始 baked #when 两轮 refresh+reconcile #then 第二次同样替换成功", () => {
    writeTemplate(VALID_TEMPLATE)
    configureMeidochoRuntimeTemplate(DIR, {
      templateContent: { filePath: templatePath, content: VALID_TEMPLATE },
      resolvers: fakeSlots(),
      bundledRendered: "BUNDLED",
    })
    const state = getMeidochoRuntimeTemplateState(DIR)
    if (state.kind !== "active") throw new Error("expected active")
    const registrationRendered = state.rendered

    writeTemplate(VALID_TEMPLATE.replace("头部", "头部V2"))
    expect(() => assertMeidochoPromptTemplateUsable(DIR)).not.toThrow()
    const systemRound1 = [registrationRendered]
    expect(reconcileMeidochoPromptTemplate(DIR, systemRound1)).toBe(true)
    expect(systemRound1[0]).toContain("头部V2")

    writeTemplate(VALID_TEMPLATE.replace("头部", "头部V3"))
    expect(() => assertMeidochoPromptTemplateUsable(DIR)).not.toThrow()
    const systemRound2 = [registrationRendered]
    expect(reconcileMeidochoPromptTemplate(DIR, systemRound2)).toBe(true)
    expect(systemRound2[0]).toContain("头部V3")
    expect(systemRound2[0]).not.toContain("头部V2")
  })

  test("#given 两个 directory 渲染分叉 #when 后配置的 instance 覆盖式 configure #then 各自锚点隔离互不影响", () => {
    // 生产事故回归：OpenCode serve 同进程多 instance 共享模块级 state 时，
    // 后初始化的 instance 覆盖锚点，先初始化 instance 的 session 热更新静默失效。
    writeTemplate(VALID_TEMPLATE)
    configureMeidochoRuntimeTemplate(DIR, {
      templateContent: { filePath: templatePath, content: VALID_TEMPLATE },
      resolvers: fakeSlots(),
      bundledRendered: "BUNDLED",
    })
    configureMeidochoRuntimeTemplate(DIR_B, {
      templateContent: { filePath: templatePath, content: VALID_TEMPLATE },
      resolvers: fakeSlotsB(),
      bundledRendered: "BUNDLED-B",
    })

    const stateA = getMeidochoRuntimeTemplateState(DIR)
    const stateB = getMeidochoRuntimeTemplateState(DIR_B)
    if (stateA.kind !== "active" || stateB.kind !== "active") throw new Error("expected both active")
    expect(stateA.rendered).toContain("TSG")
    expect(stateA.rendered).not.toContain("TSG-B")
    expect(stateB.rendered).toContain("TSG-B")

    writeTemplate(VALID_TEMPLATE.replace("头部", "头部V2"))

    expect(() => assertMeidochoPromptTemplateUsable(DIR)).not.toThrow()
    expect(() => assertMeidochoPromptTemplateUsable(DIR_B)).not.toThrow()

    const systemA = [`identity\n${stateA.registrationRendered}\nenv`]
    expect(reconcileMeidochoPromptTemplate(DIR, systemA)).toBe(true)
    expect(systemA[0]).toContain("头部V2")
    expect(systemA[0]).toContain("TSG")
    expect(systemA[0]).not.toContain("TSG-B")

    const systemB = [`identity\n${stateB.registrationRendered}\nenv`]
    expect(reconcileMeidochoPromptTemplate(DIR_B, systemB)).toBe(true)
    expect(systemB[0]).toContain("头部V2")
    expect(systemB[0]).toContain("TSG-B")
  })

  test("#given 只配置了 DIR_B #when DIR 的 session 触发 guard/reconcile #then 全部 no-op 不串扰", () => {
    writeTemplate(VALID_TEMPLATE)
    configureMeidochoRuntimeTemplate(DIR_B, {
      templateContent: { filePath: templatePath, content: VALID_TEMPLATE },
      resolvers: fakeSlotsB(),
      bundledRendered: "BUNDLED-B",
    })

    expect(() => assertMeidochoPromptTemplateUsable(DIR)).not.toThrow()
    expect(reconcileMeidochoPromptTemplate(DIR, ["BUNDLED"])).toBe(false)
    expect(getMeidochoRuntimeTemplateState(DIR).kind).toBe("disabled")
  })
})
