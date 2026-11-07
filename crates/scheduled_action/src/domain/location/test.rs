use std::collections::HashSet;
use std::sync::Mutex;

use chrono::Utc;
use model_owner::Owner;
use serde_json::{Value, json};

use super::*;
use crate::domain::event_runs::ConfigurationRevision;
use crate::domain::event_trigger::ActionTrigger;
use crate::domain::models::{ActionKind, RunVisibility};
use crate::domain::service::test::{FakeExecutor, FakeRepo, USER, user};

#[derive(Default)]
struct FakeDevices {
    devices: Mutex<Vec<(Uuid, MacroUserIdStr<'static>, [u8; 32])>>,
    fired: Mutex<HashSet<FenceId>>,
}

impl LocationDeviceRepo for FakeDevices {
    async fn create_device(
        &self,
        id: Uuid,
        owner: &MacroUserIdStr<'static>,
        token_hash: &[u8; 32],
    ) -> Result<()> {
        self.devices
            .lock()
            .unwrap()
            .push((id, owner.clone(), *token_hash));
        Ok(())
    }

    async fn delete_device(&self, id: Uuid, owner: &MacroUserIdStr<'static>) -> Result<bool> {
        let mut devices = self.devices.lock().unwrap();
        let before = devices.len();
        devices.retain(|(device, device_owner, _)| !(*device == id && device_owner == owner));
        Ok(devices.len() < before)
    }

    async fn device_owner(&self, token_hash: &[u8; 32]) -> Result<Option<MacroUserIdStr<'static>>> {
        Ok(self
            .devices
            .lock()
            .unwrap()
            .iter()
            .find(|(_, _, hash)| hash == token_hash)
            .map(|(_, owner, _)| owner.clone()))
    }

    async fn claim_firing(&self, fence: &FenceId, _cooldown: Duration) -> Result<bool> {
        Ok(self.fired.lock().unwrap().insert(fence.clone()))
    }
}

type TestLocations = LocationRoutines<FakeRepo, FakeDevices, FakeExecutor>;

fn locations() -> TestLocations {
    LocationRoutines::new(
        Arc::new(FakeRepo::default()),
        Arc::new(FakeDevices::default()),
        Arc::new(FakeExecutor::default()),
    )
}

fn office() -> Place {
    serde_json::from_value(json!({
        "name": "Office",
        "latitude": 40.7128,
        "longitude": -74.006,
        "radius_meters": 200,
    }))
    .unwrap()
}

async fn store_routine(locations: &TestLocations, owner: &str, trigger: Value) -> Uuid {
    let now = Utc::now();
    let action = ScheduledAction {
        id: None,
        owner: Owner::User(MacroUserIdStr::try_from(owner.to_owned()).unwrap()),
        name: "Office arrival".into(),
        trigger: serde_json::from_value(trigger).unwrap(),
        kind: ActionKind::Agent,
        created_at: now,
        updated_at: now,
        task: json!({"model": "model", "prompt": "summarize", "user_prompt": "task"}),
        claimed: None,
        next_run_at: None,
        enabled: true,
        run_visibility: RunVisibility::Unlisted,
        configuration_revision: ConfigurationRevision::INITIAL,
        event_activated_at: None,
        template_id: None,
        description: String::new(),
    };
    locations
        .repo
        .create_action(action)
        .await
        .unwrap()
        .id
        .unwrap()
}

#[test]
fn places_are_validated_and_trimmed() {
    let place: Place = serde_json::from_value(json!({
        "name": "  Office ",
        "latitude": -0.0,
        "longitude": 180.0,
        "radius_meters": 100,
    }))
    .unwrap();
    assert_eq!(place.name(), "Office");
    assert_eq!(place.latitude().to_bits(), 0.0_f64.to_bits());

    for invalid in [
        json!({"name": "", "latitude": 1.0, "longitude": 1.0, "radius_meters": 200}),
        json!({"name": "Office", "latitude": 90.5, "longitude": 1.0, "radius_meters": 200}),
        json!({"name": "Office", "latitude": 1.0, "longitude": -181.0, "radius_meters": 200}),
        json!({"name": "Office", "latitude": 1.0, "longitude": 1.0, "radius_meters": 99}),
        json!({"name": "Office", "latitude": 1.0, "longitude": 1.0, "radius_meters": 5001}),
        json!({"name": "Office", "latitude": 1.0, "longitude": 1.0, "radius_meters": 200, "x": 1}),
    ] {
        assert!(
            serde_json::from_value::<Place>(invalid.clone()).is_err(),
            "{invalid}"
        );
    }
}

#[test]
fn location_triggers_stand_alone_or_among_others() {
    let alone: ActionTrigger = serde_json::from_value(json!({
        "type": "location",
        "place": {"name": "Office", "latitude": 40.7128, "longitude": -74.006, "radius_meters": 200},
        "on": "arrive",
    }))
    .unwrap();
    assert_eq!(
        alone.places(),
        vec![(&office(), LocationTransition::Arrive)]
    );
    assert!(!alone.has_schedule());
    assert_eq!(alone.next_run_after(Utc::now()), None);

    let mixed: ActionTrigger = serde_json::from_value(json!({
        "type": "multiple",
        "triggers": [
            {"type": "cron", "schedule": "0 0 9 * * *", "timezone": "UTC"},
            {
                "type": "location",
                "place": {"name": "Office", "latitude": 40.7128, "longitude": -74.006, "radius_meters": 200},
                "on": "leave",
            },
        ],
    }))
    .unwrap();
    assert_eq!(mixed.places(), vec![(&office(), LocationTransition::Leave)]);
    assert!(mixed.next_run_after(Utc::now()).is_some());
}

#[test]
fn fence_ids_round_trip_and_follow_the_circle_not_the_name() {
    let routine: Uuid = "0195f9b8-3c1e-7c2a-9d4e-1a2b3c4d5e6f".parse().unwrap();
    let id = FenceId::of(routine, &office(), LocationTransition::Arrive);
    assert_eq!(id.to_string().parse::<FenceId>().unwrap(), id);
    assert!(
        id.to_string()
            .starts_with("0195f9b8-3c1e-7c2a-9d4e-1a2b3c4d5e6f.")
    );

    let renamed: Place = serde_json::from_value(json!({
        "name": "Work",
        "latitude": 40.7128,
        "longitude": -74.006,
        "radius_meters": 200,
    }))
    .unwrap();
    assert_eq!(
        FenceId::of(routine, &renamed, LocationTransition::Arrive),
        id
    );

    let moved: Place = serde_json::from_value(json!({
        "name": "Office",
        "latitude": 40.7129,
        "longitude": -74.006,
        "radius_meters": 200,
    }))
    .unwrap();
    assert_ne!(FenceId::of(routine, &moved, LocationTransition::Arrive), id);
    assert_ne!(
        FenceId::of(routine, &office(), LocationTransition::Leave),
        id
    );

    assert!("not-a-fence".parse::<FenceId>().is_err());
    assert!(
        "0195f9b8-3c1e-7c2a-9d4e-1a2b3c4d5e6f.ABCDEF0123456789"
            .parse::<FenceId>()
            .is_err()
    );
}

#[test]
fn device_tokens_need_their_shape() {
    assert!(DeviceToken::parse(&format!("mloc_{}", "a".repeat(64))).is_some());
    assert!(DeviceToken::parse(&format!("mloc_{}", "a".repeat(63))).is_none());
    assert!(DeviceToken::parse(&format!("mbot_{}", "a".repeat(64))).is_none());
}

#[tokio::test]
async fn a_registered_phone_runs_its_owners_routine_once_per_cooldown() {
    let locations = locations();
    let routine = store_routine(
        &locations,
        USER,
        json!({
            "type": "location",
            "place": {"name": "Office", "latitude": 40.7128, "longitude": -74.006, "radius_meters": 200},
            "on": "arrive",
        }),
    )
    .await;

    let device = locations.register_device(&user()).await.unwrap();
    let fences = locations.fences(&user()).await.unwrap().fences;
    assert_eq!(fences.len(), 1);
    assert_eq!(fences[0].routine_id, routine);
    assert_eq!(fences[0].routine_name, "Office arrival");
    assert_eq!(fences[0].on, LocationTransition::Arrive);
    let fence = fences[0].id.clone();

    let report = || LocationReport {
        fence: fence.clone(),
        on: LocationTransition::Arrive,
    };
    let first = locations
        .report(DeviceToken::parse(&device.token).unwrap(), report())
        .await
        .unwrap();
    assert_eq!(first, LocationReportOutcome { started: true });
    let firings = locations.executor.locations.lock().unwrap().clone();
    assert_eq!(firings.len(), 1);
    assert_eq!(firings[0].place, office());
    assert_eq!(firings[0].on, LocationTransition::Arrive);

    let again = locations
        .report(DeviceToken::parse(&device.token).unwrap(), report())
        .await
        .unwrap();
    assert_eq!(again, LocationReportOutcome { started: false });
    assert_eq!(locations.executor.locations.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn reports_need_a_known_phone_and_a_fence_its_owner_still_has() {
    let locations = locations();
    let place =
        json!({"name": "Office", "latitude": 40.7128, "longitude": -74.006, "radius_meters": 200});
    let mine = store_routine(
        &locations,
        USER,
        json!({"type": "location", "place": place, "on": "arrive"}),
    )
    .await;
    let theirs = store_routine(
        &locations,
        "macro|other@macro.com",
        json!({"type": "location", "place": place, "on": "arrive"}),
    )
    .await;
    let device = locations.register_device(&user()).await.unwrap();
    let token = || DeviceToken::parse(&device.token).unwrap();
    let error = |result: Result<LocationReportOutcome>| {
        *result.unwrap_err().downcast_ref::<LocationError>().unwrap()
    };

    let unknown = DeviceToken::parse(&format!("mloc_{}", "0".repeat(64))).unwrap();
    let report = LocationReport {
        fence: FenceId::of(mine, &office(), LocationTransition::Arrive),
        on: LocationTransition::Arrive,
    };
    assert_eq!(
        error(locations.report(unknown, report.clone()).await),
        LocationError::UnknownDevice
    );

    let wrong_crossing = LocationReport {
        fence: FenceId::of(mine, &office(), LocationTransition::Arrive),
        on: LocationTransition::Leave,
    };
    assert_eq!(
        error(locations.report(token(), wrong_crossing).await),
        LocationError::UnknownFence
    );

    let someone_elses = LocationReport {
        fence: FenceId::of(theirs, &office(), LocationTransition::Arrive),
        on: LocationTransition::Arrive,
    };
    assert_eq!(
        error(locations.report(token(), someone_elses).await),
        LocationError::UnknownFence
    );

    let mut stored = locations.repo.get_action(&mine).await.unwrap().unwrap();
    stored.enabled = false;
    stored.configuration_revision = stored.configuration_revision.next().unwrap();
    locations.repo.update_action(stored).await.unwrap();
    assert_eq!(
        error(locations.report(token(), report).await),
        LocationError::UnknownFence
    );
    assert!(locations.executor.locations.lock().unwrap().is_empty());

    locations
        .remove_device(&user(), device.device_id)
        .await
        .unwrap();
    assert_eq!(
        error(
            locations
                .report(
                    token(),
                    LocationReport {
                        fence: FenceId::of(theirs, &office(), LocationTransition::Arrive),
                        on: LocationTransition::Arrive,
                    }
                )
                .await
        ),
        LocationError::UnknownDevice
    );
}
