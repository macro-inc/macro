use super::*;
use crate::domain::ports::AgentSessionLogRepo;
use crate::testing::{InMemoryAgentSessionRepo, test_agent_session};
use agent_fold::testing::{TURN, parse_log_as, test_session};

#[tokio::test]
async fn backfill_is_bounded_and_uses_the_authoritative_fold() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_session();
    repo.insert_session(test_agent_session(session));
    repo.insert_session(test_agent_session(AgentSessionId::new()));
    let frames = parse_log_as(session, TURN);
    for frame in frames {
        let prompted = matches!(
            &frame.content,
            crate::domain::model::Message::ToRuntime(
                agent_runtime_protocol::domain::schema::v0::ToRuntimeMessage::Acp(
                    agent_runtime_protocol::domain::schema::v0::AcpMessage(
                        agent_client_protocol::RawJsonRpcMessage::Request(request)
                    )
                )
            ) if request.method.as_ref() == "session/prompt"
        );
        AgentSessionLogRepo::create(&repo, frame).await.unwrap();
        if prompted {
            break;
        }
    }
    let permission = parse_log_as(session, r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":1,"method":"session/request_permission","params":{"sessionId":"s1","toolCall":{"toolCallId":"tool"},"options":[{"optionId":"once","name":"Allow once","kind":"allow_once"}]}}}"#).remove(0);
    AgentSessionLogRepo::create(&repo, permission)
        .await
        .unwrap();
    let first = backfill_turn_states(&repo, NonZeroUsize::new(1).unwrap())
        .await
        .unwrap();
    assert_eq!(
        first,
        TurnStateBackfill {
            examined: 1,
            projected: 1
        }
    );
    let second = backfill_turn_states(&repo, NonZeroUsize::new(2).unwrap())
        .await
        .unwrap();
    assert_eq!(
        second,
        TurnStateBackfill {
            examined: 1,
            projected: 1
        }
    );
    assert_eq!(repo.turn_state(session), Some(TurnState::Blocked));
    assert_eq!(
        backfill_turn_states(&repo, NonZeroUsize::new(2).unwrap())
            .await
            .unwrap()
            .examined,
        0
    );
}

#[tokio::test]
async fn a_new_log_frame_or_existing_projection_rejects_a_stale_backfill() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_session();
    repo.insert_session(test_agent_session(session));
    let mut frames = parse_log_as(session, TURN).into_iter();
    let stored = AgentSessionLogRepo::create(&repo, frames.next().unwrap())
        .await
        .unwrap();
    let newer = AgentSessionLogRepo::create(&repo, frames.next().unwrap())
        .await
        .unwrap();
    assert!(
        !repo
            .initialize_turn_state(session, Some(stored.id), TurnState::Idle)
            .await
            .unwrap()
    );
    assert!(
        repo.initialize_turn_state(session, Some(newer.id), TurnState::Running)
            .await
            .unwrap()
    );
    assert!(
        !repo
            .initialize_turn_state(session, Some(newer.id), TurnState::Idle)
            .await
            .unwrap()
    );
    assert_eq!(repo.turn_state(session), Some(TurnState::Running));
}
