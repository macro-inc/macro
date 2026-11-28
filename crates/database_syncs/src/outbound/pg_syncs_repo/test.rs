use std::time::Duration;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_databases::ColumnId;

use super::*;
use crate::domain::models::{GranolaField, SyncField, SyncedColumn};

const ALICE: &str = "macro|alice@syncs-repo.example.com";
const BOB: &str = "macro|bob@syncs-repo.example.com";
const LEASE: Duration = Duration::from_secs(600);

async fn insert_user(pool: &PgPool, user_id: &str) {
    let email = user_id.trim_start_matches("macro|");
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)"#,
        macro_user_id,
        email,
        format!("cus_{macro_user_id}"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        user_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A database entity owned by `owner`, with one table.
async fn insert_database(pool: &PgPool, owner: &str) -> (DatabaseId, TableId) {
    let database = Uuid::now_v7();
    sqlx::query!(
        r#"WITH storage AS (INSERT INTO databases (id) VALUES ($1) RETURNING id)
           INSERT INTO database_entities (database_id, name, user_id) SELECT id, 'Meetings', $2 FROM storage"#,
        database,
        owner,
    )
    .execute(pool)
    .await
    .unwrap();
    let table = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO database_tables (id, database_id, name, position) VALUES ($1, $2, 'Meetings', 'a0')"#,
        table,
        database,
    )
    .execute(pool)
    .await
    .unwrap();
    (DatabaseId::from_uuid(database), TableId::from_uuid(table))
}

fn new_sync(
    database_id: DatabaseId,
    table_id: TableId,
    created_by: &'static str,
    source: SyncSource,
) -> NewSyncRecord {
    NewSyncRecord {
        id: Uuid::now_v7(),
        database_id,
        table_id,
        created_by: MacroUserIdStr::parse_from_str(created_by).unwrap(),
        source,
        columns: vec![SyncedColumn {
            field: SyncField::Granola {
                field: GranolaField::Title,
            },
            column: ColumnId::from_uuid(Uuid::from_u128(1)),
        }],
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sync_reads_back_as_stored_and_a_retried_insert_changes_nothing(pool: PgPool) {
    insert_user(&pool, ALICE).await;
    let (database, table) = insert_database(&pool, ALICE).await;
    let repository = PgSyncsRepo::new(pool);
    let new = new_sync(
        database,
        table,
        ALICE,
        SyncSource::NotionDataSource {
            data_source_id: NotionId::parse("0123456789abcdef0123456789abcdef").unwrap(),
        },
    );

    repository.insert_sync(new.clone()).await.unwrap();
    repository
        .insert_sync(NewSyncRecord {
            columns: vec![],
            ..new.clone()
        })
        .await
        .unwrap();

    let stored = repository.sync(new.id).await.unwrap().unwrap();
    assert_eq!(
        stored,
        DatabaseSync {
            id: new.id,
            database_id: database,
            table_id: table,
            created_by: new.created_by.clone(),
            source: new.source.clone(),
            columns: new.columns.clone(),
            detached_columns: vec![],
            status: SyncStatus::Pending,
            last_synced_at: None,
            created_at: stored.created_at,
        }
    );
    assert_eq!(
        repository.database_syncs(database).await.unwrap(),
        vec![stored]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn two_claims_never_take_one_sync_and_a_stale_lease_cannot_finish(pool: PgPool) {
    insert_user(&pool, ALICE).await;
    let (database, table) = insert_database(&pool, ALICE).await;
    let repository = PgSyncsRepo::new(pool);
    let new = new_sync(database, table, ALICE, SyncSource::GranolaMeetings);
    repository.insert_sync(new.clone()).await.unwrap();

    let first = repository.claim_due(LEASE).await.unwrap().unwrap();
    let second = repository.claim_due(LEASE).await.unwrap();
    let stale = repository
        .finish(
            new.id,
            Uuid::now_v7(),
            FinishedRun {
                columns: vec![],
                detached_columns: vec![],
                failure: None,
                next_run_in: Duration::ZERO,
            },
        )
        .await
        .unwrap();
    let finished = repository
        .finish(
            new.id,
            first.lease,
            FinishedRun {
                columns: new.columns.clone(),
                detached_columns: vec![],
                failure: Some(SyncFailure::SourceNotFound),
                next_run_in: Duration::from_secs(1800),
            },
        )
        .await
        .unwrap();

    assert_eq!(first.sync.id, new.id);
    assert_eq!(second, None);
    assert!(!stale);
    assert!(finished);
    assert_eq!(repository.claim_due(LEASE).await.unwrap(), None);
    assert_eq!(
        repository.sync(new.id).await.unwrap().unwrap().status,
        SyncStatus::Failed {
            failure: SyncFailure::SourceNotFound
        }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sync_marked_due_during_its_run_runs_again_after(pool: PgPool) {
    insert_user(&pool, ALICE).await;
    let (database, table) = insert_database(&pool, ALICE).await;
    let repository = PgSyncsRepo::new(pool);
    let new = new_sync(database, table, ALICE, SyncSource::GranolaMeetings);
    repository.insert_sync(new.clone()).await.unwrap();
    let claimed = repository.claim_due(LEASE).await.unwrap().unwrap();

    repository
        .mark_source_due(
            &MacroUserIdStr::parse_from_str(ALICE).unwrap(),
            SourceKind::GranolaMeetings,
        )
        .await
        .unwrap();
    let during = repository.claim_due(LEASE).await.unwrap();
    repository
        .finish(
            new.id,
            claimed.lease,
            FinishedRun {
                columns: new.columns.clone(),
                detached_columns: vec![],
                failure: None,
                next_run_in: Duration::from_secs(1800),
            },
        )
        .await
        .unwrap();
    let after = repository.claim_due(LEASE).await.unwrap().unwrap();

    assert_eq!(during, None);
    assert_eq!(after.sync.id, new.id);
    assert_eq!(after.sync.status, SyncStatus::Synced);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_source_change_marks_due_only_its_creators_syncs_of_that_kind(pool: PgPool) {
    insert_user(&pool, ALICE).await;
    insert_user(&pool, BOB).await;
    let (database, granola_table) = insert_database(&pool, ALICE).await;
    let (_, notion_table) = insert_database(&pool, ALICE).await;
    let (bob_database, bob_table) = insert_database(&pool, BOB).await;
    let repository = PgSyncsRepo::new(pool.clone());
    let alice_granola = new_sync(database, granola_table, ALICE, SyncSource::GranolaMeetings);
    let alice_notion = new_sync(
        database,
        notion_table,
        ALICE,
        SyncSource::NotionDataSource {
            data_source_id: NotionId::parse("0123456789abcdef0123456789abcdef").unwrap(),
        },
    );
    let bob_granola = new_sync(bob_database, bob_table, BOB, SyncSource::GranolaMeetings);
    for sync in [&alice_granola, &alice_notion, &bob_granola] {
        repository.insert_sync(sync.clone()).await.unwrap();
    }
    sqlx::query!("UPDATE database_syncs SET due_at = now() + interval '1 hour'")
        .execute(&pool)
        .await
        .unwrap();

    repository
        .mark_source_due(
            &MacroUserIdStr::parse_from_str(ALICE).unwrap(),
            SourceKind::GranolaMeetings,
        )
        .await
        .unwrap();

    assert_eq!(
        repository.claim_due(LEASE).await.unwrap().unwrap().sync.id,
        alice_granola.id
    );
    assert_eq!(repository.claim_due(LEASE).await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rows_are_reserved_then_recorded_and_go_with_the_table(pool: PgPool) {
    insert_user(&pool, ALICE).await;
    let (database, table) = insert_database(&pool, ALICE).await;
    let repository = PgSyncsRepo::new(pool.clone());
    let new = new_sync(database, table, ALICE, SyncSource::GranolaMeetings);
    repository.insert_sync(new.clone()).await.unwrap();
    let kickoff = RowId::from_uuid(Uuid::now_v7());
    let review = RowId::from_uuid(Uuid::now_v7());

    repository
        .reserve_rows(
            new.id,
            &[
                ("note_kickoff".to_string(), kickoff),
                ("note_review".to_string(), review),
            ],
        )
        .await
        .unwrap();
    repository
        .record_rows(new.id, &[("note_kickoff".to_string(), kickoff, [7; 32])])
        .await
        .unwrap();
    let mut mappings = repository.row_mappings(new.id).await.unwrap();
    mappings.sort_by(|left, right| left.external_id.cmp(&right.external_id));

    assert_eq!(
        mappings,
        vec![
            RowMapping {
                external_id: "note_kickoff".to_string(),
                row_id: kickoff,
                fingerprint: Some([7; 32]),
            },
            RowMapping {
                external_id: "note_review".to_string(),
                row_id: review,
                fingerprint: None,
            },
        ]
    );

    repository
        .forget_rows(new.id, &["note_review".to_string()])
        .await
        .unwrap();
    assert_eq!(repository.row_mappings(new.id).await.unwrap().len(), 1);

    sqlx::query!("DELETE FROM database_tables WHERE id = $1", table.as_uuid())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(repository.sync(new.id).await.unwrap(), None);
    assert!(repository.row_mappings(new.id).await.unwrap().is_empty());
}
