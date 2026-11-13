use super::*;
use chrono::TimeZone;
use std::sync::Mutex;

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).unwrap()
}

fn at(year: i32, month: u32, day: u32, hour: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(year, month, day, hour, 30, 0).unwrap()
}

fn midnight(year: i32, month: u32, day: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(year, month, day, 0, 0, 0).unwrap()
}

#[test]
fn windows_start_at_the_oldest_bucket_and_end_now() {
    // A Friday.
    let now = at(2026, 11, 13, 7);
    let cases = [
        (SpendBucket::Day, midnight(2026, 10, 15)),
        // Monday 2026-11-09, 25 weeks back.
        (SpendBucket::Week, midnight(2026, 5, 18)),
        (SpendBucket::Month, midnight(2025, 12, 1)),
        (SpendBucket::Year, midnight(2022, 1, 1)),
    ];
    for (bucket, from) in cases {
        assert_eq!(
            bucket.window(now).unwrap(),
            SpendWindow {
                bucket,
                from,
                until: now
            },
            "{bucket}"
        );
    }
}

#[test]
fn a_week_window_starts_on_a_monday_even_when_now_is_one() {
    let monday = at(2026, 11, 9, 0);
    assert_eq!(
        SpendBucket::Week.window(monday).unwrap().from,
        midnight(2026, 5, 18)
    );
}

#[test]
fn a_month_window_crosses_the_year() {
    assert_eq!(
        SpendBucket::Month.window(at(2026, 3, 31, 23)).unwrap().from,
        midnight(2025, 4, 1)
    );
}

#[test]
fn buckets_serialize_lowercase() {
    assert_eq!(
        serde_json::to_value(SpendBucket::Week).unwrap(),
        serde_json::json!("week")
    );
    assert_eq!(
        serde_json::from_value::<SpendBucket>(serde_json::json!("year")).unwrap(),
        SpendBucket::Year
    );
}

struct Spend(Mutex<Vec<(String, SpendBucket)>>);

impl AgentSpendRepo for Spend {
    async fn spend_by_bucket(
        &self,
        user: &MacroUserIdStr<'_>,
        window: &SpendWindow,
    ) -> Result<Vec<SpendPoint>> {
        self.0
            .lock()
            .unwrap()
            .push((user.to_string(), window.bucket));
        Ok(vec![SpendPoint {
            start: window.from,
            cost_usd: 1.5,
        }])
    }
}

/// The admin of the agent's team.
struct Managers;

impl AgentManagers for Managers {
    async fn manages_agent(
        &self,
        actor: &MacroUserIdStr<'_>,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<bool> {
        Ok(actor.as_ref() == "macro|admin@example.com"
            && agent.as_ref() == "macro|agent@example.com")
    }
}

struct Gate(bool);

impl AgentDashboardsGate for Gate {
    async fn enabled_for(&self, _: &MacroUserIdStr<'_>) -> bool {
        self.0
    }
}

fn service(flag: bool) -> AgentSpendServiceImpl<Spend, Managers, Gate> {
    AgentSpendServiceImpl::new(Spend(Mutex::default()), Managers, Gate(flag))
}

#[tokio::test]
async fn the_agent_and_its_managers_read_its_spend() {
    let service = service(true);
    let agent = user("macro|agent@example.com");

    for actor in [agent.clone(), user("macro|admin@example.com")] {
        let spend = service
            .agent_spend(&actor, &agent, SpendBucket::Month)
            .await
            .unwrap();
        assert_eq!(spend.window.bucket, SpendBucket::Month);
        assert_eq!(spend.buckets.len(), 1);
    }

    assert_eq!(
        *service.repo.0.lock().unwrap(),
        vec![
            ("macro|agent@example.com".to_owned(), SpendBucket::Month),
            ("macro|agent@example.com".to_owned(), SpendBucket::Month),
        ]
    );
}

#[tokio::test]
async fn anyone_else_is_told_the_agent_does_not_exist() {
    let service = service(true);
    let result = service
        .agent_spend(
            &user("macro|stranger@example.com"),
            &user("macro|agent@example.com"),
            SpendBucket::Day,
        )
        .await;

    assert!(matches!(result, Err(UsageError::NotFound)));
    assert!(service.repo.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_flag_off_hides_even_the_agent_itself() {
    let service = service(false);
    let agent = user("macro|agent@example.com");
    let result = service.agent_spend(&agent, &agent, SpendBucket::Day).await;

    assert!(matches!(result, Err(UsageError::NotFound)));
    assert!(service.repo.0.lock().unwrap().is_empty());
}
