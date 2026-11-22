use super::*;
use crate::domain::{ExecutionStatus, JobInfo};
use agent_runtime_protocol::domain::job::{JobSettlement, JobStatus};
use agent_runtime_protocol::domain::notification::NotificationEvent;
use agent_session::domain::notifications::ProduceNotification;
use serde_json::json;

const CAPS: JobCaps = JobCaps {
    per_session: 2,
    per_account: 3,
};

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap()
}

fn job(deadline: chrono::DateTime<chrono::Utc>) -> ExecutionRecord {
    ExecutionRecord {
        credential_correlation_id: None,
        execution_id: ExecutionId::mint(),
        acting_as: Some(ai_toolset::actor::ToolActor::Owner),
        turn_id: Some(macro_uuid::Uuid::from_u128(7)),
        source: "export async function main() { return {data: 1}; }".into(),
        status: ExecutionStatus::Running,
        result: None,
        error: None,
        calls: Vec::new(),
        activity: Vec::new(),
        activity_truncated: false,
        job: Some(JobInfo {
            title: "Checking routine".into(),
            started_at: deadline - chrono::TimeDelta::minutes(10),
            deadline,
            never_ran: false,
        }),
    }
}

fn settled_event(session: AgentSessionId, record: &ExecutionRecord) -> PendingNotification {
    PendingNotification::new(ProduceNotification {
        session_id: session,
        subject_id: record.execution_id.to_string(),
        event: NotificationEvent::JobSettled(JobSettlement {
            job_id: record.execution_id.as_uuid(),
            title: "Checking routine".into(),
            status: JobStatus::Done,
            result: Some(json!({"data": 1})),
            error: None,
            never_ran: false,
        }),
        dedupe_key: None,
        wake: true,
    })
    .unwrap()
}

async fn store(pool: &PgPool) -> PgJobStore {
    sqlx::raw_sql(include_str!("../postgres/test/sessions.sql"))
        .execute(pool)
        .await
        .unwrap();
    // A second session of the same owner, for the account cap.
    sqlx::query!(
        "INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace) VALUES ('00000000-0000-0000-0000-000000000003', 'macro|owner@example.com', '00000000-0000-0000-0000-00000000a9e7', 'test', 'macrod', '/workspace')"
    )
    .execute(pool)
    .await
    .unwrap();
    PgJobStore::new(
        pool.clone(),
        Arc::new(agent_session::outbound::notifications::PgNotificationStore(
            pool.clone(),
        )),
    )
}

fn session(n: u128) -> AgentSessionId {
    AgentSessionId::new_from_uuid(macro_uuid::Uuid::from_u128(n))
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn launches_stop_at_the_session_and_account_caps(pool: PgPool) {
    let store = store(&pool).await;
    let deadline = chrono::Utc::now() + chrono::TimeDelta::minutes(10);
    for _ in 0..CAPS.per_session {
        store
            .launch(session(1), &owner(), &job(deadline), CAPS)
            .await
            .unwrap();
    }
    assert!(matches!(
        store
            .launch(session(1), &owner(), &job(deadline), CAPS)
            .await,
        Err(CodeModeError::JobLimit(_))
    ));
    store
        .launch(session(3), &owner(), &job(deadline), CAPS)
        .await
        .unwrap();
    assert!(matches!(
        store.launch(session(3), &owner(), &job(deadline), CAPS).await,
        Err(CodeModeError::JobLimit(message)) if message.contains("account")
    ));
    let taken = job(deadline);
    let (other_owner, other) = (
        MacroUserIdStr::try_from("macro|other@example.com".to_owned()).unwrap(),
        session(2),
    );
    store
        .launch(other, &other_owner, &taken, CAPS)
        .await
        .unwrap();
    assert!(matches!(
        store.launch(other, &other_owner, &taken, CAPS).await,
        Err(CodeModeError::Duplicate)
    ));
}

/// The settle and its notification commit together, once.
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_job_settles_once_with_its_notification(pool: PgPool) {
    let store = store(&pool).await;
    let mut record = job(chrono::Utc::now() + chrono::TimeDelta::minutes(10));
    store
        .launch(session(1), &owner(), &record, CAPS)
        .await
        .unwrap();
    assert_eq!(
        store
            .control(session(1), record.execution_id)
            .await
            .unwrap(),
        JobControl::Running
    );
    record.activity_truncated = true;
    store.save_activity(session(1), &record).await.unwrap();

    record.status = ExecutionStatus::Succeeded;
    record.result = Some(json!({"data": 1}));
    let event = settled_event(session(1), &record);
    assert!(
        store
            .settle(session(1), &record, Some(&event))
            .await
            .unwrap()
    );
    assert!(
        !store
            .settle(session(1), &record, Some(&event))
            .await
            .unwrap()
    );
    assert!(store.save_activity(session(1), &record).await.is_err());
    assert_eq!(
        store
            .control(session(1), record.execution_id)
            .await
            .unwrap(),
        JobControl::Settled
    );
    let events = sqlx::query_scalar!(
        "SELECT count(*) FROM agent_session_notification WHERE session_id = $1 AND wake",
        session(1).as_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(events, Some(1));
    // A settled job no longer counts against the cap.
    for _ in 0..CAPS.per_session {
        store
            .launch(
                session(1),
                &owner(),
                &job(chrono::Utc::now() + chrono::TimeDelta::minutes(10)),
                CAPS,
            )
            .await
            .unwrap();
    }
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_cancel_is_recorded_on_the_row(pool: PgPool) {
    let store = store(&pool).await;
    let record = job(chrono::Utc::now() + chrono::TimeDelta::minutes(10));
    store
        .launch(session(1), &owner(), &record, CAPS)
        .await
        .unwrap();
    assert_eq!(
        store
            .request_cancel(session(1), record.execution_id)
            .await
            .unwrap(),
        JobCancel::Requested
    );
    assert_eq!(
        store
            .control(session(1), record.execution_id)
            .await
            .unwrap(),
        JobControl::CancelRequested
    );
    // Another session can't touch it.
    assert!(matches!(
        store.request_cancel(session(2), record.execution_id).await,
        Err(CodeModeError::NotFound)
    ));
    assert_eq!(
        store
            .control(session(2), record.execution_id)
            .await
            .unwrap(),
        JobControl::Gone
    );
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn overdue_and_listed_jobs(pool: PgPool) {
    let store = store(&pool).await;
    let now = chrono::Utc::now();
    let overdue = job(now - chrono::TimeDelta::minutes(5));
    let running = job(now + chrono::TimeDelta::minutes(5));
    store
        .launch(session(1), &owner(), &overdue, CAPS)
        .await
        .unwrap();
    store
        .launch(session(1), &owner(), &running, CAPS)
        .await
        .unwrap();

    let found = store.overdue(now, 10).await.unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].0, session(1));
    assert_eq!(found[0].1.execution_id, overdue.execution_id);

    let listed = store
        .list(session(1), now - chrono::TimeDelta::hours(1), 10)
        .await
        .unwrap();
    assert_eq!(listed.len(), 2);
    assert!(
        store
            .list(session(2), now - chrono::TimeDelta::hours(1), 10)
            .await
            .unwrap()
            .is_empty()
    );
}

/// A program's result can hold `\u0000`, which JSONB refuses: the settle and
/// its event must still be stored.
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_result_with_a_nul_character_still_settles(pool: PgPool) {
    let store = store(&pool).await;
    let mut record = job(chrono::Utc::now() + chrono::TimeDelta::minutes(10));
    store
        .launch(session(1), &owner(), &record, CAPS)
        .await
        .unwrap();
    record.status = ExecutionStatus::Succeeded;
    record.result = Some(json!({"data": "a\u{0}b"}));
    let event = PendingNotification::new(ProduceNotification {
        session_id: session(1),
        subject_id: record.execution_id.to_string(),
        event: NotificationEvent::JobSettled(JobSettlement {
            job_id: record.execution_id.as_uuid(),
            title: "Checking routine".into(),
            status: JobStatus::Done,
            result: Some(json!({"data": "a\u{0}b"})),
            error: Some("x\u{0}y".into()),
            never_ran: false,
        }),
        dedupe_key: None,
        wake: true,
    })
    .unwrap();
    assert!(
        store
            .settle(session(1), &record, Some(&event))
            .await
            .unwrap()
    );
}

/// The correlation a job's credential was minted with is saved on its
/// record, where connected-app admission reads it.
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_started_job_keeps_its_credentials_correlation(pool: PgPool) {
    let store = store(&pool).await;
    let mut record = job(chrono::Utc::now() + chrono::TimeDelta::minutes(10));
    store
        .launch(session(1), &owner(), &record, CAPS)
        .await
        .unwrap();
    let correlation = macro_uuid::Uuid::from_u128(0x10b);
    record.credential_correlation_id = Some(correlation);
    store.save_activity(session(1), &record).await.unwrap();
    let listed = store
        .list(
            session(1),
            chrono::Utc::now() - chrono::TimeDelta::hours(1),
            10,
        )
        .await
        .unwrap();
    assert_eq!(listed[0].credential_correlation_id, Some(correlation));
}
