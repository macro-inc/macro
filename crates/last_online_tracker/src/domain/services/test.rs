use super::*;
use chrono::TimeZone;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashMap;
use std::sync::Mutex;

struct MockTime {
    time: DateTime<Utc>,
}

impl MockTime {
    fn new(time: DateTime<Utc>) -> Self {
        MockTime { time }
    }
}

impl SystemTime for MockTime {
    fn now(&self) -> DateTime<Utc> {
        self.time
    }
}

struct MockRepo {
    data: Mutex<HashMap<String, DateTime<Utc>>>,
}

impl MockRepo {
    fn new() -> Self {
        MockRepo {
            data: Mutex::new(HashMap::new()),
        }
    }

    fn with_data(data: HashMap<String, DateTime<Utc>>) -> Self {
        MockRepo {
            data: Mutex::new(data),
        }
    }
}

impl LastOnlineRepo for MockRepo {
    async fn set_last_online(
        &self,
        user: MacroUserIdStr<'_>,
        now: DateTime<Utc>,
    ) -> Result<(), Report> {
        self.data
            .lock()
            .unwrap()
            .insert(user.as_ref().to_string(), now);
        Ok(())
    }

    async fn get_last_online(
        &self,
        user: MacroUserIdStr<'_>,
    ) -> Result<Option<DateTime<Utc>>, Report> {
        Ok(self.data.lock().unwrap().get(user.as_ref()).copied())
    }
}

fn test_user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap()
}

#[tokio::test]
async fn record_last_online_stores_current_time() {
    let now = Utc.with_ymd_and_hms(2024, 1, 15, 12, 0, 0).unwrap();
    let time = MockTime::new(now);
    let repo = MockRepo::new();

    let service = LastOnlineService::new(time, repo);

    service.record_last_online(test_user()).await.unwrap();

    let stored = service.get_last_online(test_user()).await.unwrap();
    assert_eq!(stored, Some(now));
}

#[tokio::test]
async fn get_last_online_returns_none_for_unknown_user() {
    let now = Utc.with_ymd_and_hms(2024, 1, 15, 12, 0, 0).unwrap();
    let time = MockTime::new(now);
    let repo = MockRepo::new();

    let service = LastOnlineService::new(time, repo);

    let result = service.get_last_online(test_user()).await.unwrap();
    assert_eq!(result, None);
}

#[tokio::test]
async fn get_last_online_returns_stored_time() {
    let stored_time = Utc.with_ymd_and_hms(2024, 1, 15, 10, 0, 0).unwrap();
    let now = Utc.with_ymd_and_hms(2024, 1, 15, 12, 0, 0).unwrap();

    let mut data = HashMap::new();
    data.insert("macro|test@example.com".to_string(), stored_time);

    let time = MockTime::new(now);
    let repo = MockRepo::with_data(data);

    let service = LastOnlineService::new(time, repo);

    let result = service.get_last_online(test_user()).await.unwrap();
    assert_eq!(result, Some(stored_time));
}

#[tokio::test]
async fn time_since_last_online_returns_none_for_unknown_user() {
    let now = Utc.with_ymd_and_hms(2024, 1, 15, 12, 0, 0).unwrap();
    let time = MockTime::new(now);
    let repo = MockRepo::new();

    let service = LastOnlineService::new(time, repo);

    let result = service.time_since_last_online(test_user()).await.unwrap();
    assert_eq!(result, None);
}

#[tokio::test]
async fn time_since_last_online_returns_duration() {
    let stored_time = Utc.with_ymd_and_hms(2024, 1, 15, 10, 0, 0).unwrap();
    let now = Utc.with_ymd_and_hms(2024, 1, 15, 12, 0, 0).unwrap();

    let mut data = HashMap::new();
    data.insert("macro|test@example.com".to_string(), stored_time);

    let time = MockTime::new(now);
    let repo = MockRepo::with_data(data);

    let service = LastOnlineService::new(time, repo);

    let result = service.time_since_last_online(test_user()).await.unwrap();
    assert_eq!(result, Some(Duration::from_secs(2 * 60 * 60))); // 2 hours
}

#[tokio::test]
async fn time_since_last_online_handles_just_now() {
    let now = Utc.with_ymd_and_hms(2024, 1, 15, 12, 0, 0).unwrap();

    let mut data = HashMap::new();
    data.insert("macro|test@example.com".to_string(), now);

    let time = MockTime::new(now);
    let repo = MockRepo::with_data(data);

    let service = LastOnlineService::new(time, repo);

    let result = service.time_since_last_online(test_user()).await.unwrap();
    assert_eq!(result, Some(Duration::from_secs(0)));
}

#[tokio::test]
async fn record_updates_existing_last_online() {
    let first_time = Utc.with_ymd_and_hms(2024, 1, 15, 10, 0, 0).unwrap();
    let second_time = Utc.with_ymd_and_hms(2024, 1, 15, 12, 0, 0).unwrap();

    let mut data = HashMap::new();
    data.insert("macro|test@example.com".to_string(), first_time);

    let time = MockTime::new(second_time);
    let repo = MockRepo::with_data(data);

    let service = LastOnlineService::new(time, repo);

    // Verify initial value
    let initial = service.get_last_online(test_user()).await.unwrap();
    assert_eq!(initial, Some(first_time));

    // Record new time
    service.record_last_online(test_user()).await.unwrap();

    // Verify updated value
    let updated = service.get_last_online(test_user()).await.unwrap();
    assert_eq!(updated, Some(second_time));
}

#[tokio::test]
async fn multiple_users_tracked_independently() {
    let now = Utc.with_ymd_and_hms(2024, 1, 15, 12, 0, 0).unwrap();
    let time = MockTime::new(now);
    let repo = MockRepo::new();

    let service = LastOnlineService::new(time, repo);

    let user1 = MacroUserIdStr::parse_from_str("macro|user1@example.com").unwrap();
    let user2 = MacroUserIdStr::parse_from_str("macro|user2@example.com").unwrap();

    service.record_last_online(user1.copied()).await.unwrap();

    // user1 should have a record
    let result1 = service.get_last_online(user1.copied()).await.unwrap();
    assert_eq!(result1, Some(now));

    // user2 should not have a record
    let result2 = service.get_last_online(user2).await.unwrap();
    assert_eq!(result2, None);
}
