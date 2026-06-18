//! Static prompt fragments used to compose AI system prompts.
//!
//! Each module holds one prompt section as static strings and exports a
//! `PROMPT` static — a [`StaticPrompt`] borrowing string data with `'static`
//! lifetime. Prompts chain together via [`StaticPrompt::compose`].
#![deny(missing_docs)]

pub mod about_macro;
pub mod channel_mention;
pub mod citations;
pub mod do_not;
pub mod math;
pub mod mcp_item_links;
pub mod mentions;
pub mod tone;
pub mod tool_usage;
mod types;

pub use types::{ComposedPrompt, Section, StaticPrompt};

/// The base prompt: tone, math, citations, mentions, do-not rules, and Macro
/// terms. Contains no tool use instructions.
pub static BASE_PROMPT: ComposedPrompt = tone::PROMPT
    .compose(&math::PROMPT)
    .compose(&citations::PROMPT)
    .compose(&mentions::PROMPT)
    .compose(&do_not::PROMPT)
    .compose(&about_macro::PROMPT);

/// The tool-enabled prompt: [`BASE_PROMPT`] with the tool use instructions
/// appended.
pub static TOOL_USE_PROMPT: ComposedPrompt = BASE_PROMPT.compose(&tool_usage::PROMPT);

/// Citation, do-not, and Macro-terms rules surfaced to external MCP clients,
/// composed together. These are static; the item-linking rules are not, because
/// they depend on the runtime app base URL — see [`mcp_instructions`].
///
/// Deliberately omits the in-app [`mentions`] section (MCP clients cannot render
/// `<m-document-mention>` tags) as well as chat tone/style and tool-use
/// instructions, which belong to the host client, not to Macro.
static MCP_STATIC_INSTRUCTIONS: ComposedPrompt = citations::PROMPT
    .compose(&do_not::PROMPT)
    .compose(&about_macro::PROMPT);

/// Builds the instructions surfaced to external MCP clients via the server
/// `instructions` field.
///
/// Carries the formatting/correctness rules Macro features depend on so that AI
/// used through MCP produces valid output. Item links are rendered as plain
/// Markdown URLs (built from `base_url`, the runtime `APP_BASE_URL` value) and
/// lists of items as Markdown tables — NOT the in-app `<m-document-mention>`
/// markup, which MCP clients cannot render. `base_url` should already have any
/// trailing slash trimmed.
pub fn mcp_instructions(base_url: &str) -> String {
    format!(
        "{}\n{MCP_STATIC_INSTRUCTIONS}",
        mcp_item_links::render(base_url)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_instructions_link_items_as_urls_built_from_base_url() {
        let instructions = mcp_instructions("https://macro.com");

        // Item links are plain URLs built from the base url, including a
        // worked example for a document.
        assert!(instructions.contains("https://macro.com/app/<type>/<id>"));
        assert!(instructions.contains("[Name](https://macro.com/app/md/<id>)"));
    }

    #[test]
    fn mcp_instructions_forbid_mention_tags_but_in_app_prompt_keeps_them() {
        let instructions = mcp_instructions("https://macro.com");

        // MCP responses must steer away from the in-app mention markup...
        assert!(instructions.contains("Do NOT emit `<m-document-mention>`"));

        // ...while the in-app base prompt still instructs the model to use it.
        let in_app = BASE_PROMPT.to_string();
        assert!(in_app.contains("<m-document-mention>"));
        assert!(in_app.contains("use XML mention tags"));
    }

    #[test]
    fn mcp_instructions_describe_item_table_columns() {
        let instructions = mcp_instructions("https://macro.com");

        for column in ["number", "name", "link"] {
            assert!(
                instructions.contains(column),
                "instructions should describe the {column} table column"
            );
        }
    }
}
