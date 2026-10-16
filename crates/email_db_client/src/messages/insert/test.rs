use super::*;
use chrono::{DateTime, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::email::service::address::ContactInfo;
use models_email::email::service::attachment::Attachment;
use models_email::email::service::label::Label;
use sqlx::{Pool, Postgres};

const LINK_ID: &str = "00000000-0000-0000-0000-000000000001";
const THREAD_ID: &str = "10000000-0000-0000-0000-000000000001";

/// The Apple Mail one-click-unsubscribe address that wedged mwatts42's
/// backfill: 505 characters, well past `email_contacts.email_address`.
fn unsubscribe_address() -> String {
    let address = format!(
        "v3_{}@unsubscribe-06.emailinboundprocessing.com",
        "t".repeat(460)
    );
    assert_eq!(address.chars().count(), 505);
    address
}

fn message_with_oversized_fields(link_id: Uuid, thread_db_id: Uuid) -> message::Message {
    let now = Utc::now();
    message::Message {
        db_id: Uuid::now_v7(),
        provider_id: Some("oversized-recipient-message".to_string()),
        thread_db_id,
        provider_thread_id: Some("prov1".to_string()),
        replying_to_id: None,
        global_id: Some("<oversized@macro.com>".to_string()),
        link_id,
        subject: Some("unsubscribe".to_string()),
        snippet: None,
        provider_history_id: None,
        internal_date_ts: Some(now),
        sent_at: Some(now),
        size_estimate: Some(1024),
        is_read: true,
        is_starred: false,
        is_sent: true,
        is_draft: false,
        scheduled_send_time: None,
        has_attachments: true,
        from: Some(ContactInfo {
            email: "user1@macro.com".to_string(),
            name: Some("f".repeat(400)),
            photo_url: None,
        }),
        to: vec![
            ContactInfo {
                email: unsubscribe_address(),
                name: None,
                photo_url: None,
            },
            ContactInfo {
                email: "recipient@macro.com".to_string(),
                name: Some("n".repeat(400)),
                photo_url: None,
            },
        ],
        cc: vec![],
        bcc: vec![],
        labels: vec![],
        body_text: Some("body".to_string()),
        body_html_sanitized: Some("<p>body</p>".to_string()),
        body_macro: None,
        attachments: vec![Attachment {
            db_id: Uuid::now_v7(),
            provider_id: Some("att1".to_string()),
            data_url: None,
            reference_url: None,
            filename: Some("report.PDF".to_string()),
            mime_type: Some("m".repeat(400)),
            size_bytes: Some(10),
            sfs_id: None,
            content_id: Some("c".repeat(400)),
        }],
        attachments_draft: vec![],
        attachments_forwarded: vec![],
        headers_json: None,
        created_at: now,
        updated_at: now,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links", "threads"))
)]
async fn oversized_provider_values_do_not_block_the_message_insert(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str(LINK_ID)?;
    let thread_db_id = Uuid::parse_str(THREAD_ID)?;
    let mut message = message_with_oversized_fields(link_id, thread_db_id);
    let message_db_id = message.db_id;

    insert_message(&pool, thread_db_id, &mut message, link_id, false).await?;

    let inserted = sqlx::query!(
        r#"SELECT from_name FROM email_messages WHERE id = $1"#,
        message_db_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        inserted.from_name.as_deref().map(|n| n.chars().count()),
        Some(255)
    );

    // The unstorable address is dropped; every other recipient still lands.
    let recipients = sqlx::query!(
        r#"
        SELECT c.email_address, r.name
        FROM email_message_recipients r
        JOIN email_contacts c ON c.id = r.contact_id
        WHERE r.message_id = $1
        "#,
        message_db_id
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(recipients.len(), 1);
    assert_eq!(recipients[0].email_address, "recipient@macro.com");
    assert_eq!(
        recipients[0].name.as_deref().map(|n| n.chars().count()),
        Some(255)
    );

    let contacts = sqlx::query_scalar!(
        r#"SELECT email_address FROM email_contacts WHERE link_id = $1 ORDER BY email_address"#,
        link_id
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(contacts, vec!["recipient@macro.com", "user1@macro.com"]);

    let attachment = sqlx::query!(
        r#"
        SELECT mime_type, content_id
        FROM email_attachments
        WHERE message_id = $1
        "#,
        message_db_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        attachment.mime_type.as_deref().map(|m| m.chars().count()),
        Some(255)
    );
    assert_eq!(
        attachment.content_id.as_deref().map(|c| c.chars().count()),
        Some(255)
    );

    Ok(())
}

pub(crate) const PARENT_GLOBAL_ID: &str = "<parent@macro.com>";

fn contact(email: &str) -> ContactInfo {
    ContactInfo {
        email: email.to_string(),
        name: None,
        photo_url: None,
    }
}

/// A message as the provider sync builds it: a fresh `db_id` on every sync and no
/// `replying_to_id`, which is resolved from the headers after the insert.
pub(crate) struct SyncedMessage<'a> {
    pub(crate) provider_id: &'a str,
    pub(crate) global_id: &'a str,
    pub(crate) in_reply_to: Option<&'a str>,
    pub(crate) to: &'a [&'a str],
    pub(crate) cc: &'a [&'a str],
    pub(crate) labels: &'a [&'a str],
    pub(crate) body: &'a str,
}

impl SyncedMessage<'_> {
    pub(crate) fn build(&self, link_id: Uuid, thread_db_id: Uuid) -> message::Message {
        let ts = DateTime::<Utc>::from_timestamp(1_790_000_000, 0).expect("valid timestamp");
        let headers = self.in_reply_to.map(|in_reply_to| {
            serde_json::json!([
                { "name": "Message-ID", "value": self.global_id },
                { "name": "In-Reply-To", "value": in_reply_to },
            ])
        });
        message::Message {
            db_id: Uuid::now_v7(),
            provider_id: Some(self.provider_id.to_string()),
            thread_db_id,
            provider_thread_id: Some("prov1".to_string()),
            replying_to_id: None,
            global_id: Some(self.global_id.to_string()),
            link_id,
            subject: Some("quarterly numbers".to_string()),
            snippet: Some("snippet".to_string()),
            provider_history_id: Some("1001".to_string()),
            internal_date_ts: Some(ts),
            sent_at: Some(ts),
            size_estimate: Some(self.body.len() as i64),
            is_read: false,
            is_starred: false,
            is_sent: false,
            is_draft: false,
            scheduled_send_time: None,
            has_attachments: false,
            from: Some(contact("sender@macro.com")),
            to: self.to.iter().copied().map(contact).collect(),
            cc: self.cc.iter().copied().map(contact).collect(),
            bcc: vec![],
            labels: self
                .labels
                .iter()
                .map(|provider_label_id| Label {
                    id: None,
                    link_id,
                    provider_label_id: provider_label_id.to_string(),
                    name: None,
                    created_at: ts,
                    message_list_visibility: None,
                    label_list_visibility: None,
                    type_: None,
                })
                .collect(),
            body_text: Some(self.body.to_string()),
            body_html_sanitized: Some(format!("<p>{}</p>", self.body)),
            body_macro: None,
            attachments: vec![],
            attachments_draft: vec![],
            attachments_forwarded: vec![],
            headers_json: headers,
            created_at: ts,
            updated_at: ts,
        }
    }
}

async fn seed_labels(pool: &PgPool, link_id: Uuid) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO email_labels (id, link_id, provider_label_id, name)
        VALUES ($1, $3, 'INBOX', 'INBOX'), ($2, $3, 'UNREAD', 'UNREAD')
        "#,
        Uuid::now_v7(),
        Uuid::now_v7(),
        link_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Row versions (`xmin`) of a message and its recipient and label rows. Any rewrite, or a
/// delete followed by a re-insert, produces a new version.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct RowVersions {
    pub(crate) message: String,
    pub(crate) recipients: Vec<(String, String, String)>,
    pub(crate) labels: Vec<(String, String)>,
}

pub(crate) async fn row_versions(pool: &PgPool, message_id: Uuid) -> anyhow::Result<RowVersions> {
    let message = sqlx::query_scalar!(
        r#"SELECT xmin::text AS "xmin!" FROM email_messages WHERE id = $1"#,
        message_id
    )
    .fetch_one(pool)
    .await?;

    let recipients = sqlx::query!(
        r#"
        SELECT c.email_address, r.recipient_type::text AS "recipient_type!", r.xmin::text AS "xmin!"
        FROM email_message_recipients r
        JOIN email_contacts c ON c.id = r.contact_id
        WHERE r.message_id = $1
        ORDER BY c.email_address, r.recipient_type
        "#,
        message_id
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|r| (r.email_address, r.recipient_type, r.xmin))
    .collect();

    let labels = sqlx::query!(
        r#"
        SELECT l.provider_label_id, ml.xmin::text AS "xmin!"
        FROM email_message_labels ml
        JOIN email_labels l ON l.id = ml.label_id
        WHERE ml.message_id = $1
        ORDER BY l.provider_label_id
        "#,
        message_id
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|r| (r.provider_label_id, r.xmin))
    .collect();

    Ok(RowVersions {
        message,
        recipients,
        labels,
    })
}

/// `email_messages` row updates and TOAST chunk inserts. On Postgres 15+ the `xact` counters also
/// include unflushed counts from earlier transactions on the same connection, so only compare
/// against a baseline read in the same transaction.
#[derive(Debug, PartialEq, Eq)]
struct MessageWrites {
    updated: i64,
    toast_inserted: i64,
}

impl MessageWrites {
    fn since(self, baseline: &MessageWrites) -> MessageWrites {
        MessageWrites {
            updated: self.updated - baseline.updated,
            toast_inserted: self.toast_inserted - baseline.toast_inserted,
        }
    }
}

async fn message_writes(tx: &mut sqlx::PgConnection) -> anyhow::Result<MessageWrites> {
    let row = sqlx::query!(
        r#"
        SELECT
            pg_stat_get_xact_tuples_updated('email_messages'::regclass) AS "updated!",
            pg_stat_get_xact_tuples_inserted(
                (SELECT reltoastrelid FROM pg_class WHERE oid = 'email_messages'::regclass)
            ) AS "toast_inserted!"
        "#
    )
    .fetch_one(&mut *tx)
    .await?;
    Ok(MessageWrites {
        updated: row.updated,
        toast_inserted: row.toast_inserted,
    })
}

async fn from_contact_id(pool: &PgPool, message_id: Uuid) -> anyhow::Result<Option<Uuid>> {
    Ok(sqlx::query_scalar!(
        r#"SELECT from_contact_id FROM email_messages WHERE id = $1"#,
        message_id
    )
    .fetch_one(pool)
    .await?)
}

/// Large enough that Postgres stores the bodies out of line in TOAST.
fn large_body() -> String {
    (0..2_000)
        .map(|_| Uuid::now_v7().to_string())
        .collect::<Vec<_>>()
        .join(" ")
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links", "threads"))
)]
async fn resyncing_an_unchanged_message_writes_nothing(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str(LINK_ID)?;
    let thread_db_id = Uuid::parse_str(THREAD_ID)?;
    seed_labels(&pool, link_id).await?;

    let mut parent = SyncedMessage {
        provider_id: "parent",
        global_id: PARENT_GLOBAL_ID,
        in_reply_to: None,
        to: &["user1@macro.com"],
        cc: &[],
        labels: &["INBOX"],
        body: "parent body",
    }
    .build(link_id, thread_db_id);
    insert_message(&pool, thread_db_id, &mut parent, link_id, true).await?;

    let body = large_body();
    let reply = SyncedMessage {
        provider_id: "reply",
        global_id: "<reply@macro.com>",
        in_reply_to: Some(PARENT_GLOBAL_ID),
        to: &["user1@macro.com"],
        cc: &["cc@macro.com"],
        labels: &["INBOX", "UNREAD"],
        body: &body,
    };
    let mut first_sync = reply.build(link_id, thread_db_id);
    let reply_id = first_sync.db_id;
    insert_message(&pool, thread_db_id, &mut first_sync, link_id, true).await?;

    let replying_to = sqlx::query_scalar!(
        r#"SELECT replying_to_id FROM email_messages WHERE id = $1"#,
        reply_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(replying_to, Some(parent.db_id));

    let before = row_versions(&pool, reply_id).await?;
    assert_eq!(before.recipients.len(), 2);
    assert_eq!(before.labels.len(), 2);

    // The full ingest path: message upsert, recipients, labels and the replying_to update.
    let mut resync = reply.build(link_id, thread_db_id);
    insert_message(&pool, thread_db_id, &mut resync, link_id, true).await?;

    assert_eq!(
        row_versions(&pool, reply_id).await?,
        before,
        "re-syncing identical data must not write new row versions"
    );
    let replying_to = sqlx::query_scalar!(
        r#"SELECT replying_to_id FROM email_messages WHERE id = $1"#,
        reply_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(replying_to, Some(parent.db_id));

    // The skipped upsert still resolves the stored row's id.
    let from_contact_id = from_contact_id(&pool, reply_id).await?;
    let mut tx = pool.begin().await?;
    let baseline = message_writes(&mut tx).await?;
    let mut resync = reply.build(link_id, thread_db_id);
    let returned_id =
        insert_db_message(&mut tx, &mut resync, thread_db_id, from_contact_id, true).await?;
    assert_eq!(returned_id, reply_id);
    assert_eq!(
        message_writes(&mut tx).await?.since(&baseline),
        MessageWrites {
            updated: 0,
            toast_inserted: 0
        }
    );
    tx.rollback().await?;

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links", "threads"))
)]
async fn changed_flag_updates_the_row_without_rewriting_body_toast(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str(LINK_ID)?;
    let thread_db_id = Uuid::parse_str(THREAD_ID)?;
    let body = large_body();
    let synced = SyncedMessage {
        provider_id: "toasted",
        global_id: "<toasted@macro.com>",
        in_reply_to: None,
        to: &["user1@macro.com"],
        cc: &[],
        labels: &[],
        body: &body,
    };
    let mut first_sync = synced.build(link_id, thread_db_id);
    let message_id = first_sync.db_id;
    insert_message(&pool, thread_db_id, &mut first_sync, link_id, false).await?;
    let from_contact_id = from_contact_id(&pool, message_id).await?;

    let mut tx = pool.begin().await?;
    let baseline = message_writes(&mut tx).await?;
    let mut read = synced.build(link_id, thread_db_id);
    read.is_read = true;
    let returned_id =
        insert_db_message(&mut tx, &mut read, thread_db_id, from_contact_id, false).await?;
    assert_eq!(returned_id, message_id);
    assert_eq!(
        message_writes(&mut tx).await?.since(&baseline),
        MessageWrites {
            updated: 1,
            toast_inserted: 0
        },
        "an unchanged body must keep its TOAST chunks"
    );

    let edited_body = format!("{body} edited");
    let edited = SyncedMessage {
        body: &edited_body,
        ..synced
    };
    let mut edited = edited.build(link_id, thread_db_id);
    edited.is_read = true;
    insert_db_message(&mut tx, &mut edited, thread_db_id, from_contact_id, false).await?;
    let writes = message_writes(&mut tx).await?.since(&baseline);
    assert_eq!(writes.updated, 2);
    assert!(
        writes.toast_inserted > 0,
        "a changed body is written to TOAST"
    );
    tx.commit().await?;

    let stored = sqlx::query!(
        r#"SELECT is_read, body_text FROM email_messages WHERE id = $1"#,
        message_id
    )
    .fetch_one(&pool)
    .await?;
    assert!(stored.is_read);
    assert_eq!(stored.body_text.as_deref(), Some(edited_body.as_str()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links", "threads"))
)]
async fn resync_with_changed_labels_and_recipients_replaces_only_the_changes(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str(LINK_ID)?;
    let thread_db_id = Uuid::parse_str(THREAD_ID)?;
    seed_labels(&pool, link_id).await?;

    let synced = SyncedMessage {
        provider_id: "relabelled",
        global_id: "<relabelled@macro.com>",
        in_reply_to: None,
        to: &["user1@macro.com"],
        cc: &["old-cc@macro.com"],
        labels: &["INBOX", "UNREAD"],
        body: "body",
    };
    let mut first_sync = synced.build(link_id, thread_db_id);
    let message_id = first_sync.db_id;
    insert_message(&pool, thread_db_id, &mut first_sync, link_id, false).await?;
    let before = row_versions(&pool, message_id).await?;

    let mut resync = SyncedMessage {
        cc: &["new-cc@macro.com"],
        labels: &["INBOX"],
        ..synced
    }
    .build(link_id, thread_db_id);
    insert_message(&pool, thread_db_id, &mut resync, link_id, false).await?;
    let after = row_versions(&pool, message_id).await?;

    assert_eq!(after.message, before.message);
    assert_eq!(
        after
            .recipients
            .iter()
            .map(|(email, kind, _)| (email.as_str(), kind.as_str()))
            .collect::<Vec<_>>(),
        vec![("new-cc@macro.com", "CC"), ("user1@macro.com", "TO")]
    );
    let kept_to = |versions: &RowVersions| {
        versions
            .recipients
            .iter()
            .find(|(email, _, _)| email == "user1@macro.com")
            .cloned()
    };
    assert_eq!(kept_to(&after), kept_to(&before));
    assert_eq!(after.labels, vec![before.labels[0].clone()]);
    assert_eq!(after.labels[0].0, "INBOX");

    Ok(())
}
