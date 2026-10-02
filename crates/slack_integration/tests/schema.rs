//! Migration-level contract tests. Raw SQL is intentional here: these scripts
//! exercise DDL, deferred constraints and invalid SQL shapes, not adapter queries.
#![cfg(feature = "postgres")]

use sqlx::{PgPool, Postgres, Transaction};

const TEAM: &str = "019a0000-0000-7000-8000-000000000001";
const JOB: &str = "019a0000-0000-7000-8000-000000000002";
const CHANNEL: &str = "019a0000-0000-7000-8000-000000000003";
const MESSAGE: &str = "019a0000-0000-7000-8000-000000000004";
const CANDIDATE: &str = "019a0000-0000-7000-8000-000000000005";
const EMPTY_HASH: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

async fn execute(tx: &mut Transaction<'_, Postgres>, script: &str) {
    sqlx::raw_sql(script)
        .execute(&mut **tx)
        .await
        .unwrap_or_else(|error| panic!("SQL failed: {error}\n{script}"));
}

async fn rejects(tx: &mut Transaction<'_, Postgres>, script: &str, code: &str) {
    execute(tx, "SAVEPOINT expected_failure").await;
    let error = sqlx::raw_sql(script)
        .execute(&mut **tx)
        .await
        .expect_err("invalid schema mutation must fail");
    assert_eq!(
        error.as_database_error().unwrap().code().as_deref(),
        Some(code),
        "{error}: {script}"
    );
    execute(
        tx,
        "ROLLBACK TO SAVEPOINT expected_failure; RELEASE SAVEPOINT expected_failure",
    )
    .await;
}

async fn fixture(pool: &PgPool) -> Transaction<'_, Postgres> {
    fixture_with_history(pool, true).await
}

async fn fixture_with_history(pool: &PgPool, history: bool) -> Transaction<'_, Postgres> {
    let mut tx = pool.begin().await.unwrap();
    execute(&mut tx, &format!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ('{TEAM}', 'schema', 'schema@example.com', 'schema-customer');
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ('macro|schema@example.com', 'schema@example.com', '{TEAM}');
        INSERT INTO team (id, name, owner_id) VALUES ('{TEAM}', 'Schema', 'macro|schema@example.com');
        INSERT INTO import_source_binding (team_id, confirmed_unknown_at) VALUES ('{TEAM}', now());
        INSERT INTO slack_import_job
            (id, team_id, user_id, idempotency_token, request_sha256, confirmed_unknown, include_message_history)
        VALUES ('{JOB}', '{TEAM}', 'macro|schema@example.com', '{JOB}', repeat('a', 64), true, {history});
        INSERT INTO slack_import_conversation
            (job_id, slack_channel_id, kind, name, folder, member_ids, archived)
        VALUES ('{JOB}', 'C123', 'public_channel', 'general', 'general', ARRAY['U123'], false);
        INSERT INTO comms_channels (id, name, channel_type, owner_id)
        VALUES ('{CHANNEL}', 'Imported private', 'private', 'macro|schema@example.com');
        INSERT INTO import_target_reservation (team_id, source, foreign_id, candidate_channel_id)
        VALUES ('{TEAM}', 'slack', 'C123', '{CANDIDATE}');
        "#
    )).await;
    tx
}

fn users_upload() -> String {
    format!(
        "INSERT INTO slack_import_upload (job_id, object_key, sha256, byte_length)
             VALUES ('{JOB}', 'slack-import/users.json', repeat('a', 64), 10)"
    )
}

fn part_upload(index: u32) -> String {
    format!("INSERT INTO slack_import_upload
             (job_id, slack_channel_id, part_index, object_key, sha256, byte_length, record_count)
             VALUES ('{JOB}', 'C123', {index}, 'slack-import/{index}.ndjson', repeat('b', 64), 20, 1)")
}

fn mapping() -> String {
    format!("INSERT INTO slack_import_message_map (team_id, slack_channel_id, slack_ts, message_id, channel_id)
             VALUES ('{TEAM}', 'C123', 1700000000000001, '{MESSAGE}', '{CHANNEL}')")
}

fn message() -> String {
    format!(
        "INSERT INTO comms_messages (id, channel_id, sender_id, content)
             VALUES ('{MESSAGE}', '{CHANNEL}', 'macro|schema@example.com', 'Historical message')"
    )
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn natural_keys_and_old_ledger_writers_remain_compatible(pool: PgPool) {
    let mut tx = fixture(&pool).await;
    for initiator in ["onboarding", "chat", "archive"] {
        execute(
            &mut tx,
            &format!(
                "INSERT INTO import_entity (user_id, source, foreign_id, initiator)
             VALUES ('macro|schema@example.com', 'slack', '{initiator}', '{initiator}')"
            ),
        )
        .await;
    }
    let duplicates = [
        format!("INSERT INTO import_source_binding (team_id, slack_workspace_id) VALUES ('{TEAM}', 'T123')"),
        format!("INSERT INTO import_target_reservation (team_id, source, foreign_id, candidate_channel_id)
                 VALUES ('{TEAM}', 'slack', 'C123', '{CHANNEL}')"),
        format!("INSERT INTO slack_import_job
                 (id, team_id, user_id, idempotency_token, request_sha256, confirmed_unknown, include_message_history)
                 VALUES ('{MESSAGE}', '{TEAM}', 'macro|schema@example.com', '{JOB}', repeat('a', 64), true, true)"),
        format!("INSERT INTO slack_import_conversation
                 (job_id, slack_channel_id, kind, name, folder, member_ids, archived)
                 VALUES ('{JOB}', 'C123', 'public_channel', 'other', 'other', '{{}}', false)"),
    ];
    for statement in duplicates {
        rejects(&mut tx, &statement, "23505").await;
    }
    execute(&mut tx, &users_upload()).await;
    rejects(&mut tx, &users_upload(), "23505").await;
    execute(&mut tx, &part_upload(0)).await;
    rejects(&mut tx, &part_upload(0), "23505").await;
    execute(&mut tx, &mapping()).await;
    execute(&mut tx, &message()).await;
    rejects(&mut tx, &mapping(), "23505").await;
    execute(
        &mut tx,
        &format!(
            "INSERT INTO slack_import_outbox (job_id, slack_channel_id, kind, generation)
         VALUES ('{JOB}', 'C123', 'import', 1), ('{JOB}', 'C123', 'search', 1)"
        ),
    )
    .await;
    rejects(
        &mut tx,
        &format!(
            "INSERT INTO slack_import_outbox (job_id, slack_channel_id, kind, generation)
         VALUES ('{JOB}', 'C123', 'import', 1)"
        ),
        "23505",
    )
    .await;
    tx.commit().await.unwrap();
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn upload_descriptors_verification_and_seals_are_immutable(pool: PgPool) {
    let mut tx = fixture(&pool).await;
    execute(&mut tx, &users_upload()).await;
    execute(&mut tx, &part_upload(0)).await;
    for change in [
        "sha256 = repeat('c', 64)",
        "byte_length = 21",
        "part_index = 1",
        "object_key = 'changed'",
    ] {
        rejects(
            &mut tx,
            &format!("UPDATE slack_import_upload SET {change} WHERE slack_channel_id = 'C123'"),
            "23514",
        )
        .await;
    }
    rejects(
        &mut tx,
        "UPDATE slack_import_upload SET verified_at = now()",
        "23514",
    )
    .await;
    execute(
        &mut tx,
        "UPDATE slack_import_upload SET verified_at = now(), verified_etag = 'pinned-etag'",
    )
    .await;
    rejects(
        &mut tx,
        "UPDATE slack_import_upload SET verified_etag = 'replacement'",
        "23514",
    )
    .await;
    rejects(&mut tx, "DELETE FROM slack_import_upload", "23514").await;
    rejects(&mut tx, &format!(
        "UPDATE slack_import_conversation SET sealed_at = now(), part_count = 0, manifest_sha256 = '{EMPTY_HASH}'"
    ), "23514").await;
    execute(
        &mut tx,
        "UPDATE slack_import_conversation SET sealed_at = now(), part_count = 1,
         manifest_sha256 = encode(digest('0:' || repeat('b', 64) || E':20:1\n', 'sha256'), 'hex')",
    )
    .await;
    rejects(&mut tx, &part_upload(1), "23514").await;
    rejects(&mut tx, "UPDATE slack_import_conversation SET sealed_at = NULL, part_count = NULL, manifest_sha256 = NULL", "23514").await;
    rejects(
        &mut tx,
        "UPDATE slack_import_conversation SET member_ids = ARRAY['U999']",
        "23514",
    )
    .await;
    execute(
        &mut tx,
        "UPDATE slack_import_job SET registration_closed_at = now(), finalized_at = now()",
    )
    .await;
    rejects(
        &mut tx,
        "UPDATE slack_import_job SET registration_closed_at = NULL",
        "23514",
    )
    .await;
    // Exact verification retries can still observe the pinned identity after closure.
    execute(
        &mut tx,
        "UPDATE slack_import_upload SET verified_etag = verified_etag",
    )
    .await;
    tx.commit().await.unwrap();
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn shape_only_empty_seals_gaps_and_closed_registration(pool: PgPool) {
    let mut tx = fixture(&pool).await;
    execute(&mut tx, &part_upload(1)).await;
    rejects(
        &mut tx,
        "UPDATE slack_import_conversation SET sealed_at = now(), part_count = 1,
         manifest_sha256 = encode(digest('1:' || repeat('b', 64) || E':20:1\n', 'sha256'), 'hex')",
        "23514",
    )
    .await;
    tx.rollback().await.unwrap();

    let mut tx = fixture_with_history(&pool, false).await;
    rejects(&mut tx, &part_upload(0), "23514").await;
    execute(&mut tx, &users_upload()).await;
    execute(&mut tx, &format!(
        "UPDATE slack_import_conversation SET sealed_at = now(), part_count = 0, manifest_sha256 = '{EMPTY_HASH}'"
    )).await;
    execute(
        &mut tx,
        "UPDATE slack_import_job SET registration_closed_at = now(), finalized_at = now()",
    )
    .await;
    rejects(
        &mut tx,
        "UPDATE slack_import_upload SET verified_at = now(), verified_version_id = 'version'",
        "23514",
    )
    .await;
    rejects(&mut tx, &part_upload(0), "23514").await;
    tx.commit().await.unwrap();
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn leases_counters_search_and_reservations_have_valid_shapes(pool: PgPool) {
    let mut tx = fixture(&pool).await;
    for change in [
        "status = 'invalid'",
        "status = 'importing'",
        "processed = 1",
        "attempts = -1",
        "part_count = 0",
        "checkpoint_record = -1",
        "search_state = 'submitted'",
        "search_submitted_generation = 1",
        "lease_generation = -1",
    ] {
        rejects(
            &mut tx,
            &format!("UPDATE slack_import_conversation SET {change}"),
            "23514",
        )
        .await;
    }
    execute(&mut tx, &format!(
        "UPDATE slack_import_conversation SET status = 'importing', lease_owner = '{JOB}', lease_token = '{MESSAGE}',
         lease_generation = 1, lease_expires_at = now() + interval '5 minutes', heartbeat_at = now(), attempts = 1,
         processed = 3, imported = 1, duplicates = 1, skipped = 1, reactions = 2,
         search_state = 'submitted', search_dirty_generation = 1, search_submitted_generation = 1, search_receipt_id = '{JOB}'"
    )).await;
    rejects(
        &mut tx,
        &format!("UPDATE import_target_reservation SET candidate_channel_id = '{CHANNEL}'"),
        "23514",
    )
    .await;
    rejects(
        &mut tx,
        "UPDATE import_target_reservation SET state = 'ready'",
        "23514",
    )
    .await;
    execute(
        &mut tx,
        &format!("UPDATE import_target_reservation SET state = 'ready', channel_id = '{CHANNEL}'"),
    )
    .await;
    rejects(
        &mut tx,
        "UPDATE import_target_reservation SET state = 'pending', channel_id = NULL",
        "23514",
    )
    .await;
    execute(
        &mut tx,
        "UPDATE import_source_binding SET slack_workspace_id = 'T123'",
    )
    .await;
    rejects(
        &mut tx,
        "UPDATE import_source_binding SET slack_workspace_id = 'T456'",
        "23514",
    )
    .await;
    rejects(
        &mut tx,
        "UPDATE import_source_binding SET slack_workspace_id = NULL",
        "23514",
    )
    .await;
    rejects(
        &mut tx,
        "UPDATE slack_import_job SET include_message_history = false",
        "23514",
    )
    .await;
    rejects(&mut tx, &format!(
        "INSERT INTO slack_import_conversation
         (job_id, slack_channel_id, kind, name, folder, member_ids, archived, sealed_at, part_count, manifest_sha256)
         VALUES ('{JOB}', 'C456', 'public_channel', 'other', 'other', '{{}}', false, now(), 0, '{EMPTY_HASH}')"
    ), "23514").await;
    rejects(
        &mut tx,
        "UPDATE slack_import_job SET status = 'cancelled'",
        "23514",
    )
    .await;
    // Private channels must still have no team_id. Provenance is import-owned.
    rejects(
        &mut tx,
        &format!("UPDATE comms_channels SET team_id = '{TEAM}'"),
        "23514",
    )
    .await;
    tx.commit().await.unwrap();
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn message_fk_is_deferred_and_checks_parent_identity(pool: PgPool) {
    let mut tx = fixture(&pool).await;
    execute(&mut tx, &mapping()).await;
    rejects(&mut tx, "SET CONSTRAINTS ALL IMMEDIATE", "23503").await;
    execute(&mut tx, &message()).await;
    execute(&mut tx, "SET CONSTRAINTS ALL IMMEDIATE").await;
    rejects(
        &mut tx,
        &format!("UPDATE slack_import_message_map SET channel_id = '{CANDIDATE}'"),
        "23503",
    )
    .await;
    rejects(
        &mut tx,
        "UPDATE slack_import_message_map SET slack_ts = -1",
        "23514",
    )
    .await;
    // A failed enclosing batch leaves neither history nor its dedupe key behind.
    tx.rollback().await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    execute(
        &mut tx,
        "DO $$ BEGIN
         ASSERT NOT EXISTS (SELECT FROM slack_import_message_map);
         ASSERT NOT EXISTS (SELECT FROM comms_messages);
         END $$",
    )
    .await;
    tx.commit().await.unwrap();
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn job_cleanup_preserves_history_and_provenance_channel_cleanup_is_deliberate(pool: PgPool) {
    let mut tx = fixture(&pool).await;
    execute(&mut tx, &users_upload()).await;
    execute(&mut tx, &part_upload(0)).await;
    execute(&mut tx, &mapping()).await;
    execute(&mut tx, &message()).await;
    execute(&mut tx, &format!(
        "UPDATE import_target_reservation SET state = 'ready', channel_id = '{CHANNEL}';
         INSERT INTO slack_import_outbox (job_id, slack_channel_id, kind, generation) VALUES ('{JOB}', 'C123', 'search', 1);
         INSERT INTO slack_import_message_reference
             (job_id, slack_channel_id, message_id, channel_id, importer_version, template)
         VALUES ('{JOB}', 'C123', '{MESSAGE}', '{CHANNEL}', 1,
             jsonb_build_object('body', '#source', 'references', jsonb_build_array(jsonb_build_object('kind', 'channel'))));
         DELETE FROM slack_import_job WHERE id = '{JOB}';"
    )).await;
    execute(
        &mut tx,
        "DO $$ BEGIN
         ASSERT NOT EXISTS (SELECT FROM slack_import_conversation);
         ASSERT NOT EXISTS (SELECT FROM slack_import_upload);
         ASSERT NOT EXISTS (SELECT FROM slack_import_outbox);
         ASSERT NOT EXISTS (SELECT FROM slack_import_message_reference);
         ASSERT (SELECT count(*) = 1 FROM slack_import_message_map);
         ASSERT (SELECT count(*) = 1 FROM import_source_binding);
         ASSERT (SELECT count(*) = 1 FROM import_target_reservation);
         ASSERT (SELECT count(*) = 1 FROM comms_messages);
         END $$",
    )
    .await;
    execute(
        &mut tx,
        &format!("DELETE FROM comms_channels WHERE id = '{CHANNEL}'"),
    )
    .await;
    execute(
        &mut tx,
        "DO $$ BEGIN
         ASSERT NOT EXISTS (SELECT FROM slack_import_message_map);
         ASSERT NOT EXISTS (SELECT FROM import_target_reservation);
         ASSERT (SELECT count(*) = 1 FROM import_source_binding);
         END $$",
    )
    .await;
    tx.commit().await.unwrap();
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn reference_templates_are_bounded_and_completion_releases_payload(pool: PgPool) {
    let mut tx = fixture(&pool).await;
    execute(&mut tx, &format!(
        "INSERT INTO slack_import_message_reference
             (job_id, slack_channel_id, message_id, channel_id, importer_version, template)
         VALUES ('{JOB}', 'C123', '{MESSAGE}', '{CHANNEL}', 1,
             jsonb_build_object('body', '#source', 'references', jsonb_build_array(jsonb_build_object('kind', 'channel'))))"
    )).await;
    for change in [
        "importer_version = 0",
        "template = NULL",
        "completed_at = now()",
        "template = jsonb_build_object('references', '[]'::jsonb)",
        "template = jsonb_build_object('references', (SELECT jsonb_agg(i) FROM generate_series(1, 257) i))",
        "template = jsonb_build_object('references', '[1]'::jsonb, 'body', repeat('x', 4194304))",
    ] {
        rejects(
            &mut tx,
            &format!("UPDATE slack_import_message_reference SET {change}"),
            "23514",
        )
        .await;
    }
    execute(
        &mut tx,
        "UPDATE slack_import_message_reference SET completed_at = now(), template = NULL",
    )
    .await;
    rejects(
        &mut tx,
        "UPDATE slack_import_message_reference SET completed_at = NULL",
        "23514",
    )
    .await;
    tx.commit().await.unwrap();
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn team_cleanup_does_not_delete_private_history(pool: PgPool) {
    let mut tx = fixture(&pool).await;
    execute(&mut tx, &mapping()).await;
    execute(&mut tx, &message()).await;
    execute(&mut tx, &users_upload()).await;
    execute(&mut tx, &format!("DELETE FROM team WHERE id = '{TEAM}'")).await;
    execute(
        &mut tx,
        "DO $$ BEGIN
         ASSERT NOT EXISTS (SELECT FROM slack_import_job);
         ASSERT NOT EXISTS (SELECT FROM slack_import_upload);
         ASSERT NOT EXISTS (SELECT FROM slack_import_message_map);
         ASSERT NOT EXISTS (SELECT FROM import_source_binding);
         ASSERT NOT EXISTS (SELECT FROM import_target_reservation);
         ASSERT (SELECT count(*) = 1 FROM comms_channels);
         ASSERT (SELECT count(*) = 1 FROM comms_messages);
         END $$",
    )
    .await;
    tx.commit().await.unwrap();
}
