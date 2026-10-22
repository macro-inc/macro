use super::*;
use crate::domain::{
    access_requests::{ChannelAccessRequestErr, ChannelAccessRequestService},
    events::ChannelEvent,
    ports::{ChannelEventDispatcher, ChannelRepo},
    service::{ChannelServiceImpl, NoopChannelReferenceSharePermissions},
};
use entity_access::domain::models::{
    Entity, EntityAccessReceipt, EntityPermission, EntityType, MemberParticipantRole,
    ParticipantRole as AccessRole,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::sync::{Arc, Mutex};

const PRIVATE: Uuid = Uuid::from_u128(0x10);
const PUBLIC: Uuid = Uuid::from_u128(0x11);
const DIRECT_MESSAGE: Uuid = Uuid::from_u128(0x12);

#[derive(Clone, Default)]
struct RecordedEvents(Arc<Mutex<Vec<ChannelEvent>>>);

impl RecordedEvents {
    fn take(&self) -> Vec<ChannelEvent> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }
}

impl ChannelEventDispatcher for RecordedEvents {
    fn dispatch(&self, event: ChannelEvent) {
        self.0.lock().unwrap().push(event);
    }
}

type Service = ChannelServiceImpl<PgChannelsRepo, RecordedEvents>;

fn service(pool: &PgPool) -> (Service, RecordedEvents) {
    let events = RecordedEvents::default();
    let service = ChannelServiceImpl::with_dependencies(
        PgChannelsRepo::new(pool.clone()),
        events.clone(),
        NoopChannelReferenceSharePermissions,
    );
    (service, events)
}

fn user(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{name}@join.test")).unwrap()
}

fn participant(name: &str, channel_id: Uuid) -> EntityAccessReceipt<MemberParticipantRole> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(name),
        Entity {
            entity_id: channel_id.to_string(),
            entity_type: EntityType::Channel,
        },
        EntityPermission::ChannelRole {
            role: AccessRole::Member,
        },
    )
    .unwrap()
}

async fn is_participant(pool: &PgPool, channel_id: Uuid, name: &str) -> bool {
    PgChannelsRepo::new(pool.clone())
        .get_participants(channel_id)
        .await
        .unwrap()
        .iter()
        .any(|p| p.user_id == user(name).as_ref())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("channel_access_requests"))
)]
async fn a_request_is_announced_once_and_approval_adds_the_requester(pool: PgPool) {
    let (service, events) = service(&pool);

    let request = service
        .request_access(user("outsider"), PRIVATE)
        .await
        .unwrap();
    assert_eq!(request.status, ChannelAccessRequestStatus::Pending);
    let replay = service
        .request_access(user("outsider"), PRIVATE)
        .await
        .unwrap();
    assert_eq!(replay.id, request.id);
    let announced = events.take();
    assert_eq!(announced.len(), 1, "a replay is not announced again");
    let ChannelEvent::AccessRequested {
        participant_user_ids,
        ..
    } = &announced[0]
    else {
        panic!("expected an announcement, got {announced:?}");
    };
    assert_eq!(participant_user_ids.len(), 2);

    assert!(matches!(
        service
            .resolve_access_request(
                participant("outsider", PRIVATE),
                request.id,
                ChannelAccessDecision::Approve
            )
            .await,
        Err(ChannelAccessRequestErr::Forbidden)
    ));
    let approved = service
        .resolve_access_request(
            participant("member", PRIVATE),
            request.id,
            ChannelAccessDecision::Approve,
        )
        .await
        .unwrap();
    assert_eq!(approved.status, ChannelAccessRequestStatus::Approved);
    assert_eq!(approved.resolved_by, Some(user("member")));
    assert!(is_participant(&pool, PRIVATE, "outsider").await);
    let resolved = events.take();
    assert!(matches!(
        resolved.as_slice(),
        [
            ChannelEvent::AccessRequestResolved { .. },
            ChannelEvent::ParticipantsAdded { recipient_user_ids, .. },
        ] if recipient_user_ids == &vec![user("outsider")]
    ));

    assert!(matches!(
        service
            .resolve_access_request(
                participant("owner", PRIVATE),
                request.id,
                ChannelAccessDecision::Deny
            )
            .await,
        Err(ChannelAccessRequestErr::Conflict)
    ));
    assert!(matches!(
        service.request_access(user("outsider"), PRIVATE).await,
        Err(ChannelAccessRequestErr::NotRequestable(_))
    ));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("channel_access_requests"))
)]
async fn approving_someone_who_already_joined_adds_no_member(pool: PgPool) {
    let (service, events) = service(&pool);
    let request = service
        .request_access(user("outsider"), PRIVATE)
        .await
        .unwrap();
    PgChannelsRepo::new(pool.clone())
        .add_participant(
            PRIVATE,
            user("outsider"),
            crate::domain::models::ParticipantRole::Member,
        )
        .await
        .unwrap();
    events.take();

    service
        .resolve_access_request(
            participant("member", PRIVATE),
            request.id,
            ChannelAccessDecision::Approve,
        )
        .await
        .unwrap();
    assert!(matches!(
        events.take().as_slice(),
        [ChannelEvent::AccessRequestResolved { .. }]
    ));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("channel_access_requests"))
)]
async fn denial_and_withdrawal_make_the_requester_wait(pool: PgPool) {
    let (service, events) = service(&pool);

    let denied = service
        .request_access(user("outsider"), PRIVATE)
        .await
        .unwrap();
    let denied = service
        .resolve_access_request(
            participant("member", PRIVATE),
            denied.id,
            ChannelAccessDecision::Deny,
        )
        .await
        .unwrap();
    assert_eq!(denied.status, ChannelAccessRequestStatus::Denied);
    assert!(!is_participant(&pool, PRIVATE, "outsider").await);
    let until = denied.resolved_at.unwrap() + crate::domain::access_requests::DENIAL_COOLDOWN;
    assert!(matches!(
        service.request_access(user("outsider"), PRIVATE).await,
        Err(ChannelAccessRequestErr::Cooldown(at)) if at == until
    ));
    let state = service
        .my_access_request(user("outsider"), PRIVATE)
        .await
        .unwrap();
    assert_eq!(state.retry_after, Some(until));
    assert!(state.can_request);

    let withdrawn = service
        .request_access(user("latecomer"), PRIVATE)
        .await
        .unwrap();
    service
        .cancel_access_request(user("latecomer"), PRIVATE)
        .await
        .unwrap();
    service
        .cancel_access_request(user("latecomer"), PRIVATE)
        .await
        .unwrap();
    assert!(matches!(
        service.request_access(user("latecomer"), PRIVATE).await,
        Err(ChannelAccessRequestErr::Cooldown(_))
    ));
    sqlx::query!(
        "UPDATE comms_channel_access_request SET created_at = created_at - interval '2 minutes' WHERE id = $1",
        withdrawn.id,
    )
    .execute(&pool)
    .await
    .unwrap();
    events.take();
    let again = service
        .request_access(user("latecomer"), PRIVATE)
        .await
        .unwrap();
    assert_ne!(
        again.id, withdrawn.id,
        "each attempt is announced separately"
    );
    assert!(matches!(
        events.take().as_slice(),
        [ChannelEvent::AccessRequested { request, .. }] if request.id == again.id
    ));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("channel_access_requests"))
)]
async fn only_private_and_team_channels_accept_requests(pool: PgPool) {
    let (service, _) = service(&pool);
    for channel_id in [PUBLIC, DIRECT_MESSAGE] {
        assert!(matches!(
            service.request_access(user("outsider"), channel_id).await,
            Err(ChannelAccessRequestErr::NotRequestable(_))
        ));
        assert!(
            !service
                .my_access_request(user("outsider"), channel_id)
                .await
                .unwrap()
                .can_request
        );
    }
    assert!(matches!(
        service
            .request_access(user("outsider"), Uuid::from_u128(0x99))
            .await,
        Err(ChannelAccessRequestErr::ChannelNotFound)
    ));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("channel_access_requests"))
)]
async fn concurrent_requests_share_one_pending_attempt(pool: PgPool) {
    let (service, events) = service(&pool);
    let mut attempts = tokio::task::JoinSet::new();
    for _ in 0..10 {
        let service = service.clone();
        attempts.spawn(async move { service.request_access(user("outsider"), PRIVATE).await });
    }
    let ids: std::collections::HashSet<_> = attempts
        .join_all()
        .await
        .into_iter()
        .map(|r| r.unwrap().id)
        .collect();
    assert_eq!(ids.len(), 1);
    assert_eq!(events.take().len(), 1);
}
