//! Prompts for the gather and import agent sessions.
//!
//! Gather sessions stage candidates through the `CreateImportEntity` tool —
//! there is no structured output to parse; the tool IS the output channel.
//! Import sessions (Notion only — Linear tasks and Slack channels are
//! composed deterministically from staged metadata) fetch page content and
//! land it through `FinalizeImport`.

use crate::domain::models::{ImportEntity, ImportSource, metadata_label};

/// System prompt for a gather session over one connector.
pub fn gather_system(source: ImportSource) -> String {
    let (what, foreign_id_rule, metadata_hint, search_strategy) = match source {
        ImportSource::Linear => (
            "the user's most relevant recent Linear issues",
            "the Linear issue identifier (e.g. `ENG-142`); fall back to the issue URL only when \
             no identifier exists",
            "identifier, title, description (short markdown), status, priority, assignee, \
             assignee_email, due_date (ISO date, when set), url",
            "Always pass a non-empty query to search tools.",
        ),
        ImportSource::Notion => (
            "the user's most recently updated, substantive Notion pages",
            "the page URL (it is normalized to the stable page id server-side)",
            "title, url, summary (one line). Do NOT fetch or include page content — content is \
             fetched later, only for pages the user accepts",
            "Always pass a non-empty query to search tools.",
        ),
        ImportSource::Slack => (
            "the Slack channels the user is most active in",
            "the Slack channel id (e.g. `C0123456789`); fall back to the channel name",
            "name (without the leading #), channel_id, purpose, participants (name + email when \
             available)",
            "Slack-specific discovery strategy:\n\
             - FIRST call `Search channels` with an explicitly empty search string: \
             `{\"query\": \"\"}`. For this Slack MCP tool, an empty query lists all channels the \
             connected user can see. Do not substitute `active`, `recent`, `all`, or `*`.\n\
             - Follow the result's pagination cursor when one is present until you have enough \
             candidates or there are no more pages.\n\
             - Prefer channels whose names, topics, or purposes indicate substantive work. You \
             may use one broad `Search messages & files` call afterward to rank the enumerated \
             channels by recent activity, but do not use message search as a prerequisite for \
             discovering that a channel exists.\n\
             - Participant details are optional. Do not drop a channel merely because member \
             names or emails are unavailable.",
        ),
    };
    format!(
        "You are discovering {what} so they can be imported into Macro, the user's new \
         workspace.\n\
         \n\
         Use the connected tools to find 8-15 strong candidates: recently active, substantive, \
         and clearly relevant to the user's own work. Prefer one or two broad searches/list \
         calls over many narrow ones. Pass only parameters the tool's schema supports; if a call \
         fails validation, fix the arguments and retry once.\n\
         {search_strategy}\n\
         \n\
         For EACH candidate, call `CreateImportEntity` once with:\n\
         - `foreign_id`: {foreign_id_rule}\n\
         - `metadata`: {metadata_hint}\n\
         \n\
         The tool response tells you when an item was already imported by the user or a \
         teammate, or previously declined — do not re-stage those, just move on.\n\
         \n\
         When you are done staging, reply with one short plain-text sentence summarizing what \
         you staged. Do not output JSON."
    )
}

/// User message opening a gather session.
pub fn gather_prompt(source: ImportSource) -> &'static str {
    match source {
        ImportSource::Linear => {
            "Find my most relevant recent Linear issues and stage them for import."
        }
        ImportSource::Notion => {
            "Find my most recently updated Notion pages worth bringing over and stage them for \
             import."
        }
        ImportSource::Slack => {
            "Find the Slack channels I'm most active in and stage them for import."
        }
    }
}

/// System prompt for the Notion import session.
pub const NOTION_IMPORT_SYSTEM: &str = "You are importing Notion pages the user accepted into \
    Macro, their new workspace.\n\
    \n\
    Work through the listed pages ONE AT A TIME, in order. For each page:\n\
    1. Fetch its content with the connected Notion tools (by URL or page id).\n\
    2. Convert it to clean markdown. Preserve headings, lists, tables, and links; drop Notion \
    artifacts that don't translate.\n\
    3. Append a final line: `[Original in Notion](<page url>)` when a URL is known.\n\
    4. Immediately call `FinalizeImport` with the page's `import_id`, a `name` (the page \
    title), and the markdown as `content_markdown` — BEFORE fetching the next page. The user \
    is watching items land live; never batch the finalize calls up for the end.\n\
    \n\
    If a page's content cannot be fetched, still call `FinalizeImport` using the staged summary \
    plus the backlink as the body — a thin import beats a failed one.\n\
    \n\
    You MUST call `FinalizeImport` exactly once for every listed page. When all pages are \
    finalized, reply with one short sentence.";

/// User message for the Notion import session: the accepted rows.
pub fn notion_import_prompt(rows: &[ImportEntity]) -> String {
    let items: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "import_id": row.id,
                "title": metadata_label(row.source, &row.metadata),
                "url": row.metadata.get("url").and_then(|v| v.as_str()),
                "summary": row.metadata.get("summary").and_then(|v| v.as_str()),
            })
        })
        .collect();
    format!(
        "Import these Notion pages:\n{}",
        serde_json::to_string_pretty(&items).unwrap_or_else(|_| "[]".to_string())
    )
}
