use std::{
    collections::HashSet,
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use entity_access::domain::models::AccessError;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};

use super::{Admission, EntityGrants, EntityViewAccess, viewable};
use crate::model::tracking::TrackAction;

const VIEWER: &str = "macro|viewer@example.com";
const OTHER_USER: &str = "macro|other@example.com";
const SHARED_DOCUMENT: &str = "0198f7a2-0000-7000-8000-000000000001";
const PRIVATE_CHANNEL: &str = "0198f7a2-0000-7000-8000-000000000002";
const BROKEN_CHAT: &str = "0198f7a2-0000-7000-8000-000000000003";

/// Grants view access to a fixed set of entities and fails for `BROKEN_CHAT`.
#[derive(Default)]
struct FakeAccess {
    viewable: Mutex<HashSet<(EntityType, String)>>,
    lookups: AtomicUsize,
}

impl FakeAccess {
    fn with(entities: &[(EntityType, &str)]) -> Self {
        let access = Self::default();
        for (entity_type, entity_id) in entities {
            access.grant(*entity_type, entity_id);
        }
        access
    }

    fn grant(&self, entity_type: EntityType, entity_id: &str) {
        self.viewable
            .lock()
            .unwrap()
            .insert((entity_type, entity_id.to_string()));
    }

    fn revoke(&self, entity_type: EntityType, entity_id: &str) {
        self.viewable
            .lock()
            .unwrap()
            .remove(&(entity_type, entity_id.to_string()));
    }

    fn lookups(&self) -> usize {
        self.lookups.load(Ordering::SeqCst)
    }
}

impl EntityViewAccess for FakeAccess {
    async fn can_view(
        &self,
        user_id: &MacroUserIdStr<'_>,
        _organization_id: Option<i64>,
        entity: &Entity<'_>,
    ) -> Result<bool, AccessError> {
        self.lookups.fetch_add(1, Ordering::SeqCst);
        assert_eq!(user_id.0.as_ref(), VIEWER);
        if entity.entity_id == BROKEN_CHAT {
            return Err(AccessError::internal("database unavailable"));
        }
        Ok(self
            .viewable
            .lock()
            .unwrap()
            .contains(&(entity.entity_type, entity.entity_id.to_string())))
    }
}

fn grants() -> EntityGrants {
    EntityGrants::new(MacroUserIdStr::parse_from_str(VIEWER).unwrap(), None)
}

fn entity(entity_type: EntityType, entity_id: &str) -> Entity<'_> {
    entity_type.with_entity_str(entity_id)
}

#[tokio::test]
async fn only_the_connected_user_may_track_their_user_entity() {
    let access = FakeAccess::default();
    let mut grants = grants();

    assert_eq!(
        grants
            .admit(
                &access,
                &entity(EntityType::User, OTHER_USER),
                TrackAction::Open
            )
            .await
            .unwrap(),
        Admission::Refused
    );
    assert_eq!(
        grants
            .admit(
                &access,
                &entity(EntityType::User, OTHER_USER),
                TrackAction::Ping
            )
            .await
            .unwrap(),
        Admission::Refused
    );
    assert!(
        !grants
            .permits(&access, &entity(EntityType::User, OTHER_USER))
            .await
            .unwrap()
    );
    assert_eq!(
        grants
            .admit(
                &access,
                &entity(EntityType::User, "macro|Viewer@Example.com"),
                TrackAction::Open
            )
            .await
            .unwrap(),
        Admission::Admitted
    );
    assert_eq!(
        grants
            .admit(
                &access,
                &entity(EntityType::User, "not a user id"),
                TrackAction::Open
            )
            .await
            .unwrap(),
        Admission::Refused
    );
    assert_eq!(
        access.lookups(),
        0,
        "user entities never reach entity access"
    );
}

#[tokio::test]
async fn open_is_admitted_only_for_viewable_entities() {
    let access = FakeAccess::with(&[(EntityType::Document, SHARED_DOCUMENT)]);
    let mut grants = grants();

    assert_eq!(
        grants
            .admit(
                &access,
                &entity(EntityType::Document, SHARED_DOCUMENT),
                TrackAction::Open
            )
            .await
            .unwrap(),
        Admission::Admitted
    );
    assert_eq!(
        grants
            .admit(
                &access,
                &entity(EntityType::Channel, PRIVATE_CHANNEL),
                TrackAction::Open
            )
            .await
            .unwrap(),
        Admission::Refused
    );
    // The id alone is not enough: the type is part of what was checked.
    assert_eq!(
        grants
            .admit(
                &access,
                &entity(EntityType::Chat, SHARED_DOCUMENT),
                TrackAction::Open
            )
            .await
            .unwrap(),
        Admission::Refused
    );
}

#[tokio::test]
async fn ping_without_a_grant_is_checked_like_an_open() {
    let access = FakeAccess::with(&[(EntityType::Document, SHARED_DOCUMENT)]);
    let mut grants = grants();

    assert_eq!(
        grants
            .admit(
                &access,
                &entity(EntityType::Channel, PRIVATE_CHANNEL),
                TrackAction::Ping
            )
            .await
            .unwrap(),
        Admission::Refused
    );
    assert_eq!(
        grants
            .admit(
                &access,
                &entity(EntityType::Document, SHARED_DOCUMENT),
                TrackAction::Ping
            )
            .await
            .unwrap(),
        Admission::Admitted
    );
    assert_eq!(access.lookups(), 2);

    // Granted now, so later pings skip the lookup.
    for _ in 0..3 {
        assert_eq!(
            grants
                .admit(
                    &access,
                    &entity(EntityType::Document, SHARED_DOCUMENT),
                    TrackAction::Ping
                )
                .await
                .unwrap(),
            Admission::Admitted
        );
    }
    assert_eq!(access.lookups(), 2);
}

#[tokio::test]
async fn close_needs_a_grant_and_ends_it() {
    let access = FakeAccess::with(&[(EntityType::Document, SHARED_DOCUMENT)]);
    let mut grants = grants();
    let document = entity(EntityType::Document, SHARED_DOCUMENT);

    assert_eq!(
        grants
            .admit(
                &access,
                &entity(EntityType::Channel, PRIVATE_CHANNEL),
                TrackAction::Close
            )
            .await
            .unwrap(),
        Admission::Refused
    );
    assert_eq!(
        grants
            .admit(&access, &document, TrackAction::Close)
            .await
            .unwrap(),
        Admission::Refused,
        "never opened on this connection"
    );

    grants
        .admit(&access, &document, TrackAction::Open)
        .await
        .unwrap();
    assert_eq!(
        grants
            .admit(&access, &document, TrackAction::Close)
            .await
            .unwrap(),
        Admission::Admitted
    );

    let lookups = access.lookups();
    grants
        .admit(&access, &document, TrackAction::Ping)
        .await
        .unwrap();
    assert_eq!(access.lookups(), lookups + 1, "the close dropped the grant");
}

#[tokio::test]
async fn reopening_an_entity_whose_access_was_removed_revokes_it() {
    let access = FakeAccess::with(&[(EntityType::Document, SHARED_DOCUMENT)]);
    let mut grants = grants();
    let document = entity(EntityType::Document, SHARED_DOCUMENT);

    grants
        .admit(&access, &document, TrackAction::Open)
        .await
        .unwrap();
    access.revoke(EntityType::Document, SHARED_DOCUMENT);

    assert_eq!(
        grants
            .admit(&access, &document, TrackAction::Open)
            .await
            .unwrap(),
        Admission::Revoked
    );
    assert_eq!(
        grants
            .admit(&access, &document, TrackAction::Close)
            .await
            .unwrap(),
        Admission::Refused
    );
}

#[tokio::test]
async fn a_failed_check_is_an_error_and_grants_nothing() {
    let access = FakeAccess::default();
    let mut grants = grants();
    let chat = entity(EntityType::Chat, BROKEN_CHAT);

    assert!(
        grants
            .admit(&access, &chat, TrackAction::Open)
            .await
            .is_err()
    );
    assert!(grants.permits(&access, &chat).await.is_err());
    assert_eq!(
        grants
            .admit(&access, &chat, TrackAction::Close)
            .await
            .unwrap(),
        Admission::Refused
    );
}

#[tokio::test]
async fn revalidation_revokes_lost_access_and_keeps_the_rest() {
    let access = FakeAccess::with(&[
        (EntityType::Document, SHARED_DOCUMENT),
        (EntityType::Channel, PRIVATE_CHANNEL),
        (EntityType::Chat, BROKEN_CHAT),
    ]);
    let mut grants = grants();
    for granted in [
        entity(EntityType::Document, SHARED_DOCUMENT),
        entity(EntityType::Channel, PRIVATE_CHANNEL),
    ] {
        grants
            .admit(&access, &granted, TrackAction::Open)
            .await
            .unwrap();
    }
    // A grant whose recheck will fail.
    grants
        .granted
        .insert((EntityType::Chat, BROKEN_CHAT.to_string()));

    access.revoke(EntityType::Channel, PRIVATE_CHANNEL);
    let revoked = grants.revalidate(&access).await;

    assert_eq!(revoked.len(), 1);
    assert_eq!(revoked[0].entity_type, EntityType::Channel);
    assert_eq!(revoked[0].entity_id, PRIVATE_CHANNEL);
    assert_eq!(
        grants.granted,
        HashSet::from([
            (EntityType::Document, SHARED_DOCUMENT.to_string()),
            (EntityType::Chat, BROKEN_CHAT.to_string()),
        ])
    );

    access.grant(EntityType::Channel, PRIVATE_CHANNEL);
    assert!(grants.revalidate(&access).await.is_empty());
}

#[test]
fn access_errors_that_mean_no_access_read_as_not_viewable() {
    assert!(viewable(Ok::<_, AccessError>(())).unwrap());
    for denied in [
        AccessError::Unauthorized,
        AccessError::UnauthorizedWithMessage("no"),
        AccessError::NotFound("document"),
        AccessError::BadRequest("Unsupported entity type"),
    ] {
        assert!(!viewable(Err::<(), _>(denied)).unwrap());
    }
    assert!(viewable(Err::<(), _>(AccessError::internal("boom"))).is_err());
}

#[tokio::test]
async fn revalidation_stops_stream_listeners_whose_access_was_lost() {
    let access = FakeAccess::with(&[
        (EntityType::Document, SHARED_DOCUMENT),
        (EntityType::Channel, PRIVATE_CHANNEL),
    ]);
    let mut grants = grants();
    let kept = tokio::spawn(std::future::pending::<()>());
    let lost = tokio::spawn(std::future::pending::<()>());
    grants.hold_stream_listener(
        &entity(EntityType::Document, SHARED_DOCUMENT),
        kept.abort_handle(),
    );
    grants.hold_stream_listener(
        &entity(EntityType::Channel, PRIVATE_CHANNEL),
        lost.abort_handle(),
    );

    access.revoke(EntityType::Channel, PRIVATE_CHANNEL);
    let revoked = grants.revalidate(&access).await;

    assert!(revoked.is_empty(), "stream events are not tracked rows");
    assert!(lost.await.unwrap_err().is_cancelled());
    assert!(!kept.is_finished());

    drop(grants);
    assert!(
        kept.await.unwrap_err().is_cancelled(),
        "a closed connection stops its listeners"
    );
}

#[tokio::test]
async fn a_repeated_stream_events_frame_replaces_the_listener() {
    let mut grants = grants();
    let document = entity(EntityType::Document, SHARED_DOCUMENT);
    let first = tokio::spawn(std::future::pending::<()>());
    let second = tokio::spawn(std::future::pending::<()>());

    grants.hold_stream_listener(&document, first.abort_handle());
    grants.hold_stream_listener(&document, second.abort_handle());

    assert!(first.await.unwrap_err().is_cancelled());
    assert!(!second.is_finished());
}
