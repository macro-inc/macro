use super::*;
use crate::domain::model::Message;
use agent_client_protocol::schema::v1::RequestId;
use agent_runtime_protocol::domain::action::AgentAction;
use agent_runtime_protocol::domain::schema::v0::SystemEvent;

#[tokio::test]
async fn effective_history_orders_timestamps_and_uuid_ties_before_selecting_boundary() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = AgentSessionId::new();
    let other = AgentSessionId::new();
    let time = chrono::Utc::now();
    let row = |id, seconds| StoredAgentSessionLog {
        id: Uuid::from_u128(id),
        created_at: time + chrono::Duration::seconds(seconds),
        entry: AgentSessionLog {
            agent_session_id: session,
            user_id: None,
            content: Message::ToServer(ToServerMessage::Event {
                event: SystemEvent::AcpReady,
            }),
        },
    };
    // Intentionally scrambled insertion order and UUIDs contrary to timestamp order.
    repo.logs
        .lock()
        .unwrap()
        .insert(session, vec![row(1, 2), row(4, 1), row(5, 0), row(3, 1)]);
    repo.history_boundaries
        .lock()
        .unwrap()
        .insert(other, Uuid::from_u128(4));
    let ids = |rows: Vec<StoredAgentSessionLog>| {
        rows.into_iter()
            .map(|row| row.id.as_u128())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        ids(AgentSessionLogRepo::list_by_session(&repo, session)
            .await
            .unwrap()),
        vec![5, 3, 4, 1]
    );
    repo.history_boundaries
        .lock()
        .unwrap()
        .insert(session, Uuid::from_u128(4));
    assert_eq!(
        ids(AgentSessionLogRepo::list_by_session(&repo, session)
            .await
            .unwrap()),
        vec![4, 1]
    );
    assert!(
        AgentSessionLogRepo::list_by_session(&repo, other)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        repo.logs.lock().unwrap()[&session].len(),
        4,
        "selection retains raw rows"
    );
}

fn set_model_log(
    session_id: AgentSessionId,
    acp: &SessionId,
    model: &str,
) -> StoredAgentSessionLog {
    let message = AgentAction::set_model(model)
        .to_runtime(acp, RequestId::Str("c".to_owned()))
        .expect("set-model is a runtime frame");
    StoredAgentSessionLog {
        id: macro_uuid::generate_uuid_v7(),
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
