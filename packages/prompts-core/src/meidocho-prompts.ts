import type { VariantTable } from "./types"
import defaultPrompt from "../prompts/meidocho/default.md"

export const meidochoPromptVariants = {
  default: {
    kind: "bundled",
    content: defaultPrompt,
    filePath: "packages/prompts-core/prompts/meidocho/default.md",
  },
} satisfies VariantTable
