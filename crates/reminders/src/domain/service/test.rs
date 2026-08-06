use std::sync::{Arc, Mutex};

use chrono::{Duration, TimeZone};
use chrono_tz::America::New_York;
use entity_access::domain::models::{
    AccessLevel, AnyEntityPermission, Entity as AccessEntity, EntityAccessReceipt,
    EntityPermission, ParticipantRole,
};
use model_entity::EntityType;

use super::*;
use crate::domain::models::{MAX_PAGE_SIZE, ReminderCron, RemindersList};

const USER_A: &str = "macro|reminders-a@macro.com";
const USER_B: &str = "macro|reminders-b@macro.com";
const DAILY_9AM: &str = "0 0 9 * * *";

fn user(id: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

/// Fixed "current time" for every service test, so schedule boundaries are
/// deterministic rather than relative to the wall clock.
fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 7, 1, 12, 0, 0)
        .single()
        .expect("unambiguous instant")
}

fn future() -> DateTime<Utc> {
    now() + Duration::days(1)
}

fn once(remind_at: DateTime<Utc>) -> ReminderSchedule {
    ReminderSchedule::Once { remind_at }
}

fn recurring() -> ReminderSchedule {
    ReminderSchedule::Recurring {
        cron: ReminderCron::parse(DAILY_9AM).expect("valid cron"),
        timezone: New_York,
    }
}

/// A clock frozen at [`now`].
#[derive(Debug, Clone, Copy)]
struct FixedClock(DateTime<Utc>);

impl Clock for FixedClock {
    fn now(&self) -> DateTime<Utc> {
        self.0
    }
}

/// A receipt as the router would mint it: for this user, this entity, carrying
/// an `AccessLevel` permission — the shape documents, chats, projects, email
/// threads, calls and CRM records resolve to.
fn view_receipt(
    user_id: &'static str,
    entity_type: EntityType,
    entity_id: &str,
) -> EntityAccessReceipt<AnyEntityPermission> {
    receipt_with(
        user_id,
        entity_type,
        entity_id,
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
}

/// A receipt carrying a channel permission.
///
/// Channels never resolve to an `AccessLevel`; they resolve to a participant
/// role or view-only. That is the whole reason the requirement is
/// `AnyEntityPermission` — `ViewAccessLevel` cannot be satisfied by either.
fn channel_receipt(
    user_id: &'static str,
    channel_id: &str,
    permission: EntityPermission,
) -> EntityAccessReceipt<AnyEntityPermission> {
    receipt_with(user_id, EntityType::Channel, channel_id, permission)
}

fn receipt_with(
    user_id: &'static str,
    entity_type: EntityType,
    entity_id: &str,
    permission: EntityPermission,
) -> EntityAccessReceipt<AnyEntityPermission> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(user_id),
        AccessEntity {
            entity_id: entity_id.to_string(),
            entity_type,
        },
        permission,
    )
    .expect("any permission satisfies an any-permission requirement")
}

fn create_request(schedule: ReminderSchedule) -> CreateReminder {
    CreateReminder {
        description: "follow up".to_string(),
        entity: None,
        schedule,
    }
}

fn attached_request(entity_id: &str, schedule: ReminderSchedule) -> CreateReminder {
    CreateReminder {
        entity: Some(EntityType::Document.with_entity_string(entity_id.to_string())),
        ..create_request(schedule)
    }
}

#[derive(Debug, thiserror::Error)]
#[error("fake reminders repository error")]
struct FakeRepoError;

/// In-memory repository. User scoping, ordering, and keyset paging mirror the
/// SQL so the service's page assembly is exercised the same way.
#[derive(Clone, Default)]
struct FakeRemindersRepo {
    rows: Arc<Mutex<Vec<(String, Reminder)>>>,
    next_id: Arc<Mutex<u128>>,
    /// Ids the repository reports as undecodable, standing in for a row whose
    /// stored entity_type or cron no longer parses.
    unreadable: Arc<Mutex<Vec<Uuid>>>,
    /// When set, every method fails, standing in for a database outage.
    failing: Arc<Mutex<bool>>,
}

impl FakeRemindersRepo {
    fn rows(&self) -> Vec<(String, Reminder)> {
        self.rows.lock().expect("rows lock poisoned").clone()
    }

    /// Mark a row unreadable, as a schema drift would.
    fn make_unreadable(&self, id: Uuid) {
        self.unreadable
            .lock()
            .expect("unreadable lock poisoned")
            .push(id);
    }

    /// Make every subsequent call fail.
    fn start_failing(&self) {
        *self.failing.lock().expect("failing lock poisoned") = true;
    }

    fn check_failing(&self) -> Result<(), FakeRepoError> {
        if *self.failing.lock().expect("failing lock poisoned") {
            return Err(FakeRepoError);
        }
        Ok(())
    }

    fn is_unreadable(&self, id: Uuid) -> bool {
        self.unreadable
            .lock()
            .expect("unreadable lock poisoned")
            .contains(&id)
    }

    /// Sequential ids, and `created_at` stamped in insertion order so the
    /// `(next_run_at, created_at, id)` ordering is deterministic.
    fn mint_identity(&self) -> (Uuid, DateTime<Utc>) {
        let mut next = self.next_id.lock().expect("id lock poisoned");
        *next += 1;
        (
            Uuid::from_u128(*next),
            now() + Duration::seconds(*next as i64),
        )
    }
}

fn sort_key(reminder: &Reminder) -> (DateTime<Utc>, DateTime<Utc>, Uuid) {
    (reminder.next_run_at, reminder.created_at, reminder.id)
}

impl RemindersRepo for FakeRemindersRepo {
    type Err = FakeRepoError;

    async fn create_reminder(
        &self,
        user_id: &MacroUserIdStr<'_>,
        new: &NewReminder,
    ) -> Result<Reminder, Self::Err> {
        self.check_failing()?;
        let (id, created_at) = self.mint_identity();
        let reminder = Reminder {
            id,
            description: new.description.clone(),
            entity_type: new.entity.as_ref().map(|entity| entity.entity_type),
            entity_id: new
                .entity
                .as_ref()
                .map(|entity| entity.entity_id.to_string()),
            schedule: new.schedule.clone(),
            next_run_at: new.next_run_at,
            enabled: true,
            completed_at: None,
            created_at,
            updated_at: created_at,
        };
        self.rows
            .lock()
            .expect("rows lock poisoned")
            .push((user_id.as_ref().to_string(), reminder.clone()));
        Ok(reminder)
    }

    async fn get_reminder(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> Result<Option<Reminder>, Self::Err> {
        self.check_failing()?;
        Ok(self
            .rows()
            .into_iter()
            .find(|(owner, reminder)| owner == user_id.as_ref() && reminder.id == id)
            .map(|(_, reminder)| reminder))
    }

    async fn list_reminders(
        &self,
        user_id: &MacroUserIdStr<'_>,
        filter: &ReminderFilter,
        limit: i64,
    ) -> Result<ReminderBatch, Self::Err> {
        self.check_failing()?;
        let mut found: Vec<Reminder> = self
            .rows()
            .into_iter()
            .filter(|(owner, _)| owner == user_id.as_ref())
            .map(|(_, reminder)| reminder)
            .filter(|reminder| filter.include_completed || reminder.completed_at.is_none())
            .filter(|reminder| match &filter.entity {
                Some(entity) => {
                    reminder.entity_type == Some(entity.entity_type)
                        && reminder.entity_id.as_deref() == Some(entity.entity_id.as_ref())
                }
                None => true,
            })
            .collect();
        found.sort_by_key(sort_key);
        if let Some(cursor) = filter.cursor {
            let cursor_key = (cursor.next_run_at, cursor.created_at, cursor.id);
            found.retain(|reminder| sort_key(reminder) > cursor_key);
        }
        found.truncate(limit.max(0) as usize);

        // Mirrors the SQL adapter: undecodable rows are counted and the last
        // position read is reported, rather than vanishing.
        let last_examined = found.last().map(ReminderCursor::after);
        let mut batch = ReminderBatch {
            reminders: Vec::new(),
            skipped: 0,
            last_examined,
        };
        for reminder in found {
            if self.is_unreadable(reminder.id) {
                batch.skipped += 1;
            } else {
                batch.reminders.push(reminder);
            }
        }
        Ok(batch)
    }

    async fn update_reminder(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: Uuid,
        update: &ReminderUpdate,
    ) -> Result<Option<Reminder>, Self::Err> {
        self.check_failing()?;
        let mut rows = self.rows.lock().expect("rows lock poisoned");
        let Some((_, reminder)) = rows
            .iter_mut()
            .find(|(owner, reminder)| owner == user_id.as_ref() && reminder.id == id)
        else {
            return Ok(None);
        };

        if let Some(description) = &update.description {
            reminder.description = description.clone();
        }
        if let Some(schedule) = &update.schedule {
            reminder.schedule = schedule.schedule.clone();
            reminder.next_run_at = schedule.next_run_at;
            // Mirrors the SQL: rescheduling revives a completed reminder.
            reminder.completed_at = None;
        }
        if let Some(enabled) = update.enabled {
            reminder.enabled = enabled;
        }
        reminder.updated_at = now();

        Ok(Some(reminder.clone()))
    }

    async fn delete_reminder(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> Result<bool, Self::Err> {
        self.check_failing()?;
        let mut rows = self.rows.lock().expect("rows lock poisoned");
        let before = rows.len();
        rows.retain(|(owner, reminder)| !(owner == user_id.as_ref() && reminder.id == id));
        Ok(rows.len() < before)
    }
}

fn service() -> RemindersServiceImpl<FakeRemindersRepo, FixedClock> {
    RemindersServiceImpl::with_clock(FakeRemindersRepo::default(), FixedClock(now()))
}

/// Mark a reminder completed, standing in for the dispatcher.
fn complete(service: &RemindersServiceImpl<FakeRemindersRepo, FixedClock>, id: Uuid) {
    let mut rows = service.repo.rows.lock().expect("rows lock poisoned");
    let (_, reminder) = rows
        .iter_mut()
        .find(|(_, reminder)| reminder.id == id)
        .expect("reminder exists");
    reminder.completed_at = Some(now());
}

#[tokio::test]
async fn creates_a_standalone_reminder_without_a_receipt() {
    let remind_at = future();
    let reminder = service()
        .create_reminder(&user(USER_A), create_request(once(remind_at)), None)
        .await
        .expect("standalone reminder should be created");

    assert_eq!(reminder.description, "follow up");
    assert!(reminder.entity().is_none());
    assert_eq!(reminder.next_run_at, remind_at);
    assert!(reminder.enabled);
}

#[tokio::test]
async fn creates_an_entity_reminder_with_a_matching_receipt() {
    let reminder = service()
        .create_reminder(
            &user(USER_A),
            attached_request("doc-1", once(future())),
            Some(view_receipt(USER_A, EntityType::Document, "doc-1")),
        )
        .await
        .expect("entity reminder should be created");

    let entity = reminder.entity().expect("entity should be persisted");
    assert_eq!(entity.entity_type, EntityType::Document);
    assert_eq!(entity.entity_id, "doc-1");
}

/// Regression: requiring `ViewAccessLevel` made every channel unattachable,
/// because a channel permission is a participant role, never an access level.
/// The failure surfaced as "you do not have access to this entity" on channels
/// the caller was a member of.
#[tokio::test]
async fn creates_a_channel_reminder_for_each_channel_permission_shape() {
    for permission in [
        EntityPermission::ChannelRole {
            role: ParticipantRole::Owner,
        },
        EntityPermission::ChannelRole {
            role: ParticipantRole::Admin,
        },
        EntityPermission::ChannelRole {
            role: ParticipantRole::Member,
        },
        EntityPermission::ChannelViewOnly,
    ] {
        let reminder = service()
            .create_reminder(
                &user(USER_A),
                CreateReminder {
                    entity: Some(EntityType::Channel.with_entity_string("channel-1".to_string())),
                    ..create_request(once(future()))
                },
                Some(channel_receipt(USER_A, "channel-1", permission.clone())),
            )
            .await
            .expect("a channel permission should allow attaching a reminder");

        let entity = reminder.entity().expect("entity should be persisted");
        assert_eq!(entity.entity_type, EntityType::Channel);
        assert_eq!(entity.entity_id, "channel-1");
    }
}

/// The receipt still has to be for this caller and this channel; loosening the
/// permission requirement must not loosen the identity check.
#[tokio::test]
async fn rejects_a_channel_receipt_minted_for_another_user() {
    let err = service()
        .create_reminder(
            &user(USER_A),
            CreateReminder {
                entity: Some(EntityType::Channel.with_entity_string("channel-1".to_string())),
                ..create_request(once(future()))
            },
            Some(channel_receipt(
                USER_B,
                "channel-1",
                EntityPermission::ChannelRole {
                    role: ParticipantRole::Member,
                },
            )),
        )
        .await
        .expect_err("a receipt for another user must not authorize this one");

    assert!(matches!(err, ReminderError::EntityAccessDenied));
}

#[tokio::test]
async fn rejects_an_entity_reminder_with_no_receipt() {
    let err = service()
        .create_reminder(
            &user(USER_A),
            attached_request("doc-1", once(future())),
            None,
        )
        .await
        .expect_err("an entity reminder needs a receipt");

    assert!(matches!(err, ReminderError::EntityAccessDenied));
}

#[tokio::test]
async fn rejects_a_receipt_minted_for_a_different_entity() {
    let err = service()
        .create_reminder(
            &user(USER_A),
            attached_request("doc-1", once(future())),
            // Same user and type, different id: the caller proved access to
            // something else entirely.
            Some(view_receipt(USER_A, EntityType::Document, "doc-2")),
        )
        .await
        .expect_err("receipt entity must match the requested entity");

    assert!(matches!(err, ReminderError::EntityAccessDenied));
}

#[tokio::test]
async fn rejects_a_receipt_minted_for_a_different_entity_type() {
    let err = service()
        .create_reminder(
            &user(USER_A),
            attached_request("shared-id", once(future())),
            Some(view_receipt(USER_A, EntityType::Chat, "shared-id")),
        )
        .await
        .expect_err("receipt entity type must match the requested entity type");

    assert!(matches!(err, ReminderError::EntityAccessDenied));
}

#[tokio::test]
async fn rejects_a_receipt_belonging_to_another_user() {
    let err = service()
        .create_reminder(
            &user(USER_A),
            attached_request("doc-1", once(future())),
            Some(view_receipt(USER_B, EntityType::Document, "doc-1")),
        )
        .await
        .expect_err("receipt user must be the caller");

    assert!(matches!(err, ReminderError::EntityAccessDenied));
}

#[tokio::test]
async fn rejects_a_receipt_with_no_entity_to_authorize() {
    // Only reachable through driver misuse, so it is surfaced rather than
    // silently dropped.
    let err = service()
        .create_reminder(
            &user(USER_A),
            create_request(once(future())),
            Some(view_receipt(USER_A, EntityType::Document, "doc-1")),
        )
        .await
        .expect_err("a receipt without an entity should be rejected");

    assert!(matches!(err, ReminderError::BadRequest(_)));
}

#[tokio::test]
async fn rejects_a_blank_description() {
    let request = CreateReminder {
        description: "   ".to_string(),
        ..create_request(once(future()))
    };

    let err = service()
        .create_reminder(&user(USER_A), request, None)
        .await
        .expect_err("blank description should be rejected");

    assert!(matches!(err, ReminderError::BadRequest(_)));
}

#[tokio::test]
async fn trims_the_description() {
    let request = CreateReminder {
        description: "  follow up  ".to_string(),
        ..create_request(once(future()))
    };

    let reminder = service()
        .create_reminder(&user(USER_A), request, None)
        .await
        .expect("reminder should be created");

    assert_eq!(reminder.description, "follow up");
}

#[tokio::test]
async fn description_limit_counts_characters_not_bytes() {
    // Each emoji is 4 bytes, so a byte-based limit would reject this at a
    // quarter of the documented length.
    let request = CreateReminder {
        description: "🎉".repeat(MAX_DESCRIPTION_LEN),
        ..create_request(once(future()))
    };

    let reminder = service()
        .create_reminder(&user(USER_A), request, None)
        .await
        .expect("a description of exactly the limit in chars should be accepted");
    assert_eq!(reminder.description.chars().count(), MAX_DESCRIPTION_LEN);

    let too_long = CreateReminder {
        description: "🎉".repeat(MAX_DESCRIPTION_LEN + 1),
        ..create_request(once(future()))
    };
    assert!(matches!(
        service()
            .create_reminder(&user(USER_A), too_long, None)
            .await,
        Err(ReminderError::BadRequest(_))
    ));
}

#[tokio::test]
async fn rejects_a_one_shot_in_the_past() {
    let request = create_request(once(now() - Duration::hours(1)));

    let err = service()
        .create_reminder(&user(USER_A), request, None)
        .await
        .expect_err("a past instant should be rejected");

    assert!(matches!(err, ReminderError::BadRequest(_)));
}

#[tokio::test]
async fn rejects_a_one_shot_at_exactly_now() {
    // The boundary the fixed clock exists to pin: `next_run_after` is strictly
    // after `now`, so an instant equal to now has already passed.
    let err = service()
        .create_reminder(&user(USER_A), create_request(once(now())), None)
        .await
        .expect_err("an instant equal to now should be rejected");

    assert!(matches!(err, ReminderError::BadRequest(_)));
}

#[tokio::test]
async fn accepts_a_one_shot_one_second_from_now() {
    let remind_at = now() + Duration::seconds(1);
    let reminder = service()
        .create_reminder(&user(USER_A), create_request(once(remind_at)), None)
        .await
        .expect("an instant just after now should be accepted");

    assert_eq!(reminder.next_run_at, remind_at);
}

#[tokio::test]
async fn rejects_a_cron_with_no_upcoming_firing() {
    let schedule = ReminderSchedule::Recurring {
        // Year-qualified and long past.
        cron: ReminderCron::parse("0 0 9 * * * 2000").expect("valid cron"),
        timezone: New_York,
    };

    let err = service()
        .create_reminder(&user(USER_A), create_request(schedule), None)
        .await
        .expect_err("a cron with no future firing should be rejected");

    assert!(matches!(err, ReminderError::BadRequest(_)));
}

#[tokio::test]
async fn derives_next_run_at_from_a_recurring_schedule() {
    let reminder = service()
        .create_reminder(&user(USER_A), create_request(recurring()), None)
        .await
        .expect("recurring reminder should be created");

    // Frozen "now" is 2026-07-01T12:00Z, which is 08:00 in New York, so the
    // first firing is 09:00 the same morning — 13:00Z.
    assert_eq!(
        reminder.next_run_at,
        Utc.with_ymd_and_hms(2026, 7, 1, 13, 0, 0)
            .single()
            .expect("unambiguous instant")
    );
    assert!(reminder.schedule.repeats());
}

#[tokio::test]
async fn lists_only_the_callers_reminders_soonest_first() {
    let service = service();
    let soon = now() + Duration::hours(2);
    let later = now() + Duration::days(3);

    service
        .create_reminder(&user(USER_A), create_request(once(later)), None)
        .await
        .expect("created");
    service
        .create_reminder(&user(USER_A), create_request(once(soon)), None)
        .await
        .expect("created");
    service
        .create_reminder(&user(USER_B), create_request(once(soon)), None)
        .await
        .expect("created");

    let page = service
        .list_reminders(&user(USER_A), ReminderFilter::default())
        .await
        .expect("list should succeed");

    assert_eq!(page.reminders.len(), 2);
    assert_eq!(page.reminders[0].next_run_at, soon);
    assert_eq!(page.reminders[1].next_run_at, later);
    assert!(page.next_cursor.is_none(), "one page holds both");

    // The response wrapper is what the router returns.
    let list = RemindersList {
        reminders: page.reminders,
        next_cursor: None,
    };
    assert_eq!(list.reminders.len(), 2);
}

#[tokio::test]
async fn lists_reminders_filtered_by_entity() {
    let service = service();
    service
        .create_reminder(
            &user(USER_A),
            attached_request("doc-1", once(future())),
            Some(view_receipt(USER_A, EntityType::Document, "doc-1")),
        )
        .await
        .expect("created");
    service
        .create_reminder(&user(USER_A), create_request(once(future())), None)
        .await
        .expect("created");

    let filter = ReminderFilter {
        entity: Some(EntityType::Document.with_entity_string("doc-1".to_string())),
        ..Default::default()
    };
    let page = service
        .list_reminders(&user(USER_A), filter)
        .await
        .expect("list should succeed");

    assert_eq!(page.reminders.len(), 1);
    assert_eq!(page.reminders[0].entity_id.as_deref(), Some("doc-1"));
}

#[tokio::test]
async fn pages_through_reminders_with_a_cursor() {
    let service = service();
    // Same firing time for all five, so paging depends on the created_at/id
    // tie-breakers rather than next_run_at.
    let remind_at = future();
    for _ in 0..5 {
        service
            .create_reminder(&user(USER_A), create_request(once(remind_at)), None)
            .await
            .expect("created");
    }

    let mut seen = Vec::new();
    let mut cursor = None;
    let mut pages = 0;
    loop {
        let page = service
            .list_reminders(
                &user(USER_A),
                ReminderFilter {
                    limit: Some(2),
                    cursor,
                    ..Default::default()
                },
            )
            .await
            .expect("list should succeed");
        pages += 1;
        assert!(page.reminders.len() <= 2, "page must honour the limit");
        seen.extend(page.reminders.iter().map(|reminder| reminder.id));
        match page.next_cursor {
            Some(next) => cursor = Some(next),
            None => break,
        }
        assert!(pages < 10, "paging should terminate");
    }

    assert_eq!(pages, 3, "5 rows at 2 per page");
    assert_eq!(seen.len(), 5, "every reminder appears exactly once");
    let unique: std::collections::HashSet<_> = seen.iter().collect();
    assert_eq!(unique.len(), 5, "no reminder is returned twice");
}

#[tokio::test]
async fn a_full_final_page_reports_no_further_cursor() {
    let service = service();
    for _ in 0..2 {
        service
            .create_reminder(&user(USER_A), create_request(once(future())), None)
            .await
            .expect("created");
    }

    let page = service
        .list_reminders(
            &user(USER_A),
            ReminderFilter {
                limit: Some(2),
                ..Default::default()
            },
        )
        .await
        .expect("list should succeed");

    assert_eq!(page.reminders.len(), 2);
    assert!(
        page.next_cursor.is_none(),
        "a page that exactly consumes the rows has no next page"
    );
}

#[tokio::test]
async fn an_oversized_limit_is_clamped() {
    let filter = ReminderFilter {
        limit: Some(u32::MAX),
        ..Default::default()
    };
    assert_eq!(filter.page_size(), MAX_PAGE_SIZE);

    // A zero limit would otherwise return an empty page forever.
    let filter = ReminderFilter {
        limit: Some(0),
        ..Default::default()
    };
    assert_eq!(filter.page_size(), 1);

    let service = service();
    service
        .create_reminder(&user(USER_A), create_request(once(future())), None)
        .await
        .expect("created");
    let page = service
        .list_reminders(&user(USER_A), filter)
        .await
        .expect("list should succeed");
    assert_eq!(page.reminders.len(), 1);
}

#[tokio::test]
async fn gets_a_reminder_by_id() {
    let service = service();
    let created = service
        .create_reminder(&user(USER_A), create_request(once(future())), None)
        .await
        .expect("created");

    let found = service
        .get_reminder(&user(USER_A), created.id)
        .await
        .expect("get should succeed");

    assert_eq!(found.id, created.id);
}

#[tokio::test]
async fn another_users_reminder_is_not_found() {
    let service = service();
    let created = service
        .create_reminder(&user(USER_A), create_request(once(future())), None)
        .await
        .expect("created");

    assert!(matches!(
        service.get_reminder(&user(USER_B), created.id).await,
        Err(ReminderError::NotFound)
    ));
    assert!(matches!(
        service
            .update_reminder(
                &user(USER_B),
                created.id,
                ReminderPatch {
                    enabled: Some(false),
                    ..Default::default()
                },
            )
            .await,
        Err(ReminderError::NotFound)
    ));
    assert!(matches!(
        service.delete_reminder(&user(USER_B), created.id).await,
        Err(ReminderError::NotFound)
    ));

    // ...and USER_A's reminder survived all three attempts.
    assert_eq!(service.repo.rows().len(), 1);
}

#[tokio::test]
async fn updates_description_and_enabled() {
    let service = service();
    let created = service
        .create_reminder(&user(USER_A), create_request(once(future())), None)
        .await
        .expect("created");

    let updated = service
        .update_reminder(
            &user(USER_A),
            created.id,
            ReminderPatch {
                description: Some("  new text  ".to_string()),
                enabled: Some(false),
                ..Default::default()
            },
        )
        .await
        .expect("update should succeed");

    assert_eq!(updated.description, "new text");
    assert!(!updated.enabled);
    // Untouched fields keep their value.
    assert_eq!(updated.next_run_at, created.next_run_at);
}

#[tokio::test]
async fn updating_the_schedule_recomputes_next_run_at() {
    let service = service();
    let created = service
        .create_reminder(&user(USER_A), create_request(once(future())), None)
        .await
        .expect("created");

    let updated = service
        .update_reminder(
            &user(USER_A),
            created.id,
            ReminderPatch {
                schedule: Some(recurring()),
                ..Default::default()
            },
        )
        .await
        .expect("update should succeed");

    assert!(updated.schedule.repeats());
    assert_ne!(updated.next_run_at, created.next_run_at);
    assert!(updated.next_run_at > now());
}

#[tokio::test]
async fn rescheduling_revives_a_completed_reminder() {
    let service = service();
    let created = service
        .create_reminder(&user(USER_A), create_request(once(future())), None)
        .await
        .expect("created");
    complete(&service, created.id);

    let revived = service
        .update_reminder(
            &user(USER_A),
            created.id,
            ReminderPatch {
                schedule: Some(once(now() + Duration::days(7))),
                ..Default::default()
            },
        )
        .await
        .expect("update should succeed");

    assert!(
        revived.completed_at.is_none(),
        "a reminder given a new firing must not stay marked completed"
    );
    // ...and it is visible in the default list again.
    let page = service
        .list_reminders(&user(USER_A), ReminderFilter::default())
        .await
        .expect("list should succeed");
    assert_eq!(page.reminders.len(), 1);
}

#[tokio::test]
async fn a_non_schedule_update_leaves_completed_at_alone() {
    let service = service();
    let created = service
        .create_reminder(&user(USER_A), create_request(once(future())), None)
        .await
        .expect("created");
    complete(&service, created.id);

    let updated = service
        .update_reminder(
            &user(USER_A),
            created.id,
            ReminderPatch {
                description: Some("still done".to_string()),
                ..Default::default()
            },
        )
        .await
        .expect("update should succeed");

    assert!(updated.completed_at.is_some());
}

#[tokio::test]
async fn rejects_an_update_to_a_past_one_shot() {
    let service = service();
    let created = service
        .create_reminder(&user(USER_A), create_request(recurring()), None)
        .await
        .expect("created");

    let err = service
        .update_reminder(
            &user(USER_A),
            created.id,
            ReminderPatch {
                schedule: Some(once(now() - Duration::hours(1))),
                ..Default::default()
            },
        )
        .await
        .expect_err("a past instant should be rejected");

    assert!(matches!(err, ReminderError::BadRequest(_)));
}

#[tokio::test]
async fn rejects_an_empty_patch() {
    let service = service();
    let created = service
        .create_reminder(&user(USER_A), create_request(once(future())), None)
        .await
        .expect("created");

    let err = service
        .update_reminder(&user(USER_A), created.id, ReminderPatch::default())
        .await
        .expect_err("an empty patch should be rejected");

    assert!(matches!(err, ReminderError::BadRequest(_)));
}

#[tokio::test]
async fn deletes_a_reminder_once() {
    let service = service();
    let created = service
        .create_reminder(&user(USER_A), create_request(once(future())), None)
        .await
        .expect("created");

    service
        .delete_reminder(&user(USER_A), created.id)
        .await
        .expect("first delete should succeed");

    assert!(matches!(
        service.delete_reminder(&user(USER_A), created.id).await,
        Err(ReminderError::NotFound)
    ));
}

#[tokio::test]
async fn a_completed_reminder_is_hidden_unless_requested() {
    let service = service();
    let created = service
        .create_reminder(&user(USER_A), create_request(once(future())), None)
        .await
        .expect("created");
    complete(&service, created.id);

    let default_list = service
        .list_reminders(&user(USER_A), ReminderFilter::default())
        .await
        .expect("list should succeed");
    assert!(default_list.reminders.is_empty());

    let with_completed = service
        .list_reminders(
            &user(USER_A),
            ReminderFilter {
                include_completed: true,
                ..Default::default()
            },
        )
        .await
        .expect("list should succeed");
    assert_eq!(with_completed.reminders.len(), 1);
}

#[tokio::test]
async fn an_unreadable_row_at_a_page_boundary_does_not_end_pagination() {
    // The failure this guards against: the repo reads page_size + 1 rows, some
    // are undecodable, and a naive `decoded.len() > page_size` check concludes
    // there is no next page — silently truncating the list.
    let service = service();
    let remind_at = future();
    let mut created = Vec::new();
    for _ in 0..5 {
        created.push(
            service
                .create_reminder(&user(USER_A), create_request(once(remind_at)), None)
                .await
                .expect("created"),
        );
    }
    // Break the 3rd row: with page size 2, it is the probe row of page 2.
    service.repo.make_unreadable(created[2].id);

    let mut seen = Vec::new();
    let mut cursor = None;
    let mut pages = 0;
    loop {
        let page = service
            .list_reminders(
                &user(USER_A),
                ReminderFilter {
                    limit: Some(2),
                    cursor,
                    ..Default::default()
                },
            )
            .await
            .expect("list should succeed");
        pages += 1;
        seen.extend(page.reminders.iter().map(|reminder| reminder.id));
        match page.next_cursor {
            Some(next) => cursor = Some(next),
            None => break,
        }
        assert!(pages < 10, "paging should terminate");
    }

    // All four readable reminders are reached; only the broken one is missing.
    assert_eq!(
        seen.len(),
        4,
        "readable rows after the bad row must be reached"
    );
    assert!(!seen.contains(&created[2].id));
    for (index, reminder) in created.iter().enumerate() {
        if index != 2 {
            assert!(seen.contains(&reminder.id), "missing reminder {index}");
        }
    }
}

#[tokio::test]
async fn a_batch_of_entirely_unreadable_rows_does_not_yield_an_empty_page() {
    // The worst case: every row the first read examines is undecodable. The
    // service reads again from where that batch stopped rather than handing back
    // an empty page, so a client never has to treat "empty but more to come" as
    // a distinct state.
    let service = service();
    let remind_at = future();
    let mut created = Vec::new();
    for _ in 0..4 {
        created.push(
            service
                .create_reminder(&user(USER_A), create_request(once(remind_at)), None)
                .await
                .expect("created"),
        );
    }
    // Page size 2 means each read examines 3 rows; break all three of the first.
    service.repo.make_unreadable(created[0].id);
    service.repo.make_unreadable(created[1].id);
    service.repo.make_unreadable(created[2].id);

    let page = service
        .list_reminders(
            &user(USER_A),
            ReminderFilter {
                limit: Some(2),
                ..Default::default()
            },
        )
        .await
        .expect("list should succeed");

    assert_eq!(
        page.reminders.len(),
        1,
        "the readable row is returned on the first page, not behind an empty one"
    );
    assert_eq!(page.reminders[0].id, created[3].id);
    assert!(
        page.next_cursor.is_none(),
        "the rows are exhausted, so this is the last page"
    );
}

#[tokio::test]
async fn a_page_is_filled_across_reads_when_rows_are_skipped() {
    // Six readable rows with a broken one wedged in the middle: the page should
    // still come back full rather than short.
    let service = service();
    let remind_at = future();
    let mut created = Vec::new();
    for _ in 0..7 {
        created.push(
            service
                .create_reminder(&user(USER_A), create_request(once(remind_at)), None)
                .await
                .expect("created"),
        );
    }
    service.repo.make_unreadable(created[1].id);

    let page = service
        .list_reminders(
            &user(USER_A),
            ReminderFilter {
                limit: Some(3),
                ..Default::default()
            },
        )
        .await
        .expect("list should succeed");

    assert_eq!(
        page.reminders.len(),
        3,
        "a skipped row must not shorten the page"
    );
    assert!(!page.reminders.iter().any(|r| r.id == created[1].id));
    assert!(page.next_cursor.is_some(), "rows remain");
}

#[tokio::test]
async fn an_unreadable_run_longer_than_the_scan_cap_degrades_to_a_short_page() {
    // The residual case the cap allows: enough consecutive bad rows that the
    // service gives up filling the page. It still reports a cursor, so the client
    // makes progress on the next call rather than stalling.
    let service = service();
    let remind_at = future();
    let mut created = Vec::new();
    for _ in 0..40 {
        created.push(
            service
                .create_reminder(&user(USER_A), create_request(once(remind_at)), None)
                .await
                .expect("created"),
        );
    }
    // Break the first 30; with page size 2 each read examines 3, so 5 reads
    // cannot get past them.
    for reminder in created.iter().take(30) {
        service.repo.make_unreadable(reminder.id);
    }

    let page = service
        .list_reminders(
            &user(USER_A),
            ReminderFilter {
                limit: Some(2),
                ..Default::default()
            },
        )
        .await
        .expect("list should succeed");

    assert!(page.reminders.is_empty(), "the scan cap was reached");
    assert!(
        page.next_cursor.is_some(),
        "a capped page must still advance, or the client stalls forever"
    );

    // Following the cursor keeps making progress until the readable rows appear.
    let mut cursor = page.next_cursor;
    let mut found = Vec::new();
    for _ in 0..10 {
        let page = service
            .list_reminders(
                &user(USER_A),
                ReminderFilter {
                    limit: Some(2),
                    cursor,
                    ..Default::default()
                },
            )
            .await
            .expect("list should succeed");
        found.extend(page.reminders.iter().map(|r| r.id));
        match page.next_cursor {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }
    assert_eq!(
        found.len(),
        10,
        "all ten readable rows are eventually reached"
    );
}

#[tokio::test]
async fn a_final_page_with_an_unreadable_row_reports_no_cursor() {
    // Symmetry check: skipped rows must not invent a next page either.
    let service = service();
    let mut created = Vec::new();
    for _ in 0..2 {
        created.push(
            service
                .create_reminder(&user(USER_A), create_request(once(future())), None)
                .await
                .expect("created"),
        );
    }
    service.repo.make_unreadable(created[1].id);

    let page = service
        .list_reminders(
            &user(USER_A),
            ReminderFilter {
                limit: Some(5),
                ..Default::default()
            },
        )
        .await
        .expect("list should succeed");

    assert_eq!(page.reminders.len(), 1);
    assert!(
        page.next_cursor.is_none(),
        "the table is exhausted, so there is no next page"
    );
}

#[tokio::test]
async fn rescheduling_leaves_enabled_alone() {
    // Product decision: `enabled = false` is an explicit "pause this", so
    // rescheduling revives the completion state but does not silently re-enable.
    // A client that wants it active again sends `enabled: true` in the same patch.
    let service = service();
    let created = service
        .create_reminder(&user(USER_A), create_request(once(future())), None)
        .await
        .expect("created");
    let paused = service
        .update_reminder(
            &user(USER_A),
            created.id,
            ReminderPatch {
                enabled: Some(false),
                ..Default::default()
            },
        )
        .await
        .expect("update should succeed");
    assert!(!paused.enabled);
    complete(&service, created.id);

    let rescheduled = service
        .update_reminder(
            &user(USER_A),
            created.id,
            ReminderPatch {
                schedule: Some(once(now() + Duration::days(7))),
                ..Default::default()
            },
        )
        .await
        .expect("update should succeed");

    assert!(rescheduled.completed_at.is_none(), "completion is cleared");
    assert!(
        !rescheduled.enabled,
        "an explicit pause survives a reschedule"
    );

    // Re-enabling is a separate, explicit field on the same patch.
    let resumed = service
        .update_reminder(
            &user(USER_A),
            created.id,
            ReminderPatch {
                schedule: Some(once(now() + Duration::days(8))),
                enabled: Some(true),
                ..Default::default()
            },
        )
        .await
        .expect("update should succeed");
    assert!(resumed.enabled);
}

#[tokio::test]
async fn repository_failures_surface_as_internal_errors() {
    // Every method wraps repo errors with `anyhow::Error::from`, which the router
    // turns into a 500 with the cause logged but not returned. Without this the
    // whole mapping is unexercised.
    let service = service();
    let created = service
        .create_reminder(&user(USER_A), create_request(once(future())), None)
        .await
        .expect("created before the outage");
    service.repo.start_failing();

    assert!(matches!(
        service
            .create_reminder(&user(USER_A), create_request(once(future())), None)
            .await,
        Err(ReminderError::Internal(_))
    ));
    assert!(matches!(
        service.get_reminder(&user(USER_A), created.id).await,
        Err(ReminderError::Internal(_))
    ));
    assert!(matches!(
        service
            .list_reminders(&user(USER_A), ReminderFilter::default())
            .await,
        Err(ReminderError::Internal(_))
    ));
    assert!(matches!(
        service
            .update_reminder(
                &user(USER_A),
                created.id,
                ReminderPatch {
                    enabled: Some(false),
                    ..Default::default()
                },
            )
            .await,
        Err(ReminderError::Internal(_))
    ));
    assert!(matches!(
        service.delete_reminder(&user(USER_A), created.id).await,
        Err(ReminderError::Internal(_))
    ));
}

#[tokio::test]
async fn validation_runs_before_the_repository_is_touched() {
    // With the repo failing, a request that is invalid on its face must still
    // come back as a 400 rather than a 500 — which is only true if validation
    // happens first.
    let service = service();
    service.repo.start_failing();

    let blank = CreateReminder {
        description: "   ".to_string(),
        ..create_request(once(future()))
    };
    assert!(matches!(
        service.create_reminder(&user(USER_A), blank, None).await,
        Err(ReminderError::BadRequest(_))
    ));

    assert!(matches!(
        service
            .create_reminder(
                &user(USER_A),
                create_request(once(now() - Duration::hours(1))),
                None
            )
            .await,
        Err(ReminderError::BadRequest(_))
    ));

    // An entity reminder with no receipt is rejected before any read, too.
    assert!(matches!(
        service
            .create_reminder(
                &user(USER_A),
                attached_request("doc-1", once(future())),
                None
            )
            .await,
        Err(ReminderError::EntityAccessDenied)
    ));

    // And an empty patch never reaches the repo.
    assert!(matches!(
        service
            .update_reminder(&user(USER_A), Uuid::from_u128(1), ReminderPatch::default())
            .await,
        Err(ReminderError::BadRequest(_))
    ));
}

#[tokio::test]
async fn update_enforces_the_description_limit() {
    // Create and update share `validate_description`, but only create was
    // covered; the DB CHECK would otherwise turn a slip here into a 500.
    let service = service();
    let created = service
        .create_reminder(&user(USER_A), create_request(once(future())), None)
        .await
        .expect("created");

    assert!(matches!(
        service
            .update_reminder(
                &user(USER_A),
                created.id,
                ReminderPatch {
                    description: Some("🎉".repeat(MAX_DESCRIPTION_LEN + 1)),
                    ..Default::default()
                },
            )
            .await,
        Err(ReminderError::BadRequest(_))
    ));

    let at_limit = service
        .update_reminder(
            &user(USER_A),
            created.id,
            ReminderPatch {
                description: Some("🎉".repeat(MAX_DESCRIPTION_LEN)),
                ..Default::default()
            },
        )
        .await
        .expect("exactly the limit should be accepted");
    assert_eq!(at_limit.description.chars().count(), MAX_DESCRIPTION_LEN);

    // Blank is rejected on update as well as on create.
    assert!(matches!(
        service
            .update_reminder(
                &user(USER_A),
                created.id,
                ReminderPatch {
                    description: Some("   ".to_string()),
                    ..Default::default()
                },
            )
            .await,
        Err(ReminderError::BadRequest(_))
    ));
}

#[tokio::test]
async fn a_disabled_reminder_is_still_listed() {
    // Deliberate: the default list hides *completed* reminders, not paused ones,
    // so a paused reminder stays visible in the UI. Pinned so a future change to
    // the list predicate has to be a decision rather than an accident.
    let service = service();
    let created = service
        .create_reminder(&user(USER_A), create_request(once(future())), None)
        .await
        .expect("created");
    service
        .update_reminder(
            &user(USER_A),
            created.id,
            ReminderPatch {
                enabled: Some(false),
                ..Default::default()
            },
        )
        .await
        .expect("paused");

    let page = service
        .list_reminders(&user(USER_A), ReminderFilter::default())
        .await
        .expect("list should succeed");

    assert_eq!(page.reminders.len(), 1);
    assert!(!page.reminders[0].enabled);
}

#[tokio::test]
async fn pages_within_an_entity_filter() {
    // The entity predicate and the keyset predicate were each covered alone;
    // a paged entity-scoped list applies both at once.
    let service = service();
    let remind_at = future();
    for _ in 0..3 {
        service
            .create_reminder(
                &user(USER_A),
                attached_request("doc-1", once(remind_at)),
                Some(view_receipt(USER_A, EntityType::Document, "doc-1")),
            )
            .await
            .expect("created");
    }
    for _ in 0..2 {
        service
            .create_reminder(
                &user(USER_A),
                attached_request("doc-2", once(remind_at)),
                Some(view_receipt(USER_A, EntityType::Document, "doc-2")),
            )
            .await
            .expect("created");
    }

    let filter = || ReminderFilter {
        entity: Some(EntityType::Document.with_entity_string("doc-1".to_string())),
        limit: Some(2),
        ..Default::default()
    };

    let mut seen = Vec::new();
    let mut cursor = None;
    let mut pages = 0;
    loop {
        let page = service
            .list_reminders(&user(USER_A), ReminderFilter { cursor, ..filter() })
            .await
            .expect("list should succeed");
        pages += 1;
        for reminder in &page.reminders {
            assert_eq!(
                reminder.entity_id.as_deref(),
                Some("doc-1"),
                "the filter must hold on every page"
            );
        }
        seen.extend(page.reminders.iter().map(|reminder| reminder.id));
        match page.next_cursor {
            Some(next) => cursor = Some(next),
            None => break,
        }
        assert!(pages < 10, "paging should terminate");
    }

    assert_eq!(seen.len(), 3, "all three doc-1 reminders, and only those");
    let unique: std::collections::HashSet<_> = seen.iter().collect();
    assert_eq!(unique.len(), 3);
}
