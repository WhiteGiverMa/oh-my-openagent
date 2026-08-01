# v4.19.4 fork rebase and dual-platform deployment

## What was tested

- Rebased `fix/hybrid-v4.19.1` onto upstream tag `v4.19.4`.
- Backed up the pre-build WSL and Windows deployment trees before replacement.
- Ran `bun install --frozen-lockfile`, `bun run build`, `bun run typecheck`, `bun test`, and `bun run test:codex`.
- Ran the OpenCode QA surfaces: common harness self-check, server health/auth, SSE hook probe, wake-split probe, tmux TUI smoke, LSP self-test, LSP diagnostics, and live plugin captures.
- Deployed the rebuilt dist and skills to both configured local checkouts, then verified native imports and Meidocho agent registration.

## What was observed

- Rebased WSL HEAD: `9a4e95896ac1739dfb97709221347da4f476be7c`.
- Upstream base: `v4.19.4` / `b072d279110bdda2c6ac2525d0d24dc54d16148a`.
- The first full test run stopped at five stale-generated-artifact failures before the rebuild. The post-build run completed with `12710 pass`, `3 skip`, and `0 fail`; the exact counts and rerun decision are recorded in `test-summary.txt`, while raw outputs remain local as `full-tests.txt` and `full-tests-after-build.txt`.
- Typecheck, build, and Codex compatibility tests exited successfully. Codex recorded `78 pass`, then `393 pass / 1 skip / 0 fail` across its gates.
- The isolated OpenCode QA kept the real session count unchanged at `166`. The final live compaction capture returned HTTP 200 and produced the expected eight numbered headings.
- Rebuilt dist hash on WSL and Windows: `0e781d7c4bf7ebf9ba1cd792afe4201077db574b684fa635221945ecc18c2591`.
- Both deployments contain `278` skill files. WSL OpenCode 1.18.9 and native Windows OpenCode 1.18.10 both load and list Meidocho.

## Why this is enough

The build and type gates cover the generated bundle and package graph. The full test and Codex gates cover the cross-harness behavior. The isolated server, SSE, TUI, LSP, and live captures exercise the OpenCode-facing use surfaces while the unchanged database count proves the QA sandbox did not pollute the real session store. Matching deployed hashes and native registration cover the two local runtime targets.

## Omitted or redacted

- Raw provider responses, prompt bodies, auth headers, environment dumps, and large OpenCode agent-list captures remain local-only and are not committed.
- The malformed/timeout compaction probe attempts are retained locally for diagnosis; only the successful final capture is used as acceptance evidence.
- No real provider credential was copied into the evidence directory.

## Evidence index

- `build.txt`, `typecheck-after-build.txt`, `test-summary.txt`, `codex-test.txt`
- `server-smoke.txt`, `sse-hook-probe.txt`, `serve-wake-split-self-test.txt`, `tui-smoke.txt`
- `lsp-e2e-self-test.txt`, `lsp-summary.txt`
- `plugin-live-capture-compaction-final-2.txt`, `plugin-live-normal-control.txt`, `isolation-receipt.txt`
- `wsl-build-artifacts.txt`, `runtime-reload.txt`
- `rebase-conflicts.txt`
