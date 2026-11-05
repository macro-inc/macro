use chrono::Duration;

use super::*;
use crate::domain::auto_archive::{AutoArchiveOverrides, AutoArchiveReason, AutoArchiveRepo};
use crate::domain::error::AgentSessionError;
use crate::domain::pull_request_links::SessionPullRequestLinkRepo;
use crate::domain::work_registration::{WorkEndReason, WorkRegistrationRepo};

const AGENT: &str = "macro|registered-agent@example.com";

async fn end_state(pool: &PgPool, session: AgentSessionId) -> Vec<Option<String>> {
    sqlx::query_scalar!(
        r#"
        SELECT end_reason::text
        FROM work_registration
        WHERE agent_session_id = $1
        ORDER BY registered_at
        "#,
        session.as_uuid(),
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn set_activity(pool: &PgPool, session: AgentSessionId, turn: &str, age: Duration) {
    sqlx::query!(
        "UPDATE agent_session SET turn_state = $2, modified_at = NOW() - make_interval(secs => $3) WHERE id = $1",
        session.as_uuid(),
        turn,
        age.num_seconds() as f64,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn add_pull_request(pool: &PgPool, number: i64, status: &str) -> String {
    let key = format!("Example/Repo/pull/{number}");
    sqlx::query!(
        "INSERT INTO github_pull_request (github_key, number, owner, repo, status) VALUES ($1, $2, 'Example', 'Repo', $3)",
        key,
        number,
        status,
    )
    .execute(pool)
    .await
    .unwrap();
    key
}

/// A repo, a session, and a registered account with a user row.
async fn registered_session(
    pool: &PgPool,
) -> (
    PgAgentSessionRepo<PgBotsRepo>,
    AgentSessionId,
    MacroUserIdStr<'static>,
) {
    let repo = test_repo(pool);
    let bot = create_test_bot(pool).await;
    insert_user(pool, AGENT).await;
    let session = create_session(&repo, new_session(bot, None, None)).await.id;
    let account = user_id(AGENT);
    repo.register(&account, session).await.unwrap();
    (repo, session, account)
}

async fn sweep(repo: &PgAgentSessionRepo<PgBotsRepo>) -> Vec<WorkEndReason> {
    let now = Utc::now();
    repo.end_due_registrations(now - Duration::hours(24), now - Duration::days(7), 100)
        .await
        .unwrap()
        .into_iter()
        .map(|ended| ended.reason)
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn registering_twice_returns_the_active_registration(pool: PgPool) {
    let (repo, session, account) = registered_session(&pool).await;
    let active = repo.active_registrations(std::slice::from_ref(&account), 10).await.unwrap();

    let repeated = repo.register(&account, session).await.unwrap();

    assert!(!repeated.created);
    assert_eq!(vec![repeated.registration], active);
    assert_eq!(end_state(&pool, session).await, vec![None]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unregistering_twice_ends_once_and_keeps_the_row(pool: PgPool) {
    let (repo, session, account) = registered_session(&pool).await;

    assert!(repo.unregister(&account, session).await.unwrap());
    assert!(!repo.unregister(&account, session).await.unwrap());

    assert_eq!(
        end_state(&pool, session).await,
        vec![Some("unregistered".to_owned())]
    );
    let active = repo.active_registrations(&[account.clone()], 10).await.unwrap();
    assert!(active.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_later_registration_is_a_new_one(pool: PgPool) {
    let (repo, session, account) = registered_session(&pool).await;
    repo.unregister(&account, session).await.unwrap();

    let again = repo.register(&account, session).await.unwrap();

    assert!(again.created);
    assert_eq!(
        end_state(&pool, session).await,
        vec![Some("unregistered".to_owned()), None]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_archived_or_missing_session_refuses_registration(pool: PgPool) {
    let (repo, session, account) = registered_session(&pool).await;
    AgentSessionRepo::set_archived(&repo, session, true).await.unwrap();

    assert!(matches!(
        repo.register(&account, session).await,
        Err(AgentSessionError::Archived(_))
    ));
    assert!(matches!(
        repo.register(&account, AgentSessionId::new()).await,
        Err(AgentSessionError::NotFound(_))
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn archiving_ends_registrations_at_once_and_restoring_does_not_bring_them_back(pool: PgPool) {
    let (repo, session, account) = registered_session(&pool).await;

    AgentSessionRepo::set_archived(&repo, session, true).await.unwrap();

    assert_eq!(
        end_state(&pool, session).await,
        vec![Some("session_archived".to_owned())]
    );

    AgentSessionRepo::set_archived(&repo, session, false).await.unwrap();

    assert!(repo.active_registrations(&[account], 10).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_auto_archive_ends_registrations_whatever_triggered_it(pool: PgPool) {
    let (repo, session, _account) = registered_session(&pool).await;
    repo.set_session_auto_archive_overrides(
        session,
        AutoArchiveOverrides {
            on_pull_request_merged: None,
            on_runtime_closed: Some(true),
        },
    )
    .await
    .unwrap();

    assert!(
        repo.auto_archive(session, AutoArchiveReason::RuntimeClosed)
            .await
            .unwrap()
    );

    assert_eq!(
        end_state(&pool, session).await,
        vec![Some("session_archived".to_owned())]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn finished_pull_requests_end_registrations_regardless_of_auto_archive_preference(
    pool: PgPool,
) {
    let (repo, session, account) = registered_session(&pool).await;
    let merged = add_pull_request(&pool, 1, "merged").await;
    let open = add_pull_request(&pool, 2, "open").await;
    repo.link_pull_request(session, &merged, &account).await.unwrap();
    repo.link_pull_request(session, &open, &account).await.unwrap();

    assert!(repo.end_for_finished_pull_requests(&merged).await.unwrap().is_empty());
    assert_eq!(end_state(&pool, session).await, vec![None]);

    sqlx::query!("UPDATE github_pull_request SET status = 'closed' WHERE github_key = $1", open)
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(
        repo.end_for_finished_pull_requests(&open).await.unwrap(),
        vec![session]
    );
    // Repeating the event ends nothing more.
    assert!(repo.end_for_finished_pull_requests(&open).await.unwrap().is_empty());
    assert_eq!(
        end_state(&pool, session).await,
        vec![Some("pull_request_finished".to_owned())]
    );
    // The auto-archive preference is off, so the session itself stays active.
    assert!(AgentSessionRepo::get(&repo, session).await.unwrap().archived.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_link_with_no_stored_pull_request_is_not_finished(pool: PgPool) {
    let (repo, session, account) = registered_session(&pool).await;
    let unknown = "example/repo/pull/404";
    repo.link_pull_request(session, unknown, &account).await.unwrap();

    assert!(repo.end_for_finished_pull_requests(unknown).await.unwrap().is_empty());
    set_activity(&pool, session, "running", Duration::minutes(5)).await;
    assert!(sweep(&repo).await.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sweep_ends_an_idle_session_after_a_day_unless_blocked(pool: PgPool) {
    let (repo, session, _account) = registered_session(&pool).await;

    set_activity(&pool, session, "idle", Duration::hours(23)).await;
    assert!(sweep(&repo).await.is_empty());
    set_activity(&pool, session, "blocked", Duration::hours(25)).await;
    assert!(sweep(&repo).await.is_empty());

    set_activity(&pool, session, "idle", Duration::hours(25)).await;
    assert_eq!(sweep(&repo).await, vec![WorkEndReason::Idle]);
    assert_eq!(end_state(&pool, session).await, vec![Some("idle".to_owned())]);
    // Sweeping again ends nothing more.
    assert!(sweep(&repo).await.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sweep_counts_a_failed_turn_as_idle(pool: PgPool) {
    let (repo, session, _account) = registered_session(&pool).await;

    set_activity(&pool, session, "failed", Duration::hours(25)).await;

    assert_eq!(sweep(&repo).await, vec![WorkEndReason::Idle]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sweep_ends_a_blocked_session_after_a_week(pool: PgPool) {
    let (repo, session, _account) = registered_session(&pool).await;

    set_activity(&pool, session, "blocked", Duration::days(6)).await;
    assert!(sweep(&repo).await.is_empty());

    set_activity(&pool, session, "blocked", Duration::days(8)).await;
    assert_eq!(sweep(&repo).await, vec![WorkEndReason::BlockedTimeout]);
    assert_eq!(
        end_state(&pool, session).await,
        vec![Some("blocked_timeout".to_owned())]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sweep_catches_up_on_finished_pull_requests_first(pool: PgPool) {
    let (repo, session, account) = registered_session(&pool).await;
    let closed = add_pull_request(&pool, 1, "closed").await;
    repo.link_pull_request(session, &closed, &account).await.unwrap();
    // Idle too, but the first matching reason wins.
    set_activity(&pool, session, "idle", Duration::hours(25)).await;

    assert_eq!(sweep(&repo).await, vec![WorkEndReason::PullRequestFinished]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sweep_prefers_an_archived_session_over_the_time_rules(pool: PgPool) {
    let (repo, session, _account) = registered_session(&pool).await;
    set_activity(&pool, session, "idle", Duration::hours(25)).await;
    sqlx::query!(
        "UPDATE agent_session SET archived_by = 'user', archived_at = NOW() WHERE id = $1",
        session.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(sweep(&repo).await, vec![WorkEndReason::SessionArchived]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_sweeps_end_each_registration_once(pool: PgPool) {
    let (repo, session, _account) = registered_session(&pool).await;
    set_activity(&pool, session, "idle", Duration::hours(25)).await;

    let (first, second) = tokio::join!(sweep(&repo), sweep(&repo));

    assert_eq!(first.len() + second.len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn archived_sessions_are_never_read_and_states_report_recent_ends(pool: PgPool) {
    let (repo, session, account) = registered_session(&pool).await;
    let accounts = [account.clone()];
    let long_ago = Utc::now() - Duration::hours(1);

    let states = repo.registration_states(&accounts, &[session], long_ago).await.unwrap();
    assert_eq!(states.len(), 1);
    assert!(!states[0].ended && !states[0].session_archived);
    assert!(repo.has_current_registrations(session, long_ago).await.unwrap());

    // An archive racing the end of its registrations reads as archived, not active.
    sqlx::query!(
        "UPDATE agent_session SET archived_by = 'user', archived_at = NOW() WHERE id = $1",
        session.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(repo.active_registrations(&accounts, 10).await.unwrap().is_empty());
    let states = repo.registration_states(&accounts, &[session], long_ago).await.unwrap();
    assert!(states[0].session_archived);

    repo.unregister(&account, session).await.unwrap();
    let states = repo.registration_states(&accounts, &[session], long_ago).await.unwrap();
    assert!(states[0].ended);
    let later = Utc::now() + Duration::hours(1);
    assert!(repo.registration_states(&accounts, &[session], later).await.unwrap().is_empty());
    assert!(!repo.has_current_registrations(session, later).await.unwrap());
}
