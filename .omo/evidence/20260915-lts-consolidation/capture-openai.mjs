#!/usr/bin/env node
// QA capture server: OpenAI Responses API mock that logs every request body to
// CAPTURE_LOG (one JSON blob per line, terminated by ===END===) and replies with
// a fixed SSE text completion. Used to observe the exact system prompt OpenCode
// sends for each request (prompt-template render / hot-reload / zero-call proof).
import http from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const logFile = process.env.CAPTURE_LOG ?? path.join(os.tmpdir(), "capture-openai.log")
const requestedPort = Number(process.env.CAPTURE_PORT ?? 0)
let callCount = 0

function sseEvents(text) {
  const id = `resp_${Date.now()}_${callCount}`
  const item = `msg_${Date.now()}_${callCount}`
  return [
    { type: "response.created", response: { id, created_at: Math.floor(Date.now() / 1000), model: "gpt-fake" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id: item } },
    { type: "response.output_text.delta", item_id: item, output_index: 0, delta: text },
    { type: "response.output_item.done", output_index: 0, item: { type: "message", id: item } },
    { type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 5 } } },
  ]
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok")
    return
  }
  const isResponses = req.url?.includes("/responses")
  const isChatCompletions = req.url?.includes("/chat/completions")
  if (req.method !== "POST" || (!isResponses && !isChatCompletions)) {
    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }))
    return
  }
  callCount++
  const chunks = []
  req.on("data", (chunk) => chunks.push(chunk))
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8")
    fs.appendFileSync(logFile, `CALL ${callCount}\n${raw}\n===END===\n`)
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    })
    if (isChatCompletions) {
      const id = `chatcmpl_${Date.now()}_${callCount}`
      const frame = (delta, finish) => ({
        id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "gpt-fake",
        choices: [{ index: 0, delta, finish_reason: finish }],
      })
      res.write(`data: ${JSON.stringify(frame({ role: "assistant", content: `QA_OK_${callCount}` }, null))}\n\n`)
      res.write(`data: ${JSON.stringify({ ...frame({}, "stop"), usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`)
      res.write("data: [DONE]\n\n")
      res.end()
      return
    }
    for (const event of sseEvents(`QA_OK_${callCount}`)) {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    res.write("data: [DONE]\n\n")
    res.end()
  })
  req.on("error", () => res.destroy())
})

server.listen(requestedPort, "127.0.0.1", () => {
  console.log(`capture-openai listening on ${server.address().port}`)
})
