//! Static prompt fragments used to compose AI system prompts.
//!
//! Each module holds one prompt section as static strings and exports a
//! `PROMPT` static — a [`StaticPrompt`] borrowing string data with `'static`
//! lifetime. Prompts chain together via [`StaticPrompt::compose`].
#![deny(missing_docs)]

pub mod about_macro;
pub mod agent_identity;
pub mod agent_session;
pub mod channel_mention;
pub mod citations;
pub mod coding_agents;
pub mod connected_toolsets;
pub mod crm_pipelines;
pub mod databases;
pub mod deferred_tools;
pub mod do_not;
pub mod document_content_links;
pub mod email;
pub mod math;
pub mod mcp_item_links;
pub mod mcp_setup;
pub mod mcp_usage;
pub mod mentions;
pub mod pull_requests;
pub mod skills;
pub mod tone;
pub mod tool_usage;
mod types;
pub mod user_tools;

pub use types::{ComposedPrompt, Section, StaticPrompt};

/// The base prompt: tone, math, citations, mentions, do-not rules, and Macro
/// terms. Contains no tool use instructions.
pub static BASE_PROMPT: ComposedPrompt = tone::PROMPT
    .compose(&math::PROMPT)
    .compose(&citations::PROMPT)
    .compose(&mentions::PROMPT)
    .compose(&do_not::PROMPT)
    .compose(&about_macro::PROMPT);

/// The tool-enabled prompt for hosts whose tools all execute directly in the
/// agent loop (the channel-mention bot, the MCP server): [`BASE_PROMPT`] with
/// the tool use instructions, skill-following rules, document-content linking
/// rules, and email inbox behavior appended. Says nothing about
/// composer-confirmed user tools — those hosts' toolsets execute
/// `CreateCalendarEvent` directly and have no `SendEmail` at all.
pub static DIRECT_TOOL_USE_PROMPT: ComposedPrompt = BASE_PROMPT
    .compose(&tool_usage::PROMPT)
    .compose(&databases::PROMPT)
    .compose(&crm_pipelines::PROMPT)
    .compose(&skills::PROMPT)
    .compose(&document_content_links::PROMPT)
    .compose(&email::PROMPT);

/// The chat tool-enabled prompt: [`DIRECT_TOOL_USE_PROMPT`] plus the rules
/// for composer-confirmed user tools (`SendEmail`, deferred execution), which
/// only apply on surfaces that can render the composer card. Composed as its
/// own chain so the email section stays last.
pub static TOOL_USE_PROMPT: ComposedPrompt = BASE_PROMPT
    .compose(&tool_usage::PROMPT)
    .compose(&databases::PROMPT)
    .compose(&crm_pipelines::PROMPT)
    .compose(&user_tools::BOOKING_PROMPT)
    .compose(&user_tools::PROMPT)
    .compose(&skills::PROMPT)
    .compose(&document_content_links::PROMPT)
    .compose(&email::PROMPT);

/// The agent-session tool-enabled prompt: [`TOOL_USE_PROMPT`] with the user
/// tool rules restated for a host that reviews those calls in the turn - a
/// review card the user answers while the agent waits, not a composer left
/// pending after it.
pub static SESSION_TOOL_USE_PROMPT: ComposedPrompt = BASE_PROMPT
    .compose(&tool_usage::PROMPT)
    .compose(&databases::PROMPT)
    .compose(&crm_pipelines::PROMPT)
    .compose(&user_tools::BOOKING_PROMPT)
    .compose(&user_tools::SESSION_PROMPT)
    .compose(&skills::PROMPT)
    .compose(&document_content_links::PROMPT)
    .compose(&email::PROMPT);

/// Agent-session instructions for nonblocking saved reviews in code mode.
pub static CODE_MODE_SESSION_TOOL_USE_PROMPT: ComposedPrompt = BASE_PROMPT
    .compose(&tool_usage::PROMPT)
    .compose(&databases::PROMPT)
    .compose(&crm_pipelines::PROMPT)
    .compose(&user_tools::BOOKING_PROMPT)
    .compose(&user_tools::CODE_MODE_SESSION_PROMPT)
    .compose(&skills::PROMPT)
    .compose(&document_content_links::PROMPT)
    .compose(&email::PROMPT);

/// Database-only agent instructions, without unrelated tool capabilities.
pub static DATABASE_TOOL_USE_PROMPT: ComposedPrompt = BASE_PROMPT.compose(&databases::PROMPT);

/// Database question instructions for hosts that only discover and read data.
pub static DATABASE_READ_ONLY_TOOL_USE_PROMPT: ComposedPrompt =
    BASE_PROMPT.compose(&databases::READ_ONLY_PROMPT);

/// The static rules surfaced to external MCP clients, after the item-linking
/// rules and the short "Using Macro" section — see [`mcp_instructions`].
///
/// Deliberately omits the in-app [`mentions`] section (MCP clients cannot render
/// `<m-document-mention>` tags in a chat reply), the in-app [`citations`] and
/// [`do_not`] rules (`[[...]]` citation ids render as raw text in MCP clients),
/// the in-app [`about_macro`] section (replaced by [`mcp_usage`]), and chat
/// tone/style and general tool-use instructions, which belong to the host
/// client, not to Macro. [`document_content_links`] still applies over MCP
/// because it governs content written *into* a Markdown document (via
/// `CreateDocument`/`EditDocument`), not the model's chat replies. See
/// [`mentions`] for the full statement of which surfaces (replies, channel
/// messages, email bodies, and Markdown documents) these Markdown/mention
/// rules cover.
static MCP_STATIC_INSTRUCTIONS: ComposedPrompt = document_content_links::PROMPT
    .compose(&databases::PROMPT)
    .compose(&crm_pipelines::PROMPT);

/// The static rules MCP clients got before agent-led setup. Served unchanged
/// while setup is switched off, so turning it off changes nothing for anyone.
static LEGACY_MCP_STATIC_INSTRUCTIONS: ComposedPrompt = citations::PROMPT
    .compose(&do_not::PROMPT)
    .compose(&about_macro::PROMPT)
    .compose(&databases::PROMPT)
    .compose(&crm_pipelines::PROMPT)
    .compose(&document_content_links::PROMPT);

/// The instructions MCP clients got before agent-led setup, served while it is
/// switched off. See [`mcp_instructions_for`] for the current ones.
pub fn legacy_mcp_instructions(base_url: &str) -> String {
    format!(
        "{}\n{LEGACY_MCP_STATIC_INSTRUCTIONS}",
        mcp_item_links::render(base_url)
    )
}

/// How many characters of server instructions Claude Code keeps. Everything an
/// agent needs to act correctly by default sits before this point.
pub const MCP_INSTRUCTIONS_VISIBLE_CHARS: usize = 4096;

/// Builds the instructions surfaced to external MCP clients via the server
/// `instructions` field.
///
/// Ordered by what an outside agent needs first, because clients truncate
/// (Claude Code keeps [`MCP_INSTRUCTIONS_VISIBLE_CHARS`]) and weigh the start
/// most: the setup flow, how to use Macro, how to link items in replies, the
/// rules for content written into Macro, then the database and CRM
/// references.
///
/// Item links in the model's own chat replies are rendered as plain Markdown
/// URLs (built from `base_url`, the runtime `APP_BASE_URL` value) and lists of
/// items as Markdown tables — NOT the in-app `<m-document-mention>` markup,
/// which MCP clients cannot render. Content the model writes *into* a Macro
/// document via `CreateDocument` or `EditDocument` is the opposite: it must
/// still use `<m-document-mention>` tags (see [`document_content_links`]),
/// since the Macro app renders that content regardless of which surface
/// created it. `base_url` should already have any trailing slash trimmed.
pub fn mcp_instructions(base_url: &str) -> String {
    mcp_instructions_for(base_url, mcp_setup::SetupHint::Unknown)
}

/// [`mcp_instructions`] for a person whose setup state is known: the setup
/// flow leads for a workspace that isn't set up, and shrinks to one line for
/// one that is. See [`mcp_setup`].
pub fn mcp_instructions_for(base_url: &str, setup: mcp_setup::SetupHint) -> String {
    format!(
        "{}\n{}\n{}\n{MCP_STATIC_INSTRUCTIONS}",
        mcp_setup::render(setup),
        mcp_usage::render(),
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
    fn direct_tool_use_prompt_omits_composer_confirmed_user_tool_rules() {
        // Hosts on the direct prompt (channel bot, MCP) have no composer and
        // no SendEmail tool; describing deferred user tools there would tell
        // the model the opposite of what its tools actually do.
        let direct = DIRECT_TOOL_USE_PROMPT.to_string();
        assert!(!direct.contains("PendingUserExecution"));
        assert!(!direct.contains("MUST use the `SendEmail` tool"));

        // The chat prompt keeps both rules.
        let chat = TOOL_USE_PROMPT.to_string();
        assert!(chat.contains("PendingUserExecution"));
        assert!(chat.contains("MUST use the `SendEmail` tool"));
    }

    #[test]
    fn session_tool_use_prompt_describes_a_review_in_the_turn_not_a_pending_composer() {
        // An agent session finishes user tools in the turn: the model never
        // sees "PendingUserExecution" there, and telling it about a composer
        // to confirm in later would have it say so to the user.
        let session = SESSION_TOOL_USE_PROMPT.to_string();
        assert!(!session.contains("PendingUserExecution"));
        assert!(session.contains("review card"));
        assert!(session.contains("MUST use the `SendEmail` tool"));
        assert!(session.contains("do not ask for confirmation in prose"));
    }

    #[test]
    fn session_tool_use_prompt_routes_thread_prompts_to_prose_and_the_confirmed_send() {
        // A prompt read out of a channel or document thread has no review
        // card anyone is watching: the model asks in the thread, then sends
        // on the user's reply through SendConfirmedEmail, quoting it.
        let session = SESSION_TOOL_USE_PROMPT.to_string();
        assert!(session.contains("channel or document thread"));
        assert!(session.contains("context block names a conversation parent"));
        assert!(session.contains("`SendConfirmedEmail`"));
        assert!(session.contains("quoted verbatim"));
        assert!(session.contains("`userConfirmation`"));
        assert!(session.contains("`AskUser`"));
        assert!(session.contains(
            "`SendConfirmedEmail` and `CreateConfirmedCalendarEvent` are never right here"
        ));

        // The thread rule is to restate what the tool would have done, whole,
        // so the user can approve it without opening the session - and it
        // covers every user tool, not just email: an approved event goes
        // through the calendar twin of the confirmed send.
        assert!(session.contains("written out verbatim"));
        assert!(session.contains("the whole calendar event"));
        assert!(session.contains("`CreateConfirmedCalendarEvent` for the event"));

        // Which prompt is being answered decides it, not the session.
        assert!(session.contains("decided per"));
    }

    #[test]
    fn session_tool_use_prompt_treats_a_private_conversation_like_the_session_view() {
        // A DM with the agent is read live: its questions and review cards
        // appear there, so the thread rule does not apply to it.
        let session = SESSION_TOOL_USE_PROMPT.to_string();
        assert!(session.contains("private conversation with the user is the exception"));
        assert!(session.contains("like one typed in the agent session view"));
    }

    #[test]
    fn session_tool_use_prompt_keeps_the_thread_mechanics_away_from_the_user() {
        // The thread rule explains review cards and the session view so the
        // model knows why it writes the draft out. None of that is for the
        // user, who asked for an email or an event and should just get the
        // draft and a question - not a note about where their prompt came from.
        let session = SESSION_TOOL_USE_PROMPT.to_string();
        assert!(session.contains("The rule above is for you, not the user"));
        assert!(session.contains("Never explain why you are writing the draft out"));
        assert!(session.contains("not mention the agent session view, review cards"));
        assert!(session.contains("does not know or care"));
        assert!(session.contains("with no preamble about"));
    }

    #[test]
    fn chat_prompt_names_the_confirmed_tools_only_to_rule_them_out() {
        // The chat host has the same toolset and a composer, so the direct
        // tools are visible there and must be steered away from; the direct
        // prompt's hosts do not register them and say nothing about them.
        let chat = TOOL_USE_PROMPT.to_string();
        assert!(chat.contains("`SendConfirmedEmail`"));
        assert!(chat.contains("`CreateConfirmedCalendarEvent`"));
        assert!(chat.contains("never use them here"));
        let direct = DIRECT_TOOL_USE_PROMPT.to_string();
        assert!(!direct.contains("SendConfirmedEmail"));
        assert!(!direct.contains("CreateConfirmedCalendarEvent"));
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
    fn mentions_and_document_content_links_share_the_github_pr_mention_tag() {
        // GitHub PRs are mentioned by URL in-app and over MCP alike; the two
        // sections must hand the model the same tag shape.
        const TAG: &str = r#"<m-pr-mention>{"url":"https://github.com/{owner}/{repo}/pull/{number}","label":""}</m-pr-mention>"#;
        assert!(mentions::PROMPT.instructions.contains(TAG));
        assert!(document_content_links::PROMPT.instructions.contains(TAG));
        assert!(mcp_instructions("https://macro.com").contains(TAG));
    }

    #[test]
    fn mentions_and_document_content_links_share_the_booking_link_mention_tag() {
        const TAG: &str = r#"<m-booking-link-mention>{"profileId":"{profile_id}","slug":"{slug}","url":"https://macro.com/app/book/{profile_id}/{slug}","label":""}</m-booking-link-mention>"#;
        assert!(mentions::PROMPT.instructions.contains(TAG));
        assert!(document_content_links::PROMPT.instructions.contains(TAG));
        assert!(mcp_instructions("https://macro.com").contains(TAG));
    }

    #[test]
    fn agent_session_preamble_tells_the_model_to_emit_mention_tags() {
        let preamble = agent_session::PROMPT.to_string();
        assert!(preamble.contains("XML mention tag"));
        assert!(preamble.contains("clickable chips"));
        assert!(preamble.contains("agent session"));
        assert!(preamble.contains("date/time"));
    }

    #[test]
    fn mentions_prompt_says_a_shared_calendar_event_previews_for_channel_members() {
        let instructions = mentions::PROMPT.instructions.as_ref();
        assert!(instructions.contains("read-only preview"));
        assert!(instructions.contains("Private and confidential events are never shared"));
    }

    #[test]
    fn mentions_prompt_covers_date_and_agent_session_chips() {
        let instructions = mentions::PROMPT.instructions.as_ref();
        assert!(instructions.contains("<m-date-mention>"));
        assert!(instructions.contains("<m-agent-session-mention>"));
        assert!(instructions.contains("<m-user-mention>"));
        assert!(instructions.contains("\"expanded\":true"));
        assert!(instructions.contains("\"blockName\":\"skill\""));
        assert!(instructions.contains("\"blockName\":\"initiative\""));
        assert!(instructions.contains("\"blockName\":\"pipeline\""));
    }

    #[test]
    fn system_prompt_tells_agents_to_open_ready_pull_requests_with_ci_passing() {
        let prompt = BASE_PROMPT.to_string();
        assert!(prompt.contains(pull_requests::READY_PULL_REQUEST));
        assert!(mcp_instructions("https://macro.com").contains(pull_requests::READY_PULL_REQUEST));

        let coding = coding_agents::PROMPT.to_string();
        assert!(coding.contains("ready for review, not a draft"));
        assert!(coding.contains("CI passing"));
    }

    #[test]
    fn agent_identity_names_the_agent_before_the_session_preamble() {
        let identity = agent_identity::render("Grunk", "grunk");
        assert!(identity.starts_with("# Identity\n"));
        assert!(identity.contains("You are Grunk (@grunk)."));
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

    /// The first `n` characters, as a client that cuts instructions keeps them.
    fn first_chars(text: &str, n: usize) -> String {
        text.chars().take(n).collect()
    }

    #[test]
    fn legacy_instructions_are_the_ones_before_agent_led_setup() {
        let legacy = legacy_mcp_instructions("https://macro.com");
        assert!(legacy.starts_with(&mcp_item_links::render("https://macro.com")));
        assert!(legacy.contains(&citations::PROMPT.to_string()));
        assert!(!legacy.contains("SetupGetState"));
        assert!(!legacy.contains("# Using Macro"));
    }

    #[test]
    fn mcp_instructions_never_name_tools_mcp_does_not_have() {
        let instructions = mcp_instructions("https://macro.com");
        assert!(!instructions.contains("ReadThread"));
    }

    #[test]
    fn mcp_instructions_drop_citation_ids_that_mcp_clients_cannot_render() {
        let instructions = mcp_instructions("https://macro.com");
        assert!(!instructions.contains("[[md;"));
        assert!(instructions.contains("never `[[...]]` ids"));
    }

    #[test]
    fn mcp_usage_and_reply_linking_survive_claude_code_truncation() {
        let instructions = mcp_instructions("https://macro.com");
        let visible = first_chars(&instructions, MCP_INSTRUCTIONS_VISIBLE_CHARS);
        assert!(visible.contains("# Using Macro"));
        assert!(visible.contains("SelfKnowledge"));
        assert!(visible.contains("columns `number`, `name`, and `link`"));
    }

    #[test]
    fn a_workspace_that_is_not_set_up_leads_with_the_setup_flow() {
        let instructions =
            mcp_instructions_for("https://macro.com", mcp_setup::SetupHint::NotSetUp);
        // ChatGPT weighs roughly the first 512 characters.
        let head = first_chars(&instructions, 512);
        assert!(head.contains("Before anything else, call SetupGetState"));
        for step in [
            "SetupConnect",
            "SetupDiscover",
            "SetupProposePlan",
            "SetupImport",
            "SetupGetStatus",
        ] {
            assert!(instructions.contains(step), "the flow should name {step}");
        }
        assert!(instructions.contains("Never share, invite, send or pay"));
    }

    #[test]
    fn a_set_up_workspace_gets_one_line_of_setup() {
        let setup = mcp_setup::render(mcp_setup::SetupHint::SetUp);
        let lines: Vec<&str> = setup
            .lines()
            .filter(|line| !line.starts_with('#'))
            .collect();
        assert_eq!(lines.len(), 1);
        assert!(!setup.contains("SetupConnect"));
    }

    #[test]
    fn the_setup_flow_usage_and_reply_linking_fit_in_what_claude_code_keeps() {
        for hint in [
            mcp_setup::SetupHint::NotSetUp,
            mcp_setup::SetupHint::SetUp,
            mcp_setup::SetupHint::Unknown,
        ] {
            let instructions = mcp_instructions_for("https://macro.com", hint);
            let visible = first_chars(&instructions, MCP_INSTRUCTIONS_VISIBLE_CHARS);
            assert!(visible.contains("SetupGetState"), "{hint:?}");
            assert!(visible.contains("# Using Macro"), "{hint:?}");
            assert!(
                visible.contains("columns `number`, `name`, and `link`"),
                "{hint:?}: the item-linking rules must be visible"
            );
            // The cut must not land inside the example of a document link.
            assert!(
                visible.contains("</m-document-mention>"),
                "{hint:?}: the document link example must be visible whole"
            );
        }
    }
}
