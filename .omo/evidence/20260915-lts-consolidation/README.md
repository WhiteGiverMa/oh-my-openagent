# LTS Consolidation QA Evidence — 2026-09-15

## Scope

19 upstream PRs cherry-picked onto `fix/hybrid-v4.19.1-without-pr-6160` (base v4.19.4)
+ one fork-original fix discovered during QA (gpt-6 heuristic family, ported from #7790).
Change surface: `packages/omo-opencode` (agent-overrides, chat-message, background-agent,
runtime-fallback, live-server-route, event-session-lifecycle, delegate-task, team-mode,
hook caches, atlas, compaction injectors), `model-core`, `delegate-core`, `omo-senpi`,
`omo-codex` installer.

## What was tested

- `bun test` full suite: **12876 pass / 3 skip / 0 fail** (38173 assertions, 1688 files).
- `bun run typecheck` (tsgo root + script + all packages): exit 0.
- `bun run build`: exit 0, all steps; require shim present
  (`var __require = typeof import.meta.require === "function" ? ...` in dist/index.js);
  dist/skills populated.
- Live-surface QA (`drive-qa.sh`, isolated XDG+HOME sandbox, fake OpenAI capture server,
  host DB session count compared):

| # | Check | Result |
|---|-------|--------|
| 1 | sandbox `opencode serve` healthy with new dist | PASS |
| 2 | SSE `/event` delivers `server.connected` | NOT RUN TO PASS — probe delivers nothing under OpenCode >= 1.18.5 in this environment (known issue per fork notepad §14; same outcome recorded in 20260812 QA; not a regression of this change) |
| 3 | plugin loads; `/agent` lists `Meidocho - 女仆长♥️` | PASS |
| 4 | #6617: `agents.meidocho.reasoning:"max"` lowers to agent `variant=max` at build time (`/agent` output) | PASS |
| 5 | wire: prompt to fake provider carries `"effort":"max"` — gpt-5.5 on @ai-sdk/openai | PASS |
| 6 | wire: same for gpt-6-astra on @ai-sdk/openai (Responses API) | PASS (after gpt-6 family fix; FAILED before it) |
| 7 | wire: same for gpt-6-astra on @ai-sdk/openai-compatible (Chat Completions) | PASS (after gpt-6 family fix; FAILED before it) |
| 8 | fake provider reply rendered in session (sandbox DB) | PASS |
| 9 | host DB session count unchanged 327 → 327 | PASS |

## The gpt-6 finding (why check 6/7 failed before the fix)

With variant=max correctly applied end to end, gpt-6-astra requests carried NO reasoning
field on the wire. `detectHeuristicModelFamily("gpt-6-astra")` fell past `gpt-5`
(`includes "gpt-5"`) into `gpt-legacy` (`includes "gpt"`), whose entry has no
`reasoningEfforts`, so `resolveCompatibleModelSettings` dropped the variant-preset-merged
`reasoningEffort:"max"` as `unsupported-by-model-family` and chat-params deleted it from
options. gpt-5.5 matched the gpt-5 family (which lists max) and passed.

Fix: ported the gpt-6 family block (and the `supportsTemperature?` type field it needs)
from upstream #7790 (`0fe0ac98f`) only; the PR's category re-routing was not taken.

## Omitted

- No real provider credentials anywhere in this directory; the capture server is local-only.
- Sandbox serve/SSE logs contain no secrets (fake apiKey).
- Preserved failure sandboxes from intermediate runs were deleted after inspection;
  final green runs self-cleaned.
