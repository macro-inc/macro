use std::collections::HashSet;

use chrono::TimeZone;
use feature_flags::outbound::fake::FakeFeatureFlags;
use feature_flags::{FlagSnapshot, FlagValue};
use serde_json::json;

use super::*;
use crate::domain::service::test::FakeRepo;

const AGENT: &str = "macro|agent@team.test";
const TEAM_OWNER: &str = "macro|owner@team.test";
const TEAM_ADMIN: &str = "macro|admin@team.test";
const TEAMMATE: &str = "macro|teammate@team.test";
const STRANGER: &str = "macro|stranger@elsewhere.test";
/// A person (not an agent) on the same team.
const PERSON: &str = "macro|person@team.test";

const FIRST: Uuid = Uuid::from_u128(1);
const SECOND: Uuid = Uuid::from_u128(2);

fn id(user: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(user).unwrap()
}

/// Owners and admins oversee `AGENT`; `PERSON` is no agent, so nobody
/// oversees them. Each owner's routines are listed oldest first.
struct FakeStore {
    overseers: HashSet<&'static str>,
    routines: Vec<AgentRoutine>,
}

impl AgentRoutineStore for FakeStore {
    async fn is_agent(&self, user: &MacroUserIdStr<'_>) -> Result<bool> {
        Ok(user.as_ref() == AGENT)
    }

    async fn oversees(
        &self,
        viewer: &MacroUserIdStr<'_>,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<bool> {
        Ok(agent.as_ref() == AGENT && self.overseers.contains(viewer.as_ref()))
    }

    async fn top_level_routines(
        &self,
        owner: &MacroUserIdStr<'_>,
        limit: u8,
    ) -> Result<Vec<AgentRoutine>> {
        if owner.as_ref() != AGENT && owner.as_ref() != PERSON {
            return Ok(Vec::new());
        }
        Ok(self
            .routines
            .iter()
            .take(usize::from(limit))
            .cloned()
            .collect())
    }
}

fn routine(id: Uuid, name: &str) -> AgentRoutine {
    AgentRoutine {
        id,
        name: name.to_owned(),
        enabled: true,
        running: false,
        trigger_kind: TriggerKind::Cron,
        next_run_at: Some(Utc.with_ymd_and_hms(2026, 11, 14, 9, 0, 0).unwrap()),
        last_run: None,
    }
}

fn flags_for(viewers: &[&'static str]) -> FakeFeatureFlags {
    let mut flags = FakeFeatureFlags::default();
    for viewer in viewers {
        flags.set(
            id(viewer),
            Ok(FlagSnapshot::new([(
                AGENT_DASHBOARDS_FLAG.to_owned(),
                FlagValue::Boolean(true),
            )])),
        );
    }
    flags
}

type Service = AgentRoutineServiceImpl<FakeStore, FakeRepo, FakeFeatureFlags>;

fn service_with(routines: Vec<AgentRoutine>, flags: Option<FakeFeatureFlags>) -> Service {
    let runs = FakeRepo::default();
    // FIRST ran twice: an old success, then the failure that is its last run.
    for (start_hour, succeeded) in [(7, true), (8, false)] {
        runs.records.lock().unwrap().push(ActionExecutionRecord {
            id: Some(macro_uuid::generate_uuid_v7()),
            action_id: FIRST,
            resource_id: Some("session".to_owned()),
            start_time: Utc
                .with_ymd_and_hms(2026, 11, 13, start_hour, 0, 0)
                .unwrap(),
            end_time: Utc
                .with_ymd_and_hms(2026, 11, 13, start_hour, 5, 0)
                .unwrap(),
            is_success: succeeded,
            result: json!({ "steps": [{ "output": "the secret plan" }] }),
            created_at: Utc
                .with_ymd_and_hms(2026, 11, 13, start_hour, 5, 0)
                .unwrap(),
        });
    }
    AgentRoutineServiceImpl::new(
        Arc::new(FakeStore {
            overseers: HashSet::from([TEAM_OWNER, TEAM_ADMIN]),
            routines,
        }),
        Arc::new(runs),
        flags,
    )
}

fn service() -> Service {
    service_with(
        vec![routine(FIRST, "Morning digest"), routine(SECOND, "Triage")],
        Some(flags_for(&[
            AGENT, TEAM_OWNER, TEAM_ADMIN, TEAMMATE, STRANGER, PERSON,
        ])),
    )
}

fn is_not_found(error: &anyhow::Error) -> bool {
    matches!(
        error.downcast_ref::<ActionPolicyError>(),
        Some(ActionPolicyError::NotFound)
    )
}

#[tokio::test]
async fn the_agent_and_its_team_owners_and_admins_read_its_routines() {
    let service = service();
    for viewer in [AGENT, TEAM_OWNER, TEAM_ADMIN] {
        let listed = service
            .agent_routines(&id(viewer), &id(AGENT))
            .await
            .unwrap();
        let names: Vec<_> = listed.routines.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["Morning digest", "Triage"], "{viewer}");
        assert!(!listed.truncated);
    }
}

#[tokio::test]
async fn anyone_else_is_told_the_agent_has_nothing_to_show() {
    let service = service();
    for viewer in [TEAMMATE, STRANGER] {
        let error = service
            .agent_routines(&id(viewer), &id(AGENT))
            .await
            .unwrap_err();
        assert!(is_not_found(&error), "{viewer}: {error}");
    }
}

#[tokio::test]
async fn a_person_is_not_an_agent_so_nobody_reads_their_routines_here() {
    let service = service();
    for viewer in [TEAM_ADMIN, PERSON] {
        let error = service
            .agent_routines(&id(viewer), &id(PERSON))
            .await
            .unwrap_err();
        assert!(is_not_found(&error), "{viewer}: {error}");
    }
}

#[tokio::test]
async fn without_agent_dashboards_even_the_agent_gets_not_found() {
    // Flag off for the agent, an evaluation failure for the admin, and no
    // PostHog at all.
    let mut flags = flags_for(&[]);
    flags.set(
        id(AGENT),
        Ok(FlagSnapshot::new([(
            AGENT_DASHBOARDS_FLAG.to_owned(),
            FlagValue::Boolean(false),
        )])),
    );
    flags.set(id(TEAM_ADMIN), Err("posthog is down".to_owned()));
    let flagged = service_with(vec![routine(FIRST, "Morning digest")], Some(flags));
    for viewer in [AGENT, TEAM_ADMIN] {
        let error = flagged
            .agent_routines(&id(viewer), &id(AGENT))
            .await
            .unwrap_err();
        assert!(is_not_found(&error), "{viewer}: {error}");
    }

    let unconfigured = service_with(vec![routine(FIRST, "Morning digest")], None);
    let error = unconfigured
        .agent_routines(&id(AGENT), &id(AGENT))
        .await
        .unwrap_err();
    assert!(is_not_found(&error), "{error}");
}

#[tokio::test]
async fn the_summary_carries_the_last_outcome_and_no_routine_content() {
    let listed = service()
        .agent_routines(&id(TEAM_ADMIN), &id(AGENT))
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(&listed).unwrap(),
        json!({
            "routines": [
                {
                    "id": FIRST.to_string(),
                    "name": "Morning digest",
                    "enabled": true,
                    "running": false,
                    "triggerKind": "cron",
                    "nextRunAt": "2026-11-14T09:00:00Z",
                    "lastRun": {
                        "startedAt": "2026-11-13T08:00:00Z",
                        "endedAt": "2026-11-13T08:05:00Z",
                        "succeeded": false,
                    },
                },
                {
                    "id": SECOND.to_string(),
                    "name": "Triage",
                    "enabled": true,
                    "running": false,
                    "triggerKind": "cron",
                    "nextRunAt": "2026-11-14T09:00:00Z",
                },
            ],
            "truncated": false,
        })
    );
}

#[tokio::test]
async fn more_than_the_cap_lists_the_oldest_and_says_so() {
    let routines = (0..=u128::from(MAX_AGENT_ROUTINES))
        .map(|n| routine(Uuid::from_u128(100 + n), &format!("routine {n}")))
        .collect();
    let listed = service_with(routines, Some(flags_for(&[AGENT])))
        .agent_routines(&id(AGENT), &id(AGENT))
        .await
        .unwrap();
    assert_eq!(listed.routines.len(), usize::from(MAX_AGENT_ROUTINES));
    assert_eq!(listed.routines[0].name, "routine 0");
    assert!(listed.truncated);
}
