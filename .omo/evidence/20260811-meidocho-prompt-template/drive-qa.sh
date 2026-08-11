#!/usr/bin/env bash
# QA driver: meidocho prompt_template feature.
# Scenarios (all in an isolated XDG sandbox, fake OpenAI capture server):
#   D  baseline      - no prompt_template configured, bundled template reaches the model
#   A  render        - valid user template marker reaches the model
#   A2 hot-reload    - same server process, edited template v2 reaches the model (no restart)
#   B  block         - broken template: message blocked, zero model calls, not persisted
#   C  recover       - fixed template works again without restart
# Isolation proof: host ~/.local/share/opencode/opencode.db session count unchanged.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PLUGIN_DIST="$REPO_ROOT/dist/index.js"
RESULTS="$SCRIPT_DIR/qa-results.txt"
: >"$RESULTS"

HOST_DB="$HOME/.local/share/opencode/opencode.db"
host_session_count() { sqlite3 "$HOST_DB" "SELECT count(*) FROM session" 2>/dev/null || echo "ERR"; }

pass() { echo "PASS $1" | tee -a "$RESULTS"; }
fail() {
  echo "FAIL $1" | tee -a "$RESULTS"
  QA_FAILED=1
  echo "sandbox preserved for inspection: $SANDBOX" | tee -a "$RESULTS"
  exit 1
}
note() { echo "NOTE $1" | tee -a "$RESULTS"; }

command -v opencode >/dev/null || fail "opencode not on PATH"
command -v sqlite3 >/dev/null || fail "sqlite3 not on PATH"
[ -f "$PLUGIN_DIST" ] || fail "plugin dist missing: $PLUGIN_DIST (run bun run build first)"

HOST_COUNT_BEFORE="$(host_session_count)"
note "host session count before: $HOST_COUNT_BEFORE"

SANDBOX="$(mktemp -d /tmp/meidocho-pt-qa-XXXXXX)"
WORKDIR="$SANDBOX/workdir"
mkdir -p "$WORKDIR/.omo"
export XDG_DATA_HOME="$SANDBOX/xdg-data"
export XDG_CONFIG_HOME="$SANDBOX/xdg-config"
export XDG_STATE_HOME="$SANDBOX/xdg-state"
export XDG_CACHE_HOME="$SANDBOX/xdg-cache"
export TMPDIR="$SANDBOX/tmp"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_MODELS_FETCH=1
# The QA shell itself may run inside an opencode process that injects auth +
# identity env. Strip them so the sandbox server starts UNAUTHENTICATED and the
# nested instance never believes it is the parent.
unset OPENCODE_SERVER_PASSWORD OPENCODE OPENCODE_PID
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME" "$TMPDIR"

CAPTURE_LOG="$SANDBOX/capture.log"
SSE_LOG="$SANDBOX/sse.log"
SERVER_PID=""
CAPTURE_PID=""
SERVER_PORT=""
SSE_PID=""

cleanup() {
  [ -n "$SSE_PID" ] && kill "$SSE_PID" 2>/dev/null || true
  [ -n "$SERVER_PID" ] && kill -9 "$SERVER_PID" 2>/dev/null || true
  [ -n "$CAPTURE_PID" ] && kill "$CAPTURE_PID" 2>/dev/null || true
  [ "${QA_FAILED:-0}" = "1" ] || rm -rf "$SANDBOX"
}
trap cleanup EXIT

# --- capture server (fake OpenAI) ---
CAPTURE_PORT=""
CAPTURE_LOG="$CAPTURE_LOG" node "$SCRIPT_DIR/capture-openai.mjs" >"$SANDBOX/capture.stdout" 2>&1 &
CAPTURE_PID=$!
for _ in $(seq 1 50); do
  [ -s "$SANDBOX/capture.stdout" ] && break
  sleep 0.1
done
CAPTURE_PORT="$(grep -oE 'listening on [0-9]+' "$SANDBOX/capture.stdout" | awk '{print $3}' | head -1)"
[ -n "$CAPTURE_PORT" ] || fail "capture server did not start"
note "capture server on :$CAPTURE_PORT"

# --- sandbox opencode.jsonc (fake provider + local dist plugin) ---
mkdir -p "$XDG_CONFIG_HOME/opencode"
cat >"$XDG_CONFIG_HOME/opencode/opencode.jsonc" <<JSONC
{
  "plugin": ["file://$PLUGIN_DIST"],
  "model": "openai/gpt-fake",
  "provider": {
    "openai": {
      "options": { "apiKey": "fake-key", "baseURL": "http://127.0.0.1:$CAPTURE_PORT/v1", "timeout": 30000 },
      "models": { "gpt-fake": { "tool_call": true, "limit": { "context": 200000, "output": 8192 } } }
    }
  },
  "permission": { "bash": "allow" }
}
JSONC

free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()' 2>/dev/null || echo $((20000 + RANDOM % 20000)); }

start_server() {
  SERVER_PORT="$(free_port)"
  (cd "$WORKDIR" && exec opencode serve --hostname 127.0.0.1 --port "$SERVER_PORT" >"$SANDBOX/server-$SERVER_PORT.log" 2>&1) &
  SERVER_PID=$!
  local ok=""
  for _ in $(seq 1 100); do
    if curl -fsS --max-time 2 "http://127.0.0.1:$SERVER_PORT/global/health" >/dev/null 2>&1; then ok=1; break; fi
    sleep 0.2
  done
  [ -n "$ok" ] || fail "opencode server did not become healthy on :$SERVER_PORT (log: $SANDBOX/server-$SERVER_PORT.log)"
  curl -fsSN --max-time 600 "http://127.0.0.1:$SERVER_PORT/event?directory=$WORKDIR" >"$SSE_LOG" 2>/dev/null &
  SSE_PID=$!
  note "opencode server on :$SERVER_PORT (pid $SERVER_PID)"
}

stop_server() {
  [ -n "$SSE_PID" ] && kill "$SSE_PID" 2>/dev/null || true
  SSE_PID=""
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    for _ in $(seq 1 25); do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -9 "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  SERVER_PID=""
  sleep 0.5
}

new_session() {
  curl -fsS --max-time 10 -X POST -H 'Content-Type: application/json' \
    -d "{\"directory\":\"$WORKDIR\"}" \
    "http://127.0.0.1:$SERVER_PORT/session?directory=$WORKDIR" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'
}

send_prompt() {
  local ses="$1" text="$2"
  curl -fsS --max-time 10 -X POST -H 'Content-Type: application/json' \
    -d "{\"agent\":\"Meidocho - 女仆长♥️\",\"model\":{\"providerID\":\"openai\",\"modelID\":\"gpt-fake\"},\"parts\":[{\"type\":\"text\",\"text\":\"$text\"}]}" \
    "http://127.0.0.1:$SERVER_PORT/session/$ses/prompt_async?directory=$WORKDIR" >/dev/null
}

capture_call_count() { grep -c '^CALL ' "$CAPTURE_LOG" 2>/dev/null || echo 0; }

wait_capture_marker() {
  local marker="$1"
  local after_count="$2"
  local timeout_s="${3:-30}"
  local deadline=$((SECONDS + timeout_s))
  while [ $SECONDS -lt $deadline ]; do
    if awk '/^CALL /{n++} n>'"$after_count" "$CAPTURE_LOG" 2>/dev/null | grep -qF "$marker"; then return 0; fi
    sleep 0.5
  done
  return 1
}

sandbox_message_count() {
  sqlite3 "$XDG_DATA_HOME/opencode/opencode.db" "SELECT count(*) FROM message" 2>/dev/null || echo 0
}

# ============================= Scenario D: baseline =============================
cat >"$WORKDIR/.omo/omo.jsonc" <<'OMO'
{
  "agents": { "meidocho": { "model": "openai/gpt-fake" } }
}
OMO

start_server
SES_D="$(new_session)"
note "baseline session: $SES_D"
send_prompt "$SES_D" "QA baseline hello"
if wait_capture_marker "你是主人的女仆长兼私人开发姬" 0 40; then
  pass "D baseline: bundled template reaches the model without prompt_template configured"
else
  fail "D baseline: bundled template text not observed in captured request"
fi
stop_server

# ============================= Scenario A: render ===============================
# Template must live inside the project root (or ~/.omo allowlist) — resolve-file-uri
# rejects paths outside the boundary, so place it under $WORKDIR/.omo/.
TEMPLATE="$WORKDIR/.omo/meidocho-template.md"
cat >"$TEMPLATE" <<'TPL'
MARKER_V1_QA713 你是测试版女仆长。

{{ taskSystemGuide }}

{{ categorySkillsGuide }}

{{ delegationTable }}

{{ oracleSection }}

{{ frontendGuidance }}

{{ fileEditGuidance }}
TPL

cat >"$WORKDIR/.omo/omo.jsonc" <<OMO
{
  "agents": {
    "meidocho": {
      "model": "openai/gpt-fake",
      "prompt_template": "file://$TEMPLATE"
    }
  }
}
OMO

start_server
SES_A="$(new_session)"
note "template session: $SES_A"
CALLS_BEFORE_A="$(capture_call_count)"
send_prompt "$SES_A" "QA render hello"
if wait_capture_marker "MARKER_V1_QA713" "$CALLS_BEFORE_A" 40; then
  pass "A render: user template marker reaches the model"
else
  fail "A render: MARKER_V1_QA713 not observed in captured request"
fi

# ============================ Scenario A2: hot-reload ===========================
sleep 1.2
cat >"$TEMPLATE" <<'TPL'
MARKER_V2_QA889 你是热重载版女仆长。

{{ taskSystemGuide }}

{{ categorySkillsGuide }}

{{ delegationTable }}

{{ oracleSection }}

{{ frontendGuidance }}

{{ fileEditGuidance }}
TPL

CALLS_BEFORE_A2="$(capture_call_count)"
send_prompt "$SES_A" "QA hot-reload hello"
if wait_capture_marker "MARKER_V2_QA889" "$CALLS_BEFORE_A2" 40; then
  pass "A2 hot-reload: edited template v2 reaches the model in the same server process"
else
  fail "A2 hot-reload: MARKER_V2_QA889 not observed"
fi
if awk '/^CALL /{n++} n>'"$CALLS_BEFORE_A2" "$CAPTURE_LOG" | grep -qF "MARKER_V1_QA713"; then
  fail "A2 hot-reload: stale MARKER_V1 still present after reload"
else
  pass "A2 hot-reload: stale v1 marker fully replaced"
fi

# ============================= Scenario B: block ================================
sleep 1.2
cat >"$TEMPLATE" <<'TPL'
BROKEN_QA 删掉了一个必需占位符。

{{ taskSystemGuide }}

{{ categorySkillsGuide }}

{{ oracleSection }}

{{ frontendGuidance }}

{{ fileEditGuidance }}
TPL

CALLS_BEFORE_B="$(capture_call_count)"
DB_COUNT_BEFORE_B="$(sandbox_message_count)"
: >"$SSE_LOG"
send_prompt "$SES_A" "QA should be blocked"
sleep 4

if [ "$(capture_call_count)" = "$CALLS_BEFORE_B" ]; then
  pass "B block: zero model calls while template invalid"
else
  fail "B block: model was called despite invalid template"
fi

if [ "$(sandbox_message_count)" = "$DB_COUNT_BEFORE_B" ]; then
  pass "B block: blocked message was not persisted to the DB"
else
  fail "B block: message count changed ($DB_COUNT_BEFORE_B -> $(sandbox_message_count))"
fi

if grep -qF "模板无效，本条消息已被拦截" "$SSE_LOG" && grep -qF "缺少必需占位符 {{ delegationTable }}" "$SSE_LOG"; then
  pass "B block: detailed error report observed on the event stream"
else
  note "SSE log tail: $(tail -c 600 "$SSE_LOG" | tr '\n' ' ')"
  fail "B block: error report not observed on the event stream"
fi

# ============================ Scenario C: recover ===============================
sleep 1.2
cat >"$TEMPLATE" <<'TPL'
MARKER_V3_QA960 修复版女仆长。

{{ taskSystemGuide }}

{{ categorySkillsGuide }}

{{ delegationTable }}

{{ oracleSection:omit }}

{{ frontendGuidance }}

{{ fileEditGuidance }}
TPL

CALLS_BEFORE_C="$(capture_call_count)"
send_prompt "$SES_A" "QA recover hello"
if wait_capture_marker "MARKER_V3_QA960" "$CALLS_BEFORE_C" 40; then
  pass "C recover: fixed template (with :omit) works again without restart"
else
  fail "C recover: MARKER_V3_QA960 not observed"
fi
stop_server

# ============================ Isolation proof ===================================
HOST_COUNT_AFTER="$(host_session_count)"
note "host session count after: $HOST_COUNT_AFTER"
if [ "$HOST_COUNT_BEFORE" = "$HOST_COUNT_AFTER" ]; then
  pass "isolation: host opencode.db session count unchanged ($HOST_COUNT_BEFORE)"
else
  fail "isolation: host DB changed ($HOST_COUNT_BEFORE -> $HOST_COUNT_AFTER)"
fi

note "ALL SCENARIOS PASSED"
