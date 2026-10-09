use super::super::test::{
    CHAT_ID, PROJECT_ID, RecordingEventBroker, StubChatRepo, TEAM_ID, build_service, owner,
};
use super::*;

fn chat_uuid() -> uuid::Uuid {
    uuid::Uuid::parse_str(CHAT_ID).unwrap()
}

fn team() -> Owner {
    Owner::Team(TEAM_ID)
}

#[tokio::test]
async fn purge_owned_deletes_the_chat_and_publishes_without_an_actor() {
    let repo = StubChatRepo::storing(team(), None);
    let broker = RecordingEventBroker::default();
    let service = build_service(repo.clone(), broker.clone());

    let outcome = service.purge_owned(chat_uuid(), &team()).await.unwrap();

    assert_eq!(outcome, OwnedPurgeOutcome::Purged);
    assert_eq!(repo.permanently_deleted(), [CHAT_ID]);
    let events = broker.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].key, CHAT_ID);
    assert_eq!(events[0].envelope["event_type"], "chat.permanently_deleted");
    let metadata = &events[0].envelope["metadata"];
    assert!(metadata["actor_user_id"].is_null());
    assert_eq!(metadata["project_id"], PROJECT_ID);
}

#[tokio::test]
async fn purge_owned_deletes_a_trashed_chat() {
    let repo = StubChatRepo::storing(team(), Some(chrono::DateTime::<chrono::Utc>::UNIX_EPOCH));
    let service = build_service(repo.clone(), RecordingEventBroker::default());

    let outcome = service.purge_owned(chat_uuid(), &team()).await.unwrap();

    assert_eq!(outcome, OwnedPurgeOutcome::Purged);
    assert_eq!(repo.permanently_deleted(), [CHAT_ID]);
}

#[tokio::test]
async fn purge_owned_refuses_a_chat_owned_by_someone_else() {
    let repo = StubChatRepo::storing(Owner::User(owner()), None);
    let broker = RecordingEventBroker::default();
    let service = build_service(repo.clone(), broker.clone());

    let outcome = service.purge_owned(chat_uuid(), &team()).await.unwrap();

    assert_eq!(outcome, OwnedPurgeOutcome::OwnedElsewhere);
    assert!(repo.permanently_deleted().is_empty());
    assert!(broker.events().is_empty());
}

#[tokio::test]
async fn purge_owned_of_a_missing_chat_is_purged() {
    let repo = StubChatRepo::missing();
    let broker = RecordingEventBroker::default();
    let service = build_service(repo.clone(), broker.clone());

    let outcome = service.purge_owned(chat_uuid(), &team()).await.unwrap();

    assert_eq!(outcome, OwnedPurgeOutcome::Purged);
    assert!(repo.permanently_deleted().is_empty());
    assert!(broker.events().is_empty());
}

#[tokio::test]
async fn purge_owned_returns_a_failed_delete_as_an_error() {
    let broker = RecordingEventBroker::default();
    let service = build_service(
        StubChatRepo::failing_permanent_delete(team()),
        broker.clone(),
    );

    assert!(service.purge_owned(chat_uuid(), &team()).await.is_err());
    assert!(broker.events().is_empty());
}
