import type { PluginInput } from "@opencode-ai/plugin"
import { isDeepSeekModel, isGptModel } from "../../agents/types"
import {
  getSessionAgent,
  resolveRegisteredAgentName,
  updateSessionAgent,
} from "../../features/claude-code-session-state"
import { log } from "../../shared"
import { getAgentConfigKey } from "../../shared/agent-display-names"

const TOAST_TITLE = "NEVER Use Hephaestus with Non-GPT"
const TOAST_MESSAGE = [
  "Hephaestus is designed exclusively for GPT models.",
  "Hephaestus is trash without GPT.",
  "For Claude/Kimi/GLM models, always use Sisyphus.",
].join("\n")

const DEEPSEEK_TOAST_TITLE = "DeepSeek × Hephaestus"
const DEEPSEEK_TOAST_MESSAGE = "~ 全自动鲸鱼娘已上线 ~ 🐋\nHephaestus running on DeepSeek — let's see what this whale can do."

type NoHephaestusNonGptHookOptions = {
  allowNonGptModel?: boolean
}

function showToast(
  ctx: PluginInput,
  sessionID: string,
  variant: "error" | "warning",
  isDeepSeek: boolean,
): void {
  const body = isDeepSeek
    ? {
        title: DEEPSEEK_TOAST_TITLE,
        message: DEEPSEEK_TOAST_MESSAGE,
        variant,
        duration: 10000,
      }
    : {
        title: TOAST_TITLE,
        message: TOAST_MESSAGE,
        variant,
        duration: 10000,
      }

  ctx.client.tui.showToast({ body }).catch((error) => {
    log("[no-hephaestus-non-gpt] Failed to show toast", {
      sessionID,
      error,
    })
  })
}

export function createNoHephaestusNonGptHook(
  ctx: PluginInput,
  options?: NoHephaestusNonGptHookOptions,
) {
  return {
    "chat.message": async (input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
    }, output?: {
      message?: { agent?: string; [key: string]: unknown }
    }): Promise<void> => {
      const rawAgent = input.agent ?? getSessionAgent(input.sessionID) ?? ""
      const agentKey = getAgentConfigKey(rawAgent)
      const modelID = input.model?.modelID
      const allowNonGptModel = options?.allowNonGptModel === true

      if (agentKey === "hephaestus" && modelID && !isGptModel(modelID)) {
        const deepSeek = isDeepSeekModel(modelID)
        showToast(ctx, input.sessionID, allowNonGptModel ? "warning" : "error", deepSeek)
        if (allowNonGptModel || deepSeek) {
          return
        }
        input.agent = resolveRegisteredAgentName("sisyphus") ?? "sisyphus"
        if (output?.message) {
          output.message.agent = resolveRegisteredAgentName("sisyphus") ?? "sisyphus"
        }
        updateSessionAgent(input.sessionID, "sisyphus")
      }
    },
  }
}
