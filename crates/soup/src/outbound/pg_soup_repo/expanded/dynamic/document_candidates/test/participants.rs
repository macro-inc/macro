//! The triggers that keep `document_email_participants` a superset of what
//! the attachment chain proves.

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Connection, PgConnection, PgPool};
use std::collections::BTreeSet;
use uuid::{Uuid, uuid};

/// The mailbox these tests write into; inserted as a replica, its link and
/// threads never exist.
const MAILBOX: Uuid = uuid!("33333333-0000-0000-0000-00000000000a");

/// Postgres' `lock_not_available`, raised when `lock_timeout` expires.
const LOCK_NOT_AVAILABLE: &str = "55P03";

async fn participants_of(
    conn: &mut PgConnection,
    document: &str,
) -> anyhow::Result<BTreeSet<String>> {
    Ok(sqlx::query_scalar!(
        "SELECT address FROM document_email_participants WHERE document_id = $1",
        document
    )
    .fetch_all(conn)
    .await?
    .into_iter()
    .collect())
}

fn set(addresses: &[&str]) -> BTreeSet<String> {
    addresses.iter().map(|a| (*a).to_owned()).collect()
}

async fn insert_contact(conn: &mut PgConnection, address: &str) -> anyhow::Result<Uuid> {
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_contacts (id, link_id, email_address) VALUES ($1, $2, $3)",
        id,
        MAILBOX,
        address,
    )
    .execute(conn)
    .await?;
    Ok(id)
}

async fn insert_message(conn: &mut PgConnection, sender: Uuid) -> anyhow::Result<Uuid> {
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_messages (id, thread_id, link_id, from_contact_id) VALUES ($1, $2, $3, $4)",
        id,
        Uuid::now_v7(),
        MAILBOX,
        sender,
    )
    .execute(conn)
    .await?;
    Ok(id)
}

async fn insert_recipient(
    conn: &mut PgConnection,
    message: Uuid,
    contact: Uuid,
) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO email_message_recipients (message_id, contact_id, recipient_type) VALUES ($1, $2, 'CC')",
        message,
        contact,
    )
    .execute(conn)
    .await?;
    Ok(())
}

async fn insert_attachment(conn: &mut PgConnection, message: Uuid) -> anyhow::Result<Uuid> {
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_attachments (id, message_id) VALUES ($1, $2)",
        id,
        message,
    )
    .execute(conn)
    .await?;
    Ok(id)
}

async fn insert_document(conn: &mut PgConnection, id: &str) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner) VALUES ($1, $1, 'macro|me@mailbox.test')"#,
        id,
    )
    .execute(conn)
    .await?;
    Ok(())
}

async fn link(conn: &mut PgConnection, document: &str, attachment: Uuid) -> sqlx::Result<()> {
    sqlx::query!(
        "INSERT INTO document_email (document_id, email_attachment_id) VALUES ($1, $2)",
        document,
        attachment,
    )
    .execute(conn)
    .await?;
    Ok(())
}

async fn set_replication_role(conn: &mut PgConnection, role: &str) -> anyhow::Result<()> {
    sqlx::query_scalar!(
        "SELECT set_config('session_replication_role', $1, false)",
        role
    )
    .fetch_one(conn)
    .await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn participants_follow_every_write_that_proves_one(db: PgPool) -> anyhow::Result<()> {
    let conn = &mut *db.acquire().await?;
    set_replication_role(conn, "replica").await?;
    let me = insert_contact(conn, "me@mailbox.test").await?;
    let vendor = insert_contact(conn, "Vendor@Acme.test").await?;
    let colleague = insert_contact(conn, "pat@acme.test").await?;
    let other = insert_contact(conn, "other@globex.test").await?;
    let new = insert_contact(conn, "new@initech.test").await?;
    let corrected = insert_contact(conn, "lee@hooli.test").await?;
    let sent = insert_message(conn, me).await?;
    let adopted = insert_message(conn, new).await?;
    insert_recipient(conn, sent, vendor).await?;
    insert_recipient(conn, adopted, me).await?;
    let attachment = insert_attachment(conn, sent).await?;
    let (document, moved_to) = ("participants-doc", "participants-other-doc");
    for id in [document, moved_to] {
        insert_document(conn, id).await?;
    }
    set_replication_role(conn, "origin").await?;

    // Sync links the uploaded document after the message and its recipients.
    link(conn, document, attachment).await?;
    assert_eq!(
        participants_of(conn, document).await?,
        set(&["me@mailbox.test", "vendor@acme.test"])
    );

    // A later sync adds a recipient and changes the sender.
    insert_recipient(conn, sent, colleague).await?;
    sqlx::query!(
        "UPDATE email_messages SET from_contact_id = $2 WHERE id = $1",
        sent,
        other,
    )
    .execute(&mut *conn)
    .await?;
    let before_move = set(&[
        "me@mailbox.test",
        "other@globex.test",
        "pat@acme.test",
        "vendor@acme.test",
    ]);
    assert_eq!(participants_of(conn, document).await?, before_move);

    // A sent identity adopts the attachment onto another message, whose
    // recipient is then corrected and whose sender's address changes.
    sqlx::query!(
        "UPDATE email_attachments SET message_id = $2 WHERE id = $1",
        attachment,
        adopted,
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!(
        "UPDATE email_message_recipients SET contact_id = $2 WHERE message_id = $1",
        adopted,
        corrected,
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!(
        "UPDATE email_contacts SET email_address = 'Renamed@Initech.test' WHERE id = $1",
        new,
    )
    .execute(&mut *conn)
    .await?;
    // Rows the chain no longer proves stay; readers recheck the chain.
    let mut after_move = before_move;
    after_move.extend(set(&[
        "lee@hooli.test",
        "new@initech.test",
        "renamed@initech.test",
    ]));
    assert_eq!(participants_of(conn, document).await?, after_move);

    // Relinking records the attachment's participants on the other document,
    // and deleting a document deletes its rows.
    sqlx::query!(
        "UPDATE document_email SET document_id = $2 WHERE document_id = $1",
        document,
        moved_to,
    )
    .execute(&mut *conn)
    .await?;
    assert_eq!(
        participants_of(conn, moved_to).await?,
        set(&["lee@hooli.test", "renamed@initech.test"])
    );
    sqlx::query!(r#"DELETE FROM "Document" WHERE id = $1"#, document)
        .execute(&mut *conn)
        .await?;
    assert!(participants_of(conn, document).await?.is_empty());
    Ok(())
}

/// An unlinked attachment document's chain, with a contact and a message
/// outside it that a participant write can bring in.
struct Chain {
    case: String,
    document: String,
    attachment: Uuid,
    message: Uuid,
    recipient: Uuid,
    newcomer: Uuid,
    newcomer_message: Uuid,
}

impl Chain {
    async fn seed(conn: &mut PgConnection, case: String) -> anyhow::Result<Self> {
        set_replication_role(conn, "replica").await?;
        let sender = insert_contact(conn, &format!("{case}-sender@acme.test")).await?;
        let recipient = insert_contact(conn, &format!("{case}-recipient@acme.test")).await?;
        let newcomer = insert_contact(conn, &format!("{case}-newcomer@acme.test")).await?;
        let message = insert_message(conn, sender).await?;
        insert_recipient(conn, message, recipient).await?;
        let newcomer_message = insert_message(conn, newcomer).await?;
        let attachment = insert_attachment(conn, message).await?;
        let document = format!("{case}-doc");
        insert_document(conn, &document).await?;
        set_replication_role(conn, "origin").await?;
        Ok(Self {
            case,
            document,
            attachment,
            message,
            recipient,
            newcomer,
            newcomer_message,
        })
    }

    fn renamed(&self) -> String {
        format!("{}-renamed@acme.test", self.case)
    }
}

/// A write that makes someone a participant of an existing chain.
#[derive(Clone, Copy, Debug)]
enum ParticipantWrite {
    NewRecipient,
    ChangedRecipient,
    ChangedSender,
    ChangedAddress,
    MovedAttachment,
}

impl ParticipantWrite {
    const ALL: [Self; 5] = [
        Self::NewRecipient,
        Self::ChangedRecipient,
        Self::ChangedSender,
        Self::ChangedAddress,
        Self::MovedAttachment,
    ];

    async fn apply(self, chain: &Chain, conn: &mut PgConnection) -> sqlx::Result<()> {
        match self {
            Self::NewRecipient => insert_recipient(conn, chain.message, chain.newcomer).await,
            Self::ChangedRecipient => sqlx::query!(
                "UPDATE email_message_recipients SET contact_id = $3 WHERE message_id = $1 AND contact_id = $2",
                chain.message,
                chain.recipient,
                chain.newcomer,
            )
            .execute(conn)
            .await
            .map(drop),
            Self::ChangedSender => sqlx::query!(
                "UPDATE email_messages SET from_contact_id = $2 WHERE id = $1",
                chain.message,
                chain.newcomer,
            )
            .execute(conn)
            .await
            .map(drop),
            Self::ChangedAddress => sqlx::query!(
                "UPDATE email_contacts SET email_address = $2 WHERE id = $1",
                chain.recipient,
                chain.renamed(),
            )
            .execute(conn)
            .await
            .map(drop),
            Self::MovedAttachment => sqlx::query!(
                "UPDATE email_attachments SET message_id = $2 WHERE id = $1",
                chain.attachment,
                chain.newcomer_message,
            )
            .execute(conn)
            .await
            .map(drop),
        }
    }

    /// The address the write adds to the chain's participants.
    fn joins(self, chain: &Chain) -> String {
        match self {
            Self::ChangedAddress => chain.renamed(),
            _ => format!("{}-newcomer@acme.test", chain.case),
        }
    }
}

/// Whether linking the chain's document, or applying `write`, waits on a row
/// lock another transaction holds.
async fn waits(
    conn: &mut PgConnection,
    chain: &Chain,
    write: Option<ParticipantWrite>,
) -> anyhow::Result<bool> {
    let mut transaction = conn.begin().await?;
    sqlx::query!("SET LOCAL lock_timeout = '100ms'")
        .execute(&mut *transaction)
        .await?;
    let result = match write {
        Some(write) => write.apply(chain, &mut transaction).await,
        None => link(&mut transaction, &chain.document, chain.attachment).await,
    };
    transaction.rollback().await?;
    match result {
        Err(sqlx::Error::Database(e)) if e.code().as_deref() == Some(LOCK_NOT_AVAILABLE) => {
            Ok(true)
        }
        result => result.map(|()| false).map_err(Into::into),
    }
}

/// Neither trigger sees the other transaction's uncommitted row, so a link
/// and a write that adds a participant to its chain must wait for each other:
/// the one that waits records the participant once the other commits.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_link_and_a_participant_write_on_its_chain_wait_for_each_other(
    db: PgPool,
) -> anyhow::Result<()> {
    let mut linker = db.acquire().await?;
    let mut writer = db.acquire().await?;
    for write in ParticipantWrite::ALL {
        let chain = Chain::seed(&mut linker, format!("{write:?}-in-flight").to_lowercase()).await?;
        let mut in_flight = writer.begin().await?;
        write.apply(&chain, &mut in_flight).await?;
        assert!(
            waits(&mut linker, &chain, None).await?,
            "a link waits for {write:?}"
        );
        in_flight.commit().await?;
        link(&mut linker, &chain.document, chain.attachment).await?;
        assert!(
            participants_of(&mut linker, &chain.document)
                .await?
                .contains(&write.joins(&chain)),
            "a link after {write:?} records it"
        );

        let chain = Chain::seed(&mut linker, format!("{write:?}-after").to_lowercase()).await?;
        let mut in_flight = linker.begin().await?;
        link(&mut in_flight, &chain.document, chain.attachment).await?;
        assert!(
            waits(&mut writer, &chain, Some(write)).await?,
            "{write:?} waits for a link"
        );
        in_flight.commit().await?;
        write.apply(&chain, &mut writer).await?;
        assert!(
            participants_of(&mut writer, &chain.document)
                .await?
                .contains(&write.joins(&chain)),
            "{write:?} after a link records it"
        );
    }
    Ok(())
}
