//! Static prompt fragments used to compose AI system prompts.
//!
//! Each module holds one prompt section as static strings and exports a
//! `PROMPT` static — a [`StaticPrompt`] borrowing string data with `'static`
//! lifetime. Prompts chain together via [`StaticPrompt::compose`].
#![deny(missing_docs)]

pub mod about_macro;
pub mod agent_session;
pub mod channel_mention;
pub mod citations;
pub mod connected_toolsets;
pub mod do_not;
pub mod document_content_links;
pub mod email;
pub mod math;
pub mod mcp_item_links;
pub mod mentions;
pub mod skills;
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

/// The tool-enabled prompt: [`BASE_PROMPT`] with the tool use instructions,
/// skill-following rules, document-content linking rules, and email inbox
/// behavior appended.
pub static TOOL_USE_PROMPT: ComposedPrompt = BASE_PROMPT
    .compose(&tool_usage::PROMPT)
    .compose(&skills::PROMPT)
    .compose(&document_content_links::PROMPT)
    .compose(&email::PROMPT);

/// Citation, do-not, Macro-terms, and document-content-linking rules surfaced
/// to external MCP clients, composed together. These are static; the
/// item-linking rules for the model's own replies are not, because they
/// depend on the runtime app base URL — see [`mcp_instructions`].
///
/// Deliberately omits the in-app [`mentions`] section (MCP clients cannot render
/// `<m-document-mention>` tags in a chat reply) as well as chat tone/style and
/// general tool-use instructions, which belong to the host client, not to Macro.
/// [`document_content_links`] is the exception: it still applies over MCP
/// because it governs content written *into* a Markdown document (via
/// `CreateDocument`/`EditDocument`), not the model's chat replies. See
/// [`mentions`] for the full statement of which surfaces (replies, channel
/// messages, email bodies, and Markdown documents) these Markdown/mention
/// rules cover.
static MCP_STATIC_INSTRUCTIONS: ComposedPrompt = citations::PROMPT
    .compose(&do_not::PROMPT)
    .compose(&about_macro::PROMPT)
    .compose(&document_content_links::PROMPT);

/// Builds the instructions surfaced to external MCP clients via the server
/// `instructions` field.
///
/// Carries the formatting/correctness rules Macro features depend on so that AI
/// used through MCP produces valid output. Item links in the model's own chat
/// replies are rendered as plain Markdown URLs (built from `base_url`, the
/// runtime `APP_BASE_URL` value) and lists of items as Markdown tables — NOT
/// the in-app `<m-document-mention>` markup, which MCP clients cannot render.
/// Content the model writes *into* a Macro document via `CreateDocument` or
/// `EditDocument` is the opposite: it must still use `<m-document-mention>`
/// tags (see [`document_content_links`]), since the Macro app renders that
/// content regardless of which surface created it. `base_url` should already
/// have any trailing slash trimmed.
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

    #[test]
    fn mcp_instructions_still_require_mention_tags_inside_document_content() {
        let instructions = mcp_instructions("https://macro.com");

        // Even though the model's own MCP replies must use plain URLs, content
        // written into a Macro document via CreateDocument/EditDocument must
        // still use `<m-document-mention>` tags — the fix for the "CreateDocument
        // over MCP can't link docs correctly" bug.
        assert!(instructions.contains("CreateDocument"));
        assert!(instructions.contains(
            r#"<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"md","blockParams":{}}</m-document-mention>"#
        ));

        // The plain-URL rule and the mention-tag rule must not silently
        // contradict each other: the plain-URL section explicitly scopes
        // itself to the model's own replies, not to document content.
        assert!(instructions.contains("does NOT apply to content you write into a Macro document"));
    }

    #[test]
    fn tool_use_prompt_also_carries_document_content_link_rules() {
        // The in-app prompt should keep the same guidance so behavior doesn't
        // diverge between surfaces.
        let in_app = TOOL_USE_PROMPT.to_string();
        assert!(in_app.contains("CreateDocument"));
        assert!(in_app.contains(
            r#"<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"md","blockParams":{}}</m-document-mention>"#
        ));
    }

    #[test]
    fn mentions_and_document_content_links_share_an_identical_document_mention_tag() {
        // document_content_links deliberately repeats this tag literal (rather
        // than importing it) so it stays self-contained for MCP composition,
        // where `mentions` is excluded. Guard against the two silently
        // diverging by requiring both to contain the exact same string.
        const TAG: &str = r#"<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"md","blockParams":{}}</m-document-mention>"#;
        assert!(mentions::PROMPT.instructions.contains(TAG));
        assert!(document_content_links::PROMPT.instructions.contains(TAG));
    }

    #[test]
    fn agent_session_preamble_tells_the_model_to_emit_mention_tags() {
        let preamble = agent_session::PROMPT.to_string();
        assert!(preamble.contains("XML mention tag"));
        assert!(preamble.contains("clickable chips"));
    }

    #[test]
    fn markdown_surface_scope_names_every_surface_but_the_reply_tone_exception() {
        // The mention rule must name every Markdown-authoring surface and the
        // non-Markdown-document exception, and the tool-use tone rule must not
        // silently bleed into tool-authored content.
        let in_app = TOOL_USE_PROMPT.to_string();
        for surface in [
            "SendChannelMessage",
            "SendEmail",
            "CreateDocument",
            "agent session",
        ] {
            assert!(
                in_app.contains(surface),
                "markdown surface scope should name {surface}"
            );
        }
        assert!(in_app.contains("non-Markdown documents"));
        assert!(in_app.contains("apply to your own conversational replies only"));
    }
}
