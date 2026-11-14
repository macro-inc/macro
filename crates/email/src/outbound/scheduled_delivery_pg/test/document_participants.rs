//! Adopting an imported message moves attachments between the two messages,
//! and deletes the local copy of an attachment both hold, while document
//! links may run on them. The completion locks the local message in its
//! fence and the imported one when it finds it, before adoption touches an
//! attachment; a link locks its attachment's message before its foreign key
//! check takes the attachment (`document_email_participants_lock_linked_message`).
//! Both take a message before its attachments, so a link and adoption wait
//! for each other instead of deadlocking, and the projection holds every
//! participant the chain proves afterwards.

use super::identity::{
    ATTACHMENT, IMPORTED, LINK, MESSAGE, adopt, complete, fence, finish, imported_delivery,
};
use super::support::DeliveryClaim;
use anyhow::Context;
use email_db_client::messages::sent_identity::imported_message;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Acquire, PgConnection, PgPool, Postgres, Transaction, types::Uuid};
use std::collections::BTreeSet;
use std::time::Duration;
use tokio::task::JoinHandle;

const FOREIGN_KEY_VIOLATION: &str = "23503";
/// The adopted recipient: only the imported message names them at first.
const NEWCOMER: &str = "pat@acme.test";

async fn backend_pid(conn: &mut PgConnection) -> anyhow::Result<i32> {
    Ok(sqlx::query_scalar!(r#"SELECT pg_backend_pid() AS "pid!""#)
        .fetch_one(conn)
        .await?)
}

/// Returns once `waiter` waits on a lock `holder` holds; fails if `waiting`
/// finishes first or ten seconds pass. Postgres has no event to wait on for
/// a lock wait, so this polls `pg_blocking_pids`.
async fn blocked_by<T>(
    db: &PgPool,
    waiter: i32,
    holder: i32,
    waiting: &JoinHandle<T>,
) -> anyhow::Result<()> {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let blocked = sqlx::query_scalar!(
                r#"SELECT $2::int = ANY(pg_blocking_pids($1)) AS "blocked!""#,
                waiter,
                holder,
            )
            .fetch_one(db)
            .await?;
            if blocked {
                return Ok(());
            }
            anyhow::ensure!(!waiting.is_finished(), "finished without waiting");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .context("never waited")?
}

/// The imported delivery, with a recipient only the imported message names
/// and, when `duplicated`, the local copy of its attachment.
async fn seed(db: &PgPool, duplicated: bool) -> anyhow::Result<(Option<Uuid>, String)> {
    let newcomer = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_contacts (id, link_id, email_address) VALUES ($1, $2, $3)",
        newcomer,
        LINK,
        NEWCOMER,
    )
    .execute(db)
    .await?;
    sqlx::query!(
        "INSERT INTO email_message_recipients (message_id, contact_id, recipient_type) VALUES ($1, $2, 'CC')",
        IMPORTED,
        newcomer,
    )
    .execute(db)
    .await?;
    let local = if duplicated {
        let local = Uuid::now_v7();
        sqlx::query!(
            "INSERT INTO email_attachments (id, message_id, provider_attachment_id) VALUES ($1, $2, 'attachment')",
            local,
            MESSAGE,
        )
        .execute(db)
        .await?;
        Some(local)
    } else {
        None
    };
    let document = Uuid::now_v7().to_string();
    let mut tx = db.begin().await?;
    // No owner behind the foreign key.
    sqlx::raw_sql("SET LOCAL session_replication_role = 'replica'")
        .execute(&mut *tx)
        .await?;
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner) VALUES ($1, 'attached.pdf', 'macro|nobody@example.com')"#,
        document,
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((local, document))
}

async fn link(
    conn: &mut PgConnection,
    document: &str,
    attachment: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "INSERT INTO document_email (document_id, email_attachment_id) VALUES ($1, $2)",
        document,
        attachment,
    )
    .execute(conn)
    .await
    .map(drop)
}

/// The lowercased addresses `document`'s attachment chains prove.
async fn proven(db: &PgPool, document: &str) -> anyhow::Result<BTreeSet<String>> {
    Ok(sqlx::query_scalar!(
        r#"SELECT DISTINCT LOWER(c.email_address) AS "address!"
           FROM document_email de
           JOIN email_attachments a ON a.id = de.email_attachment_id
           JOIN email_messages m ON m.id = a.message_id
           JOIN email_contacts c ON c.id = m.from_contact_id
               OR c.id IN (SELECT r.contact_id FROM email_message_recipients r WHERE r.message_id = m.id)
           WHERE de.document_id = $1"#,
        document,
    )
    .fetch_all(db)
    .await?
    .into_iter()
    .collect())
}

/// What the chain proves, which the projection must hold.
async fn proven_and_recorded(db: &PgPool, document: &str) -> anyhow::Result<BTreeSet<String>> {
    let proven = proven(db, document).await?;
    let recorded: BTreeSet<_> = sqlx::query_scalar!(
        "SELECT address FROM document_email_participants WHERE document_id = $1",
        document,
    )
    .fetch_all(db)
    .await?
    .into_iter()
    .collect();
    assert!(
        recorded.is_superset(&proven),
        "{recorded:?} misses some of {proven:?}"
    );
    Ok(proven)
}

/// Begins the completion holding both messages, as its fence and
/// `imported_message` leave them before adoption writes anything.
async fn adopting(
    db: &PgPool,
    claim: &DeliveryClaim,
) -> anyhow::Result<(i32, Transaction<'static, Postgres>)> {
    let mut tx = db.begin().await?;
    let pid = backend_pid(&mut tx).await?;
    assert!(fence(&mut tx, claim).await?);
    assert_eq!(
        imported_message(&mut tx, LINK, MESSAGE, "sent-provider-message").await?,
        Some(IMPORTED)
    );
    Ok((pid, tx))
}

/// A link to the local copy of the attachment waits for adoption, which
/// deletes that copy, and then fails its foreign key check, as a link to a
/// deleted attachment does.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../email_db_client/fixtures",
        scripts("mark_message_as_sent")
    )
)]
async fn a_link_to_the_local_copy_waits_for_adoption_and_fails(db: PgPool) -> anyhow::Result<()> {
    let claim = imported_delivery(&db).await?;
    let (local, document) = seed(&db, true).await?;
    let local = local.context("a local copy")?;
    let (adopter, mut adoption) = adopting(&db, &claim).await?;
    let mut linker = db.acquire().await?;
    let linker_pid = backend_pid(&mut linker).await?;
    let linking = tokio::spawn({
        let document = document.clone();
        async move { link(&mut linker, &document, local).await }
    });
    blocked_by(&db, linker_pid, adopter, &linking).await?;
    adopt(&mut adoption).await?;
    adoption.commit().await?;

    match linking.await? {
        Err(sqlx::Error::Database(e)) => {
            assert_eq!(e.code().as_deref(), Some(FOREIGN_KEY_VIOLATION), "{e}");
            assert_eq!(
                e.constraint(),
                Some("document_email_email_attachment_id_fkey")
            );
        }
        result => anyhow::bail!("the link outlived its attachment: {result:?}"),
    }
    Ok(())
}

/// A link to the imported attachment waits for adoption, then follows the
/// attachment to the local message and records its participants, the
/// adopted recipient among them.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../email_db_client/fixtures",
        scripts("mark_message_as_sent")
    )
)]
async fn a_link_to_the_imported_attachment_follows_it_to_the_local_message(
    db: PgPool,
) -> anyhow::Result<()> {
    let claim = imported_delivery(&db).await?;
    let (_, document) = seed(&db, false).await?;
    let (adopter, mut adoption) = adopting(&db, &claim).await?;
    let mut linker = db.acquire().await?;
    let linker_pid = backend_pid(&mut linker).await?;
    let linking = tokio::spawn({
        let document = document.clone();
        async move { link(&mut linker, &document, ATTACHMENT).await }
    });
    blocked_by(&db, linker_pid, adopter, &linking).await?;
    adopt(&mut adoption).await?;
    adoption.commit().await?;
    linking.await??;

    assert_eq!(
        sqlx::query_scalar!(
            "SELECT message_id FROM email_attachments WHERE id = $1",
            ATTACHMENT
        )
        .fetch_one(&db)
        .await?,
        MESSAGE
    );
    let proven = proven_and_recorded(&db, &document).await?;
    assert!(proven.contains(NEWCOMER), "{proven:?}");
    Ok(())
}

/// Adoption waits for a link to the local copy in flight, then carries the
/// link over to the imported attachment it keeps.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../email_db_client/fixtures",
        scripts("mark_message_as_sent")
    )
)]
async fn adoption_waits_for_a_link_in_flight_and_carries_it_over(db: PgPool) -> anyhow::Result<()> {
    let claim = imported_delivery(&db).await?;
    let (local, document) = seed(&db, true).await?;
    let local = local.context("a local copy")?;
    let mut holder = db.acquire().await?;
    let linker = backend_pid(&mut holder).await?;
    let mut linking = holder.begin().await?;
    link(&mut linking, &document, local).await?;
    let mut adopter = db.acquire().await?;
    let adopter_pid = backend_pid(&mut adopter).await?;
    let adoption = tokio::spawn(async move {
        let mut tx = adopter.begin().await?;
        let completed = finish(&mut tx, &claim).await?;
        tx.commit().await?;
        anyhow::Ok(completed)
    });
    blocked_by(&db, adopter_pid, linker, &adoption).await?;
    linking.commit().await?;
    assert!(adoption.await??);

    assert_eq!(
        sqlx::query_scalar!(
            "SELECT email_attachment_id FROM document_email WHERE document_id = $1",
            document,
        )
        .fetch_all(&db)
        .await?,
        [ATTACHMENT]
    );
    let proven = proven_and_recorded(&db, &document).await?;
    assert!(proven.contains(NEWCOMER), "{proven:?}");
    Ok(())
}

/// Completing a delivery whose sent copy was imported with an attachment
/// already linked to a document leaves the projection holding the local
/// message's participants.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../email_db_client/fixtures",
        scripts("mark_message_as_sent")
    )
)]
async fn adoption_records_the_local_message_for_linked_attachments(
    db: PgPool,
) -> anyhow::Result<()> {
    let claim = imported_delivery(&db).await?;
    let (_, document) = seed(&db, false).await?;
    link(&mut *db.acquire().await?, &document, ATTACHMENT).await?;
    assert!(complete(&db, &claim).await?);

    let proven = proven_and_recorded(&db, &document).await?;
    assert!(proven.contains(NEWCOMER), "{proven:?}");
    Ok(())
}
