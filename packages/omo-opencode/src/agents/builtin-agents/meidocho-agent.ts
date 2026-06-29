import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS, isAnyProviderConnected } from "../../shared"
import { log } from "../../shared/logger"
import { createMeidochoAgent } from "../meidocho"
import { applyEnvironmentContext } from "./environment-context"
import { applyCategoryOverride, mergeAgentConfig } from "./agent-overrides"
import { applyModelResolution, getFirstFallbackModel } from "./model-resolution"
import { applyFrontierToolSchemaPermission } from "../frontier-tool-schema-guard"

export function maybeCreateMeidochoConfig(input: {
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  availableModels: Set<string>
  systemDefaultModel?: string
  isFirstRunNoCache: boolean
  availableAgents: AvailableAgent[]
  availableSkills: AvailableSkill[]
  availableCategories: AvailableCategory[]
  mergedCategories: Record<string, CategoryConfig>
  directory?: string
  useTaskSystem: boolean
  disableOmoEnv?: boolean
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    availableModels,
    systemDefaultModel,
    isFirstRunNoCache,
    availableAgents,
    availableSkills,
    availableCategories,
    mergedCategories,
    directory,
    useTaskSystem,
    disableOmoEnv = false,
  } = input

  if (disabledAgents.includes("meidocho")) return undefined

  const meidochoOverride = agentOverrides["meidocho"]
  const meidochoRequirement = AGENT_MODEL_REQUIREMENTS["meidocho"]
  const hasMeidochoExplicitConfig = meidochoOverride !== undefined

  const hasRequiredProvider =
    !meidochoRequirement?.requiresProvider ||
    hasMeidochoExplicitConfig ||
    isFirstRunNoCache ||
    isAnyProviderConnected(meidochoRequirement.requiresProvider, availableModels)

  if (!hasRequiredProvider) {
    log("[agent-registration] Agent skipped: required provider not connected", {
      agent: "meidocho",
      requiredProvider: meidochoRequirement?.requiresProvider,
    })
    return undefined
  }

  let meidochoResolution = applyModelResolution({
    userModel: meidochoOverride?.model,
    requirement: meidochoRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (isFirstRunNoCache && !meidochoOverride?.model) {
    meidochoResolution = getFirstFallbackModel(meidochoRequirement)
  }

  if (!meidochoResolution) {
    log("[agent-registration] Agent skipped: model resolution returned no result", {
      agent: "meidocho",
      configuredModel: meidochoOverride?.model,
    })
    return undefined
  }
  const { model: meidochoModel, variant: meidochoResolvedVariant } = meidochoResolution

  let meidochoConfig = createMeidochoAgent(
    meidochoModel,
    availableAgents,
    undefined,
    availableSkills,
    availableCategories,
    useTaskSystem,
  )

  meidochoConfig = { ...meidochoConfig, variant: meidochoResolvedVariant ?? "medium" }

  const mdOverrideCategory = (meidochoOverride as Record<string, unknown> | undefined)?.category as string | undefined
  if (mdOverrideCategory) {
    meidochoConfig = applyCategoryOverride(meidochoConfig, mdOverrideCategory, mergedCategories)
  }

  meidochoConfig = applyEnvironmentContext(meidochoConfig, directory, { disableOmoEnv })

  if (meidochoOverride) {
    meidochoConfig = mergeAgentConfig(meidochoConfig, meidochoOverride, directory)
  }

  const resolvedModel = meidochoConfig.model ?? ""
  meidochoConfig.permission = applyFrontierToolSchemaPermission(
    meidochoConfig.permission,
    resolvedModel,
    meidochoOverride?.permission,
    (meidochoOverride as { tools?: Record<string, boolean> } | undefined)?.tools
  )

  return meidochoConfig
}
