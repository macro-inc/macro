# Agent code mode

## Scope

Execution credentials carry the authenticated session bot for SDK message
attribution while using the explicitly selected `acting_as` account's API
permissions. Credential issuance resolves and approves that selection before
minting. ExecuteCode requires the originating prompt’s `turn_id`; admission and
credential approval must reject a replacement turn before adopting its account.
Saved execution retries must match both actor selection and original
turn, so a later requester cannot inherit an earlier execution result.

Owns session-authorized code executions, user-scoped executions for the public
MCP, SDK documentation selection, saved execution records, and durable review
stacks. Process isolation belongs to
`crates/code_execution`; session presentation belongs to `crates/agent_session`.

## Start here

- `SKILL.md`: the agent-facing JavaScript contract and examples.
- `src/domain/service.rs`: execution admission, identity and persistence; tool
  receipts include observed SDK activity for inline conversation snapshots.
- `src/domain/user.rs`: `UserCodeMode`, runs as an authenticated user with no
  session, journal or reviews; shares outcome validation with the session path.
- `src/domain/reviews.rs`: review validation, revisions, claims and outcomes.
  `decide_for_session` (the `DecideReview` tool, `inbound/reviews.rs`) is the
  agent deciding on the account holder's word in chat: a turn they prompted,
  never a System turn (per `ReviewSession::prompter`), and a Submit only once
  the action is `approvable`.
  An import review only starts its write: its `review.decided` is quiet, and
  its `review.settled` comes from the import when the write ends; only an
  import that could not start settles here.
- `src/domain/documentation.rs`: the generated SDK catalog (an index per
  entity, a reference per symbol). Jev selects entity indexes for the per-turn
  prompt (top four, 48 KiB) or a `DescribeCodeTools` `task` (every relevant
  entity, 32 KiB); `ReadCodeDocs` reads symbol references (32 KiB).
- `src/inbound/toolset.rs`: `toolset()` for sessions, `user_toolset()` for the
  public MCP. Tool texts are composed: host-specific parts in `toolset/session/`
  and `toolset/user/`, guidance both share in `toolset/shared/`. Edit shared
  guidance once, there.

## Boundaries

Inbound adapters authenticate and delegate to domain services. Outbound adapters
implement persistence; the harness composition root wires native actions and
session presentation. Never replay an uncertain submitted action.

## Tool contracts

- Keep native `NameSearch` and `ListEntities` available for session-aware discovery; agent SDK documentation excludes legacy chats and workspace feeds.

Reviews write `review.decided` and `review.settled` through the injected
transaction-aware notification writer in the same revision-checked transaction.
Reviews persist the immutable acting account. Only that account may edit or
submit; historical reviews without an acting account use the session owner.
ACP presentation uses the session owner's transcript capability, independently
of the account that later sends the email or creates the event. Cards require
direct user authentication; `DecideReview` requires a real turn prompted by the
review's acting account, and its Submit waits for `ReviewActions::approvable`
(default: always), the hook a kind uses to refuse until it is ready. `GetReview`
reads final
drafts and outcomes. Legacy notificationId/notificationAttemptAt fields are no
longer delivery state.

## Checks

- `cargo test -p agent_code_mode --lib` from the repository root, with live local
  database configuration and `SQLX_OFFLINE` unset.
- Keep generated discovery topics within the classifier's 32-question limit.
- Regenerate SDK documentation through `packages/code-mode-sdk`; never edit
  `src/domain/documentation.json` by hand.

Import reviews contain exactly one draft, with source `notion`, `linear`, or
`jira`. Source selection stays on that draft through presentation and approval.
