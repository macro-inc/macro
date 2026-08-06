use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    InitializeRequest, InitializeResponse, NewSessionRequest, NewSessionResponse, PromptRequest,
    SessionId,
};
use tokio::sync::mpsc::unbounded_channel;

use super::*;

/// A [`FakeAgent`] whose outbound frames nothing reads.
fn agent() -> FakeAgent {
    let (to_harness, _rx) = unbounded_channel();
    FakeAgent::new(to_harness)
}

/// What the harness sends when it builds a typed ACP request.
fn request(payload: &(impl JsonRpcMessage + serde::Serialize), id: &str) -> RawJsonRpcMessage {
    RawJsonRpcMessage::request(
        payload.method().to_owned(),
        serde_json::to_value(payload).unwrap(),
        RequestId::Str(id.to_owned()),
    )
    .unwrap()
}

#[test]
fn the_handshake_order_is_accepted() {
    let agent = agent();

    agent.deliver(request(
        &InitializeRequest::new(ProtocolVersion::V1),
        "initialize",
    ));
    agent.completes_initialize(InitializeResponse::new(ProtocolVersion::V1));
    agent.deliver(request(&NewSessionRequest::new("/workspace"), "new"));
    agent.sends_reply(
        RequestId::Str("new".to_owned()),
        NewSessionResponse::new("acp-abc"),
    );
    agent.deliver(request(
        &PromptRequest::new(SessionId::new("acp-abc"), vec!["hello".into()]),
        "prompt",
    ));

    assert!(matches!(
        agent.received_requests().as_slice(),
        [
            ClientRequest::InitializeRequest(_),
            ClientRequest::NewSessionRequest(_),
            ClientRequest::PromptRequest(_)
        ]
    ));
}

/// The subtle case: `initialize` answered is not enough, because a prompt needs
/// the session id only `session/new` returns.
#[test]
#[should_panic(expected = "before its ACP session existed")]
fn a_prompt_before_session_new_is_answered_panics() {
    let agent = agent();

    agent.deliver(request(
        &InitializeRequest::new(ProtocolVersion::V1),
        "initialize",
    ));
    agent.completes_initialize(InitializeResponse::new(ProtocolVersion::V1));
    agent.deliver(request(&NewSessionRequest::new("/workspace"), "new"));

    agent.deliver(request(
        &PromptRequest::new(SessionId::new("acp-abc"), vec!["hello".into()]),
        "prompt",
    ));
}
