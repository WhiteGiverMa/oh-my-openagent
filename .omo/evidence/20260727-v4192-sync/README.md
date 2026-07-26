# v4.19.2 hybrid rebase and deployment QA

## What was tested

- `bun test` against the rebased worktree.
- `bun run typecheck` and `bun run build` against the rebased worktree.
- OpenCode 1.18.5 dependency and TUI smoke checks from the `opencode-qa` skill.
- A fresh isolated OpenCode CLI run loading this worktree's `dist/index.js`, selecting the registered `meidocho` agent, and calling a local fake OpenAI-compatible provider.
- A fresh isolated server check loading the same plugin and resolving `meidocho` through the `/agent` API.

## What was observed

- Full suite: 12,275 passed, 3 skipped, 0 failed, 38,208 assertions.
- Typecheck: passed across root, scripts, and all workspace packages.
- Build: passed; regenerated the v4.19.2 Codex installer, CodeGraph runtime, Senpi extensions/skills, LSP runtimes, schema, CLI bundles, and main dist.
- The real CLI run returned `TUI_NOREG_OK` from the fake provider and recorded `branch=default`, proving the current bundled plugin loaded and reached the model surface.
- The same isolated server returned `meidocho` in its registered agent list.
- Host OpenCode session count remained 102 before and after the live CLI QA. The TUI smoke also recorded an unchanged host count.
- Temporary XDG homes, fake provider process, OpenCode server, curl watcher, and tmux session were removed by their cleanup paths.

Exact command outputs are in the neighboring `.txt` and `.jsonl` artifacts, especially `plugin-live-cli.txt`, `plugin-live-run.jsonl`, and `tui-smoke.txt`.

## Why it is enough

The source is based on the official v4.19.2 tag, the full repository gate is green, generated deployment artifacts were rebuilt, and the current published bundle was exercised through real OpenCode server and CLI surfaces in an isolated environment. Existing committed evidence in `20260726-runtime-prompt-append/` separately proves the model-aware runtime append behavior and compaction suppression using the same worktree feature set.

## What was omitted

The generic `server-smoke.sh`, `sse-hook-probe.sh`, and `serve-wake-split-probe.sh --self-test` helpers did not finish under the installed OpenCode 1.18.5 event/runtime behavior; their timeout/debug outputs are retained and not reported as passes. No real provider credentials, host configuration, private auth files, or unredacted environment dumps were copied into evidence.
