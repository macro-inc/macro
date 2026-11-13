use std::collections::HashMap;
use std::sync::Mutex;

use chrono::{DateTime, TimeZone, Utc};
use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use crate::domain::models::AgentRelation;
use crate::domain::record::{
    WakeEndStatus, WakeOutcome, WakeOutcomeCheck, WakeOutcomeSource, WakeTraceIds, WakeTrigger,
    WakeTriggerKind,
};
use crate::domain::trace::WakeTraceSource;

const AGENT: &str = "macro|agent@example.com";
const ADMIN: &str = "macro|admin@example.com";
const MEMBER: &str = "macro|member@example.com";

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

fn caller(id: &'static str) -> Caller {
    Caller { user_id: user(id) }
}

#[derive(Default)]
struct FakeRepository {
    wakes: Mutex<HashMap<String, ValidWake>>,
    traced: Mutex<Vec<String>>,
}

impl WakeRepository for FakeRepository {
    async fn relation(
        &self,
        caller: &MacroUserIdStr<'static>,
        agent: &MacroUserIdStr<'static>,
    ) -> Result<AgentRelation, rootcause::Report> {
        Ok(AgentRelation {
            is_agent_account: agent.as_ref() == AGENT,
            caller_administers_agent_team: caller.as_ref() == ADMIN,
        })
    }

    async fn upsert(
        &self,
        _: &MacroUserIdStr<'static>,
        wake: &ValidWake,
    ) -> Result<UpsertOutcome, rootcause::Report> {
        let mut wakes = self.wakes.lock().unwrap();
        if let Some(stored) = wakes.get(&wake.record.wake) {
            if stored.record.system != wake.record.system {
                return Ok(UpsertOutcome::OtherSystem);
            }
            if stored.phase > wake.phase {
                return Ok(UpsertOutcome::Stale);
            }
        }
        wakes.insert(wake.record.wake.clone(), wake.clone());
        Ok(UpsertOutcome::Stored)
    }

    async fn list(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &WakeFilter,
        _: Option<&WakeCursor>,
        limit: u32,
    ) -> Result<WakePage, rootcause::Report> {
        let wakes = self.wakes.lock().unwrap();
        Ok(WakePage {
            wakes: wakes
                .values()
                .take(limit as usize)
                .map(|wake| StoredWake {
                    record: wake.record.clone(),
                    received_at: wake.started_at,
                    trace_updated_at: None,
                })
                .collect(),
            next: None,
        })
    }

    async fn get(
        &self,
        _: &MacroUserIdStr<'static>,
        wake_id: &str,
    ) -> Result<Option<StoredWake>, rootcause::Report> {
        Ok(self
            .wakes
            .lock()
            .unwrap()
            .get(wake_id)
            .map(|wake| StoredWake {
                record: wake.record.clone(),
                received_at: wake.started_at,
                trace_updated_at: None,
            }))
    }

    async fn mark_trace(
        &self,
        _: &MacroUserIdStr<'static>,
        wake_id: &str,
        _: DateTime<Utc>,
    ) -> Result<bool, rootcause::Report> {
        self.traced.lock().unwrap().push(wake_id.to_owned());
        Ok(true)
    }
}

#[derive(Default)]
struct FakeTraces(Mutex<HashMap<String, WakeTrace>>);

impl TraceStore for FakeTraces {
    async fn put(
        &self,
        _: &MacroUserIdStr<'static>,
        wake_id: &str,
        trace: &WakeTrace,
    ) -> Result<(), rootcause::Report> {
        self.0
            .lock()
            .unwrap()
            .insert(wake_id.to_owned(), trace.clone());
        Ok(())
    }

    async fn get(
        &self,
        _: &MacroUserIdStr<'static>,
        wake_id: &str,
    ) -> Result<Option<WakeTrace>, rootcause::Report> {
        Ok(self.0.lock().unwrap().get(wake_id).cloned())
    }
}

struct Rollout(bool);

impl DashboardsRollout for Rollout {
    async fn enabled_for(&self, _: &MacroUserIdStr<'static>) -> bool {
        self.0
    }
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 12, 9, 0, 0).unwrap()
    }
}

type Service = AgentWakesService<FakeRepository, FakeTraces, Rollout, FixedClock>;

fn service(enabled: bool) -> Service {
    AgentWakesService::new(
        FakeRepository::default(),
        FakeTraces::default(),
        Rollout(enabled),
        FixedClock,
    )
}

fn started(wake: &str) -> WakeRecord {
    WakeRecord {
        v: 1,
        phase: WakePhase::Start,
        system: "pr-factory".to_owned(),
        wake: wake.to_owned(),
        trace: WakeTraceIds {
            trace_id: "0123456789abcdef0123456789abcdef".to_owned(),
            span_id: "0123456789abcdef".to_owned(),
            parent_span_id: None,
        },
        operation: None,
        parent: None,
        trigger: WakeTrigger {
            kind: WakeTriggerKind::Event,
            source: "ciFailures".to_owned(),
            name: None,
            ids: [("pr".to_owned(), "macro-inc/macro#1".to_owned())].into(),
            summary: Some("CI failed".to_owned()),
        },
        started_at: "2026-11-11T09:00:00.000Z".to_owned(),
        session: None,
        terminal: None,
        ended_at: None,
        duration_ms: None,
        status: None,
        error: None,
        outcome: None,
        effects: None,
        usage: None,
    }
}

fn ended(wake: &str) -> WakeRecord {
    WakeRecord {
        phase: WakePhase::End,
        ended_at: Some("2026-11-11T09:01:30.500Z".to_owned()),
        duration_ms: Some(90_500.0),
        status: Some(WakeEndStatus::Failed),
        outcome: Some(WakeOutcome {
            name: "unclassified".to_owned(),
            source: WakeOutcomeSource::None,
            check: WakeOutcomeCheck::NotReported,
            reported: None,
            observed: None,
            summary: None,
        }),
        effects: Some(vec![]),
        ..started(wake)
    }
}

fn trace() -> WakeTrace {
    WakeTrace {
        v: 1,
        source: WakeTraceSource::Claude,
        session_id: "s1".to_owned(),
        started_at: "2026-11-11T09:00:00.000Z".to_owned(),
        ended_at: "2026-11-11T09:01:30.000Z".to_owned(),
        live: false,
        model: None,
        title: None,
        cost_usd: None,
        spans: vec![],
    }
}

#[tokio::test]
async fn the_agent_records_its_wakes_and_the_end_stands() {
    let service = service(true);
    let agent = user(AGENT);

    service
        .record(&caller(AGENT), &agent, started("w1"))
        .await
        .unwrap();
    service
        .record(&caller(AGENT), &agent, ended("w1"))
        .await
        .unwrap();
    // A retried start arriving last changes nothing.
    service
        .record(&caller(AGENT), &agent, started("w1"))
        .await
        .unwrap();

    let wake = service.get(&caller(AGENT), &agent, "w1").await.unwrap();
    assert_eq!(wake.record.phase, WakePhase::End);
}

#[tokio::test]
async fn nobody_else_records_an_agents_wakes() {
    let service = service(true);
    let agent = user(AGENT);

    let admin = service.record(&caller(ADMIN), &agent, started("w1")).await;
    assert!(matches!(admin, Err(WakeError::Forbidden)));

    let member = service.record(&caller(MEMBER), &agent, started("w1")).await;
    assert!(matches!(member, Err(WakeError::NotFound)));
}

#[tokio::test]
async fn a_person_who_is_not_an_agent_account_records_nothing() {
    let service = service(true);
    let person = user(MEMBER);

    let result = service
        .record(&caller(MEMBER), &person, started("w1"))
        .await;
    assert!(matches!(result, Err(WakeError::NotFound)));
}

#[tokio::test]
async fn team_admins_read_and_other_members_do_not() {
    let service = service(true);
    let agent = user(AGENT);
    service
        .record(&caller(AGENT), &agent, started("w1"))
        .await
        .unwrap();

    let page = service
        .list(&caller(ADMIN), &agent, WakeFilter::default(), None, None)
        .await
        .unwrap();
    assert_eq!(page.wakes.len(), 1);

    let member = service
        .list(&caller(MEMBER), &agent, WakeFilter::default(), None, None)
        .await;
    assert!(matches!(member, Err(WakeError::NotFound)));
}

#[tokio::test]
async fn everything_is_not_found_while_the_flag_is_off() {
    let service = service(false);
    let agent = user(AGENT);

    let record = service.record(&caller(AGENT), &agent, started("w1")).await;
    assert!(matches!(record, Err(WakeError::NotFound)));

    let list = service
        .list(&caller(AGENT), &agent, WakeFilter::default(), None, None)
        .await;
    assert!(matches!(list, Err(WakeError::NotFound)));
}

#[tokio::test]
async fn a_wake_id_of_another_system_conflicts() {
    let service = service(true);
    let agent = user(AGENT);
    service
        .record(&caller(AGENT), &agent, started("w1"))
        .await
        .unwrap();

    let other = WakeRecord {
        system: "tod".to_owned(),
        ..started("w1")
    };
    let result = service.record(&caller(AGENT), &agent, other).await;
    assert!(matches!(result, Err(WakeError::Conflict(_))));
}

#[tokio::test]
async fn records_that_are_not_whole_v1_records_are_refused() {
    let service = service(true);
    let agent = user(AGENT);

    let unended = WakeRecord {
        phase: WakePhase::End,
        ..started("w1")
    };
    let wrong_version = WakeRecord {
        v: 2,
        ..started("w2")
    };
    let bad_instant = WakeRecord {
        started_at: "yesterday".to_owned(),
        ..started("w3")
    };
    let empty_id = started("");
    let started_with_status = WakeRecord {
        status: Some(WakeEndStatus::Ok),
        ..started("w4")
    };

    for record in [
        unended,
        wrong_version,
        bad_instant,
        empty_id,
        started_with_status,
    ] {
        let result = service.record(&caller(AGENT), &agent, record).await;
        assert!(matches!(result, Err(WakeError::Invalid(_))), "{result:?}");
    }
}

#[tokio::test]
async fn a_trace_needs_a_recorded_wake_and_admins_read_it() {
    let service = service(true);
    let agent = user(AGENT);

    let unknown = service
        .put_trace(&caller(AGENT), &agent, "w1", trace())
        .await;
    assert!(matches!(unknown, Err(WakeError::NotFound)));

    service
        .record(&caller(AGENT), &agent, started("w1"))
        .await
        .unwrap();
    service
        .put_trace(&caller(AGENT), &agent, "w1", trace())
        .await
        .unwrap();
    assert_eq!(*service.repository.traced.lock().unwrap(), vec!["w1"]);

    let read = service
        .get_trace(&caller(ADMIN), &agent, "w1")
        .await
        .unwrap();
    assert_eq!(read, trace());

    let by_admin = service
        .put_trace(&caller(ADMIN), &agent, "w1", trace())
        .await;
    assert!(matches!(by_admin, Err(WakeError::Forbidden)));
}

#[tokio::test]
async fn a_live_trace_after_the_end_leaves_the_final_trace() {
    let service = service(true);
    let agent = user(AGENT);
    let live = WakeTrace {
        live: true,
        ..trace()
    };

    service
        .record(&caller(AGENT), &agent, started("w1"))
        .await
        .unwrap();
    service
        .put_trace(&caller(AGENT), &agent, "w1", live.clone())
        .await
        .unwrap();
    assert_eq!(
        service.get_trace(&caller(AGENT), &agent, "w1").await.unwrap(),
        live
    );

    service
        .record(&caller(AGENT), &agent, ended("w1"))
        .await
        .unwrap();
    service
        .put_trace(&caller(AGENT), &agent, "w1", trace())
        .await
        .unwrap();
    service
        .put_trace(&caller(AGENT), &agent, "w1", live)
        .await
        .unwrap();

    assert_eq!(
        service.get_trace(&caller(AGENT), &agent, "w1").await.unwrap(),
        trace()
    );
    assert_eq!(
        *service.repository.traced.lock().unwrap(),
        vec!["w1", "w1"]
    );
}

#[test]
fn record_json_round_trips_through_the_v1_shape() {
    let json = serde_json::json!({
        "v": 1,
        "phase": "end",
        "system": "pr-factory",
        "wake": "9f1a",
        "trace": { "traceId": "0123456789abcdef0123456789abcdef", "spanId": "0123456789abcdef" },
        "trigger": { "kind": "event", "source": "ciFailures", "ids": { "pr": "macro-inc/macro#10357" } },
        "startedAt": "2026-11-11T09:00:00.000Z",
        "endedAt": "2026-11-11T09:01:30.500Z",
        "durationMs": 90500,
        "status": "ok",
        "outcome": { "name": "rerun_flake", "source": "reported", "check": "confirmed" },
        "effects": [{ "kind": "ci_rerun", "id": "991" }],
        "usage": { "costUsd": 0.25, "turns": 7 },
        "unknownField": true
    });

    let record: WakeRecord = serde_json::from_value(json.clone()).unwrap();
    assert_eq!(record.status, Some(WakeEndStatus::Ok));
    assert_eq!(record.usage.as_ref().unwrap().cost_usd, Some(0.25));

    let written = serde_json::to_value(&record).unwrap();
    assert_eq!(written["phase"], "end");
    assert_eq!(written["status"], "ok");
    assert_eq!(written["trigger"]["ids"]["pr"], "macro-inc/macro#10357");
    assert_eq!(written.get("unknownField"), None);

    let start: WakeRecord = serde_json::from_value(serde_json::json!({
        "v": 1,
        "phase": "start",
        "system": "pr-factory",
        "wake": "9f1a",
        "trace": { "traceId": "0123456789abcdef0123456789abcdef", "spanId": "0123456789abcdef" },
        "trigger": { "kind": "manual", "source": "cli", "ids": {} },
        "startedAt": "2026-11-11T09:00:00.000Z"
    }))
    .unwrap();
    assert_eq!(start.status, None);
}
