use super::*;
use ai_toolset::AsyncToolCollection;
use rmcp::{handler::server::ServerHandler, model::ErrorCode};

fn empty_service() -> AuthenticatedToolService<()> {
    AuthenticatedToolService::new(Arc::new(AsyncToolCollection::new()), ())
}

#[test]
fn server_info_advertises_macro_tools() {
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

#[test]
fn server_instructions_describe_available_workflows() {
    let instructions = empty_service()
        .get_info()
        .instructions
        .expect("server should provide MCP instructions");

    for expected_text in [
        "Macro workspace",
        "ContentSearch",
        "NameSearch",
        "ReadContent",
        "ReadMetadata",
        "ReadThread",
        "CreateDocument",
        "ListEntities",
    ] {
        assert!(
            instructions.contains(expected_text),
            "instructions should mention {expected_text}"
        );
    }
}

#[test]
fn empty_toolset_lists_no_tools() {
    assert!(empty_service().tool_definitions().is_empty());
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
