# Meidocho Prompt Template Externalization

> 计划日期：2026-08-11 | 分支：feat/meidocho-prompt-template（base: fix/hybrid-v4.19.1-without-pr-6160）
> 自用功能，不 PR 上游；完成后 merge 回 hybrid 生产分支。

## 目标（与主人确认的 UX 契约）

1. 默认提示词外部化为 **git 追踪** 的 md，内容 = 现 `prompt.ts` 的 `MEIDOCHO_TEMPLATE` 原文（含 6 个 `{{ slot }}` 占位符）。
2. 用户层 `agents.meidocho.prompt_template: "file://..."` 指向仓库外 md。**仅 meidocho schema 有此键**（`.extend()` 先例 = hephaestus `allow_non_gpt_model`）；sisyphus/hephaestus schema 与工厂零改动，未知键被 Zod 静默剥除。
3. 6 个命名槽位运行时渲染；占位符在 md 中的位置 = 渲染位置（滑块语义）；缺失槽位不渲染的唯一合法形式是显式 `{{ name:omit }}`。
4. 严格校验（每条消息发送时）：缺占位符 / 占位符重复 / 未知占位符 → **拦截该消息**（`chat.message` hook throw → 消息不入库、不调用模型、错误详情经 `session.error` 事件立刻推送客户端）。
5. 热重载：mtime 变化 → 重读 + 重校验 + 重渲染 → `system.transform` 替换已烘焙 prompt；无效则拦截下条消息，修复后自动恢复。改 md 保存后下一条消息即生效，零重启零构建。
6. 未配置 `prompt_template`：guard/replacer 均不激活，零开销，行为与今天完全一致。

## 本体事实（已读源码确认）

- `plugin.trigger` 不 catch hook 异常（`packages/opencode/src/plugin/index.ts:282`）。
- `chat.message` 触发点在消息入库之前（`packages/opencode/src/session/prompt.ts:999`，save 在 ~1039 之后）。
- `promptAsync` 失败经 `catchCause` publish `Session.Event.Error`，message 含完整 cause（`handlers/session.ts:316`）。
- `sisyphus-runtime-prompt-reconciler.ts` = system.transform 处 substring 替换已烘焙 prompt 的现成模式。

## 文件清单

### 新建

| 文件 | 内容 |
|---|---|
| `packages/prompts-core/prompts/meidocho/default.md` | 默认模板（git 追踪），原文提取自 prompt.ts，保留 6 占位符 |
| `packages/prompts-core/src/meidocho-prompts.ts` | `meidochoPromptVariants`（仿 prometheus-prompts.ts，10 行） |
| `packages/omo-opencode/src/agents/meidocho/template.ts` | 槽位注册表 + `renderMeidochoTemplate` + `validateMeidochoTemplate`（四规则）+ 错误单生成（含编辑距离拼写建议） |
| `packages/omo-opencode/src/agents/meidocho/runtime-template.ts` | 模块级状态：模板来源路径、mtime、渲染缓存、校验错误单；`refreshMeidochoRuntimeTemplate()` |
| `packages/omo-opencode/src/agents/meidocho/template.test.ts` | 校验器/渲染器测试 |
| `packages/omo-opencode/src/agents/meidocho/runtime-template.test.ts` | 状态机测试 |

### 修改

| 文件 | 改动 |
|---|---|
| `packages/prompts-core/src/index.ts` | 导出 meidocho variants |
| `packages/omo-opencode/src/agents/meidocho/prompt.ts` | 删 386 行常量；`buildMeidochoPrompt(..., templateOverride?)` 走 bundled md + 渲染管线 |
| `packages/omo-opencode/src/agents/meidocho/agent.ts` | `createMeidochoAgent` 透传 template 参数 |
| `packages/omo-opencode/src/agents/builtin-agents/meidocho-agent.ts` | 读 `override.prompt_template` → resolve-file-uri 同步读 → 登记 runtime-template 状态（有效渲染 / 无效错误单） |
| `packages/omo-opencode/src/config/schema/agent-overrides.ts` | `AgentOverridesSchema` 加 `meidocho: AgentOverrideConfigSchema.extend({ prompt_template: z.string().optional() }).optional()` |
| `packages/omo-opencode/src/plugin/chat-message.ts`（或实际挂载点） | meidocho guard：agent==meidocho 且配了模板 → refresh → 无效 throw 错误单 |
| system.transform 挂载点（待侦查确认文件） | meidocho replacer：渲染结果 ≠ baked 时 substring 替换 |
| `packages/omo-opencode/src/agents/meidocho/prompt.test.ts` | 更新为渲染管线断言 |
| `assets/oh-my-opencode.schema.json` | `bun run build:schema` 重新生成 |

## 待侦查确认（实现前）

1. `plugin/chat-message.ts` 现有结构与 guard 挂载方式。
2. `experimental.chat.system.transform` handler 文件（hephaestusAgentsMdInjector 所在处）。
3. `resolve-file-uri.ts` 的同步读接口（`resolvePromptAppend`）与边界语义。
4. `script/build.ts` 对 omo-opencode 包外 `.md` import 的 loader（prompts-core 已有先例，预期直接可行）。

## 校验规则（四规则）

- 每个必需槽位（`taskSystemGuide`、`categorySkillsGuide`、`delegationTable`、`oracleSection`、`frontendGuidance`、`fileEditGuidance`）的正常形式 + `:omit` 形式出现总数**恰好一次**。
- 未知占位符名 → 错误，按编辑距离给「你是不是想写 X」建议。
- `{{ name:omit }}` → 渲染为空（整行只剩它时清理该行）。
- 校验失败 → 生成错误单：文件路径、逐条问题、必需槽位清单、omit 语法说明、修复后重发提示。

## 验证

1. 定向 `bun test`（template / runtime-template / prompt / schema）+ 全量 `bun test`。
2. `bun run typecheck`。
3. `bun run build`（退出码 0）。
4. **opencode-qa 隔离 QA**（XDG 沙箱，绝不碰 4097 生产服务与宿主 DB）：
   - a. 配 `prompt_template` 指向测试 md → `opencode run --format json` 发消息 → 正常完成（渲染生效）。
   - b. 改坏模板（删一个占位符）→ 发消息 → 拦截：错误单出现、该消息未入库（沙箱 DB message count 不变）。
   - c. 修复 → 发消息 → 恢复。
   - d. 合法改动（加独特标记句）→ 发消息 → 热重载生效（行为/输出可观察）。
   - e. 宿主 `~/.local/share/opencode/opencode.db` session count 前后不变。
   - evidence → `.omo/evidence/20260811-meidocho-prompt-template/`（含 WHAT/OBSERVED/WHY/OMITTED）。

## 交接

- merge 回 `fix/hybrid-v4.19.1-without-pr-6160`（merge commit），清理 worktree。
- 功能上线需一次标准部署（备份 → build → 双端同步），由主人按 SOP 执行或另行安排；之后的提示词微调永久免构建。
