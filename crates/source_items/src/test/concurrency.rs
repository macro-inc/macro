//! Two transactions racing on one item, each interleaving forced: the second statement is let
//! through only once PostgreSQL reports it waiting on the first transaction.

use super::{DOC, MEMBER, OWNER, assert_exact, grant, insert_document, row, rows};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{PgConnection, PgPool};
use tokio::sync::oneshot;

/// Key limits that send inserts and grant changes through each class of advisory key: per-item
/// keys, buckets for a large insert, and the global key for a grant change on many unseen items.
const KEY_LIMITS: [(i32, i32); 4] = [(4096, 4096), (0, 4096), (4096, 0), (0, 0)];

async fn set_key_limit(conn: &mut PgConnection, limit: i32) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "SELECT set_config('source_items.key_limit', $1, true)",
        limit.to_string()
    )
    .fetch_one(conn)
    .await?;
    Ok(())
}

async fn backend_pid(conn: &mut PgConnection) -> Result<i32, sqlx::Error> {
    Ok(sqlx::query_scalar!(r#"SELECT pg_backend_pid() AS "pid!""#)
        .fetch_one(conn)
        .await?)
}

/// Returns once `pid` waits on a lock another backend holds. PostgreSQL has no notification for
/// this, so the wait runs server side, as PostgreSQL's own isolation tester does.
async fn wait_until_blocked(pool: &PgPool, pid: i32) -> Result<(), sqlx::Error> {
    let mut conn = pool.acquire().await?;
    sqlx::query!("SET statement_timeout = '20s'")
        .execute(&mut *conn)
        .await?;
    sqlx::query(&format!(
        "DO $$ BEGIN
             WHILE cardinality(pg_blocking_pids({pid})) = 0 LOOP
                 PERFORM pg_sleep(0.005);
             END LOOP;
         END $$"
    ))
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Runs `first` to completion in one transaction, then `second` in another until it blocks, then
/// commits the first and the second, in that order.
async fn race<F, S>(pool: &PgPool, limits: (i32, i32), first: F, second: S) -> Result<(), sqlx::Error>
where
    F: AsyncFnOnce(&mut PgConnection) -> Result<(), sqlx::Error>,
    S: AsyncFnOnce(&mut PgConnection) -> Result<(), sqlx::Error>,
{
    let mut one = pool.begin().await?;
    set_key_limit(&mut one, limits.0).await?;
    first(&mut one).await?;
    let (pid_sender, pid) = oneshot::channel();
    let blocked = async {
        let mut two = pool.begin().await?;
        set_key_limit(&mut two, limits.1).await?;
        let _ = pid_sender.send(backend_pid(&mut two).await?);
        second(&mut two).await?;
        two.commit().await
    };
    let release = async {
        let pid = pid.await.expect("the second transaction reports its pid");
        wait_until_blocked(pool, pid).await?;
        one.commit().await
    };
    let (released, finished) = tokio::join!(release, blocked);
    released?;
    finished
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_grant_waits_for_its_items_insert(pool: PgPool) -> Result<(), sqlx::Error> {
    for (n, limits) in KEY_LIMITS.into_iter().enumerate() {
        let doc = format!("10000000-0000-4000-8000-00000000010{n}");
        race(
            &pool,
            limits,
            async |c| insert_document(c, &doc, "2026-01-01 00:00:00").await,
            async |c| grant(c, "document", &doc, OWNER, "user").await,
        )
        .await?;
        let mut conn = pool.acquire().await?;
        assert_eq!(
            rows(&mut conn, &doc).await?,
            [row(OWNER, "document", Some("2026-01-01 00:00:00"), 1)],
            "{limits:?}"
        );
    }
    assert_exact(&pool).await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_insert_waits_for_a_grant_on_its_unseen_item(pool: PgPool) -> Result<(), sqlx::Error> {
    for (n, (inserter, granter)) in KEY_LIMITS.into_iter().enumerate() {
        let doc = format!("10000000-0000-4000-8000-00000000020{n}");
        race(
            &pool,
            (granter, inserter),
            async |c| grant(c, "document", &doc, OWNER, "user").await,
            async |c| insert_document(c, &doc, "2026-01-01 00:00:00").await,
        )
        .await?;
        let mut conn = pool.acquire().await?;
        assert_eq!(
            rows(&mut conn, &doc).await?,
            [row(OWNER, "document", Some("2026-01-01 00:00:00"), 1)],
            "{:?}",
            (inserter, granter)
        );
    }
    assert_exact(&pool).await
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

async fn insert(c: &mut PgConnection) -> Result<(), sqlx::Error> {
    insert_document(c, DOC, "2026-01-01 00:00:00").await
}

/// Moving a grant is not a key update: entity_access's unique indexes are partial.
async fn move_away(c: &mut PgConnection) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "UPDATE entity_access SET entity_id = $2::text::uuid WHERE entity_id = $1::text::uuid",
        DOC,
        super::DOC_2,
    )
    .execute(c)
    .await?;
    Ok(())
}

fn save(at: &'static str) -> impl AsyncFnOnce(&mut PgConnection) -> Result<(), sqlx::Error> {
    async move |c: &mut PgConnection| {
        sqlx::query!(
            r#"UPDATE "Document" SET "updatedAt" = $2::text::timestamp WHERE id = $1"#,
            DOC,
            at
        )
        .execute(c)
        .await?;
        Ok(())
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_revoke_and_an_insert_that_counts_its_grant_serialize(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    // The insert counts the grant, then the revoke waits for it.
    grant(&mut *pool.acquire().await?, "document", DOC, OWNER, "user").await?;
    race(&pool, (4096, 4096), insert, revoke).await?;
    assert_eq!(rows(&mut *pool.acquire().await?, DOC).await?, []);
    assert_exact(&pool).await?;

    // The revoke goes first, then the insert waits to count the grant it removed.
    sqlx::query!(r#"DELETE FROM "Document" WHERE id = $1"#, DOC)
        .execute(&pool)
        .await?;
    grant(&mut *pool.acquire().await?, "document", DOC, OWNER, "user").await?;
    race(&pool, (4096, 4096), revoke, insert).await?;
    assert_eq!(rows(&mut *pool.acquire().await?, DOC).await?, []);
    assert_exact(&pool).await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_grant_moved_off_an_item_in_flight_is_not_counted(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    // The insert counts the grant, then the move waits for it.
    grant(&mut *pool.acquire().await?, "document", DOC, OWNER, "user").await?;
    race(&pool, (4096, 4096), insert, move_away).await?;
    assert_eq!(rows(&mut *pool.acquire().await?, DOC).await?, []);
    assert_exact(&pool).await?;

    // The move goes first, then the insert waits before counting.
    sqlx::query!(r#"DELETE FROM "Document" WHERE id = $1"#, DOC)
        .execute(&pool)
        .await?;
    sqlx::query!("DELETE FROM entity_access").execute(&pool).await?;
    grant(&mut *pool.acquire().await?, "document", DOC, OWNER, "user").await?;
    race(&pool, (4096, 4096), move_away, insert).await?;
    assert_eq!(rows(&mut *pool.acquire().await?, DOC).await?, []);
    assert_exact(&pool).await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn grants_and_saves_serialize_on_the_item(pool: PgPool) -> Result<(), sqlx::Error> {
    insert_document(&mut *pool.acquire().await?, DOC, "2026-01-01 00:00:00").await?;

    // A save in flight: the grant waits, then reads the saved timestamp.
    race(
        &pool,
        (4096, 4096),
        save("2026-02-01 00:00:00"),
        async |c| grant(c, "document", DOC, OWNER, "user").await,
    )
    .await?;
    assert_eq!(
        rows(&mut *pool.acquire().await?, DOC).await?,
        [row(OWNER, "document", Some("2026-02-01 00:00:00"), 1)]
    );

    // A grant in flight: the save waits, then updates the row the grant added.
    race(
        &pool,
        (4096, 4096),
        async |c| grant(c, "document", DOC, MEMBER, "user").await,
        save("2026-03-01 00:00:00"),
    )
    .await?;
    assert_eq!(
        rows(&mut *pool.acquire().await?, DOC).await?,
        [
            row(MEMBER, "document", Some("2026-03-01 00:00:00"), 1),
            row(OWNER, "document", Some("2026-03-01 00:00:00"), 1),
        ]
    );
    assert_exact(&pool).await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn large_writes_hold_a_bounded_number_of_keys(pool: PgPool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    set_key_limit(&mut tx, 100).await?;
    // 5,000 single-item inserts in one transaction, like a large folder upload.
    for n in 0..5_000 {
        insert_document(
            &mut tx,
            &format!("10000000-0000-4000-8000-{n:012}"),
            "2026-01-01 00:00:00",
        )
        .await?;
    }
    // Grants on 5,000 items nobody has inserted.
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           SELECT ('20000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'document', $1,
                  'user', 'view'
           FROM generate_series(1, 5000) n"#,
        OWNER,
    )
    .execute(&mut *tx)
    .await?;
    let keys = sqlx::query_scalar!(
        r#"SELECT count(*) AS "keys!" FROM pg_locks
           WHERE locktype = 'advisory' AND pid = pg_backend_pid()"#
    )
    .fetch_one(&mut *tx)
    .await?;
    // 100 per-item keys, at most 1,024 buckets, and the global key.
    assert!(keys <= 100 + 1024 + 1, "{keys} advisory keys");
    tx.commit().await?;
    assert_exact(&pool).await
}
