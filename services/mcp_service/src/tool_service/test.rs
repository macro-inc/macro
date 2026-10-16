use super::*;
use ai_toolset::AsyncToolCollection;
use rmcp::{handler::server::ServerHandler, model::ErrorCode};

fn empty_service() -> AuthenticatedToolService<()> {
    AuthenticatedToolService::new(
        Arc::new(AsyncToolCollection::new()),
        (),
        "https://macro.com".to_owned(),
        url::Url::parse("https://static-file-service.macro.com").unwrap(),
    )
    .with_agent_setup(Arc::new(crate::setup_prompt::UnknownSetup))
}

/// The service as it runs while agent-led setup is switched off.
fn service_without_setup() -> AuthenticatedToolService<()> {
    AuthenticatedToolService::new(
        Arc::new(AsyncToolCollection::new()),
        (),
        "https://macro.com".to_owned(),
        url::Url::parse("https://static-file-service.macro.com").unwrap(),
    )
}

#[tokio::test]
async fn with_setup_off_mcp_clients_get_exactly_what_they_got_before() {
    let info = service_without_setup().get_info();

    assert!(info.capabilities.prompts.is_none());
    assert_eq!(
        info.instructions.as_deref(),
        Some(
            format!(
                "{LEGACY_INSTRUCTIONS_PREAMBLE}\n\n{}",
                prompt::legacy_mcp_instructions("https://macro.com")
            )
            .as_str()
        )
    );
    let instructions = info.instructions.unwrap_or_default();
    assert!(instructions.starts_with("This server provides tools for interacting"));
    assert!(!instructions.contains("SetupGetState"));
}

#[tokio::test]
async fn with_setup_on_the_setup_prompt_is_offered() {
    let info = empty_service().get_info();

    assert!(info.capabilities.prompts.is_some());
    assert!(
        info.instructions
            .unwrap_or_default()
            .contains("SetupGetState")
    );
}

#[tokio::test]
async fn server_info_advertises_macro_tools() {
    let info = empty_service().get_info();

    assert_eq!(info.server_info.name, "macro-tools");
    assert_eq!(info.server_info.title.as_deref(), Some("Macro"));
    assert_eq!(info.server_info.version, env!("CARGO_PKG_VERSION"));
    assert!(
        info.server_info
            .description
            .as_deref()
            .is_some_and(|description| description.contains("documents, emails, and messages"))
    );
    assert!(info.capabilities.tools.is_some());
}

#[tokio::test]
async fn server_info_advertises_the_web_app_favicon() {
    let info = empty_service().get_info();

    let icons = info
        .server_info
        .icons
        .expect("server should advertise an icon");
    let [icon] = icons.as_slice() else {
        panic!("server should advertise exactly one icon");
    };

    // The same file the web app's <link rel="icon"> points at.
    assert_eq!(icon.src, "https://macro.com/app/macro-favicon.svg");
    assert_eq!(icon.mime_type.as_deref(), Some("image/svg+xml"));
    assert_eq!(icon.sizes.as_deref(), Some(["any".to_owned()].as_slice()));
}

#[tokio::test]
async fn server_instructions_describe_available_workflows() {
    let instructions = empty_service()
        .get_info()
        .instructions
        .expect("server should provide MCP instructions");

    for expected_text in [
        "Macro is the person's work hub",
        "ContentSearch",
        "NameSearch",
        "ReadContent",
        "ReadMetadata",
        "ReadChannelMessages",
        "ReadChannelThread",
        "ReadChannelMessageContext",
        "download URLs",
        "CreateDocument",
        "ListEntities",
        "ListSkills",
        "ReadSkill",
    ] {
        assert!(
            instructions.contains(expected_text),
            "instructions should mention {expected_text}"
        );
    }
}

#[tokio::test]
async fn server_instructions_only_name_tools_the_server_has() {
    let instructions = empty_service()
        .get_info()
        .instructions
        .expect("server should provide MCP instructions");

    // MCP has no ReadThread tool; naming it sends agents to a dead end.
    assert!(!instructions.contains("ReadThread"));
}

#[tokio::test]
async fn server_instructions_link_items_as_urls_not_mention_tags() {
    let instructions = empty_service()
        .get_info()
        .instructions
        .expect("server should provide MCP instructions");

    // MCP responses must link items with plain URLs built from the app base URL.
    assert!(
        instructions.contains("https://macro.com/app/"),
        "instructions should build item links from the app base url"
    );
    // And must steer the model away from the in-app mention markup.
    assert!(
        instructions.contains("<m-document-mention>"),
        "instructions should reference the mention tag it is forbidding"
    );
    assert!(
        instructions.contains("Do NOT emit"),
        "instructions should forbid emitting mention tags in MCP responses"
    );
    // Lists of items should be rendered as a table with number/name/link columns.
    for column in ["number", "name", "link"] {
        assert!(
            instructions.contains(column),
            "instructions should describe the {column} table column"
        );
    }
}

#[tokio::test]
async fn empty_toolset_lists_no_tools() {
    assert!(empty_service().tool_definitions().is_empty());
}

/// Anthropic's connector directory rejects any tool missing a display title or
/// the applicable `readOnlyHint`/`destructiveHint`, and any tool name over 64
/// characters. Assert it against the toolset the server actually exposes, so a
/// newly added tool can't quietly regress the submission.
#[test]
fn every_exposed_tool_meets_directory_requirements() {
    let tools = ai_tools::tools_for(ai_tools::AiHost::Mcp);
    assert!(
        !tools.toolset.tools.is_empty(),
        "the MCP toolset should not be empty"
    );

    for (name, tool) in tools.toolset.tools.iter() {
        let annotations = mcp_annotations(&tool.annotations);

        assert!(
            name.len() <= 64,
            "{name} exceeds the 64-character tool name limit"
        );
        assert!(
            annotations
                .title
                .as_deref()
                .is_some_and(|title| !title.trim().is_empty()),
            "{name} has no display title"
        );
        assert!(
            annotations.read_only_hint.is_some(),
            "{name} has no readOnlyHint"
        );
        assert!(
            annotations.destructive_hint.is_some(),
            "{name} has no destructiveHint"
        );
        assert!(
            !(annotations.read_only_hint == Some(true)
                && annotations.destructive_hint == Some(true)),
            "{name} claims to be both read-only and destructive"
        );
    }
}

#[test]
fn read_only_tools_map_to_read_only_hint() {
    let annotations = mcp_annotations(&ai_toolset::ToolAnnotations::read_only("Read document"));

    assert_eq!(annotations.title.as_deref(), Some("Read document"));
    assert_eq!(annotations.read_only_hint, Some(true));
    assert_eq!(annotations.destructive_hint, Some(false));
    assert_eq!(annotations.idempotent_hint, Some(true));
    assert_eq!(annotations.open_world_hint, Some(false));
}

#[test]
fn destructive_tools_map_to_destructive_hint() {
    let annotations =
        mcp_annotations(&ai_toolset::ToolAnnotations::destructive("Send email").with_open_world());

    assert_eq!(annotations.title.as_deref(), Some("Send email"));
    assert_eq!(annotations.read_only_hint, Some(false));
    assert_eq!(annotations.destructive_hint, Some(true));
    assert_eq!(annotations.open_world_hint, Some(true));
}

#[test]
fn additive_tools_set_neither_hint() {
    let annotations = mcp_annotations(&ai_toolset::ToolAnnotations::additive("Create document"));

    assert_eq!(annotations.read_only_hint, Some(false));
    assert_eq!(annotations.destructive_hint, Some(false));
}

#[test]
fn authenticated_user_id_is_read_from_http_request_parts() {
    let expected_user_id = MacroUserIdStr::try_from_email("User@macro.com").unwrap();
    let mut parts = http::Request::new(()).into_parts().0;
    parts.extensions.insert(expected_user_id.clone());

    let mut extensions = rmcp::model::Extensions::new();
    extensions.insert(parts);

    let user_id = AuthenticatedToolService::<()>::authenticated_user_id(&extensions).unwrap();

    assert_eq!(user_id, expected_user_id);
}

#[test]
fn authenticated_user_id_requires_request_parts() {
    let error =
        AuthenticatedToolService::<()>::authenticated_user_id(&rmcp::model::Extensions::new())
            .expect_err("missing request parts should fail auth extraction");

    assert_eq!(error.code, ErrorCode::INTERNAL_ERROR);
    assert_eq!(error.message, "missing user identity — is auth configured?");
}

#[test]
fn authenticated_user_id_requires_user_extension_inside_request_parts() {
    let parts = http::Request::new(()).into_parts().0;
    let mut extensions = rmcp::model::Extensions::new();
    extensions.insert(parts);

    let error = AuthenticatedToolService::<()>::authenticated_user_id(&extensions)
        .expect_err("missing user id should fail auth extraction");

    assert_eq!(error.code, ErrorCode::INTERNAL_ERROR);
    assert_eq!(error.message, "missing user identity — is auth configured?");
}
