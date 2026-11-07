# model_emulator

## What it is

Test support for the agent: a stand-in for the Gemini API that answers from
scripts instead of a model. The real model router (`crates/agent`, rig's
Gemini client) and the agent harness run against it, in a `cargo test`, as a
standalone process or as part of a local stack, so a test decides ahead of
time what the model says and which tools it calls. No model is ever called.

## How it works

- `ModelEmulator::start()` listens on a `127.0.0.1` port; `cargo run -p
  model_emulator` is the same emulator as a process (`--listen`).
- It answers `POST /v1beta/models/<model>:streamGenerateContent` (one
  server-sent event with the whole reply) and `:generateContent` (JSON), in
  Gemini's shapes, with a `finishReason` and `usageMetadata` so the router's
  metering sees a finished request.
- A request belongs to the script its last user message names with
  `[[script:<name>]]`. The model turns after that message say how far the
  conversation is: the first request gets the script's first reply, the one
  that carries its tool results the second, and so on.
- A request that names no script, names one nobody added, is past the
  script's last reply, or offers no tools (titles, summaries) is answered
  `OK.`.
- A reply is text, tool calls, or both. `{{name}}` in a reply's text or tool
  arguments is replaced by the last match of the script's capture `name`, a
  regular expression with one group matched against the request's text: this
  is how a scripted `ExecuteCode` call copies the turn id out of the prompt.
- `/_emulator/…` is the control API: `PUT`/`DELETE /_emulator/scripts/{name}`,
  `GET /_emulator/requests?script=<name>` (the last 500 requests, with the
  script and reply each was answered from), `DELETE /_emulator/requests`.
- A local stack with no real Gemini key runs it as the `model_emulator`
  sidecar (`xtask_local`'s `model_emulator.rs`), which sets
  `OVERRIDE_GOOGLE_GENERATIVE_AI_API_URL` for the services.

## Start here

- `src/lib.rs`: `ModelEmulator`, its control methods and the request log.
- `src/script.rs`: `Script`, `Reply`, `ToolCall`, how a request picks its
  reply, and captures.
- `src/routes.rs`: the Gemini routes, the reply's JSON and the control API.
- `src/test.rs`: scripts, the control API, and rig's Gemini client against it.

## Scope

- Owns: the two GenerateContent calls the agent's Gemini client makes.
- Not here: the other providers the router knows (Anthropic, OpenAI,
  Fireworks, Cerebras). A new local user is on the free plan, whose only model is
  Gemini Flash, so that is the model a local session calls.
- Not emulated: token counting, safety blocks, errors and rate limits,
  replies streamed in several chunks, and requests over 2 MB (refused).

## Recipes

- In a test: `ModelEmulator::start().await?`, `set_script(name, script)`, and
  a rig `gemini::Client` built with `.base_url(emulator.base_url())`.
- Point a local `agent_harness_service` at it:
  `OVERRIDE_GOOGLE_GENERATIVE_AI_API_URL=<base>`, with any value for
  `GOOGLE_GENERATIVE_AI_API_KEY`. A local stack does this by itself.
- Script a conversation over HTTP:
  `PUT /_emulator/scripts/draft` with
  `{"replies":[{"calls":[{"name":"<tool>","args":{…}}]},{"text":"Done."}]}`,
  then send the agent a message containing `[[script:draft]]`.
- Find a tool's exact name and schema: send any scripted message and read
  `tools` in the body of `GET /_emulator/requests`.

## Checks

- `cargo test -p model_emulator`

## Gotchas

- Scripts are shared by everything that talks to one emulator: name a
  script after the test that owns it.
- A tool call must use the name the request declares (`mcp__…`); the
  emulator does not check it, and the agent answers an unknown tool with an
  error result, not a failure.
- The emulator never reads the API key. Never give it a real one, and never
  point a deployed service at it.

## Related

- Rules: `.agents/rules/config-and-service-urls.md` · `crates/agent/AGENTS.md`
