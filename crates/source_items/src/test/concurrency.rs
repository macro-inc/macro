//! Two transactions changing inputs of one item, with each interleaving forced: both write, then
//! they commit in either order or together. Rows change at commit, under the item's bucket, so
//! every order must leave them exact. The last tests replay lock orders that real writers use and
//! check the projection makes no transaction wait on another one it did not wait on before.

use super::{DOC, DOC_2, MEMBER, OWNER, assert_exact, grant, insert_document, row, rows};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{PgConnection, PgPool, Postgres, Transaction};

/// The ways two open transactions can reach commit.
#[derive(Debug, Clone, Copy)]
enum Commit {
    FirstThenSecond,
    SecondThenFirst,
    Together,
}

const COMMITS: [Commit; 3] = [
    Commit::FirstThenSecond,
    Commit::SecondThenFirst,
    Commit::Together,
];

async fn commit(
    order: Commit,
    one: Transaction<'_, Postgres>,
    two: Transaction<'_, Postgres>,
) -> Result<(), sqlx::Error> {
    match order {
        Commit::FirstThenSecond => {
            one.commit().await?;
            two.commit().await
        }
        Commit::SecondThenFirst => {
            two.commit().await?;
            one.commit().await
        }
        Commit::Together => {
            let (one, two) = tokio::join!(one.commit(), two.commit());
            one.and(two)
        }
    }
}

/// Runs `first` in one transaction and `second` in another while the first is open, then commits
/// them in `order`.
async fn race<F, S>(pool: &PgPool, order: Commit, first: F, second: S) -> Result<(), sqlx::Error>
where
    F: AsyncFnOnce(&mut PgConnection) -> Result<(), sqlx::Error>,
    S: AsyncFnOnce(&mut PgConnection) -> Result<(), sqlx::Error>,
{
    let mut one = pool.begin().await?;
    first(&mut one).await?;
    let mut two = pool.begin().await?;
    second(&mut two).await?;
    commit(order, one, two).await
}

async fn reset(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query!(r#"TRUNCATE "Document", entity_access CASCADE"#)
        .execute(pool)
        .await?;
    Ok(())
}

async fn insert(c: &mut PgConnection) -> Result<(), sqlx::Error> {
    insert_document(c, DOC, "2026-01-01 00:00:00").await
}

async fn share(c: &mut PgConnection) -> Result<(), sqlx::Error> {
    grant(c, "document", DOC, OWNER, "user").await
}

async fn revoke(c: &mut PgConnection) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "DELETE FROM entity_access WHERE entity_id = $1::text::uuid",
        DOC
    )
    .execute(c)
    .await?;
    Ok(())
}

/// Moving a grant is not a key update: entity_access's unique indexes are partial.
async fn move_away(c: &mut PgConnection) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "UPDATE entity_access SET entity_id = $2::text::uuid WHERE entity_id = $1::text::uuid",
        DOC,
        DOC_2,
    )
    .execute(c)
    .await?;
    Ok(())
}

async fn save(c: &mut PgConnection) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"UPDATE "Document" SET "updatedAt" = '2026-02-01 00:00:00' WHERE id = $1"#,
        DOC
    )
    .execute(c)
    .await?;
    Ok(())
}

async fn make_task(c: &mut PgConnection) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "INSERT INTO document_sub_type (document_id, sub_type) VALUES ($1, 'task')",
        DOC
    )
    .execute(c)
    .await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_item_insert_and_a_grant_on_it_count_once_in_any_order(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    for order in COMMITS {
        reset(&pool).await?;
        race(&pool, order, insert, share).await?;
        assert_eq!(
            rows(&mut *pool.acquire().await?, DOC).await?,
            [row(OWNER, "document", Some("2026-01-01 00:00:00"), 1)],
            "insert, then share: {order:?}"
        );
        reset(&pool).await?;
        race(&pool, order, share, insert).await?;
        assert_eq!(
            rows(&mut *pool.acquire().await?, DOC).await?,
            [row(OWNER, "document", Some("2026-01-01 00:00:00"), 1)],
            "share, then insert: {order:?}"
        );
    }
    assert_exact(&pool).await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_or_moving_a_grant_while_its_item_is_inserted_leaves_no_row(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    for order in COMMITS {
        for name in ["revoke", "move"] {
            reset(&pool).await?;
            share(&mut *pool.acquire().await?).await?;
            if name == "revoke" {
                race(&pool, order, insert, revoke).await?;
            } else {
                race(&pool, order, insert, move_away).await?;
            }
            assert_eq!(
                rows(&mut *pool.acquire().await?, DOC).await?,
                [],
                "{name}: {order:?}"
            );
            assert_exact(&pool).await?;
        }
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn saves_subtypes_and_grants_on_one_item_compose_in_any_order(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    for order in COMMITS {
        reset(&pool).await?;
        insert(&mut *pool.acquire().await?).await?;
        race(&pool, order, save, share).await?;
        assert_eq!(
            rows(&mut *pool.acquire().await?, DOC).await?,
            [row(OWNER, "document", Some("2026-02-01 00:00:00"), 1)],
            "save, then share: {order:?}"
        );
        race(&pool, order, make_task, async |c| {
            grant(c, "document", DOC, MEMBER, "user").await
        })
        .await?;
        assert_eq!(
            rows(&mut *pool.acquire().await?, DOC).await?,
            [
                row(MEMBER, "task", Some("2026-02-01 00:00:00"), 1),
                row(OWNER, "task", Some("2026-02-01 00:00:00"), 1),
            ],
            "subtype, then share: {order:?}"
        );
        assert_exact(&pool).await?;
    }
    Ok(())
}

/// Fails the second transaction's statement if it has to wait at all.
async fn no_wait(c: &mut PgConnection) -> Result<(), sqlx::Error> {
    sqlx::query!("SET LOCAL lock_timeout = '1s'")
        .execute(c)
        .await?;
    Ok(())
}

/// A writer holding an item's row lock used to make a grant statement on that item wait, which
/// deadlocked writers that touch the grant afterwards: here, a document edit that saves, then
/// changes the same grant a concurrent share added.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_share_does_not_wait_for_an_edit_holding_the_item(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    insert(&mut *pool.acquire().await?).await?;
    let mut edit = pool.begin().await?;
    save(&mut edit).await?;

    let mut shared = pool.begin().await?;
    no_wait(&mut shared).await?;
    share(&mut shared).await?;
    shared.commit().await?;

    sqlx::query!(
        "UPDATE entity_access SET access_level = 'edit' WHERE entity_id = $1::text::uuid",
        DOC
    )
    .execute(&mut *edit)
    .await?;
    edit.commit().await?;
    assert_eq!(
        rows(&mut *pool.acquire().await?, DOC).await?,
        [row(OWNER, "document", Some("2026-02-01 00:00:00"), 1)]
    );
    assert_exact(&pool).await
}

/// The reverse order: a revoke holds the grant row, an edit saves the item and then waits for that
/// grant. The revoke must commit without waiting for the edit.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_revoke_does_not_wait_for_an_edit_that_waits_for_it(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    insert(&mut *pool.acquire().await?).await?;
    share(&mut *pool.acquire().await?).await?;
    let mut revoking = pool.begin().await?;
    no_wait(&mut revoking).await?;
    revoke(&mut revoking).await?;

    let edit = async {
        let mut edit = pool.begin().await?;
        save(&mut edit).await?;
        // Waits for the revoke, as it always has.
        sqlx::query!(
            "UPDATE entity_access SET access_level = 'edit' WHERE entity_id = $1::text::uuid",
            DOC
        )
        .execute(&mut *edit)
        .await?;
        edit.commit().await
    };
    let revoke_then_commit = async {
        wait_for_lock_waiters(&pool).await?;
        revoking.commit().await
    };
    let (edit, revoked) = tokio::join!(edit, revoke_then_commit);
    revoked?;
    edit?;
    assert_eq!(rows(&mut *pool.acquire().await?, DOC).await?, []);
    assert_exact(&pool).await
}

/// A bulk update that visits items in one order against a bulk share of the same items: the share
/// commits while the update still holds its rows.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_bulk_share_does_not_wait_for_a_bulk_update(pool: PgPool) -> Result<(), sqlx::Error> {
    {
        let mut conn = pool.acquire().await?;
        insert_document(&mut conn, DOC, "2026-01-01 00:00:00").await?;
        insert_document(&mut conn, DOC_2, "2026-01-01 00:00:00").await?;
    }
    let mut deleting = pool.begin().await?;
    sqlx::query!(
        r#"UPDATE "Document" SET "deletedAt" = now() WHERE id = ANY($1)"#,
        &[DOC_2.to_owned(), DOC.to_owned()],
    )
    .execute(&mut *deleting)
    .await?;

    let mut sharing = pool.begin().await?;
    no_wait(&mut sharing).await?;
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           SELECT id::uuid, 'document', $1, 'user', 'view' FROM "Document""#,
        MEMBER,
    )
    .execute(&mut *sharing)
    .await?;
    sharing.commit().await?;
    deleting.commit().await?;
    assert!(
        rows(&mut *pool.acquire().await?, DOC)
            .await?
            .iter()
            .all(|row| row.sort_ts.is_none())
    );
    assert_exact(&pool).await
}

/// Waits until some backend waits on a lock. PostgreSQL has no notification for this, so the wait
/// runs server side, as PostgreSQL's own isolation tester does.
async fn wait_for_lock_waiters(pool: &PgPool) -> Result<(), sqlx::Error> {
    let mut conn = pool.acquire().await?;
    sqlx::query!("SET statement_timeout = '20s'")
        .execute(&mut *conn)
        .await?;
    sqlx::query!(
        "DO $$ BEGIN
             WHILE NOT EXISTS (
                 SELECT 1 FROM pg_stat_activity
                 WHERE datname = current_database() AND wait_event_type = 'Lock'
             ) LOOP
                 PERFORM pg_sleep(0.005);
                 -- pg_stat_activity is read once per transaction unless cleared.
                 PERFORM pg_stat_clear_snapshot();
             END LOOP;
         END $$"
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn large_writes_take_no_advisory_locks(pool: PgPool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    // 5,000 single-item inserts in one transaction, like a large folder upload.
    for n in 0..5_000 {
        insert_document(
            &mut tx,
            &format!("10000000-0000-4000-8000-{n:012}"),
            "2026-01-01 00:00:00",
        )
        .await?;
    }
    // Grants on those items and on 5,000 items nobody inserted.
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           SELECT (p || lpad(n::text, 12, '0'))::uuid, 'document', $1, 'user', 'view'
           FROM generate_series(0, 4999) n,
                unnest(ARRAY['10000000-0000-4000-8000-', '20000000-0000-4000-8000-']) p"#,
        OWNER,
    )
    .execute(&mut *tx)
    .await?;
    let advisory = sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM pg_locks
           WHERE locktype = 'advisory' AND pid = pg_backend_pid()"#
    )
    .fetch_one(&mut *tx)
    .await?;
    assert_eq!(advisory, 0);
    tx.commit().await?;
    let projected = sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM source_items"#)
        .fetch_one(&pool)
        .await?;
    assert_eq!(projected, 5_000);
    assert_exact(&pool).await
}

/// A deferred constraint check queued after a write must run before the commit takes buckets:
/// here it waits for a row another transaction holds while that transaction commits a write to the
/// same item.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deferred_checks_run_before_the_commit_takes_buckets(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    {
        let mut conn = pool.acquire().await?;
        insert(&mut conn).await?;
        insert_document(&mut conn, DOC_2, "2026-01-01 00:00:00").await?;
        sqlx::query!(
            r#"CREATE TABLE deferred_reference (
                   document_id text REFERENCES "Document" (id) DEFERRABLE INITIALLY DEFERRED
               )"#
        )
        .execute(&mut *conn)
        .await?;
    }
    let mut holder = pool.begin().await?;
    sqlx::query!(
        r#"SELECT id FROM "Document" WHERE id = $1 FOR UPDATE"#,
        DOC_2
    )
    .fetch_one(&mut *holder)
    .await?;

    let mut checked = pool.begin().await?;
    share(&mut checked).await?;
    // Created by this test, so the query cannot be checked at compile time.
    sqlx::query("INSERT INTO deferred_reference (document_id) VALUES ($1)")
        .bind(DOC_2)
        .execute(&mut *checked)
        .await?;
    grant(&mut holder, "document", DOC, MEMBER, "user").await?;

    // The check waits for the holder; the holder's commit must not wait for the checker.
    let checked_commit = checked.commit();
    let holder_commit = async {
        wait_for_lock_waiters(&pool).await?;
        no_wait(&mut holder).await?;
        holder.commit().await
    };
    let (checked, held) = tokio::join!(checked_commit, holder_commit);
    held?;
    checked?;
    assert_eq!(rows(&mut *pool.acquire().await?, DOC).await?.len(), 2);
    assert_exact(&pool).await
}

/// A transaction that truncated an input holds it exclusively until it commits; another commit
/// must wait for that before taking a bucket the truncating transaction needs.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_truncate_and_a_commit_on_its_items_do_not_deadlock(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    insert(&mut *pool.acquire().await?).await?;
    let mut sharing = pool.begin().await?;
    share(&mut sharing).await?;

    let mut truncating = pool.begin().await?;
    sqlx::query!("TRUNCATE document_sub_type")
        .execute(&mut *truncating)
        .await?;
    make_task(&mut truncating).await?;

    let share_commit = sharing.commit();
    let truncate_commit = async {
        wait_for_lock_waiters(&pool).await?;
        no_wait(&mut truncating).await?;
        truncating.commit().await
    };
    let (shared, truncated) = tokio::join!(share_commit, truncate_commit);
    truncated?;
    shared?;
    assert_eq!(
        rows(&mut *pool.acquire().await?, DOC).await?,
        [row(OWNER, "task", Some("2026-01-01 00:00:00"), 1)]
    );
    assert_exact(&pool).await
}

/// Two transactions touching the same two items in opposite statement order commit together.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn commits_on_the_same_items_in_opposite_orders_both_finish(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    {
        let mut conn = pool.acquire().await?;
        insert(&mut conn).await?;
        insert_document(&mut conn, DOC_2, "2026-01-01 00:00:00").await?;
    }
    for _ in 0..20 {
        let mut one = pool.begin().await?;
        grant(&mut one, "document", DOC, OWNER, "user").await?;
        grant(&mut one, "document", DOC_2, OWNER, "user").await?;
        let mut two = pool.begin().await?;
        grant(&mut two, "document", DOC_2, MEMBER, "user").await?;
        grant(&mut two, "document", DOC, MEMBER, "user").await?;
        commit(Commit::Together, one, two).await?;
        sqlx::query!("DELETE FROM entity_access")
            .execute(&pool)
            .await?;
    }
    assert_exact(&pool).await
}
