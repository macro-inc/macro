use super::*;
use crate::domain::model::FileChangeKind;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const OWNER: &str = "macro|changes-owner@example.com";

/// A session row for the summary row's foreign key, with the user and bot
/// rows it needs in turn.
async fn seed_session(pool: &PgPool) -> AgentSessionId {
    let email = OWNER.strip_prefix("macro|").unwrap_or(OWNER);
    let macro_user_id = sqlx::query_scalar!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
        RETURNING id
        "#,
        macro_uuid::generate_uuid_v7(),
        email,
        email,
        format!("stripe_{email}"),
    )
    .fetch_one(pool)
    .await
    .expect("insert macro_user");
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING"#,
        OWNER,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await
    .expect("insert User");
    let bot_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"INSERT INTO bots (id, kind, name, handle, has_agent, owner_user_id) VALUES ($1, 'owned', 'Changes Bot', $2, true, $3)"#,
        bot_id,
        format!("changes-bot-{}", bot_id.simple()),
        OWNER,
    )
    .execute(pool)
    .await
    .expect("insert bot");
    let session = AgentSessionId::new();
    sqlx::query!(
        r#"
        INSERT INTO agent_session (id, owner_id, bot_id, model, harness, repo_url, workspace, name)
        VALUES ($1, $2, $3, 'claude', 'macrod', 'https://github.com/example/example', '/workspace', 'Changes')
        "#,
        session.as_uuid(),
        OWNER,
        bot_id,
    )
    .execute(pool)
    .await
    .expect("insert agent_session");
    session
}

fn changeset(session: AgentSessionId) -> Changeset {
    Changeset {
        id: ChangesetId::new(),
        session,
        source: ChangesetSource::MacrodGit,
        range: ChangesetRange {
            repository: Some("https://github.com/example/example".to_owned()),
            base: GitRef {
                name: Some("main".to_owned()),
                sha: Some("aaa".to_owned()),
            },
            head: GitRef {
                name: Some("agent/work".to_owned()),
                sha: None,
            },
        },
        files: vec![ChangedFile {
            path: "src/lib.rs".to_owned(),
            previous_path: None,
            kind: FileChangeKind::Modified,
            additions: 3,
            deletions: 1,
            binary: false,
            patch_omitted: false,
        }],
        additions: 3,
        deletions: 1,
        patch_bytes: 120,
        truncated: false,
        captured_at: Utc::now(),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_session_without_captures_reads_as_empty(pool: PgPool) {
    let repo = PgChangesetRepo::new(pool.clone());
    let session = seed_session(&pool).await;
    assert_eq!(repo.get(session).await.unwrap(), SessionChanges::default());
    assert!(repo.patch_key(session).await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_attempt_is_visible_while_it_runs_and_when_it_ends(pool: PgPool) {
    let repo = PgChangesetRepo::new(pool.clone());
    let session = seed_session(&pool).await;
    let started = Utc::now();
    repo.begin_attempt(session, started).await.unwrap();

    let running = repo.get(session).await.unwrap();
    assert!(running.changeset.is_none());
    let attempt = running.attempt.expect("the attempt is recorded");
    assert!(attempt.in_flight());
    assert_eq!(
        attempt.started_at.timestamp_millis(),
        started.timestamp_millis()
    );

    repo.record_failure(
        session,
        AttemptOutcome::NotReady,
        Some("not yet"),
        Utc::now(),
    )
    .await
    .unwrap();
    let attempt = repo.get(session).await.unwrap().attempt.unwrap();
    assert!(!attempt.in_flight());
    assert_eq!(attempt.outcome, Some(AttemptOutcome::NotReady));
    assert_eq!(attempt.error.as_deref(), Some("not yet"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_captured_changeset_round_trips_and_reports_what_it_superseded(pool: PgPool) {
    let repo = PgChangesetRepo::new(pool.clone());
    let session = seed_session(&pool).await;
    repo.begin_attempt(session, Utc::now()).await.unwrap();

    let first = changeset(session);
    let first_key = PatchBlobKey::for_changeset(session, first.id);
    let superseded = repo
        .record_changeset(&first, Some(&first_key), Utc::now())
        .await
        .unwrap();
    assert!(superseded.is_none(), "nothing came before");

    let stored = repo.get(session).await.unwrap();
    let stored_changeset = stored.changeset.expect("captured");
    assert_eq!(stored_changeset.id, first.id);
    assert_eq!(stored_changeset.files, first.files);
    assert_eq!(stored_changeset.range, first.range);
    assert_eq!(
        (stored_changeset.additions, stored_changeset.deletions),
        (3, 1)
    );
    assert_eq!(stored_changeset.patch_bytes, 120);
    assert_eq!(
        stored.attempt.unwrap().outcome,
        Some(AttemptOutcome::Captured)
    );
    assert_eq!(
        repo.patch_key(session).await.unwrap(),
        Some(first_key.clone())
    );

    let mut second = changeset(session);
    second.files.clear();
    second.patch_bytes = 0;
    let superseded = repo
        .record_changeset(&second, None, Utc::now())
        .await
        .unwrap();
    assert_eq!(
        superseded,
        Some(first_key),
        "the old patch is reported for cleanup"
    );
    assert!(repo.patch_key(session).await.unwrap().is_none());
    assert!(
        repo.get(session)
            .await
            .unwrap()
            .changeset
            .unwrap()
            .files
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failed_attempt_keeps_the_previous_changeset(pool: PgPool) {
    let repo = PgChangesetRepo::new(pool.clone());
    let session = seed_session(&pool).await;
    let first = changeset(session);
    repo.record_changeset(&first, None, Utc::now())
        .await
        .unwrap();

    repo.begin_attempt(session, Utc::now()).await.unwrap();
    repo.record_failure(session, AttemptOutcome::Failed, Some("boom"), Utc::now())
        .await
        .unwrap();

    let stored = repo.get(session).await.unwrap();
    assert_eq!(stored.changeset.map(|c| c.id), Some(first.id));
    let attempt = stored.attempt.unwrap();
    assert_eq!(attempt.outcome, Some(AttemptOutcome::Failed));
    assert_eq!(attempt.error.as_deref(), Some("boom"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_the_session_takes_its_changes_with_it(pool: PgPool) {
    let repo = PgChangesetRepo::new(pool.clone());
    let session = seed_session(&pool).await;
    repo.record_changeset(&changeset(session), None, Utc::now())
        .await
        .unwrap();
    sqlx::query!("DELETE FROM agent_session WHERE id = $1", session.as_uuid())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(repo.get(session).await.unwrap(), SessionChanges::default());
}
