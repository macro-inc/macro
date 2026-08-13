# Real recordings

Real ACP traffic from real dev sessions, sanitized with
`../../scripts/sanitize_recording.py` before being committed - see that
script's docs for what "sanitized" means. The sweep tests in
`src/domain/test/real_recordings.rs` discover every `.jsonl` in this
directory with `insta::glob!`, so adding coverage means dropping a sanitized
recording here: no constant, no registration list. Each fixture's derived
messages and metadata are pinned as insta snapshots named after its file.

Recordings live under `~/.agent_runtime_sessions` on whatever machine ran
the session.

What each fixture uniquely proves:

- `real_single_turn.jsonl` - the smallest complete real session: one prompt,
  one reply, opened with `session/new`.
- `real_multi_turn.jsonl` - three prompts in one session, ordinary
  multi-turn traffic, no resume involved.
- `resumed_and_continued.jsonl` - opens with `session/load`, then takes
  three more prompts in the same log. The mixed case a pure resume or a pure
  fresh session does not cover: turn numbering has to pick up cleanly after
  a resumed turn that never had a prompt of its own in this log.
- `resumed_no_prompt.jsonl` - opens with `session/load` and carries no
  `session/prompt` at all; the agent's reply is the only thing in the log.
  The regression fixture for the fold once dropping such content outright -
  see `State::begin_turn_without_prompt`.
- `long_multi_resume.jsonl` - 6565 frames, 106 prompts, three separate
  `session/load` resumes in one log: what a session actually looks like
  after running for a while. Too large for a message snapshot; the invariant
  tests cover what it uniquely proves (turn numbering across resumes).
- `plan_todo.jsonl` - one turn building a three-item todo list and checking
  the items off, emitting a `plan` update on every change and re-emitting it
  unchanged in between. The only fixture carrying `plan` frames.
- `command_invocation.jsonl` - a fresh session whose first prompt invokes a
  slash command (`/add-sdk-endpoint`, with trailing input). Carries the
  harness's full `available_commands_update` advertisement - names,
  descriptions, `input` hints - plus a `session/set_config_option` model
  change before the prompt. The only fixture in which a slash command is
  actually invoked.
