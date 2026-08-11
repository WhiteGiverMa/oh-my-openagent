import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS, isAnyProviderConnected } from "../../shared"
import { log } from "../../shared/logger"
import { createMeidochoAgent } from "../meidocho"
import { buildMeidochoPrompt, buildMeidochoSlotResolvers } from "../meidocho/prompt"
import { configureMeidochoRuntimeTemplate } from "../meidocho/runtime-template"
import { applyEnvironmentContext } from "./environment-context"
import { applyCategoryOverride, mergeAgentConfig } from "./agent-overrides"
import { applyModelResolution, getFirstFallbackModel } from "./model-resolution"
import { applyFrontierToolSchemaPermission } from "../frontier-tool-schema-guard"
import { resolvePromptTemplateFile } from "./resolve-file-uri"

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

  const { prompt_template: promptTemplateUri, ...overrideForMerge } = meidochoOverride ?? {}

  let promptOverride: string | undefined
  if (promptTemplateUri) {
    const resolved = resolvePromptTemplateFile(promptTemplateUri, directory)
    const resolvers = buildMeidochoSlotResolvers({
      availableAgents,
      availableSkills,
      availableCategories,
      useTaskSystem,
      model: meidochoModel,
    })
    const bundledRendered = buildMeidochoPrompt(
      availableAgents,
      undefined,
      availableSkills,
      availableCategories,
      useTaskSystem,
      meidochoModel,
    )
    const runtimeResult = configureMeidochoRuntimeTemplate({
      templateContent: resolved.ok
        ? { filePath: resolved.filePath, content: resolved.content }
        : undefined,
      loadFailureReason: resolved.ok ? undefined : resolved.reason,
      resolvers,
      bundledRendered,
    })
    if (runtimeResult.kind === "active" || runtimeResult.kind === "invalid") {
      promptOverride = runtimeResult.prompt
      if (runtimeResult.kind === "invalid") {
        log("[meidocho-agent] prompt_template invalid at registration; messages will be blocked until fixed", {
          filePath: resolved.ok ? resolved.filePath : promptTemplateUri,
          reason: resolved.ok ? "validation failed" : resolved.reason,
        })
      }
    }
  }

  let meidochoConfig = createMeidochoAgent(
    meidochoModel,
    availableAgents,
    undefined,
    availableSkills,
    availableCategories,
    useTaskSystem,
    promptOverride,
  )

  meidochoConfig = { ...meidochoConfig, variant: meidochoResolvedVariant ?? "medium" }

  const mdOverrideCategory = (meidochoOverride as Record<string, unknown> | undefined)?.category as string | undefined
  if (mdOverrideCategory) {
    meidochoConfig = applyCategoryOverride(meidochoConfig, mdOverrideCategory, mergedCategories)
  }

  meidochoConfig = applyEnvironmentContext(meidochoConfig, directory, { disableOmoEnv })

  if (meidochoOverride) {
    meidochoConfig = mergeAgentConfig(meidochoConfig, overrideForMerge, directory)
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
