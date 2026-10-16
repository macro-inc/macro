use super::*;
use crate::domain::item_preferences::ItemNotificationPreference;
use ai_toolset::schema::generate_validated_input_schema;
use chrono::Duration;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use rootcause::Report;
use std::sync::{Arc, Mutex};

const USER: &str = "macro|muter@example.com";

type Sets = Arc<Mutex<Vec<(String, String, Option<DateTime<Utc>>)>>>;
type Removes = Arc<Mutex<Vec<(String, String)>>>;

#[derive(Default, Clone)]
struct RecordingRepository {
    sets: Sets,
    removes: Removes,
}

impl ItemNotificationPreferenceRepository for RecordingRepository {
    async fn list(&self, _: MacroUserIdStr<'_>) -> Result<Vec<ItemNotificationPreference>, Report> {
        Ok(vec![])
    }
    async fn set(
        &self,
        user: MacroUserIdStr<'_>,
        entity: Entity<'_>,
        until: Option<DateTime<Utc>>,
    ) -> Result<(), Report> {
        self.sets
            .lock()
            .unwrap()
            .push((user.to_string(), entity.entity_id.to_string(), until));
        Ok(())
    }
    async fn remove(&self, user: MacroUserIdStr<'_>, entity: Entity<'_>) -> Result<(), Report> {
        self.removes
            .lock()
            .unwrap()
            .push((user.to_string(), entity.entity_id.to_string()));
        Ok(())
    }
}

fn context() -> (
    ItemNotificationPreferenceToolContext<RecordingRepository>,
    RecordingRepository,
) {
    let repository = RecordingRepository::default();
    (
        ItemNotificationPreferenceToolContext::new(repository.clone()),
        repository,
    )
}

fn request() -> RequestContext {
    RequestContext::new(MacroUserIdStr::try_from(USER.to_owned()).unwrap())
}

fn tool(action: MuteAction, snooze_until: Option<DateTime<Utc>>) -> MuteNotifications {
    MuteNotifications {
        entity_type: NotificationEntityType::Channel,
        entity_id: "0f6d9a0e-1b62-4f53-9f4c-0b9e2f6f0c11".to_owned(),
        action,
        snooze_until,
    }
}

#[test]
fn mute_notifications_schema_is_valid() {
    let validated = generate_validated_input_schema::<MuteNotifications>().expect("valid schema");
    assert_eq!(validated.name, "MuteNotifications");
}

#[tokio::test]
async fn mute_saves_an_indefinite_mute_for_the_user() {
    let (context, repository) = context();
    tool(MuteAction::Mute, None)
        .call(ServiceContext(context), request())
        .await
        .expect("mute succeeds");

    let sets = repository.sets.lock().unwrap();
    assert_eq!(sets.len(), 1);
    assert_eq!(sets[0].0, USER);
    assert_eq!(sets[0].1, "0f6d9a0e-1b62-4f53-9f4c-0b9e2f6f0c11");
    assert_eq!(sets[0].2, None);
}

#[tokio::test]
async fn snooze_saves_the_deadline() {
    let until = Utc::now() + Duration::hours(2);
    let (context, repository) = context();
    let response = tool(MuteAction::Snooze, Some(until))
        .call(ServiceContext(context), request())
        .await
        .expect("snooze succeeds");

    assert_eq!(response.snooze_until, Some(until));
    assert_eq!(repository.sets.lock().unwrap()[0].2, Some(until));
}

#[tokio::test]
async fn snooze_needs_a_future_deadline() {
    let missing = tool(MuteAction::Snooze, None)
        .call(ServiceContext(context().0), request())
        .await
        .expect_err("snooze without a deadline");
    assert!(missing.description.contains("snoozeUntil"));

    let past = tool(MuteAction::Snooze, Some(Utc::now() - Duration::hours(1)))
        .call(ServiceContext(context().0), request())
        .await
        .expect_err("snooze in the past");
    assert!(past.description.contains("future"));
}

#[tokio::test]
async fn unmute_removes_the_preference() {
    let (context, repository) = context();
    tool(MuteAction::Unmute, None)
        .call(ServiceContext(context), request())
        .await
        .expect("unmute succeeds");

    assert!(repository.sets.lock().unwrap().is_empty());
    assert_eq!(repository.removes.lock().unwrap().len(), 1);
}
