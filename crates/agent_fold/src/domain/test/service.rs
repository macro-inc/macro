use super::util::{InMemoryLog, TURN, parse_log_as, test_session};
use crate::domain::fold;
use crate::domain::log::AgentSessionId;
use crate::domain::model::{AuthorKind, MessageId, TurnId};
use crate::domain::ports::{FoldedMessageRepo, LogRepo};
use crate::domain::service::FoldedMessageService;

fn other_session() -> AgentSessionId {
    AgentSessionId::TEST_B
}

/// A log holding two sessions: the full fixture, and a second session cut
/// off mid-turn.
fn two_session_store() -> InMemoryLog {
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
        store
            .list_by_session(test_session())
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

/// `message_ids` lists one key per derived message - a turn contributes both
/// its user and its agent side, keyed apart by author, so each gets its own
/// placeholder. An unlogged session derives none.
#[tokio::test]
async fn message_ids_lists_each_message_once() {
    let service = FoldedMessageService::new(two_session_store());

    let ids = service
        .message_ids(test_session())
        .await
        .expect("in-memory store cannot fail");
    assert_eq!(
        ids,
        vec![
            MessageId {
                turn: TurnId(0),
                author: AuthorKind::User,
            },
            MessageId {
                turn: TurnId(0),
                author: AuthorKind::Agent,
            },
        ],
        "one turn, but both sides are separately addressable"
    );

    let unlogged = service
        .message_ids(AgentSessionId::new_from_uuid(macro_uuid::Uuid::from_u128(
            9,
        )))
        .await
        .expect("in-memory store cannot fail");
    assert_eq!(unlogged, vec![]);
}
