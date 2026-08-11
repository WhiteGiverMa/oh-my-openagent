export const MEIDOCHO_REQUIRED_SLOTS = [
  "taskSystemGuide",
  "categorySkillsGuide",
  "delegationTable",
  "oracleSection",
  "frontendGuidance",
  "fileEditGuidance",
] as const

export type MeidochoSlotName = (typeof MEIDOCHO_REQUIRED_SLOTS)[number]

export type MeidochoSlotResolvers = Record<MeidochoSlotName, () => string>

export type MeidochoTemplateIssue =
  | { readonly kind: "missing-slot"; readonly slot: MeidochoSlotName }
  | { readonly kind: "duplicate-slot"; readonly slot: MeidochoSlotName; readonly count: number }
  | { readonly kind: "unknown-placeholder"; readonly name: string; readonly suggestion?: MeidochoSlotName; readonly line: number }
  | { readonly kind: "invalid-modifier"; readonly name: string; readonly modifier: string; readonly line: number }
  | { readonly kind: "empty-placeholder"; readonly line: number }

export type MeidochoTemplateValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly MeidochoTemplateIssue[] }

type ParsedPlaceholder = {
  readonly name: string
  readonly modifier?: string
  readonly line: number
}

const PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g

function isRequiredSlot(name: string): name is MeidochoSlotName {
  return (MEIDOCHO_REQUIRED_SLOTS as readonly string[]).includes(name)
}

function lineAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) {
    if (text[i] === "\n") line++
  }
  return line
}

function scanPlaceholders(template: string): ParsedPlaceholder[] {
  const results: ParsedPlaceholder[] = []
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const raw = (match[1] ?? "").trim()
    const line = lineAt(template, match.index ?? 0)
    if (raw.length === 0) {
      results.push({ name: "", line })
      continue
    }
    const colonIndex = raw.indexOf(":")
    if (colonIndex === -1) {
      results.push({ name: raw, line })
      continue
    }
    results.push({
      name: raw.slice(0, colonIndex).trim(),
      modifier: raw.slice(colonIndex + 1).trim(),
      line,
    })
  }
  return results
}

function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
  }
  return dp[a.length][b.length]
}

function suggestSlot(name: string): MeidochoSlotName | undefined {
  let best: MeidochoSlotName | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const slot of MEIDOCHO_REQUIRED_SLOTS) {
    const distance = editDistance(name.toLowerCase(), slot.toLowerCase())
    if (distance < bestDistance) {
      bestDistance = distance
      best = slot
    }
  }
  return bestDistance <= 3 ? best : undefined
}

export function validateMeidochoTemplate(template: string): MeidochoTemplateValidation {
  const issues: MeidochoTemplateIssue[] = []
  const counts = new Map<MeidochoSlotName, number>()

  for (const placeholder of scanPlaceholders(template)) {
    if (placeholder.name.length === 0) {
      issues.push({ kind: "empty-placeholder", line: placeholder.line })
      continue
    }
    if (!isRequiredSlot(placeholder.name)) {
      issues.push({
        kind: "unknown-placeholder",
        name: placeholder.name,
        suggestion: suggestSlot(placeholder.name),
        line: placeholder.line,
      })
      continue
    }
    if (placeholder.modifier !== undefined && placeholder.modifier !== "omit") {
      issues.push({
        kind: "invalid-modifier",
        name: placeholder.name,
        modifier: placeholder.modifier,
        line: placeholder.line,
      })
      continue
    }
    counts.set(placeholder.name, (counts.get(placeholder.name) ?? 0) + 1)
  }

  for (const slot of MEIDOCHO_REQUIRED_SLOTS) {
    const count = counts.get(slot) ?? 0
    if (count === 0) issues.push({ kind: "missing-slot", slot })
    else if (count > 1) issues.push({ kind: "duplicate-slot", slot, count })
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues }
}

export function renderMeidochoTemplate(template: string, slots: MeidochoSlotResolvers): string {
  let rendered = template
  for (const name of MEIDOCHO_REQUIRED_SLOTS) {
    rendered = rendered.replace(
      new RegExp(`^[ \\t]*\\{\\{\\s*${name}\\s*:\\s*omit\\s*\\}\\}[ \\t]*(?:\\r?\\n|$)`, "gm"),
      "",
    )
    rendered = rendered.replace(new RegExp(`\\{\\{\\s*${name}\\s*:\\s*omit\\s*\\}\\}`, "g"), "")
    rendered = rendered.replace(new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, "g"), () => slots[name]())
  }
  return rendered
}

function describeIssue(issue: MeidochoTemplateIssue): string {
  switch (issue.kind) {
    case "missing-slot":
      return `缺少必需占位符 {{ ${issue.slot} }}（确认不要此段？请写 {{ ${issue.slot}:omit }}）`
    case "duplicate-slot":
      return `占位符 {{ ${issue.slot} }} 出现了 ${issue.count} 次（每个槽位必须恰好一次）`
    case "unknown-placeholder":
      return `未知占位符 {{ ${issue.name} }}（第 ${issue.line} 行${issue.suggestion ? `，你是不是想写 {{ ${issue.suggestion} }}？` : "，不是已知槽位"}）`
    case "invalid-modifier":
      return `占位符 {{ ${issue.name}:${issue.modifier} }} 的修饰词无效（第 ${issue.line} 行，唯一支持的修饰词是 :omit）`
    case "empty-placeholder":
      return `空占位符 {{ }}（第 ${issue.line} 行）`
  }
}

export function buildMeidochoTemplateErrorReport(input: {
  readonly issues: readonly MeidochoTemplateIssue[]
  readonly filePath?: string
}): string {
  const lines = [
    "[meidocho prompt_template] 模板无效，本条消息已被拦截（未发送给模型，未消耗 token）。",
  ]
  if (input.filePath) lines.push(`文件: ${input.filePath}`)
  lines.push("问题:")
  for (const issue of input.issues) lines.push(`  - ${describeIssue(issue)}`)
  lines.push(`必需槽位（每个恰好出现一次；确认不要某段请写 {{ 槽位名:omit }}）: ${MEIDOCHO_REQUIRED_SLOTS.join(", ")}`)
  lines.push("修复并保存模板文件后，重新发送消息即可自动恢复。")
  return lines.join("\n")
}
