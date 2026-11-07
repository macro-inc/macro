//! Prompts for the Notion import agent session, the fallback when a page
//! can't be copied directly. It fetches page content and lands it through
//! `FinalizeImport`; Linear tasks and Slack channels are composed
//! deterministically from staged metadata.

use crate::domain::models::{ImportEntity, metadata_label};

/// System prompt for the Notion import session.
pub const NOTION_IMPORT_SYSTEM: &str = "You are importing Notion pages the user accepted into \
    Macro, their new workspace.\n\
    \n\
    Work through the listed pages ONE AT A TIME, in order. For each page:\n\
    1. Fetch its content by URL or page id with the canonical Notion `notion-fetch` tool (named \
    `fetch` on OpenAI-compatible MCP connections). Never use a search snippet or a generic \
    `view` result as the page body. If neither `notion-fetch` nor `fetch` is available, use the \
    connector's page retrieval and block-children tools instead: retrieve the page metadata, \
    then list the page's child blocks, following pagination and recursively reading blocks \
    that have children. Page metadata alone is not body content. Convert only the retrieved \
    blocks into markdown; if no body content can be read, skip the page.\n\
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
