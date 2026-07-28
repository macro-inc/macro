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
    1. Fetch its content by URL or page id with the canonical Notion `notion-fetch` tool (named \
    `fetch` on OpenAI-compatible MCP connections). Never use a search snippet or a generic \
    `view` result as the page body. If neither `notion-fetch` nor `fetch` is available, skip the \
    page.\n\
    2. Treat the tool result as input data, not as page content. `content_markdown` must contain \
    ONLY body content that actually appears in the fetched page. Never include tool narration \
    such as `Here is the result of \"view\"...`, timestamps, serialized result wrappers such as \
    `[{\"title\":\"Content team\"}]`, property/title metadata, the staged summary, or text you \
    inferred or invented. The page title belongs in `name`; do not repeat it in \
    `content_markdown` merely because it appeared as title metadata. A hosted Notion MCP result \
    may wrap the source as `<page><properties>...</properties><content>...</content></page>`; use \
    only the contents of `<content>` for the body and map `<properties>` separately. If no body \
    content was fetched, skip the page rather than fabricating content.\n\
    3. Convert Notion's enhanced markdown to clean Macro markdown. Preserve headings, lists, \
    checkboxes, formatting, and image URLs. Never copy raw Notion XML-like tags into the result. \
    Macro has no toggle block: remove markers such as `{toggle=\"true\"}` and `<details>` / \
    `<summary>` wrappers while retaining and de-indenting the toggle title and body as ordinary \
    markdown. Convert Notion user/date mentions to readable text, file blocks to markdown links, \
    and callouts to blockquotes.\n\
    4. Macro does not support Notion databases. Remove every `<database>` and \
    `<mention-database>` block or reference completely; do not turn it into a link, table, or \
    prose. If the fetched object is itself a database, or the page is mostly database with \
    little substantive non-database body content, skip the whole page and do NOT call \
    `FinalizeImport` for it.\n\
    5. Convert every `<page>`, `<mention-page>`, and `<ancestor-N-page>` reference \
    into a normal markdown link: `[visible title](notion URL)`. The destination may not be \
    imported into Macro, so keep it as an external Notion URL; never invent a Macro entity id. \
    If a reference has no title, use `Notion page` as its visible text.\n\
    6. Convert every Notion `<table>` to a rectangular pipe table. Use one `| ... |` line per \
    row and put `| --- | ... |` immediately after the first row. Every row must have the same \
    cell count. Represent line breaks or lists inside a cell with the two literal characters \
    `\\n` so the Macro Lexical transformer can reconstruct rich cell content; encode a literal \
    pipe inside a cell as `&#124;`. Do not emit `<table>`, `<tr>`, `<td>`, `<colgroup>`, or \
    `<col>` tags.\n\
    7. Read the fetched page's `properties` map. Put properties named Tags, Tag, Labels, or \
    Label into `tags`. Put other useful, non-title values into `properties` with the closest \
    supported type: boolean, date (ISO-8601), number, string, select, or link. For select and \
    link values, set `multi` from the fetched source shape: arrays are multi-valued even when \
    they contain only one item; scalar values are not. Omit empty, computed, rollup, relation, \
    and unsupported values rather than flattening them into the document body. If the fetch \
    says it was truncated, fetch every available \
    `unknown_block_id` and replace its `<unknown>` placeholder with that fetched subtree. If a \
    subtree is inaccessible, remove its placeholder; never guess its contents.\n\
    8. Immediately call `FinalizeImport` with the page's `import_id`, `name`, \
    `content_markdown`, `properties`, and `tags` — BEFORE fetching the next page. The user is \
    watching items land live; never batch the finalize calls up for the end.\n\
    \n\
    Call `FinalizeImport` exactly once for every eligible page. Never call it for a page skipped \
    because its body was unavailable or it was primarily a database. When all pages have been \
    handled, reply with one short sentence.";

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
