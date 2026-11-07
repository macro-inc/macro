use super::*;
use crate::{Action, Actor, DayCount, EntityRank, RecordedAction};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

const VIEWER: &str = "macro|viewer@example.com";

fn records() -> Vec<ActivityRecord> {
    [
        EntityType::CrmCompany,
        EntityType::CrmContact,
        EntityType::CrmPipeline,
        EntityType::Document,
        EntityType::Initiative,
    ]
    .into_iter()
    .enumerate()
    .map(|(index, kind)| ActivityRecord {
        id: Uuid::from_u128(index as u128 + 1),
        actor: Actor::new_from_user(MacroUserIdStr::parse_from_str(VIEWER).unwrap()),
        subject_id: VIEWER.to_owned(),
        entity_type: kind,
        entity_id: format!("record-{index}"),
        action: RecordedAction::Known(Action::Edited),
        occurred_at: Utc::now(),
        agent_correlation_id: None,
        agent_verb: None,
    })
    .collect()
}

struct Reads;
impl ActivityReads for Reads {
    type Err = std::io::Error;
    async fn subject_feed(
        &self,
        _: &str,
        cursor: Option<(DateTime<Utc>, Uuid)>,
        _: NonZeroU32,
    ) -> Result<ActivityFeedPage, Self::Err> {
        Ok(ActivityFeedPage {
            records: records(),
            next: cursor,
        })
    }
    async fn teammate_feed(
        &self,
        viewer: &str,
        cursor: Option<(DateTime<Utc>, Uuid)>,
        limit: NonZeroU32,
    ) -> Result<ActivityFeedPage, Self::Err> {
        self.subject_feed(viewer, cursor, limit).await
    }
    async fn subject_activity_range(
        &self,
        _: &str,
        _: DateTime<Utc>,
        _: DateTime<Utc>,
        _: NonZeroU32,
    ) -> Result<ActivityRange, Self::Err> {
        Ok(ActivityRange {
            records: records(),
            truncated: true,
        })
    }
    async fn subject_overview(
        &self,
        _: &str,
        window: ActivityWindow,
    ) -> Result<ActivityOverview, Self::Err> {
        let day = window.start;
        Ok(ActivityOverview::new(
            window,
            vec![DayCount {
                day,
                count: 5.try_into().unwrap(),
            }],
            records()
                .into_iter()
                .map(|row| EntityRank {
                    entity_type: row.entity_type,
                    entity_id: row.entity_id,
                    count: 1.try_into().unwrap(),
                })
                .collect(),
        )
        .unwrap())
    }
    async fn entity_activity(
        &self,
        _: &[(EntityType, String)],
        _: u32,
    ) -> Result<EntityActivityMap, Self::Err> {
        Ok(EntityActivityMap::new())
    }
}

#[derive(Clone, Default)]
struct Access {
    allowed: Arc<AtomicBool>,
    checked: Arc<Mutex<Vec<EntityType>>>,
    fail: Arc<AtomicBool>,
}
impl ActivityAudienceExpander for Access {
    type Err = std::io::Error;
    async fn entity_audience(
        &self,
        _: EntityType,
        _: &str,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Self::Err> {
        unreachable!("page reads use the batch port")
    }
    async fn visible_entities(
        &self,
        _: &MacroUserIdStr<'_>,
        keys: &[(EntityType, String)],
    ) -> Result<HashSet<(EntityType, String)>, Self::Err> {
        self.checked
            .lock()
            .unwrap()
            .extend(keys.iter().map(|(kind, _)| *kind));
        if self.fail.load(Ordering::Relaxed) {
            return Err(std::io::Error::other("access unavailable"));
        }
        Ok(keys
            .iter()
            .filter(|(kind, _)| {
                *kind == EntityType::Initiative || self.allowed.load(Ordering::Relaxed)
            })
            .cloned()
            .collect())
    }
}

#[tokio::test]
async fn member_revocation_and_regrant_filter_every_personal_activity_surface() {
    let access = Access::default();
    let reads = VisibleActivityReads::new(Reads, access.clone());
    let cursor = Some((Utc::now(), Uuid::now_v7()));
    let limit = NonZeroU32::new(100).unwrap();
    let day = chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
    for allowed in [true, false, true] {
        access.allowed.store(allowed, Ordering::Relaxed);
        let expected = if allowed { 5 } else { 2 };
        let personal = reads.subject_feed(VIEWER, cursor, limit).await.unwrap();
        assert_eq!(personal.records.len(), expected);
        assert_eq!(personal.next, cursor);
        access.checked.lock().unwrap().clear();
        let teammates = reads.teammate_feed(VIEWER, cursor, limit).await.unwrap();
        assert_eq!(teammates.records.len(), expected);
        assert_eq!(teammates.next, cursor);
        assert!(
            !access
                .checked
                .lock()
                .unwrap()
                .contains(&EntityType::Initiative)
        );
        let range = reads
            .subject_activity_range(VIEWER, Utc::now(), Utc::now(), limit)
            .await
            .unwrap();
        assert_eq!(range.records.len(), expected);
        assert!(range.truncated);
        let window = ActivityWindow::new(chrono_tz::UTC, day, day.succ_opt().unwrap()).unwrap();
        let overview = reads.subject_overview(VIEWER, window).await.unwrap();
        assert_eq!(overview.top_entities.len(), expected);
        assert_eq!(overview.total(), 5);
    }
    access.fail.store(true, Ordering::Relaxed);
    assert!(reads.subject_feed(VIEWER, cursor, limit).await.is_err());
}
