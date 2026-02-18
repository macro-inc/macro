use std::io::Write;

use clap::Parser;
use tempfile::NamedTempFile;

use crate::Cli;
use crate::config::SeedCliContext;
use crate::service::auth::Auth;
use crate::service::db::Db;
use crate::service::s3::S3;

use super::*;

// ── Parsing tests ──────────────────────────────────────────

#[test]
fn parse_email_bulk_generate_minimal() {
    let cli = Cli::try_parse_from([
        "seed_cli",
        "email",
        "bulk-generate",
        "--user-id",
        "test-user-123",
        "--email-address",
        "alice@example.com",
    ])
    .unwrap();

    match cli.command {
        crate::entity::EntityCommand::Email(args) => match args.command {
            EmailCommand::BulkGenerate(bulk) => {
                assert_eq!(bulk.user_id, "test-user-123");
                assert_eq!(bulk.email_address, "alice@example.com");
                assert_eq!(bulk.thread_count, 10);
                assert_eq!(bulk.max_messages_per_thread, 10);
                assert_eq!(bulk.output, "emails.json");
            }
            other => panic!("expected BulkGenerate, got {other:?}"),
        },
        other => panic!("expected Email, got {other:?}"),
    }
}

#[test]
fn parse_email_bulk_generate_with_options() {
    let cli = Cli::try_parse_from([
        "seed_cli",
        "email",
        "bulk-generate",
        "--user-id",
        "test-user-123",
        "--email-address",
        "alice@example.com",
        "--thread-count",
        "50",
        "--max-messages-per-thread",
        "5",
        "--output",
        "custom.json",
    ])
    .unwrap();

    match cli.command {
        crate::entity::EntityCommand::Email(args) => match args.command {
            EmailCommand::BulkGenerate(bulk) => {
                assert_eq!(bulk.thread_count, 50);
                assert_eq!(bulk.max_messages_per_thread, 5);
                assert_eq!(bulk.output, "custom.json");
            }
            other => panic!("expected BulkGenerate, got {other:?}"),
        },
        other => panic!("expected Email, got {other:?}"),
    }
}

#[test]
fn parse_email_bulk_generate_missing_user_id_fails() {
    let result = Cli::try_parse_from([
        "seed_cli",
        "email",
        "bulk-generate",
        "--email-address",
        "alice@example.com",
    ]);
    assert!(result.is_err());
}

#[test]
fn parse_email_bulk_generate_missing_email_fails() {
    let result = Cli::try_parse_from([
        "seed_cli",
        "email",
        "bulk-generate",
        "--user-id",
        "test-user-123",
    ]);
    assert!(result.is_err());
}

#[test]
fn parse_email_seed_defaults() {
    let cli = Cli::try_parse_from(["seed_cli", "email", "seed"]).unwrap();

    match cli.command {
        crate::entity::EntityCommand::Email(args) => match args.command {
            EmailCommand::Seed(create) => {
                assert_eq!(create.file_path, None);
                assert_eq!(create.concurrency, 95);
            }
            other => panic!("expected Seed, got {other:?}"),
        },
        other => panic!("expected Email, got {other:?}"),
    }
}

#[test]
fn parse_email_seed_with_file_path_override() {
    let cli = Cli::try_parse_from([
        "seed_cli",
        "email",
        "seed",
        "--file-path",
        "/tmp/emails.json",
    ])
    .unwrap();

    match cli.command {
        crate::entity::EntityCommand::Email(args) => match args.command {
            EmailCommand::Seed(create) => {
                assert_eq!(create.file_path, Some("/tmp/emails.json".to_string()));
                assert_eq!(create.concurrency, 95);
            }
            other => panic!("expected Seed, got {other:?}"),
        },
        other => panic!("expected Email, got {other:?}"),
    }
}

#[test]
fn parse_email_seed_with_concurrency() {
    let cli = Cli::try_parse_from(["seed_cli", "email", "seed", "--concurrency", "10"]).unwrap();

    match cli.command {
        crate::entity::EntityCommand::Email(args) => match args.command {
            EmailCommand::Seed(create) => {
                assert_eq!(create.concurrency, 10);
            }
            other => panic!("expected Seed, got {other:?}"),
        },
        other => panic!("expected Email, got {other:?}"),
    }
}

// ── Helpers ────────────────────────────────────────────────

fn mock_ctx(db: Db) -> SeedCliContext {
    SeedCliContext {
        db,
        fusionauth_client: Auth::default(),
        s3: S3::default(),
    }
}

fn write_temp_json(content: &str) -> NamedTempFile {
    let mut file = NamedTempFile::new().unwrap();
    file.write_all(content.as_bytes()).unwrap();
    file.flush().unwrap();
    file
}

fn minimal_seed_json(thread_count: usize) -> String {
    let mut threads = Vec::new();
    for _ in 0..thread_count {
        threads.push(serde_json::json!({
            "provider_id": "abcdef0123456789",
            "inbox_visible": true,
            "is_read": false,
            "messages": [{
                "provider_id": "1234567890abcdef",
                "subject": "Test Subject",
                "snippet": null,
                "sent_at": "2024-06-01T12:00:00Z",
                "is_read": false,
                "is_starred": false,
                "is_sent": false,
                "from": { "email": "fakecontact1@gmail.com", "name": "Alice Johnson", "photo_url": null },
                "to": [{ "email": "test@example.com", "name": "Me", "photo_url": null }],
                "cc": [],
                "body_template": "meeting_followup",
                "label_ids": ["INBOX", "UNREAD"]
            }]
        }));
    }

    serde_json::json!({
        "user_id": "test-user-123",
        "email_address": "test@example.com",
        "provider": "Gmail",
        "labels": [
            { "provider_label_id": "INBOX", "name": "INBOX", "label_type": "System" },
            { "provider_label_id": "SENT", "name": "SENT", "label_type": "System" }
        ],
        "threads": threads
    })
    .to_string()
}

// ── Integration tests (seed) ──────────────────────────────

#[tokio::test]
async fn seed_inserts_link_labels_and_threads() {
    let json = minimal_seed_json(2);
    let file = write_temp_json(&json);

    let mut mock_db = Db::default();
    mock_db
        .expect_upsert_email_link()
        .times(1)
        .returning(|link| Ok(link));
    mock_db
        .expect_insert_email_labels()
        .times(1)
        .returning(|_| Ok(()));
    mock_db
        .expect_insert_email_thread()
        .times(2)
        .returning(|_, _| Ok(Uuid::nil()));

    let args = EmailArgs {
        command: EmailCommand::Seed(SeedArgs {
            file_path: Some(file.path().to_str().unwrap().to_string()),
            concurrency: 95,
        }),
    };

    let result = args.execute(mock_ctx(mock_db)).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn seed_single_thread() {
    let json = minimal_seed_json(1);
    let file = write_temp_json(&json);

    let mut mock_db = Db::default();
    mock_db
        .expect_upsert_email_link()
        .times(1)
        .returning(|link| Ok(link));
    mock_db
        .expect_insert_email_labels()
        .times(1)
        .returning(|_| Ok(()));
    mock_db
        .expect_insert_email_thread()
        .times(1)
        .returning(|_, _| Ok(Uuid::nil()));

    let args = EmailArgs {
        command: EmailCommand::Seed(SeedArgs {
            file_path: Some(file.path().to_str().unwrap().to_string()),
            concurrency: 95,
        }),
    };

    let result = args.execute(mock_ctx(mock_db)).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn seed_missing_file_fails() {
    let mock_db = Db::default();

    let args = EmailArgs {
        command: EmailCommand::Seed(SeedArgs {
            file_path: Some("/nonexistent/path.json".to_string()),
            concurrency: 95,
        }),
    };

    let result = args.execute(mock_ctx(mock_db)).await;
    let err = result.unwrap_err();
    assert!(err.to_string().contains("failed to read json file"));
}

#[tokio::test]
async fn seed_invalid_json_fails() {
    let file = write_temp_json("not valid json {{{");

    let mock_db = Db::default();

    let args = EmailArgs {
        command: EmailCommand::Seed(SeedArgs {
            file_path: Some(file.path().to_str().unwrap().to_string()),
            concurrency: 95,
        }),
    };

    let result = args.execute(mock_ctx(mock_db)).await;
    let err = result.unwrap_err();
    assert!(err.to_string().contains("failed to parse seed data json"));
}

#[tokio::test]
async fn seed_continues_on_thread_failure() {
    let json = minimal_seed_json(3);
    let file = write_temp_json(&json);

    let mut mock_db = Db::default();
    mock_db
        .expect_upsert_email_link()
        .times(1)
        .returning(|link| Ok(link));
    mock_db
        .expect_insert_email_labels()
        .times(1)
        .returning(|_| Ok(()));

    let call_count = Arc::new(AtomicU32::new(0));
    let call_count_clone = Arc::clone(&call_count);
    mock_db
        .expect_insert_email_thread()
        .times(3)
        .returning(move |_, _| {
            let n = call_count_clone.fetch_add(1, Ordering::Relaxed);
            if n == 1 {
                Err(anyhow::anyhow!("db error"))
            } else {
                Ok(Uuid::nil())
            }
        });

    let args = EmailArgs {
        command: EmailCommand::Seed(SeedArgs {
            file_path: Some(file.path().to_str().unwrap().to_string()),
            concurrency: 1, // sequential so ordering is predictable
        }),
    };

    let result = args.execute(mock_ctx(mock_db)).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn seed_link_failure_propagates() {
    let json = minimal_seed_json(1);
    let file = write_temp_json(&json);

    let mut mock_db = Db::default();
    mock_db
        .expect_upsert_email_link()
        .times(1)
        .returning(|_| Err(anyhow::anyhow!("link creation failed")));

    let args = EmailArgs {
        command: EmailCommand::Seed(SeedArgs {
            file_path: Some(file.path().to_str().unwrap().to_string()),
            concurrency: 95,
        }),
    };

    let result = args.execute(mock_ctx(mock_db)).await;
    let err = result.unwrap_err();
    assert!(err.to_string().contains("link creation failed"));
}

#[tokio::test]
async fn seed_label_failure_propagates() {
    let json = minimal_seed_json(1);
    let file = write_temp_json(&json);

    let mut mock_db = Db::default();
    mock_db
        .expect_upsert_email_link()
        .times(1)
        .returning(|link| Ok(link));
    mock_db
        .expect_insert_email_labels()
        .times(1)
        .returning(|_| Err(anyhow::anyhow!("label insertion failed")));

    let args = EmailArgs {
        command: EmailCommand::Seed(SeedArgs {
            file_path: Some(file.path().to_str().unwrap().to_string()),
            concurrency: 95,
        }),
    };

    let result = args.execute(mock_ctx(mock_db)).await;
    let err = result.unwrap_err();
    assert!(err.to_string().contains("label insertion failed"));
}

// ── build_thread unit tests ───────────────────────────────

#[test]
fn build_thread_sets_provider_id() {
    let bodies = sample_bodies::load_sample_bodies();
    let seed = SeedThread {
        provider_id: "abc123".to_string(),
        inbox_visible: true,
        is_read: false,
        messages: vec![make_seed_message()],
    };

    let thread = build_thread(&seed, Uuid::nil(), Utc::now(), &bodies);
    assert_eq!(thread.provider_id, Some("abc123".to_string()));
}

#[test]
fn build_thread_resolves_body_template() {
    let bodies = sample_bodies::load_sample_bodies();
    let seed = SeedThread {
        provider_id: "abc123".to_string(),
        inbox_visible: true,
        is_read: false,
        messages: vec![make_seed_message()],
    };

    let thread = build_thread(&seed, Uuid::nil(), Utc::now(), &bodies);
    assert!(thread.messages[0].body_text.is_some());
    assert!(thread.messages[0].body_html_sanitized.is_some());
}

#[test]
fn build_thread_computes_timestamps() {
    let bodies = sample_bodies::load_sample_bodies();
    let sent_at = DateTime::parse_from_rfc3339("2024-06-01T12:00:00Z")
        .unwrap()
        .with_timezone(&Utc);

    let mut msg = make_seed_message();
    msg.sent_at = sent_at;
    msg.is_sent = false;

    let seed = SeedThread {
        provider_id: "abc123".to_string(),
        inbox_visible: true,
        is_read: false,
        messages: vec![msg],
    };

    let thread = build_thread(&seed, Uuid::nil(), Utc::now(), &bodies);
    assert_eq!(thread.latest_inbound_message_ts, Some(sent_at));
    assert_eq!(thread.latest_outbound_message_ts, None);
    assert_eq!(thread.latest_non_spam_message_ts, Some(sent_at));
}

#[test]
fn build_thread_multiple_messages_correct_order() {
    let bodies = sample_bodies::load_sample_bodies();
    let t1 = DateTime::parse_from_rfc3339("2024-06-01T12:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    let t2 = DateTime::parse_from_rfc3339("2024-06-01T13:00:00Z")
        .unwrap()
        .with_timezone(&Utc);

    let mut msg1 = make_seed_message();
    msg1.sent_at = t1;
    msg1.is_sent = false;

    let mut msg2 = make_seed_message();
    msg2.sent_at = t2;
    msg2.is_sent = true;

    let seed = SeedThread {
        provider_id: "abc123".to_string(),
        inbox_visible: true,
        is_read: false,
        messages: vec![msg1, msg2],
    };

    let thread = build_thread(&seed, Uuid::nil(), Utc::now(), &bodies);
    assert_eq!(thread.messages.len(), 2);
    assert_eq!(thread.latest_inbound_message_ts, Some(t1));
    assert_eq!(thread.latest_outbound_message_ts, Some(t2));
    assert_eq!(thread.created_at, t1);
}

// ── Test helpers ──────────────────────────────────────────

fn make_seed_message() -> SeedMessage {
    SeedMessage {
        provider_id: "1234567890abcdef".to_string(),
        subject: Some("Test Subject".to_string()),
        snippet: None,
        sent_at: Utc::now(),
        is_read: false,
        is_starred: false,
        is_sent: false,
        from: ContactInfo {
            email: "fakecontact1@gmail.com".to_string(),
            name: Some("Alice Johnson".to_string()),
            photo_url: None,
        },
        to: vec![ContactInfo {
            email: "test@example.com".to_string(),
            name: Some("Me".to_string()),
            photo_url: None,
        }],
        cc: vec![],
        body_template: "meeting_followup".to_string(),
        label_ids: vec!["INBOX".to_string(), "UNREAD".to_string()],
    }
}
