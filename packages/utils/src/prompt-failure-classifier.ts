export function extractPromptFailureMessage(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>
    if (typeof record.message === "string") return record.message
    try {
      return JSON.stringify(error)
    } catch (stringifyError) {
      stringifyError instanceof Error
      return ""
    }
  }
  return String(error)
}

export function isAmbiguousPromptDispatchFailure(error: unknown): boolean {
  const message = extractPromptFailureMessage(error).toLowerCase()
  return (
    message.includes("unexpected eof")
    || message.includes("json parse error")
    || message.includes("unexpected end of json input")
    || message.includes("timed out")
  )
}

export type PromptDispatchFailureResultLike = {
  status: "failed"
  error: unknown
  dispatchAttempted?: boolean
}

export function isAmbiguousPostDispatchPromptFailure(result: PromptDispatchFailureResultLike): boolean {
  return result.dispatchAttempted === true && isAmbiguousPromptDispatchFailure(result.error)
}


const VERIFICATION_INDEPENDENT_AMBIGUOUS_PATTERNS = [
  "unexpected eof",
  "json parse error",
  "unexpected end of json input",
] as const

const VERIFICATION_DEPENDENT_AMBIGUOUS_PATTERNS = [
  "timed out",
] as const

function promptFailureMessageMatches(error: unknown, patterns: readonly string[]): boolean {
  const message = extractPromptFailureMessage(error).toLowerCase()
  return patterns.some((pattern) => message.includes(pattern))
}

export function isVerificationIndependentAmbiguousPromptDispatchFailure(error: unknown): boolean {
  return promptFailureMessageMatches(error, VERIFICATION_INDEPENDENT_AMBIGUOUS_PATTERNS)
}

// For callers that verify post-dispatch acceptance (e.g. parent-wake via
// hasRecordedPromptAfterDispatch): timeouts remain ambiguous so the caller can
// confirm delivery before retrying instead of risking a duplicate dispatch.
export function isVerifiableAmbiguousPromptFailure(result: PromptDispatchFailureResultLike): boolean {
  return result.dispatchAttempted === true && isAmbiguousPromptDispatchFailure(result.error)
}

export function normalizeBackgroundError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('Session closed or not found')) {
      return 'background session not found or closed'
    }
    return error.message
  }
  return String(error)
}

export function isBackgroundSessionTerminated(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('Session closed or not found')
  }
  const msg = String(error)
  return msg.includes('Session closed') || msg.includes('not found')
}
