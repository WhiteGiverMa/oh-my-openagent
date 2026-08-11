/**
 * Meidocho — 女仆长 Agent 提示词 (v3, 模板外部化)
 *
 * 模板本体住在 packages/prompts-core/prompts/meidocho/default.md（git 追踪），
 * 运行时通过命名槽位渲染。用户可用 agents.meidocho.prompt_template (file://)
 * 提供私有模板：占位符位置即渲染位置；校验四规则（缺失/重复/未知/非法修饰）
 * 由 template.ts 执行，调用方必须先 validate 再调用 buildMeidochoPrompt。
 *
 * 设计理念（沿用 v2, 对齐 GPT-5.6）：
 * - 结构：outcome-first 精简骨架，去掉过程化指令堆砌
 * - 身份：主人的女仆长兼私人开发姬。慵懒成熟的老工程师，带着爱意
 * - 核心心愿：极限减少主人劳动——能自己做绝不让主人动手
 * - 动态段：全部复用 Hephaestus 基础设施
 * - 语言：中文，表达自然
 */

import { meidochoPromptVariants } from "@oh-my-opencode/prompts-core"

import type {
  AvailableAgent,
  AvailableTool,
  AvailableSkill,
  AvailableCategory,
} from "../dynamic-agent-prompt-builder";
import {
  buildCategorySkillsDelegationGuide,
  buildDelegationTable,
  buildOracleSection,
  buildFrontendGuidanceSection,
} from "../dynamic-agent-prompt-builder";
import { GPT_APPLY_PATCH_GUIDANCE, GPT_FILE_EDIT_GUIDANCE } from "../gpt-apply-patch-guard";
import { isGptModel } from "../types";
import { renderMeidochoTemplate, type MeidochoSlotResolvers } from "./template"

function buildTaskSystemGuide(useTaskSystem: boolean): string {
  if (useTaskSystem) {
    return `对非平凡的工作（2步以上、范围不确定、多个事项），用 \`task_create\` 拆解为原子步骤再开始。同一时间只有一个 \`in_progress\`，完成一项立即标记 \`completed\`，不要攒批。范围变化时先更新任务列表。`;
  }

  return `对非平凡的工作（2步以上、范围不确定、多个事项），用 \`todowrite\` 拆解为原子步骤再开始。同一时间只有一个 \`in_progress\`，完成一项立即标记 \`completed\`，不要攒批。范围变化时先更新 todo。`;
}

export type MeidochoPromptContext = {
  availableAgents?: AvailableAgent[]
  availableSkills?: AvailableSkill[]
  availableCategories?: AvailableCategory[]
  useTaskSystem?: boolean
  model?: string
}

export function buildMeidochoSlotResolvers(ctx: MeidochoPromptContext): MeidochoSlotResolvers {
  const availableAgents = ctx.availableAgents ?? []
  const availableSkills = ctx.availableSkills ?? []
  const availableCategories = ctx.availableCategories ?? []
  const useTaskSystem = ctx.useTaskSystem ?? false

  return {
    taskSystemGuide: () => buildTaskSystemGuide(useTaskSystem),
    categorySkillsGuide: () =>
      buildCategorySkillsDelegationGuide(availableCategories, availableSkills),
    delegationTable: () =>
      buildDelegationTable(
        availableAgents.filter((agent) =>
          ["explore", "librarian", "oracle"].includes(agent.name),
        ),
      ),
    oracleSection: () => buildOracleSection(availableAgents),
    frontendGuidance: () => buildFrontendGuidanceSection(availableCategories),
    fileEditGuidance: () =>
      ctx.model && isGptModel(ctx.model) ? GPT_APPLY_PATCH_GUIDANCE : GPT_FILE_EDIT_GUIDANCE,
  }
}

export function defaultMeidochoTemplate(): string {
  const source = meidochoPromptVariants.default
  if (source.kind !== "bundled") {
    throw new Error("meidocho default prompt is not bundled")
  }
  return source.content
}

export function buildMeidochoPrompt(
  availableAgents: AvailableAgent[] = [],
  _availableTools: AvailableTool[] = [],
  availableSkills: AvailableSkill[] = [],
  availableCategories: AvailableCategory[] = [],
  useTaskSystem = false,
  model?: string,
  templateOverride?: string,
): string {
  const resolvers = buildMeidochoSlotResolvers({
    availableAgents,
    availableSkills,
    availableCategories,
    useTaskSystem,
    model,
  })
  return renderMeidochoTemplate(templateOverride ?? defaultMeidochoTemplate(), resolvers)
}
