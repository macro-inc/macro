use chrono::{DateTime, TimeZone, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use super::*;
use crate::domain::models::WakeStatus;
use crate::domain::record::{
    OutcomeCheck, OutcomeSource, TraceIds, Trigger, TriggerKind, WakeEnd, WakeEndStatus,
    WakeOutcome,
};

const AGENT: &str = "macro|agent@example.com";
const ADMIN: &str = "macro|admin@example.com";
const OWNER: &str = "macro|owner@example.com";
const MEMBER: &str = "macro|member@example.com";
const OUTSIDER: &str = "macro|outsider@example.com";

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

/// The agent and four people; the agent, the admin, the owner and the member
/// share one team, the outsider is in a team of its own.
async fn seed(pool: &PgPool) {
    for (id, is_agent) in [
        (AGENT, true),
        (ADMIN, false),
        (OWNER, false),
        (MEMBER, false),
        (OUTSIDER, false),
    ] {
        let email = id.strip_prefix("macro|").unwrap();
        let macro_user_id = Uuid::now_v7();
        sqlx::query!(
            "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
            macro_user_id,
            email,
            format!("stripe_{macro_user_id}"),
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query!(
            r#"INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES ($1, $2, $3, $4)"#,
            id,
            email,
            macro_user_id,
            is_agent,
        )
        .execute(pool)
        .await
        .unwrap();
    }

    let team = Uuid::now_v7();
    let other_team = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Team', $2), ($3, 'Other', $4)",
        team,
        OWNER,
        other_team,
        OUTSIDER,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO team_user (user_id, team_id, team_role) VALUES
            ($1, $5, 'member'), ($2, $5, 'admin'), ($3, $5, 'owner'),
            ($4, $5, 'member'), ($6, $7, 'owner')
        "#,
        AGENT,
        ADMIN,
        OWNER,
        MEMBER,
        team,
        OUTSIDER,
        other_team,
    )
    .execute(pool)
    .await
    .unwrap();
}

fn at(minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 11, 9, minute, 0).unwrap()
}

fn wake(id: &str, system: &str, phase: WakePhase, minute: u32) -> ValidWake {
    let end = (phase == WakePhase::End).then(|| WakeEnd {
        ended_at: "2026-11-11T10:00:00.000Z".to_owned(),
        duration_ms: 1000.0,
        status: WakeEndStatus::Failed,
        error: None,
        outcome: WakeOutcome {
            name: "unclassified".to_owned(),
            source: OutcomeSource::None,
            check: OutcomeCheck::NotReported,
            reported: None,
            observed: None,
            summary: None,
        },
        effects: vec![],
        usage: None,
    });
    let status = if end.is_some() {
        WakeStatus::Failed
    } else {
        WakeStatus::Running
    };
    ValidWake {
        record: WakeRecord {
            v: 1,
            phase,
            system: system.to_owned(),
            wake: id.to_owned(),
            trace: TraceIds {
                trace_id: "0123456789abcdef0123456789abcdef".to_owned(),
                span_id: "0123456789abcdef".to_owned(),
                parent_span_id: None,
            },
            operation: None,
            parent: None,
            trigger: Trigger {
                kind: TriggerKind::Schedule,
                source: "schedules".to_owned(),
                name: Some("nightly".to_owned()),
                ids: Default::default(),
                summary: None,
            },
            started_at: at(minute).to_rfc3339(),
            session: None,
            terminal: None,
            end,
        },
        phase,
        status,
        started_at: at(minute),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn relation_finds_agent_accounts_and_their_team_admins(pool: PgPool) {
    seed(&pool).await;
    let repo = PgWakeRepository::new(pool);

    for (caller, administers) in [
        (ADMIN, true),
        (OWNER, true),
        (MEMBER, false),
        (OUTSIDER, false),
        (AGENT, false),
    ] {
        let relation = repo.relation(&user(caller), &user(AGENT)).await.unwrap();
        assert!(relation.is_agent_account, "{caller}");
        assert_eq!(relation.caller_administers_agent_team, administers, "{caller}");
    }

    let person = repo.relation(&user(ADMIN), &user(MEMBER)).await.unwrap();
    assert!(!person.is_agent_account);

    let missing = repo
        .relation(&user(ADMIN), &user("macro|nobody@example.com"))
        .await
        .unwrap();
    assert!(!missing.is_agent_account);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn upsert_keeps_the_latest_phase_per_wake(pool: PgPool) {
    seed(&pool).await;
    let repo = PgWakeRepository::new(pool);
    let agent = user(AGENT);

    let start = wake("w1", "pr-factory", WakePhase::Start, 0);
    let session = wake("w1", "pr-factory", WakePhase::Session, 0);
    let end = wake("w1", "pr-factory", WakePhase::End, 0);

    assert_eq!(repo.upsert(&agent, &start).await.unwrap(), UpsertOutcome::Stored);
    assert_eq!(repo.upsert(&agent, &session).await.unwrap(), UpsertOutcome::Stored);
    // The same phase again replaces it: a session record may be re-sent as
    // more is known.
    assert_eq!(repo.upsert(&agent, &session).await.unwrap(), UpsertOutcome::Stored);
    assert_eq!(repo.upsert(&agent, &end).await.unwrap(), UpsertOutcome::Stored);
    assert_eq!(repo.upsert(&agent, &start).await.unwrap(), UpsertOutcome::Stale);

    let stored = repo.get(&agent, "w1").await.unwrap().unwrap();
    assert_eq!(stored.record, end.record);

    let failed = repo
        .list(
            &agent,
            &WakeFilter {
                status: Some(WakeStatus::Failed),
            },
            None,
            10,
        )
        .await
        .unwrap();
    assert_eq!(failed.wakes.len(), 1);

    let other = wake("w1", "tod", WakePhase::End, 0);
    assert_eq!(
        repo.upsert(&agent, &other).await.unwrap(),
        UpsertOutcome::OtherSystem
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_pages_newest_first_and_filters_by_status(pool: PgPool) {
    seed(&pool).await;
    let repo = PgWakeRepository::new(pool);
    let agent = user(AGENT);

    // Two wakes share a start, so the id breaks the tie.
    for (id, system, minute) in [
        ("a", "pr-factory", 1),
        ("b", "tod", 2),
        ("c", "pr-factory", 3),
        ("d", "pr-factory", 3),
        ("e", "tod", 5),
    ] {
        repo.upsert(&agent, &wake(id, system, WakePhase::Start, minute))
            .await
            .unwrap();
    }
    repo.upsert(&agent, &wake("e", "tod", WakePhase::End, 5))
        .await
        .unwrap();

    let mut seen = Vec::new();
    let mut after: Option<WakeCursor> = None;
    loop {
        let page = repo
            .list(&agent, &WakeFilter::default(), after.as_ref(), 2)
            .await
            .unwrap();
        assert!(page.wakes.len() <= 2);
        seen.extend(page.wakes.iter().map(|wake| wake.record.wake.clone()));
        match page.next {
            Some(next) => after = Some(next),
            None => break,
        }
    }
    assert_eq!(seen, ["e", "d", "c", "b", "a"]);

    let running = repo
        .list(
            &agent,
            &WakeFilter {
                status: Some(WakeStatus::Running),
            },
            None,
            10,
        )
        .await
        .unwrap();
    let ids: Vec<_> = running
        .wakes
        .iter()
        .map(|wake| wake.record.wake.as_str())
        .collect();
    assert_eq!(ids, ["d", "c", "b", "a"]);
    assert_eq!(running.next, None);

    let others = repo
        .list(&user(ADMIN), &WakeFilter::default(), None, 10)
        .await
        .unwrap();
    assert!(others.wakes.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mark_trace_needs_a_recorded_wake(pool: PgPool) {
    seed(&pool).await;
    let repo = PgWakeRepository::new(pool);
    let agent = user(AGENT);

    assert!(!repo.mark_trace(&agent, "w1", at(9)).await.unwrap());

    repo.upsert(&agent, &wake("w1", "pr-factory", WakePhase::Start, 0))
        .await
        .unwrap();
    assert!(repo.mark_trace(&agent, "w1", at(9)).await.unwrap());

    let stored = repo.get(&agent, "w1").await.unwrap().unwrap();
    assert_eq!(stored.trace_updated_at, Some(at(9)));
}
