use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::Utc;

use uuid::Uuid;

use super::*;
use crate::domain::events::ActivityTopicEvent;
use crate::domain::models::{Actor, CommonAction};

#[derive(Clone, Default)]
struct RecordingPublisher {
    published: Arc<Mutex<Vec<(String, ActivityTopicEvent)>>>,
}
impl RecordingPublisher {
    fn recorded_events(&self) -> Vec<(String, ActivityTopicEvent)> {
        self.published.lock().unwrap().clone()
    }
}
impl ActivityEventPublisher for RecordingPublisher {
    type Err = std::io::Error;
    async fn publish(&self, event: ActivityTopicEvent) -> Result<(), Self::Err> {
        self.published
            .lock()
            .unwrap()
            .push((event.key().to_owned(), event));
        Ok(())
    }
}

struct FakeAudience {
    by_entity: HashMap<String, Vec<MacroUserIdStr<'static>>>,
}

impl ActivityAudienceExpander for FakeAudience {
    type Err = std::convert::Infallible;

    async fn entity_audience(
        &self,
        _entity_type: EntityType,
        entity_id: &str,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Self::Err> {
        Ok(self.by_entity.get(entity_id).cloned().unwrap_or_default())
    }
}

struct FailingAudience;

impl ActivityAudienceExpander for FailingAudience {
    type Err = std::io::Error;

    async fn entity_audience(
        &self,
        _entity_type: EntityType,
        _entity_id: &str,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Self::Err> {
        Err(std::io::Error::other("access lookup unavailable"))
    }
}

fn user(local: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{local}@example.com")).expect("valid user id")
}

#[tokio::test]
async fn moving_task_does_not_announce_hidden_source_project_to_the_actor() {
    struct Removed;
    impl crate::DomainActivity for Removed {
        const ENTITY_TYPE: EntityType = EntityType::Initiative;
        fn entity_id(&self) -> &str {
            "hidden-source"
        }
        fn into_action(self) -> crate::Action {
            crate::Action::TaskRemoved(crate::InitiativeTaskChange {
                task_id: "task".into(),
            })
        }
    }
    let actor = user("task-editor");
    let source_owner = user("source-owner");
    let broker = RecordingPublisher::default();
    let announcements = ActivityAnnouncements::new(
        broker.clone(),
        FakeAudience {
            by_entity: HashMap::from([
                ("hidden-source".into(), vec![source_owner.clone()]),
                ("task".into(), vec![source_owner.clone(), actor.clone()]),
            ]),
        },
    );
    announcements
        .publish_recorded(&[Activity::from_domain(
            Uuid::now_v7(),
            0,
            Actor::new_from_user(actor.clone()),
            None,
            Removed,
            Utc::now(),
        )])
        .await;
    let deliveries = broker.recorded_events();
    assert_eq!(deliveries.len(), 1);
    assert_eq!(deliveries[0].0, source_owner.as_ref());
    assert!(
        deliveries
            .iter()
            .all(|(recipient, _)| recipient != actor.as_ref())
    );
}

#[tokio::test]
async fn project_subject_with_public_link_access_still_receives_activity() {
    struct PublicProject;
    impl ActivityAudienceExpander for PublicProject {
        type Err = std::convert::Infallible;
        async fn entity_audience(
            &self,
            _: EntityType,
            _: &str,
        ) -> Result<Vec<MacroUserIdStr<'static>>, Self::Err> {
            Ok(Vec::new())
        }
        async fn viewer_can_see(
            &self,
            _: EntityType,
            _: &str,
            _: &MacroUserIdStr<'_>,
        ) -> Result<bool, Self::Err> {
            Ok(true)
        }
    }
    let actor = user("editor");
    let broker = RecordingPublisher::default();
    let announcements = ActivityAnnouncements::new(broker.clone(), PublicProject);
    let row = Activity::common(
        Uuid::now_v7(),
        0,
        Actor::new_from_user(actor.clone()),
        None,
        EntityType::Initiative,
        "public-project",
        CommonAction::Edited,
        Utc::now(),
    );
    announcements.publish_recorded(&[row]).await;
    assert_eq!(broker.recorded_events()[0].0, actor.as_ref());
}

#[tokio::test]
async fn project_membership_realtime_requires_task_access_as_well_as_project_access() {
    struct Membership;
    impl crate::DomainActivity for Membership {
        const ENTITY_TYPE: EntityType = EntityType::Initiative;
        fn entity_id(&self) -> &str {
            "initiative-1"
        }
        fn into_action(self) -> crate::Action {
            crate::Action::TaskAdded(crate::InitiativeTaskChange {
                task_id: "private-task".into(),
            })
        }
    }
    let owner = user("owner");
    let watcher = user("watcher");
    let broker = RecordingPublisher::default();
    let announcements = ActivityAnnouncements::new(
        broker.clone(),
        FakeAudience {
            by_entity: HashMap::from([
                ("initiative-1".into(), vec![owner.clone(), watcher]),
                ("private-task".into(), vec![owner.clone()]),
            ]),
        },
    );
    let row = Activity::from_domain(
        Uuid::from_u128(3),
        0,
        Actor::new_from_user(owner.clone()),
        None,
        Membership,
        Utc::now(),
    );
    announcements.publish_recorded(&[row]).await;
    let deliveries = broker.recorded_events();
    assert_eq!(deliveries.len(), 1);
    assert_eq!(deliveries[0].0, owner.as_ref());
}

fn edited(ordinal: u32, actor: Actor<'static>, entity_id: &str) -> Activity {
    Activity::common(
        Uuid::from_u128(7),
        ordinal,
        actor,
        None,
        EntityType::Document,
        entity_id,
        CommonAction::Edited,
        Utc::now(),
    )
}

fn rows_for<'a>(
    events: &'a [(String, ActivityTopicEvent)],
    recipient: &str,
) -> &'a [ActivityWireRow] {
    events
        .iter()
        .find_map(|(key, event)| {
            let ActivityTopicEvent::Recorded {
                recipient_id,
                activities,
            } = event
            else {
                return None;
            };
            assert_eq!(recipient_id, key, "events are keyed by their recipient");
            (recipient_id == recipient).then_some(activities.as_slice())
        })
        .unwrap_or_else(|| panic!("no event addressed to {recipient}"))
}

#[tokio::test]
async fn delivers_to_the_subject_and_the_entity_audience() {
    let teo = user("teo");
    let watcher = user("watcher");
    let broker = RecordingPublisher::default();
    let publisher = ActivityAnnouncements::new(
        broker.clone(),
        FakeAudience {
            by_entity: HashMap::from([("doc-1".to_string(), vec![teo.clone(), watcher.clone()])]),
        },
    );

    let activities = [
        edited(0, Actor::new_from_user(teo.clone()), "doc-1"),
        edited(1, Actor::new_from_user(teo.clone()), "doc-2"),
    ];
    publisher.publish_recorded(&activities).await;

    let events = broker.recorded_events();
    assert_eq!(events.len(), 2, "one event per distinct recipient");
    // The subject receives both rows (doc-2 has no audience beyond them);
    // the watcher receives only the row for the entity they can access.
    assert_eq!(rows_for(&events, teo.as_ref()).len(), 2);
    let watcher_rows = rows_for(&events, watcher.as_ref());
    assert_eq!(watcher_rows.len(), 1);
    assert_eq!(watcher_rows[0].entity_id, "doc-1");
}

#[tokio::test]
async fn bot_subject_rows_reach_the_entity_audience_only() {
    let watcher = user("watcher");
    let bot = Actor::new_from_bot(bot_id::BotId::new_from_uuid(Uuid::from_u128(42)));
    let broker = RecordingPublisher::default();
    let publisher = ActivityAnnouncements::new(
        broker.clone(),
        FakeAudience {
            by_entity: HashMap::from([("doc-1".to_string(), vec![watcher.clone()])]),
        },
    );

    publisher.publish_recorded(&[edited(0, bot, "doc-1")]).await;

    let events = broker.recorded_events();
    assert_eq!(
        events.len(),
        1,
        "a bot subject is not an addressable recipient"
    );
    assert_eq!(rows_for(&events, watcher.as_ref()).len(), 1);
}

#[tokio::test]
async fn expansion_failure_degrades_to_subject_only_delivery() {
    let teo = user("teo");
    let broker = RecordingPublisher::default();
    let publisher = ActivityAnnouncements::new(broker.clone(), FailingAudience);

    publisher
        .publish_recorded(&[edited(0, Actor::new_from_user(teo.clone()), "doc-1")])
        .await;

    let events = broker.recorded_events();
    assert_eq!(events.len(), 1);
    assert_eq!(rows_for(&events, teo.as_ref()).len(), 1);
}

struct StalledPublisher {
    started: std::sync::atomic::AtomicUsize,
}

impl ActivityEventPublisher for StalledPublisher {
    type Err = std::io::Error;
    async fn publish(&self, _event: ActivityTopicEvent) -> Result<(), Self::Err> {
        self.started
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        std::future::pending().await
    }
}

#[tokio::test(start_paused = true)]
async fn bounds_total_delivery_latency_and_concurrency_for_a_large_audience() {
    let publisher = ActivityAnnouncements::new(
        StalledPublisher { started: 0.into() },
        FakeAudience {
            by_entity: HashMap::from([(
                "doc-1".into(),
                (0..1000).map(|i| user(&format!("watcher-{i}"))).collect(),
            )]),
        },
    );
    let before = tokio::time::Instant::now();
    publisher
        .publish_recorded(&[edited(0, Actor::new_from_user(user("subject")), "doc-1")])
        .await;
    assert_eq!(before.elapsed(), ANNOUNCEMENT_BUDGET);
    assert_eq!(
        publisher
            .publisher
            .started
            .load(std::sync::atomic::Ordering::SeqCst),
        MAX_CONCURRENT_DELIVERIES
    );
}

#[tokio::test]
async fn purge_invalidation_needs_no_deleted_entity_audience() {
    let publisher = RecordingPublisher::default();
    let announcements = ActivityAnnouncements::new(publisher.clone(), FailingAudience);
    announcements.publish_invalidated().await;
    assert_eq!(
        publisher.recorded_events(),
        vec![(
            "activity-invalidated".into(),
            ActivityTopicEvent::Invalidated
        )]
    );
}
