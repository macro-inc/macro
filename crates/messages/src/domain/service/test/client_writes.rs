use super::*;

const CHANNEL: u128 = 20;
const AUTHOR: &str = "macro|author@example.com";

/// A message minted `days` ago, outside the window a new post's id must fall in.
fn minted_days_ago(days: i64) -> Uuid {
    let minted = Utc::now() - chrono::TimeDelta::days(days);
    Uuid::new_v7(uuid::Timestamp::from_unix(
        uuid::NoContext,
        u64::try_from(minted.timestamp()).unwrap(),
        minted.timestamp_subsec_nanos(),
    ))
}

/// The fixture's root, posted by `AUTHOR` in `CHANNEL` with id `id`.
fn channel_repo(id: Uuid) -> Repo {
    let mut repo = fixture();
    repo.message.parent = MessageParent::Channel(Uuid::from_u128(CHANNEL));
    repo.message.id = id;
    repo.state.root_id = id;
    repo
}

fn member(user: &str, channel: u128) -> EntityAccessReceipt<MessageWrite> {
    EntityAccessReceipt::try_new_authenticated_user(
        user.to_owned().try_into().unwrap(),
        entity_access::domain::models::Entity {
            entity_type: EntityType::Channel,
            entity_id: Uuid::from_u128(channel).to_string(),
        },
        EntityPermission::ChannelRole {
            role: entity_access::domain::models::ParticipantRole::Member,
        },
    )
    .unwrap()
}

fn post_with_id(id: Uuid) -> PostMessage {
    PostMessage {
        id: Some(id),
        ..post_input()
    }
}

#[tokio::test]
async fn a_replayed_post_returns_the_stored_message_without_writing_or_publishing() {
    // Days late, past the window a new post's id must fall in, and edited since.
    let mut repo = channel_repo(minted_days_ago(3));
    repo.message.content = "edited since".into();
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());

    let replayed = service
        .post_once(member(AUTHOR, CHANNEL), post_with_id(repo.message.id))
        .await
        .unwrap();

    assert_eq!(replayed.value.id, repo.message.id);
    assert_eq!(replayed.value.content, "edited since");
    assert_eq!(replayed.seq, None);
    assert!(repo.creates.lock().unwrap().is_empty());
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_post_id_another_sender_thread_or_channel_holds_conflicts() {
    let repo = channel_repo(Uuid::now_v7());
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let mut other_thread = post_with_id(repo.message.id);
    other_thread.thread_id = Some(Uuid::now_v7());

    for (access, input) in [
        (
            member("macro|other@example.com", CHANNEL),
            post_with_id(repo.message.id),
        ),
        (member(AUTHOR, CHANNEL), other_thread),
        (member(AUTHOR, CHANNEL + 1), post_with_id(repo.message.id)),
    ] {
        assert!(matches!(
            service.post_once(access, input).await,
            Err(MessageError::Conflict)
        ));
    }
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_post_that_lost_a_race_to_its_own_replay_returns_the_committed_message() {
    let mut repo = channel_repo(Uuid::now_v7());
    repo.concurrent_create = true;
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());

    let replayed = service
        .post_once(member(AUTHOR, CHANNEL), post_with_id(repo.message.id))
        .await
        .unwrap();

    assert_eq!(replayed.value.id, repo.message.id);
    assert_eq!(replayed.seq, None);
    assert_eq!(repo.creates.lock().unwrap().len(), 1);
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_new_post_writes_once_and_still_checks_its_id() {
    let repo = channel_repo(Uuid::now_v7());
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let id = Uuid::now_v7();

    let posted = service
        .post_once(member(AUTHOR, CHANNEL), post_with_id(id))
        .await
        .unwrap();
    assert_eq!(posted.value.id, id);
    assert_eq!(repo.creates.lock().unwrap().len(), 1);
    assert_eq!(events.0.lock().unwrap().len(), 1);

    assert!(matches!(
        service
            .post_once(member(AUTHOR, CHANNEL), post_with_id(minted_days_ago(3)))
            .await,
        Err(MessageError::Invalid(_))
    ));
    assert_eq!(repo.creates.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_replayed_delete_returns_the_tombstone_without_writing_or_publishing() {
    let mut repo = channel_repo(Uuid::now_v7());
    repo.message.deleted_at = Some(Utc::now());
    repo.message.content.clear();
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());

    let replayed = service
        .delete_once(member(AUTHOR, CHANNEL), repo.message.id, None)
        .await
        .unwrap();

    assert_eq!(replayed.value.id, repo.message.id);
    assert!(replayed.value.deleted_at.is_some());
    assert_eq!(replayed.seq, None);
    assert!(repo.deletes.lock().unwrap().is_empty());
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_replayed_delete_still_needs_the_right_to_delete() {
    let mut repo = channel_repo(Uuid::now_v7());
    repo.message.deleted_at = Some(Utc::now());
    let service = MessageService::new(repo.clone(), Events::default());

    assert!(matches!(
        service
            .delete_once(
                member("macro|other@example.com", CHANNEL),
                repo.message.id,
                None
            )
            .await,
        Err(MessageError::Forbidden)
    ));
    assert!(matches!(
        service
            .delete_once(member(AUTHOR, CHANNEL), Uuid::now_v7(), None)
            .await,
        Err(MessageError::NotFound)
    ));
}

#[tokio::test]
async fn replay_safe_writes_are_for_channels_only() {
    let repo = fixture();
    let service = MessageService::new(repo.clone(), Events::default());
    let document = || access(AUTHOR, "doc", AccessLevel::Comment);

    assert!(matches!(
        service
            .post_once(document(), post_with_id(Uuid::now_v7()))
            .await,
        Err(MessageError::Invalid(_))
    ));
    assert!(matches!(
        service.delete_once(document(), repo.message.id, None).await,
        Err(MessageError::Invalid(_))
    ));
    assert!(repo.creates.lock().unwrap().is_empty());
    assert!(repo.deletes.lock().unwrap().is_empty());
}
