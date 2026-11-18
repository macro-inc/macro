//! The triggers that keep `document_email_participants` a superset of what
//! the attachment chain proves.

use anyhow::Context;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Connection, PgConnection, PgPool};
use std::collections::BTreeSet;
use std::time::Duration;
use tokio::task::JoinHandle;
use uuid::{Uuid, uuid};

/// The mailbox these tests write into; inserted as a replica, its link and
/// threads never exist.
const MAILBOX: Uuid = uuid!("33333333-0000-0000-0000-00000000000a");

/// Postgres' `foreign_key_violation`.
const FOREIGN_KEY_VIOLATION: &str = "23503";

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

/// The participants `document`'s chain proves now.
async fn proven_participants(
    conn: &mut PgConnection,
    document: &str,
) -> anyhow::Result<BTreeSet<String>> {
    Ok(sqlx::query_scalar!(
        r#"SELECT LOWER(c.email_address) AS "address!"
           FROM document_email de
           JOIN email_attachments ea ON ea.id = de.email_attachment_id
           JOIN email_messages m ON m.id = ea.message_id
           JOIN email_contacts c ON c.id = m.from_contact_id
               OR c.id IN (SELECT r.contact_id FROM email_message_recipients r WHERE r.message_id = m.id)
           WHERE de.document_id = $1"#,
        document
    )
    .fetch_all(conn)
    .await?
    .into_iter()
    .collect())
}

/// One of the chain's messages.
#[derive(Clone, Copy, Debug)]
enum On {
    /// The message the attachment came in on.
    Message,
    /// The message a move takes the attachment to.
    OtherMessage,
}

/// One of the chain's contacts.
#[derive(Clone, Copy, Debug)]
enum Contact {
    Recipient,
    OtherRecipient,
    /// A contact on no message yet.
    Newcomer,
}

/// An attachment document's chain: its attachment on a message from a sender
/// to a recipient, a second message from another sender to another
/// recipient, and a newcomer on neither.
#[derive(Clone)]
struct Chain {
    case: String,
    document: String,
    attachment: Uuid,
    message: Uuid,
    recipient: Uuid,
    other_message: Uuid,
    other_recipient: Uuid,
    newcomer: Uuid,
}

impl Chain {
    async fn seed(conn: &mut PgConnection, case: String, linked: bool) -> anyhow::Result<Self> {
        set_replication_role(conn, "replica").await?;
        let address = |who: &str| format!("{case}-{who}@acme.test");
        let sender = insert_contact(conn, &address("sender")).await?;
        let recipient = insert_contact(conn, &address("recipient")).await?;
        let other_sender = insert_contact(conn, &address("other-sender")).await?;
        let other_recipient = insert_contact(conn, &address("other-recipient")).await?;
        let newcomer = insert_contact(conn, &address("newcomer")).await?;
        let message = insert_message(conn, sender).await?;
        insert_recipient(conn, message, recipient).await?;
        let other_message = insert_message(conn, other_sender).await?;
        insert_recipient(conn, other_message, other_recipient).await?;
        let attachment = insert_attachment(conn, message).await?;
        let document = format!("{case}-doc");
        insert_document(conn, &document).await?;
        set_replication_role(conn, "origin").await?;
        if linked {
            link(conn, &document, attachment).await?;
        }
        Ok(Self {
            case,
            document,
            attachment,
            message,
            recipient,
            other_message,
            other_recipient,
            newcomer,
        })
    }

    fn message(&self, on: On) -> Uuid {
        match on {
            On::Message => self.message,
            On::OtherMessage => self.other_message,
        }
    }

    fn recipient_of(&self, on: On) -> Uuid {
        match on {
            On::Message => self.recipient,
            On::OtherMessage => self.other_recipient,
        }
    }

    fn contact(&self, contact: Contact) -> Uuid {
        match contact {
            Contact::Recipient => self.recipient,
            Contact::OtherRecipient => self.other_recipient,
            Contact::Newcomer => self.newcomer,
        }
    }

    fn renamed(&self, contact: Contact) -> String {
        format!("{}-{contact:?}-renamed@acme.test", self.case).to_lowercase()
    }
}

/// A write that completes or changes the chain.
#[derive(Clone, Copy, Debug)]
enum Write {
    /// Links the document to the attachment.
    Link,
    /// Adds the newcomer as a recipient.
    NewRecipient(On),
    /// Replaces the message's recipient with the newcomer.
    ChangedRecipient(On),
    /// Makes the newcomer the message's sender.
    ChangedSender(On),
    /// Changes the contact's address.
    Renamed(Contact),
    /// Moves the attachment to the other message.
    MovedAttachment,
    /// Moves the attachment's link from another document to this one; the
    /// foreign key check skips an attachment that did not change.
    Relinked,
}

impl Write {
    async fn apply(self, chain: &Chain, conn: &mut PgConnection) -> anyhow::Result<()> {
        let changed = match self {
            Self::Link => return Ok(link(conn, &chain.document, chain.attachment).await?),
            Self::NewRecipient(on) => {
                return Ok(insert_recipient(conn, chain.message(on), chain.newcomer).await?);
            }
            Self::ChangedRecipient(on) => sqlx::query!(
                "UPDATE email_message_recipients SET contact_id = $3 WHERE message_id = $1 AND contact_id = $2",
                chain.message(on),
                chain.recipient_of(on),
                chain.newcomer,
            )
            .execute(conn)
            .await?,
            Self::ChangedSender(on) => sqlx::query!(
                "UPDATE email_messages SET from_contact_id = $2 WHERE id = $1",
                chain.message(on),
                chain.newcomer,
            )
            .execute(conn)
            .await?,
            Self::Renamed(contact) => sqlx::query!(
                "UPDATE email_contacts SET email_address = $2 WHERE id = $1",
                chain.contact(contact),
                chain.renamed(contact),
            )
            .execute(conn)
            .await?,
            Self::MovedAttachment => sqlx::query!(
                "UPDATE email_attachments SET message_id = $2 WHERE id = $1",
                chain.attachment,
                chain.other_message,
            )
            .execute(conn)
            .await?,
            Self::Relinked => sqlx::query!(
                "UPDATE document_email SET document_id = $2 WHERE email_attachment_id = $1",
                chain.attachment,
                chain.document,
            )
            .execute(conn)
            .await?,
        };
        anyhow::ensure!(changed.rows_affected() == 1, "{self:?} changed no row");
        Ok(())
    }
}

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

/// Applies `then` while `first` is uncommitted and checks that it waits for
/// `first`. Neither trigger sees the other transaction's uncommitted row, so
/// only the trigger of `then`, running once `first` commits, can record what
/// the two writes prove together: the document's participants must then
/// hold everything its chain proves.
async fn race(db: &PgPool, chain: &Chain, first: Write, then: Write) -> anyhow::Result<()> {
    let proven_before = proven_participants(&mut *db.acquire().await?, &chain.document).await?;
    let mut holder = db.acquire().await?;
    let holder_pid = backend_pid(&mut holder).await?;
    let mut holding = holder.begin().await?;
    first.apply(chain, &mut holding).await?;
    let mut waiter = db.acquire().await?;
    let waiter_pid = backend_pid(&mut waiter).await?;
    let waiting = tokio::spawn({
        let chain = chain.clone();
        async move {
            let mut transaction = waiter.begin().await?;
            then.apply(&chain, &mut transaction).await?;
            transaction.commit().await?;
            anyhow::Ok(())
        }
    });
    blocked_by(db, waiter_pid, holder_pid, &waiting)
        .await
        .with_context(|| format!("{then:?} waits for {first:?}"))?;
    holding.commit().await?;
    waiting.await??;

    let conn = &mut *db.acquire().await?;
    let proven = proven_participants(conn, &chain.document).await?;
    assert_ne!(
        proven, proven_before,
        "{first:?} then {then:?} change the chain"
    );
    let recorded = participants_of(conn, &chain.document).await?;
    assert!(
        recorded.is_superset(&proven),
        "{first:?} then {then:?}: {recorded:?} misses some of {proven:?}"
    );
    Ok(())
}

/// A link and a write that adds a participant to its chain wait for each
/// other, whichever comes first.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_link_and_a_participant_write_on_its_chain_wait_for_each_other(
    db: PgPool,
) -> anyhow::Result<()> {
    let conn = &mut *db.acquire().await?;
    for (case, write) in [
        Write::NewRecipient(On::Message),
        Write::ChangedRecipient(On::Message),
        Write::ChangedSender(On::Message),
        Write::Renamed(Contact::Recipient),
        Write::MovedAttachment,
    ]
    .into_iter()
    .enumerate()
    {
        let chain = Chain::seed(conn, format!("link-after-{case}"), false).await?;
        race(&db, &chain, write, Write::Link).await?;
        let chain = Chain::seed(conn, format!("link-first-{case}"), false).await?;
        race(&db, &chain, Write::Link, write).await?;
    }
    Ok(())
}

/// A relink (a link updated to another document, which its foreign key check
/// skips, since the attachment stays) and a move of its attachment wait for
/// each other, whichever comes first.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_relink_and_a_move_of_its_attachment_wait_for_each_other(
    db: PgPool,
) -> anyhow::Result<()> {
    let conn = &mut *db.acquire().await?;
    for (case, (first, then)) in [
        (Write::Relinked, Write::MovedAttachment),
        (Write::MovedAttachment, Write::Relinked),
    ]
    .into_iter()
    .enumerate()
    {
        let chain = Chain::seed(conn, format!("relinked-{case}"), false).await?;
        let previous = format!("{}-previous-doc", chain.case);
        set_replication_role(conn, "replica").await?;
        insert_document(conn, &previous).await?;
        set_replication_role(conn, "origin").await?;
        link(conn, &previous, chain.attachment).await?;
        race(&db, &chain, first, then).await?;
    }
    Ok(())
}

/// Two writes on a linked chain that bring in a participant between them (an
/// attachment move and a write on the message it moves to, or a new
/// participant and a change of their address) wait for each other too.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn participant_writes_on_one_chain_wait_for_each_other(db: PgPool) -> anyhow::Result<()> {
    let conn = &mut *db.acquire().await?;
    for (case, (a, b)) in [
        (
            Write::MovedAttachment,
            Write::NewRecipient(On::OtherMessage),
        ),
        (
            Write::MovedAttachment,
            Write::ChangedRecipient(On::OtherMessage),
        ),
        (
            Write::MovedAttachment,
            Write::ChangedSender(On::OtherMessage),
        ),
        (
            Write::MovedAttachment,
            Write::Renamed(Contact::OtherRecipient),
        ),
        (
            Write::NewRecipient(On::Message),
            Write::Renamed(Contact::Newcomer),
        ),
        (
            Write::ChangedRecipient(On::Message),
            Write::Renamed(Contact::Newcomer),
        ),
        (
            Write::ChangedSender(On::Message),
            Write::Renamed(Contact::Newcomer),
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let chain = Chain::seed(conn, format!("pair-{case}"), true).await?;
        race(&db, &chain, a, b).await?;
        let chain = Chain::seed(conn, format!("pair-{case}-reversed"), true).await?;
        race(&db, &chain, b, a).await?;
    }
    Ok(())
}

/// A message delete takes the message before its cascade deletes the
/// attachment, as a link does before its foreign key check: whichever comes
/// second waits, and neither deadlocks. A link that waited for the delete
/// fails its foreign key check, as document creation expects.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_message_delete_and_a_link_to_its_attachment_never_deadlock(
    db: PgPool,
) -> anyhow::Result<()> {
    let conn = &mut *db.acquire().await?;
    let chain = Chain::seed(conn, "deleted-first".to_owned(), false).await?;
    let mut holder = db.acquire().await?;
    let holder_pid = backend_pid(&mut holder).await?;
    let mut deleting = holder.begin().await?;
    sqlx::query!("DELETE FROM email_messages WHERE id = $1", chain.message)
        .execute(&mut *deleting)
        .await?;
    let mut linker = db.acquire().await?;
    let linker_pid = backend_pid(&mut linker).await?;
    let linking = tokio::spawn({
        let chain = chain.clone();
        async move { link(&mut linker, &chain.document, chain.attachment).await }
    });
    blocked_by(&db, linker_pid, holder_pid, &linking).await?;
    deleting.commit().await?;
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

    let chain = Chain::seed(conn, "linked-first".to_owned(), false).await?;
    let mut holder = db.acquire().await?;
    let holder_pid = backend_pid(&mut holder).await?;
    let mut linking = holder.begin().await?;
    link(&mut linking, &chain.document, chain.attachment).await?;
    let mut deleter = db.acquire().await?;
    let deleter_pid = backend_pid(&mut deleter).await?;
    let deleting = tokio::spawn(async move {
        sqlx::query!("DELETE FROM email_messages WHERE id = $1", chain.message)
            .execute(&mut *deleter)
            .await
    });
    blocked_by(&db, deleter_pid, holder_pid, &deleting).await?;
    linking.commit().await?;
    deleting.await??;
    Ok(())
}

/// A link that waited for its attachment's message while a move took the
/// attachment to another message locks that message too, before its foreign
/// key check takes the attachment. So a delete that holds the message the
/// attachment moved to deletes it while the link waits, and the link fails
/// its foreign key check instead of deadlocking with the delete.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_link_locks_the_message_its_attachment_moved_to(db: PgPool) -> anyhow::Result<()> {
    // Five sessions at once fill the test pool: the four below and the one
    // `blocked_by` polls with.
    let chain = Chain::seed(
        &mut *db.acquire().await?,
        "moved-while-linking".to_owned(),
        false,
    )
    .await?;
    let mut holder = db.acquire().await?;
    let holder_pid = backend_pid(&mut holder).await?;
    let mut holding = holder.begin().await?;
    sqlx::query!(
        "SELECT id FROM email_messages WHERE id = $1 FOR UPDATE",
        chain.message
    )
    .fetch_one(&mut *holding)
    .await?;
    let mut linker = db.acquire().await?;
    let linker_pid = backend_pid(&mut linker).await?;
    let linking = tokio::spawn({
        let chain = chain.clone();
        async move { link(&mut linker, &chain.document, chain.attachment).await }
    });
    blocked_by(&db, linker_pid, holder_pid, &linking)
        .await
        .context("the link waits for the message")?;

    // The attachment moves while the link waits, and a delete takes the
    // message it moved to as soon as the move commits.
    let mut mover = db.acquire().await?;
    let mover_pid = backend_pid(&mut mover).await?;
    let mut moving = mover.begin().await?;
    // A link that took the attachment before its message would hold the
    // move until the holder commits, which comes only after the move.
    tokio::time::timeout(
        Duration::from_secs(10),
        Write::MovedAttachment.apply(&chain, &mut moving),
    )
    .await
    .context("the move waits for the link")??;
    let mut deleter = db.acquire().await?;
    let deleter_pid = backend_pid(&mut deleter).await?;
    let (took_message, message_taken) = tokio::sync::oneshot::channel();
    let (go, delete_now) = tokio::sync::oneshot::channel();
    let moved_to = chain.other_message;
    let deleting = tokio::spawn(async move {
        let mut deleting = deleter.begin().await?;
        sqlx::query!(
            "SELECT id FROM email_messages WHERE id = $1 FOR UPDATE",
            moved_to
        )
        .fetch_one(&mut *deleting)
        .await?;
        took_message
            .send(())
            .map_err(|()| anyhow::anyhow!("the test stopped"))?;
        delete_now.await?;
        sqlx::query!("DELETE FROM email_messages WHERE id = $1", moved_to)
            .execute(&mut *deleting)
            .await?;
        deleting.commit().await?;
        anyhow::Ok(())
    });
    blocked_by(&db, deleter_pid, mover_pid, &deleting)
        .await
        .context("the delete waits for the move")?;
    moving.commit().await?;
    message_taken.await?;
    holding.commit().await?;

    blocked_by(&db, linker_pid, deleter_pid, &linking)
        .await
        .context("the link waits for the message the attachment moved to")?;
    go.send(())
        .map_err(|()| anyhow::anyhow!("the delete stopped"))?;
    deleting.await??;
    match linking.await? {
        Err(sqlx::Error::Database(e)) => {
            assert_eq!(e.code().as_deref(), Some(FOREIGN_KEY_VIOLATION), "{e}");
        }
        result => anyhow::bail!("the link outlived its attachment: {result:?}"),
    }
    Ok(())
}

/// One statement that deletes several documents deletes all their rows.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_documents_deletes_their_participants(db: PgPool) -> anyhow::Result<()> {
    let conn = &mut *db.acquire().await?;
    let mut chains = Vec::new();
    for case in 0..4 {
        chains.push(Chain::seed(conn, format!("deleted-{case}"), true).await?);
    }
    for deleted in [&chains[..1], &chains[1..3]] {
        let ids: Vec<_> = deleted.iter().map(|chain| chain.document.clone()).collect();
        sqlx::query!(r#"DELETE FROM "Document" WHERE id = ANY($1)"#, &ids)
            .execute(&mut *conn)
            .await?;
    }
    for chain in &chains[..3] {
        assert!(participants_of(conn, &chain.document).await?.is_empty());
    }
    assert_eq!(participants_of(conn, &chains[3].document).await?.len(), 2);
    Ok(())
}

/// Calls of the row triggers' functions so far in this transaction, counted
/// with `track_functions` set.
async fn row_trigger_calls(conn: &mut PgConnection) -> anyhow::Result<i64> {
    Ok(sqlx::query_scalar!(
        r#"SELECT COALESCE(sum(pg_stat_get_xact_function_calls(f::regproc)), 0)::bigint AS "calls!"
           FROM unnest(ARRAY[
               'document_email_participants_attachment_moved',
               'document_email_participants_recipient_changed',
               'document_email_participants_sender_changed',
               'document_email_participants_address_changed'
           ]) f"#
    )
    .fetch_one(conn)
    .await?)
}

/// The row triggers' `WHEN` clauses skip updates that leave a chain alone:
/// an attachment, a recipient or a sender set to what it was, a sender
/// cleared (its contact deleted), and an address changed only in case. A real
/// change still calls one.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn updates_that_keep_a_chain_call_no_trigger(db: PgPool) -> anyhow::Result<()> {
    let conn = &mut *db.acquire().await?;
    let chain = Chain::seed(conn, "kept".to_owned(), true).await?;
    let mut tx = conn.begin().await?;
    sqlx::query!("SET LOCAL track_functions = 'all'")
        .execute(&mut *tx)
        .await?;
    let before = row_trigger_calls(&mut tx).await?;
    sqlx::query!(
        "UPDATE email_attachments SET message_id = message_id WHERE id = $1",
        chain.attachment
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE email_message_recipients SET message_id = message_id, contact_id = contact_id
         WHERE message_id = $1",
        chain.message
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE email_messages SET from_contact_id = from_contact_id WHERE id = $1",
        chain.message
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE email_messages SET from_contact_id = NULL WHERE id = $1",
        chain.other_message
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE email_contacts SET email_address = UPPER(email_address) WHERE id = $1",
        chain.recipient
    )
    .execute(&mut *tx)
    .await?;
    assert_eq!(row_trigger_calls(&mut tx).await? - before, 0);

    // A contact this transaction has not updated: a second update of the
    // same row checks its mailbox foreign key, and the test mailbox does not
    // exist.
    Write::Renamed(Contact::OtherRecipient)
        .apply(&chain, &mut tx)
        .await?;
    assert_eq!(row_trigger_calls(&mut tx).await? - before, 1);
    Ok(())
}

/// The backfill commits each batch with the last attachment it covered, so a
/// run stopped part way resumes after it, and drops its progress row at the
/// end.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_backfill_resumes_after_its_last_committed_batch(db: PgPool) -> anyhow::Result<()> {
    let conn = &mut *db.acquire().await?;
    // Links written as a replica fire no trigger, as links did before it.
    set_replication_role(conn, "replica").await?;
    let mut chains = Vec::new();
    for case in 0..3 {
        let chain = Chain::seed(conn, format!("backfill-{case}"), false).await?;
        set_replication_role(conn, "replica").await?;
        link(conn, &chain.document, chain.attachment).await?;
        chains.push(chain);
    }
    set_replication_role(conn, "origin").await?;
    chains.sort_by_key(|chain| chain.attachment);
    // Where a run that committed its first batch stopped. The table exists
    // only while a run is unfinished, so the query macros cannot name it.
    sqlx::raw_sql(&format!(
        "CREATE TABLE document_email_participants_backfill (
             single boolean PRIMARY KEY DEFAULT true CHECK (single),
             last_attachment_id uuid NOT NULL
         );
         INSERT INTO document_email_participants_backfill (last_attachment_id) VALUES ('{}')",
        chains[0].attachment
    ))
    .execute(&mut *conn)
    .await?;

    // A backfill that never finishes fails here instead of hanging.
    sqlx::query!("SET statement_timeout = '30s'")
        .execute(&mut *conn)
        .await?;
    sqlx::raw_sql(include_str!(
        "../../../../../../../../macro_db_client/migrations/20261114135612_document_email_participants_backfill.sql"
    ))
    .execute(&mut *conn)
    .await?;

    assert!(participants_of(conn, &chains[0].document).await?.is_empty());
    for chain in &chains[1..] {
        assert_eq!(
            participants_of(conn, &chain.document).await?,
            proven_participants(conn, &chain.document).await?
        );
    }
    assert_eq!(
        sqlx::query_scalar!("SELECT to_regclass('document_email_participants_backfill')::text")
            .fetch_one(&mut *conn)
            .await?,
        None
    );
    Ok(())
}
