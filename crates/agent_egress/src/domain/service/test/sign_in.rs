//! An upstream that answers HTTP 401 asks for a sign-in: the proxy records
//! it on the connection and answers as for one that cannot be used.

use super::*;
use crate::domain::ports::ActorMcpTransport;
use serde_json::{Value, json};
use std::sync::atomic::{AtomicUsize, Ordering};

/// Answers every exchange the way a server never signed in to does.
#[derive(Default)]
struct SignInTransport(AtomicUsize);

#[async_trait::async_trait]
impl ActorMcpTransport for SignInTransport {
    async fn exchange(
        &self,
        _: AgentSessionId,
        _: MacroUserIdStr<'static>,
        _: UpstreamCall,
        _: Value,
    ) -> Result<Value, EgressError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Err(EgressError::SignInRequired)
    }
}

fn wiki_destination() -> McpDestination {
    McpDestination::Custom(CustomMcpServerKey::for_url(WIKI))
}

#[tokio::test]
async fn an_in_process_call_to_a_server_asking_for_a_sign_in_answers_how_to_sign_in() {
    let transport = Arc::new(SignInTransport::default());
    let service = gated(prompted_by(Some(owner())), SpyCredentials::at(WIKI))
        .with_actor_mcp(transport.clone());
    let grant = service.session_grant(AgentSessionId::new()).await.unwrap();

    let result = service
        .exchange_as(
            &grant,
            &owner(),
            &wiki_destination(),
            json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search","arguments":{}}}),
        )
        .await
        .unwrap();

    assert_eq!(result["isError"], true);
    let text = result["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("Team wiki"), "{text}");
    assert!(text.contains("Sign in"), "{text}");
    assert!(!text.contains("outcome may be unknown"), "{text}");
    assert_eq!(
        *service.credentials.unauthorized.lock().unwrap(),
        [(owner().to_string(), wiki_destination())]
    );
    assert_eq!(transport.0.load(Ordering::SeqCst), 1, "never retried");
}

#[tokio::test]
async fn an_in_process_listing_of_a_server_asking_for_a_sign_in_offers_the_connect_tool() {
    let service = gated(prompted_by(Some(owner())), SpyCredentials::at(WIKI))
        .with_actor_mcp(Arc::new(SignInTransport::default()));
    let grant = service.session_grant(AgentSessionId::new()).await.unwrap();

    let result = service
        .exchange_as(
            &grant,
            &owner(),
            &wiki_destination(),
            json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}),
        )
        .await
        .unwrap();

    assert_eq!(result["tools"][0]["name"], CONNECT_TOOL_NAME);
    assert_eq!(service.credentials.unauthorized.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_sandbox_call_to_a_server_asking_for_a_sign_in_answers_how_to_sign_in() {
    let transport = Arc::new(SignInTransport::default());
    let service = gated(prompted_by(Some(asker())), SpyCredentials::at(WIKI))
        .with_actor_mcp(transport.clone());

    let response = service
        .proxy(
            &SessionToken::new("session"),
            wiki(),
            json_request(
                r#"{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"search","arguments":{"acting_as":"requester"}}}"#,
            ),
        )
        .await
        .unwrap();

    let body = body_json(response).await;
    assert_eq!(body["id"], 9);
    assert_eq!(body["result"]["isError"], true);
    let text = body["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("Team wiki"), "{text}");
    assert!(text.contains("Sign in"), "{text}");
    assert_eq!(
        *service.credentials.unauthorized.lock().unwrap(),
        [(asker().to_string(), wiki_destination())]
    );
    assert_eq!(transport.0.load(Ordering::SeqCst), 1, "never retried");
    assert!(!service.forward.was_called());
}

#[tokio::test]
async fn a_sandbox_listing_of_an_app_asking_for_a_sign_in_offers_the_connect_tool() {
    let service = gated(prompted_by(Some(asker())), SpyCredentials::knowing())
        .with_actor_mcp(Arc::new(SignInTransport::default()));

    let response = service
        .proxy(
            &SessionToken::new("session"),
            datadog(),
            json_request(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#),
        )
        .await
        .unwrap();

    let body = body_json(response).await;
    assert_eq!(body["result"]["tools"][0]["name"], CONNECT_TOOL_NAME);
    assert_eq!(
        *service.credentials.unauthorized.lock().unwrap(),
        [(
            owner().to_string(),
            McpDestination::Connected(McpServerSlug::parse("datadog").unwrap())
        )]
    );
}

/// The raw passthrough: a server called bare answering 401 is asking for a
/// sign-in, so it is recorded, and its status still reaches the client.
#[tokio::test]
async fn an_anonymous_server_answering_401_is_recorded_and_passed_through() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::anonymous(),
        SpyGithubTokens::default(),
        SpyForwarder::answering_with(StatusCode::UNAUTHORIZED),
    );

    let response = service
        .proxy(
            &SessionToken::new("session-token"),
            wiki(),
            json_request(r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{}}"#),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        *service.credentials.unauthorized.lock().unwrap(),
        [(owner().to_string(), wiki_destination())]
    );
}

/// A 401 to a credential the proxy stamped is the connector's own grant to
/// judge; the passthrough records only bare calls.
#[tokio::test]
async fn a_server_answering_401_to_a_stamped_credential_is_not_recorded() {
    let service = EgressServiceImpl::new(
        StubSessions::granting(),
        SpyCredentials::at(WIKI),
        SpyGithubTokens::default(),
        SpyForwarder::answering_with(StatusCode::UNAUTHORIZED),
    );

    let response = service
        .proxy(
            &SessionToken::new("session-token"),
            wiki(),
            json_request(r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{}}"#),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(service.credentials.unauthorized.lock().unwrap().is_empty());
}
