//! Values PostgreSQL can't store: a NUL character is removed before the write,
//! and a message the database still refuses stops after three tries.

use super::retries::{Provider, outcomes, queue, row, sync};
use super::{fixture, snapshot};
use crate::telemetry_capture::Telemetry;
use email_api_client::domain::models::{Attention, MailboxState};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::email::service::address::ContactInfo;
use models_email::email::service::attachment::Attachment;
use sqlx::PgPool;
use uuid::Uuid;

fn inbox() -> MailboxState {
    MailboxState {
        in_inbox: true,
        attention: Attention::Primary,
        ..Default::default()
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_message_with_nul_characters_is_stored_without_them(db: PgPool) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = fixture(&db).await;
    let mut first = snapshot(link, "nul", inbox(), "v1");
    let message = &mut first.content.message;
    message.subject = Some("Quarterly\0 report".into());
    message.snippet = Some("Numbers\0 attached".into());
    message.body_text = Some("Hello\0 team".into());
    message.body_html_sanitized = Some("<p>Hello\0 team</p>".into());
    message.global_id = Some("<report\0@example.com>".into());
    message.headers_json = Some(serde_json::json!([
        {"name": "Subject", "value": "Quarterly\0 report"},
        {"name\0": "X-Mailer"},
    ]));
    message.from = Some(ContactInfo {
        email: "sender@example.com".into(),
        name: Some("Ada\0 Lovelace".into()),
        photo_url: None,
    });
    message.to = vec![
        ContactInfo {
            email: "reader@example.com".into(),
            name: Some("Grace\0 Hopper".into()),
            photo_url: None,
        },
        ContactInfo {
            email: "broken\0@example.com".into(),
            name: None,
            photo_url: None,
        },
    ];
    message.has_attachments = true;
    message.attachments = vec![Attachment {
        reference_url: None,
        db_id: Uuid::now_v7(),
        provider_id: Some("attachment".into()),
        data_url: None,
        filename: Some("report\0.pdf".into()),
        mime_type: Some("application/pdf\0".into()),
        size_bytes: Some(10),
        sfs_id: None,
        content_id: Some("report\0-part".into()),
    }];
    // The second read of the same message re-syncs the stored row, which also
    // writes its draft snapshot.
    let mut second = first.clone();
    second.version = Some("v2".into());
    queue(&db, link, "nul", 0).await;
    let service = sync(&repo, Provider::answering(vec![Ok(Some(first))]));

    assert!(service.reconcile_once().await.unwrap());

    queue(&db, link, "nul", 0).await;
    let service = sync(&repo, Provider::answering(vec![Ok(Some(second))]));
    assert!(service.reconcile_once().await.unwrap());

    assert_eq!(
        telemetry
            .spans("outlook.sync.reconcile")
            .iter()
            .map(|span| span["outlook.outcome"].as_str())
            .collect::<Vec<_>>(),
        ["imported", "imported"]
    );
    let stored = sqlx::query!(
        r#"SELECT subject,snippet,body_text,body_html_sanitized,global_id,from_name,headers_jsonb,provider_version
        FROM email_messages WHERE link_id = $1 AND provider_id = 'nul'"#,
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(stored.subject.as_deref(), Some("Quarterly report"));
    assert_eq!(stored.snippet.as_deref(), Some("Numbers attached"));
    assert_eq!(stored.body_text.as_deref(), Some("Hello team"));
    assert_eq!(
        stored.body_html_sanitized.as_deref(),
        Some("<p>Hello team</p>")
    );
    assert_eq!(stored.global_id.as_deref(), Some("<report@example.com>"));
    assert_eq!(stored.from_name.as_deref(), Some("Ada Lovelace"));
    assert_eq!(
        stored.headers_jsonb,
        Some(serde_json::json!([
            {"name": "Subject", "value": "Quarterly report"},
            {"name": "X-Mailer"},
        ]))
    );
    assert_eq!(stored.provider_version.as_deref(), Some("v2"));

    let contacts = sqlx::query!(
        r#"SELECT c.email_address,c.name FROM email_contacts c WHERE c.link_id = $1 ORDER BY c.email_address"#,
        link
    )
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(
        contacts
            .iter()
            .map(|contact| (contact.email_address.as_str(), contact.name.as_deref()))
            .collect::<Vec<_>>(),
        [
            ("reader@example.com", Some("Grace Hopper")),
            ("sender@example.com", Some("Ada Lovelace")),
        ],
        "an address with a NUL is dropped, like any address that can't be stored"
    );

    let attachment = sqlx::query!(
        r#"SELECT a.filename,a.mime_type,a.content_id FROM email_attachments a
        JOIN email_messages m ON m.id = a.message_id WHERE m.link_id = $1"#,
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(
        (
            attachment.filename.as_deref(),
            attachment.mime_type.as_deref(),
            attachment.content_id.as_deref()
        ),
        (
            Some("report.pdf"),
            Some("application/pdf"),
            Some("report-part")
        )
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_message_the_database_refuses_stops_after_three_attempts(db: PgPool) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = fixture(&db).await;
    let mut refused = snapshot(link, "refused", inbox(), "v1");
    // PostgreSQL timestamps start in 4713 BC, so the insert fails with 22008.
    refused.content.message.internal_date_ts = chrono::NaiveDate::from_ymd_opt(-10_000, 1, 1)
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .map(|date| date.and_utc());
    queue(&db, link, "refused", 0).await;
    let service = sync(
        &repo,
        Provider::answering(vec![Ok(Some(refused.clone())), Ok(Some(refused))]),
    );

    let error = service.reconcile_once().await.unwrap_err();

    assert_eq!(
        error.to_string(),
        "mailbox data cannot be stored: sqlstate 22008"
    );
    let parked = row(&db, link, "refused").await;
    assert!(!parked.abandoned);
    assert_eq!(parked.attempts, 1);
    assert!(
        (595..=600).contains(&parked.delay_seconds),
        "a refused value waits 10 minutes, not an outage's 30 seconds: {}",
        parked.delay_seconds
    );

    sqlx::query!(
        "UPDATE email_message_reconciliation SET attempts = 2, available_at = now() WHERE link_id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(service.reconcile_once().await.is_err());

    assert_eq!(
        outcomes(&telemetry),
        [
            ("deferred".into(), "unstorable".into(), Some("600".into())),
            ("abandoned".into(), "unstorable".into(), None),
        ]
    );
    let abandoned = row(&db, link, "refused").await;
    assert!(
        abandoned.abandoned,
        "the third refusal abandons the message"
    );
    assert_eq!(abandoned.attempts, 0);
    let events = telemetry.events("mailbox message abandoned");
    let [(level, fields)] = events.as_slice() else {
        panic!("expected one abandonment, got {events:?}");
    };
    assert_eq!(*level, tracing::Level::WARN);
    assert_eq!(fields["defer_reason"], "unstorable");
    assert_eq!(fields["attempts"], "3");
}
