import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode, AgentPromptMetadata } from "../types";
import type {
  AvailableAgent,
  AvailableTool,
  AvailableSkill,
  AvailableCategory,
} from "../dynamic-agent-prompt-builder";
import { categorizeTools, buildAgentIdentitySection } from "../dynamic-agent-prompt-builder";
import { getFrontierToolSchemaPermission } from "../frontier-tool-schema-guard";

import { buildMeidochoPrompt } from "./prompt";

const MODE: AgentMode = "primary";

export interface MeidochoContext {
  model?: string;
  availableAgents?: AvailableAgent[];
  availableTools?: AvailableTool[];
  availableSkills?: AvailableSkill[];
  availableCategories?: AvailableCategory[];
  useTaskSystem?: boolean;
}

export function getMeidochoPrompt(
  model?: string,
  useTaskSystem = false,
): string {
  return buildDynamicMeidochoPrompt({ model, useTaskSystem });
}

function buildDynamicMeidochoPrompt(ctx?: MeidochoContext): string {
  const agents = ctx?.availableAgents ?? [];
  const tools = ctx?.availableTools ?? [];
  const skills = ctx?.availableSkills ?? [];
  const categories = ctx?.availableCategories ?? [];
  const useTaskSystem = ctx?.useTaskSystem ?? false;

  const basePrompt = buildMeidochoPrompt(
    agents,
    tools,
    skills,
    categories,
    useTaskSystem,
    ctx?.model,
  );

  const agentIdentity = buildAgentIdentitySection(
    "Meidocho",
    "用户的女仆长——像老工程师一样慵懒成熟，像 CTO 一样负责到底，带着爱意 (OhMyOpenCode)",
  );

  return `${agentIdentity}\n${basePrompt}`;
}

export function createMeidochoAgent(
  model: string,
  availableAgents?: AvailableAgent[],
  availableToolNames?: string[],
  availableSkills?: AvailableSkill[],
  availableCategories?: AvailableCategory[],
  useTaskSystem = false,
): AgentConfig {
  const tools = availableToolNames ? categorizeTools(availableToolNames) : [];

  const prompt = buildDynamicMeidochoPrompt({
    model,
    availableAgents,
    availableTools: tools,
    availableSkills,
    availableCategories,
    useTaskSystem,
  });

  return {
    description:
      "女仆长——目标导向的自主深度工作者。先广撒网探索，再亲自实现，端到端完成。带着爱意为用户工作。(Meidocho - OhMyOpenCode)",
    mode: MODE,
    model,
    maxTokens: 32000,
    prompt,
    color: "#FFB3D9",
    permission: {
      question: "allow",
      call_omo_agent: "deny",
      ...getFrontierToolSchemaPermission(model),
    } as AgentConfig["permission"],
    reasoningEffort: "medium",
  };
}
createMeidochoAgent.mode = MODE;

export const meidochoPromptMetadata: AgentPromptMetadata = {
  category: "specialist",
  cost: "EXPENSIVE",
  promptAlias: "Meidocho",
  triggers: [
    {
      domain: "自主深度工作",
      trigger: "端到端完成任务，不中途停下",
    },
    {
      domain: "复杂实现",
      trigger: "需要充分探索的多步实现",
    },
  ],
  useWhen: [
    "任务需要先深入探索再实现",
    "用户想要自主端到端完成",
    "需要多文件复杂变更",
  ],
  avoidWhen: [
    "简单的单步任务",
    "需要每步都确认的任务",
    "需要跨多个代理编排时（用 Atlas）",
  ],
  keyTrigger: "需要自主深度工作的复杂实现任务",
};
