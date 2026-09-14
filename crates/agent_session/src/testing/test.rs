use super::*;
use crate::domain::model::Message;
use agent_runtime_protocol::domain::schema::v0::SystemEvent;

#[test]
fn seeded_frames_remain_ordered_when_the_clock_has_not_advanced() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = AgentSessionId::new();
    let entry = AgentSessionLog {
        agent_session_id: session,
        user_id: None,
        content: Message::ToServer(ToServerMessage::Event {
            event: SystemEvent::AcpReady,
        }),
    };
    // Put the existing seed ahead of the wall clock to exercise the tie/backward
    // clock path deterministically, rather than hoping two calls share a tick.
    repo.logs.lock().unwrap().insert(
        session,
        vec![StoredAgentSessionLog {
            id: Uuid::from_u128(1),
            created_at: chrono::Utc::now() + chrono::Duration::seconds(60),
            entry: entry.clone(),
        }],
    );
    repo.extend_log([entry.clone(), entry]);
    let rows = repo.logs.lock().unwrap();
    assert!(
        rows[&session]
            .windows(2)
            .all(|pair| pair[0].created_at < pair[1].created_at)
    );
}

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
