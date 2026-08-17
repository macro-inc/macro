# Testing the worker against Hermes

Hermes (NousResearch/hermes-agent) ships an ACP server adapter
(`acp_adapter/` in their repo) implementing `initialize`, `session/new`,
`session/prompt`, `session/load`, `session/resume`, and `session/cancel` -
everything our session actor drives, including the resume path.

## Install Hermes

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
hermes setup           # pick a model provider: Nous Portal, OpenRouter, OpenAI, ...
hermes acp --check     # health-check the ACP server mode
```

## End-to-end loop (no webhooks needed)

The `justfile` next to this document wraps every step below for the
`just run_local` stack (base `http://localhost:50009/agent-harness`); the
curls here show the raw shapes against a directly-run service on port 8101.

1. Run the harness service locally (it serves both `/agent-sessions` and the
   runtime gateway).

2. Create an agent bot as yourself and grab its token, or use an existing
   one. Mark it as an agent: `PATCH /bots/{id} { "hasAgent": true }`.

3. Create the session (the mention text is NOT in this request - it is
   delivered in step 5):

   ```bash
   curl -sX POST localhost:8101/agent-sessions \
     -H 'content-type: application/json' \
     -H 'x-macro-bot-token: mbot_...' -H 'x-macro-bot-scope: user' \
     -d '{"workspace": "/home/wolf/code/some-repo",
          "owner": "macro|wolf@macro.com"}'
   # -> { "session": {...}, "gatewayUrl": "ws://localhost:8101/runtime/<id>/ws" }
   ```

4. Point the worker at it and run:

   ```toml
   # macro.toml
   [session]
   id = "<session id from step 3>"
   gateway_url = "<gatewayUrl from step 3, verbatim>"
   bot_token = "mbot_..."

   [harness]
   command = "hermes"
   args = ["acp"]
   cwd = "/home/wolf/code/some-repo"

   [workspace]
   repo_url = "https://github.com/you/some-repo"   # informational for now
   ```

   ```bash
   cargo run -p coding_agent_worker -- --config macro.toml
   ```

   The worker dials the gateway with the bot token as `?token=`, spawns
   `hermes acp`, announces `AcpReady`, and the service sends `initialize` +
   `session/new` with `cwd` = the workspace from step 3.

5. Deliver the first prompt through the control endpoint. The acting-user
   header is required: a user-scoped bot resolves its session access through
   the user it acts for (the session owner passes, holding the Owner grant):

   ```bash
   curl -sX POST localhost:8101/agent-sessions/<id>/control \
     -H 'content-type: application/json' \
     -H 'x-macro-bot-token: mbot_...' -H 'x-macro-bot-scope: user' \
     -H 'x-macro-bot-for-macro-user-id: macro|you@macro.com' \
     -d '{"type": "prompt", "prompt": "list the files in this repo"}'
   ```

6. Watch the session log: `GET /agent-sessions/<id>/log`.

## Notes

- The whole loop is verified against OpenCode 1.18.3: create, dial (bot
  credential headers on the upgrade), workspace-correct `session/new` and
  `session/resume`, control prompt with acting user, streamed answer
  persisted to the session log.
- Hermes negotiates the ACP Python SDK's current protocol version; our actor
  sends `agent_session::PROTOCOL_VERSION`. If the handshake fails, compare
  the two before anything else.
- `[workspace].repo_url` is not yet consumed: having the repo cloned at the
  workspace path is the operator's job.
