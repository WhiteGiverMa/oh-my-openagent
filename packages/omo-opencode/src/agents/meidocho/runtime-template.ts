import { readFileSync, statSync } from "node:fs"

import { log } from "../../shared/logger"
import {
  buildMeidochoTemplateErrorReport,
  renderMeidochoTemplate,
  validateMeidochoTemplate,
  type MeidochoSlotResolvers,
} from "./template"

type ActiveState = {
  readonly kind: "active"
  readonly filePath: string
  readonly mtimeMs: number
  readonly rendered: string
  readonly registrationRendered: string
  readonly resolvers: MeidochoSlotResolvers
}

type InvalidState = {
  readonly kind: "invalid"
  readonly filePath: string
  readonly mtimeMs: number
  readonly errorReport: string
  readonly registrationRendered: string
  readonly resolvers: MeidochoSlotResolvers
}

type MeidochoRuntimeTemplateState =
  | { readonly kind: "disabled" }
  | ActiveState
  | InvalidState

// OpenCode serve 在同一进程内为每个 directory（项目）创建一个 plugin instance，
// 各 instance 的 resolvers 依赖项目级 skills/categories，同一 md 的渲染结果因
// instance 而异。模块级单例会被最后初始化的 instance 覆盖，导致其他 instance
// 的 reconcile 锚点失配、refresh 错用 resolvers——状态必须按 directory 隔离。
const states = new Map<string, MeidochoRuntimeTemplateState>()

function stateKey(directory: string | undefined): string {
  return directory ?? ""
}

function getState(directory: string | undefined): MeidochoRuntimeTemplateState {
  return states.get(stateKey(directory)) ?? { kind: "disabled" }
}

export type ConfigureMeidochoRuntimeTemplateInput = {
  readonly templateContent?: {
    readonly filePath: string
    readonly content: string
  }
  readonly loadFailureReason?: string
  readonly resolvers: MeidochoSlotResolvers
  readonly bundledRendered: string
}

export type ConfigureMeidochoRuntimeTemplateResult =
  | { readonly kind: "disabled" }
  | { readonly kind: "active"; readonly prompt: string }
  | { readonly kind: "invalid"; readonly prompt: string; readonly errorReport: string }

export function configureMeidochoRuntimeTemplate(
  directory: string | undefined,
  input: ConfigureMeidochoRuntimeTemplateInput,
): ConfigureMeidochoRuntimeTemplateResult {
  const key = stateKey(directory)

  if (!input.templateContent && !input.loadFailureReason) {
    states.delete(key)
    return { kind: "disabled" }
  }

  if (input.loadFailureReason || !input.templateContent) {
    const errorReport = buildLoadFailureReport(input.loadFailureReason ?? "模板内容缺失")
    states.set(key, {
      kind: "invalid",
      filePath: input.templateContent?.filePath ?? "",
      mtimeMs: 0,
      errorReport,
      registrationRendered: input.bundledRendered,
      resolvers: input.resolvers,
    })
    return { kind: "invalid", prompt: input.bundledRendered, errorReport }
  }

  const { filePath, content } = input.templateContent
  const validation = validateMeidochoTemplate(content)
  const mtimeMs = safeMtime(filePath)

  if (!validation.ok) {
    const errorReport = buildMeidochoTemplateErrorReport({ issues: validation.issues, filePath })
    states.set(key, {
      kind: "invalid",
      filePath,
      mtimeMs,
      errorReport,
      registrationRendered: input.bundledRendered,
      resolvers: input.resolvers,
    })
    return { kind: "invalid", prompt: input.bundledRendered, errorReport }
  }

  const rendered = renderMeidochoTemplate(content, input.resolvers)
  states.set(key, {
    kind: "active",
    filePath,
    mtimeMs,
    rendered,
    registrationRendered: rendered,
    resolvers: input.resolvers,
  })
  return { kind: "active", prompt: rendered }
}

function buildLoadFailureReport(reason: string): string {
  return [
    "[meidocho prompt_template] 模板文件不可读，本条消息已被拦截（未发送给模型，未消耗 token）。",
    `原因: ${reason}`,
    "修复并保存模板文件后，重新发送消息即可自动恢复。",
  ].join("\n")
}

function safeMtime(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}

function refresh(current: ActiveState | InvalidState): ActiveState | InvalidState {
  const mtimeMs = safeMtime(current.filePath)
  if (mtimeMs === 0 && current.mtimeMs === 0) return current
  if (mtimeMs === current.mtimeMs) return current

  let content: string
  try {
    content = readFileSync(current.filePath, "utf8")
  } catch (error) {
    log("[meidocho-runtime-template] template unreadable during refresh", {
      filePath: current.filePath,
      error: String(error),
    })
    return {
      kind: "invalid",
      filePath: current.filePath,
      mtimeMs,
      errorReport: buildLoadFailureReport(`无法读取模板文件: ${current.filePath}`),
      registrationRendered: current.registrationRendered,
      resolvers: current.resolvers,
    }
  }

  const validation = validateMeidochoTemplate(content)
  if (!validation.ok) {
    return {
      kind: "invalid",
      filePath: current.filePath,
      mtimeMs,
      errorReport: buildMeidochoTemplateErrorReport({
        issues: validation.issues,
        filePath: current.filePath,
      }),
      registrationRendered: current.registrationRendered,
      resolvers: current.resolvers,
    }
  }

  log("[meidocho-runtime-template] template reloaded", { filePath: current.filePath })
  return {
    kind: "active",
    filePath: current.filePath,
    mtimeMs,
    rendered: renderMeidochoTemplate(content, current.resolvers),
    registrationRendered: current.registrationRendered,
    resolvers: current.resolvers,
  }
}

export function assertMeidochoPromptTemplateUsable(directory: string | undefined): void {
  const current = getState(directory)
  if (current.kind === "disabled") return
  const next = refresh(current)
  states.set(stateKey(directory), next)
  if (next.kind === "invalid") {
    throw new Error(next.errorReport)
  }
}

export function reconcileMeidochoPromptTemplate(
  directory: string | undefined,
  system: string[],
): boolean {
  const current = getState(directory)
  if (current.kind !== "active") return false
  const active = current
  if (active.rendered === active.registrationRendered) return false

  // OpenCode core rebuilds the system array from the ORIGINAL registered prompt
  // on every request, so the anchor is always the registration-time render —
  // never the previously swapped body (second-and-later reloads).
  let swapped = false
  for (let i = 0; i < system.length; i++) {
    if (system[i].includes(active.registrationRendered)) {
      system[i] = system[i].split(active.registrationRendered).join(active.rendered)
      swapped = true
    }
  }
  return swapped
}

export function getMeidochoRuntimeTemplateState(
  directory?: string,
): MeidochoRuntimeTemplateState {
  return getState(directory)
}

export function resetMeidochoRuntimeTemplate(): void {
  states.clear()
}
