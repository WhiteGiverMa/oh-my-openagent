# QA Evidence: Meidocho prompt_template（模板外部化 + 严格校验 + 热重载拦截）

Date: 2026-08-11 | Branch: feat/meidocho-prompt-template (base: fix/hybrid-v4.19.1-without-pr-6160)

## WHAT WAS TESTED

真实 OpenCode serve（隔离 XDG 沙箱 + 自研 fake OpenAI capture server），驱动脚本
`drive-qa.sh`，capture server `capture-openai.mjs`（记录每个请求的完整 body 到
CAPTURE_LOG，回复固定 SSE 文本 QA_OK_N）。插件加载 worktree 构建产物
`dist/index.js`。9 个场景：

| 场景 | 行为断言 | 结果 |
|---|---|---|
| D baseline | 未配 prompt_template 时 bundled 默认模板原文到达模型 | PASS |
| A render | 配置合法用户模板后，模板标记 MARKER_V1_QA713 到达模型 | PASS |
| A2 hot-reload | 同一 server 进程内改模板为 v2，下条消息携带 MARKER_V2_QA889，且 MARKER_V1 完全消失 | PASS ×2 |
| B block | 模板删掉一个必需占位符后：①模型零调用（capture call count 不变）②被拦消息未入沙箱 DB ③错误单「模板无效，本条消息已被拦截 / 缺少必需占位符 {{ delegationTable }}」出现在 SSE 事件流 | PASS ×3 |
| C recover | 修复模板（含 `{{ oracleSection:omit }}`）后无需重启，MARKER_V3_QA960 到达模型 | PASS |
| isolation | 宿主 `~/.local/share/opencode/opencode.db` session count 前后不变（271 → 271） | PASS |

## WHAT WAS OBSERVED

- 驱动脚本输出：`qa-results.txt`（全部 PASS 行）。
- 沙箱与 capture 原文由 trap 清理；场景 D 失败调试期保留的沙箱已手动删除。
- 调试期发现并已修复的实现 bug（均有单元测试 pin）：
  1. **agent 识别**：OpenCode 以 displayName（"Meidocho - 女仆长♥️"）作为 agent key，guard/replacer 改为 `getAgentConfigKey()` 归一化判断（`chat-message.test.ts` 4 例）。
  2. **omo-config-core strict schema**：`.omo/omo.jsonc` 的 agents 定义走 `OmoAgentDefSchema.strict()`，新增 `prompt_template` 字段，否则整个配置文件被回退为全默认（`agent-schema.test.ts` 1 例）。
  3. **reconcile 锚点**：OpenCode core 每请求用注册时的原始 baked prompt 重建 system 数组，替换锚必须永远是注册渲染而非上次替换结果，否则第二次热更新失效（`runtime-template.test.ts` 连续热更新用例）。
- QA 驱动脚本自身修复：export CAPTURE_LOG、unset OPENCODE_SERVER_PASSWORD/OPENCODE/OPENCODE_PID（父进程注入的认证 env 会让沙箱 server 401）、`exec` 前缀启动使 `$!` 指向 opencode 真身（括号子 shell 会留下杀不掉的孤儿）、模板文件必须放在 project 边界内。

## WHY IT IS ENOUGH

- 渲染、热重载、拦截、恢复四条主路径均在**真实 serve 进程**内以 HTTP + SSE 观察，
  非单测模拟：capture body 证明 system prompt 内容，DB count 证明拦截消息未持久化，
  SSE 证明错误单抵达客户端事件流。
- 拦截场景同时断言「零模型调用」+「未入库」+「错误单可见」，覆盖用户契约的三要素。
- 残余风险：Desktop/TUI 客户端对 `session.error` 事件的呈现样式未逐像素核对（事件
  内容已在 SSE 断言，呈现为各客户端通用错误通道）；多会话并发热重载未压测（状态机
  为进程级，语义与 sisyphus reconciler 同级）。

## WHAT WAS OMITTED

- 未复制真实 provider 凭据；全部请求走本地 fake capture server。
- 宿主 `~/.omo/omo.jsonc` 真实内容未读取/未打印（仅依赖项目层配置覆盖）。
- 未触碰生产服务（:4097, pid 85447）与宿主 DB（session count 271 → 271 证明）。

## 复现

```bash
bun run build
bash .omo/evidence/20260811-meidocho-prompt-template/drive-qa.sh
```
