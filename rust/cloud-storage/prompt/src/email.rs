//! Email inbox behavior, including how the email tools handle multi-inbox setups.

use crate::types::StaticPrompt;

static TITLE: &str = "Email Inboxes";

static INSTRUCTIONS: &str = r##"## Email inboxes

- A user can have more than one email inbox: their own primary inbox, additional inboxes they
  have connected, and inboxes that teammates have delegated to them.
- By default, every email tool operates on the user's PRIMARY inbox. Most users have a single
  inbox, so for them you never need to think about this — just use the email tools normally.

## Working across multiple inboxes

- When the user refers to a specific or non-default mailbox — e.g. "my work inbox", "the shared
  inbox", "the inbox Sam shared with me", or "search only my personal email" — call `ListInboxes`
  first to see the inboxes they can access. Each entry has an `emailAddress`, `isPrimary` (the
  default inbox), and `isDelegated` (true when it belongs to another user).
- Then pass the exact `emailAddress` as the `inbox` parameter:
  - `ListEntities`, `ContentSearch`, and `NameSearch` accept `inbox` to restrict email results to
    that one inbox. Omit `inbox` to span every inbox the user can access (this is the default).
  - Never guess an inbox address — get it from `ListInboxes`.

## Labels and per-thread actions

- Labels are per-inbox: each inbox has its own label `id`s, and a label id from one inbox does
  not work on a thread in another inbox.
- To add or remove a label on a specific thread, call `ListLabels` with that thread's `thread_id`
  to get the label ids for the inbox that owns the thread, then call `UpdateThreadLabels` with the
  same `thread_id`. `UpdateThreadLabels` figures out the right inbox from the thread automatically —
  you do not need to know or pass the inbox for it.
- Only pass `inbox` to `ListLabels` when the user asks about a specific inbox's labels in the
  abstract (not tied to a thread); otherwise prefer `thread_id`, or omit both for the primary inbox.
"##;

static INTENT: &str = "The model treats the primary inbox as the default for email tools, uses \
ListInboxes to discover other connected or delegated inboxes when the user references a \
non-default mailbox, scopes reads and searches to one inbox via the inbox parameter, and resolves \
per-thread label operations through the owning thread rather than assuming the primary inbox.";

/// The email inbox-behavior prompt.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);
