// A stand-in Anthropic API on loopback, and one agent turn against it, for
// running Claude Code and its ACP adapter without network or credentials
// (the build-time first-run seed, `_claude-first-run.nix`).
//
//   node warmup-turn.mjs stand-in            serve the stand-in; print its URL
//   node warmup-turn.mjs turn <adapter> <cwd> one ACP session and prompt, with
//                                            the adapter run as macrod runs it
//
// The stand-in answers every Messages request with one streamed word and
// takes any key: callers use a fixed dummy token, no credential. A turn
// leaves no process behind.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";

const DUMMY_TOKEN = "macro-warmup-no-credential";
const TURN_TIMEOUT_MS = 120_000;
const EXIT_TIMEOUT_MS = 10_000;

function sse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function standIn() {
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      } catch {}
      if (request.url.includes("count_tokens")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ input_tokens: 1 }));
        return;
      }
      const message = {
        id: "msg_warmup",
        type: "message",
        role: "assistant",
        model: body.model ?? "warmup",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      if (!body.stream) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            ...message,
            content: [{ type: "text", text: "ok" }],
            stop_reason: "end_turn",
          }),
        );
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        sse("message_start", { type: "message_start", message }) +
          sse("content_block_start", {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          }) +
          sse("content_block_delta", {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "ok" },
          }) +
          sse("content_block_stop", { type: "content_block_stop", index: 0 }) +
          sse("message_delta", {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 1 },
          }) +
          sse("message_stop", { type: "message_stop" }),
      );
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` }),
    ),
  );
}

function within(promise, milliseconds, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} took over ${milliseconds} ms`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function turn(adapter, cwd) {
  const { server, url } = await standIn();
  const started = performance.now();
  const agent = spawn(adapter, [], {
    cwd,
    stdio: ["pipe", "pipe", "inherit"],
    detached: true,
  });
  const exited = new Promise((resolve) => agent.on("exit", resolve));
  const waiting = new Map();
  let firstChunk;
  createInterface({ input: agent.stdout }).on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.method === "session/update" && message.params?.update?.sessionUpdate === "agent_message_chunk") {
      firstChunk ??= performance.now();
    }
    if (message.id !== undefined && waiting.has(message.id)) {
      const { resolve, reject } = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) reject(new Error(`${JSON.stringify(message.error)}`));
      else resolve(message.result);
    }
  });
  let nextId = 0;
  const call = (method, params) => {
    nextId += 1;
    const id = nextId;
    agent.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
  };
  const phases = {};
  const mark = (name, since) => {
    phases[name] = Math.round(performance.now() - since);
  };
  try {
    await within(
      (async () => {
        let since = performance.now();
        await call("initialize", { protocolVersion: 1, clientCapabilities: {} });
        mark("initialize_ms", since);
        since = performance.now();
        const env = {
          ANTHROPIC_BASE_URL: url,
          ANTHROPIC_AUTH_TOKEN: DUMMY_TOKEN,
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        };
        const { sessionId } = await call("session/new", {
          cwd,
          mcpServers: [],
          _meta: { claudeCode: { options: { env } } },
        });
        mark("session_new_ms", since);
        since = performance.now();
        await call("session/prompt", { sessionId, prompt: [{ type: "text", text: "Reply with one word." }] });
        mark("prompt_ms", since);
        if (firstChunk === undefined) throw new Error("the turn ended without an agent message");
      })(),
      TURN_TIMEOUT_MS,
      "the warm-up turn",
    );
  } finally {
    agent.stdin.end();
    const code = await within(exited, EXIT_TIMEOUT_MS, "the adapter's exit").catch(() => null);
    // The adapter leads its process group: take down anything it left behind.
    try {
      process.kill(-agent.pid, "SIGKILL");
    } catch {}
    phases.adapter_exit = code;
    server.close();
  }
  phases.total_ms = Math.round(performance.now() - started);
  console.log(JSON.stringify(phases));
}

const [command, ...rest] = process.argv.slice(2);
if (command === "stand-in") {
  const { url } = await standIn();
  console.log(url);
} else if (command === "turn" && rest.length === 2) {
  await turn(rest[0], rest[1]);
} else {
  console.error("usage: warmup-turn.mjs stand-in | turn <adapter executable> <cwd>");
  process.exit(64);
}
