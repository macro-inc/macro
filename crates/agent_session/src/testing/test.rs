use super::*;
use crate::domain::model::Message;
use agent_client_protocol::schema::v1::RequestId;
use agent_runtime_protocol::domain::action::AgentAction;

fn set_model_log(
    session_id: AgentSessionId,
    acp: &SessionId,
    model: &str,
) -> StoredAgentSessionLog {
    let message = AgentAction::set_model(model)
        .to_runtime(acp, RequestId::Str("c".to_owned()))
        .expect("set-model is a runtime frame");
    StoredAgentSessionLog {
        created_at: chrono::Utc::now(),
        entry: AgentSessionLog {
            agent_session_id: session_id,
            user_id: None,
            content: Message::ToRuntime(message),
        },
    }
}

fn session_with_acp(id: AgentSessionId, acp: SessionId) -> AgentSession {
    let mut session = test_agent_session(id);
    session.model = "claude".to_owned();
    session.acp_session_id = Some(acp);
    session
}

#[tokio::test]
async fn create_batch_projects_a_set_model_request_onto_the_session() {
    let repo = InMemoryAgentSessionRepo::new();
    let id = AgentSessionId::new();
    let acp = SessionId::new("s1");
    repo.insert_session(session_with_acp(id, acp.clone()));

    AgentSessionLogRepo::create_batch(&repo, vec![set_model_log(id, &acp, "opus")])
        .await
        .expect("batch write");

    assert_eq!(
        AgentSessionRepo::get(&repo, id)
            .await
            .expect("exists")
            .model,
        "opus",
        "create_batch must project models the same way create does"
    );
}

#[tokio::test]
async fn create_batch_projects_the_last_set_model_in_the_batch() {
    let repo = InMemoryAgentSessionRepo::new();
    let id = AgentSessionId::new();
    let acp = SessionId::new("s1");
    repo.insert_session(session_with_acp(id, acp.clone()));

    AgentSessionLogRepo::create_batch(
        &repo,
        vec![
            set_model_log(id, &acp, "sonnet"),
            set_model_log(id, &acp, "opus"),
        ],
    )
    .await
    .expect("batch write");

    assert_eq!(
        AgentSessionRepo::get(&repo, id)
            .await
            .expect("exists")
            .model,
        "opus"
    );
}
