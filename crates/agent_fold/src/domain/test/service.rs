use super::util::{TURN, parse_log_as, test_session};
use crate::domain::fold;
use crate::domain::model::{AuthorKind, MessageId, TurnId};
use crate::domain::ports::FoldedMessageRepo;
use crate::domain::service::FoldedMessageService;
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::ports::AgentSessionLogRepo;
use agent_session::testing::InMemoryAgentSessionRepo;

fn other_session() -> AgentSessionId {
    AgentSessionId::TEST_B
}

/// A repo holding two sessions: the full fixture, and a second session cut
/// off mid-turn.
fn two_session_store() -> InMemoryAgentSessionRepo {
    let mut second = parse_log_as(other_session(), TURN);
    second.truncate(9);

    parse_log_as(test_session(), TURN)
        .into_iter()
        .chain(second)
        .collect()
}

/// Queries answer per session: each session's log folds independently, and
/// a session nothing was logged for is simply empty - the same answer a
/// database would give.
#[tokio::test]
async fn queries_are_scoped_to_a_session() {
    let service = FoldedMessageService::new(two_session_store());

    let full = service
        .messages(test_session())
        .await
        .expect("in-memory store cannot fail");
    assert_eq!(full.len(), 2);
    assert!(full[1].stop.is_some(), "full session closed its turn");

    let interrupted = service
        .messages(other_session())
        .await
        .expect("in-memory store cannot fail");
    assert_eq!(interrupted.len(), 2);
    assert_eq!(interrupted[1].stop, None, "cut session never closed");

    let unknown = service
        .messages(AgentSessionId::new())
        .await
        .expect("in-memory store cannot fail");
    assert_eq!(unknown, vec![], "an unlogged session has no messages");
}

/// `get` addresses one message by its natural key.
#[tokio::test]
async fn gets_a_message_by_id() {
    let service = FoldedMessageService::new(two_session_store());

    let listed = service
        .messages(test_session())
        .await
        .expect("in-memory store cannot fail");
    let agent_reply = listed[1].clone();

    let fetched = service
        .get_message(test_session(), agent_reply.id())
        .await
        .expect("in-memory store cannot fail");
    assert_eq!(fetched, Some(agent_reply), "get returns the listed message");

    let missing = service
        .get_message(
            test_session(),
            MessageId {
                turn: TurnId(7),
                author: AuthorKind::Agent,
            },
        )
        .await
        .expect("in-memory store cannot fail");
    assert_eq!(missing, None, "a key no turn produced is absent");
}

/// The service is a read model over whatever the log store returns; folding
/// through the service matches folding the log directly.
#[tokio::test]
async fn service_matches_the_bare_fold() {
    let store = two_session_store();
    let service = FoldedMessageService::new(store.clone());

    let via_service = service
        .messages(test_session())
        .await
        .expect("in-memory store cannot fail");
    let via_fold = fold::fold(
        AgentSessionLogRepo::list_by_session(&store, test_session())
            .await
            .expect("in-memory store cannot fail"),
    );

    assert_eq!(via_service, via_fold);

    // Every derived message is addressable by the key it reports.
    for message in &via_service {
        let fetched = service
            .get_message(test_session(), message.id())
            .await
            .expect("in-memory store cannot fail");
        assert_eq!(fetched.as_ref(), Some(message));
    }
}
