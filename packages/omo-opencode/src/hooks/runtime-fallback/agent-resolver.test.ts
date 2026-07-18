import { describe, expect, test } from "bun:test"
import { detectAgentFromSession, normalizeAgentName } from "./agent-resolver"

describe("runtime fallback agent resolver", () => {
  test("recognizes Meidocho from event names and session identifiers", () => {
    expect(normalizeAgentName("Meidocho - 女仆长♥️")).toBe("meidocho")
    expect(detectAgentFromSession("background-meidocho-worker")).toBe("meidocho")
  })
})
