use std::io::Write;

use clap::Parser;
use comms_db_client::model::SimpleMention;
use tempfile::NamedTempFile;
use uuid::Uuid;

use crate::Cli;
use crate::config::SeedCliContext;
use crate::service::auth::Auth;
use crate::service::db::Db;
use crate::service::s3::S3;

use super::*;

// ── Parsing tests (seed) ──────────────────────────────────

#[test]
fn parse_channel_message_seed() {
    let cli = Cli::try_parse_from(["seed_cli", "channel-message", "seed"]).unwrap();

    match cli.command {
        crate::entity::EntityCommand::ChannelMessage(args) => match args.command {
            ChannelMessageCommand::Seed => {}
            other => panic!("expected Seed, got {other:?}"),
        },
        other => panic!("expected ChannelMessage, got {other:?}"),
    }
}

// ── Parsing tests ──────────────────────────────────────────

#[test]
fn parse_channel_message_create_minimal() {
    let channel_id = Uuid::nil().to_string();
    let cli = Cli::try_parse_from([
        "seed_cli",
        "channel-message",
        "create",
        "--channel-id",
        &channel_id,
        "--sender-id",
        "macro|alice@example.com",
        "--content",
        "Hello, world!",
    ])
    .unwrap();

    match cli.command {
        crate::entity::EntityCommand::ChannelMessage(args) => match args.command {
            ChannelMessageCommand::Create(create) => {
                assert_eq!(create.channel_id, Uuid::nil());
                assert_eq!(create.sender_id, "macro|alice@example.com");
                assert_eq!(create.content, "Hello, world!");
                assert!(create.thread_id.is_none());
            }
            other => panic!("expected Create, got {other:?}"),
        },
        other => panic!("expected ChannelMessage, got {other:?}"),
    }
}

#[test]
fn parse_channel_message_create_with_thread_id() {
    let channel_id = Uuid::nil().to_string();
    let thread_id = Uuid::from_u128(1).to_string();
    let cli = Cli::try_parse_from([
        "seed_cli",
        "channel-message",
        "create",
        "--channel-id",
        &channel_id,
        "--sender-id",
        "macro|alice@example.com",
        "--content",
        "This is a reply",
        "--thread-id",
        &thread_id,
    ])
    .unwrap();

    match cli.command {
        crate::entity::EntityCommand::ChannelMessage(args) => match args.command {
            ChannelMessageCommand::Create(create) => {
                assert_eq!(create.channel_id, Uuid::nil());
                assert_eq!(create.sender_id, "macro|alice@example.com");
                assert_eq!(create.content, "This is a reply");
                assert_eq!(create.thread_id, Some(Uuid::from_u128(1)));
            }
            other => panic!("expected Create, got {other:?}"),
        },
        other => panic!("expected ChannelMessage, got {other:?}"),
    }
}

#[test]
fn parse_channel_message_create_missing_channel_id_fails() {
    let result = Cli::try_parse_from([
        "seed_cli",
        "channel-message",
        "create",
        "--sender-id",
        "macro|alice@example.com",
        "--content",
        "Hello",
    ]);
    assert!(result.is_err());
}

#[test]
fn parse_channel_message_create_missing_sender_id_fails() {
    let channel_id = Uuid::nil().to_string();
    let result = Cli::try_parse_from([
        "seed_cli",
        "channel-message",
        "create",
        "--channel-id",
        &channel_id,
        "--content",
        "Hello",
    ]);
    assert!(result.is_err());
}

#[test]
fn parse_channel_message_create_missing_content_fails() {
    let channel_id = Uuid::nil().to_string();
    let result = Cli::try_parse_from([
        "seed_cli",
        "channel-message",
        "create",
        "--channel-id",
        &channel_id,
        "--sender-id",
        "macro|alice@example.com",
    ]);
    assert!(result.is_err());
}

#[test]
fn parse_channel_message_create_invalid_channel_id_fails() {
    let result = Cli::try_parse_from([
        "seed_cli",
        "channel-message",
        "create",
        "--channel-id",
        "not-a-uuid",
        "--sender-id",
        "macro|alice@example.com",
        "--content",
        "Hello",
    ]);
    assert!(result.is_err());
}

// ── parse_entity_mentions tests ───────────────────────────

#[test]
fn parse_entity_mentions_valid() {
    let raw = vec![
        "user|macro|alice@example.com".to_string(),
        "document|doc-123".to_string(),
    ];
    let mentions = parse_entity_mentions(&raw).unwrap();
    assert_eq!(mentions.len(), 2);
    assert_eq!(mentions[0].entity_type, "user");
    assert_eq!(mentions[0].entity_id, "macro|alice@example.com");
    assert_eq!(mentions[1].entity_type, "document");
    assert_eq!(mentions[1].entity_id, "doc-123");
}

#[test]
fn parse_entity_mentions_empty() {
    let raw: Vec<String> = vec![];
    let mentions = parse_entity_mentions(&raw).unwrap();
    assert!(mentions.is_empty());
}

#[test]
fn parse_entity_mentions_invalid_format() {
    let raw = vec!["no-pipe-here".to_string()];
    let result = parse_entity_mentions(&raw);
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("invalid entity mention format")
    );
}

// ── Helpers ────────────────────────────────────────────────

fn mock_ctx(db: Db) -> SeedCliContext {
    SeedCliContext {
        db,
        fusionauth_client: Auth::default(),
        s3: S3::default(),
    }
}

fn write_temp_csv(content: &str) -> NamedTempFile {
    let mut file = NamedTempFile::new().unwrap();
    file.write_all(content.as_bytes()).unwrap();
    file.flush().unwrap();
    file
}

// ── Integration tests (single create) ─────────────────────

#[tokio::test]
async fn create_message_success() {
    let channel_id = Uuid::nil();

    let mut mock_db = Db::default();
    mock_db
        .expect_create_message()
        .times(1)
        .withf(move |opts| {
            opts.channel_id == channel_id
                && opts.sender_id == "macro|alice@example.com"
                && opts.content == "Hello, world!"
                && opts.thread_id.is_none()
        })
        .returning(|_| Ok(Uuid::nil()));

    let args = ChannelMessageArgs {
        command: ChannelMessageCommand::Create(CreateArgs {
            channel_id,
            sender_id: "macro|alice@example.com".to_string(),
            content: "Hello, world!".to_string(),
            thread_id: None,
        }),
    };

    let result = args.execute(mock_ctx(mock_db)).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn create_message_with_thread_id() {
    let channel_id = Uuid::nil();
    let thread_id = Uuid::from_u128(1);

    let mut mock_db = Db::default();
    mock_db
        .expect_create_message()
        .times(1)
        .withf(move |opts| {
            opts.channel_id == channel_id
                && opts.sender_id == "macro|alice@example.com"
                && opts.content == "This is a reply"
                && opts.thread_id == Some(thread_id)
        })
        .returning(|_| Ok(Uuid::nil()));

    let args = ChannelMessageArgs {
        command: ChannelMessageCommand::Create(CreateArgs {
            channel_id,
            sender_id: "macro|alice@example.com".to_string(),
            content: "This is a reply".to_string(),
            thread_id: Some(thread_id),
        }),
    };

    let result = args.execute(mock_ctx(mock_db)).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn create_message_db_failure_propagates_error() {
    let mut mock_db = Db::default();
    mock_db
        .expect_create_message()
        .times(1)
        .returning(|_| Err(anyhow::anyhow!("db connection failed")));

    let args = ChannelMessageArgs {
        command: ChannelMessageCommand::Create(CreateArgs {
            channel_id: Uuid::nil(),
            sender_id: "macro|alice@example.com".to_string(),
            content: "Hello".to_string(),
            thread_id: None,
        }),
    };

    let result = args.execute(mock_ctx(mock_db)).await;
    let err = result.unwrap_err();
    assert!(err.to_string().contains("db connection failed"));
}

// ── Seed CSV tests ────────────────────────────────────────

#[tokio::test]
async fn seed_creates_all_messages() {
    let msg1 = Uuid::new_v4();
    let msg2 = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let csv = format!(
        "message_id,channel_id,sender_id,content,thread_id,entity_mentions\n\
         {msg1},{channel_id},macro|alice@example.com,Hello world,,\n\
         {msg2},{channel_id},macro|bob@example.com,Hi there,,\n"
    );
    let file = write_temp_csv(&csv);

    let mut mock_db = Db::default();
    mock_db
        .expect_seed_message()
        .times(2)
        .returning(|opts| Ok(opts.message_id));

    let result = seed_from_file(mock_ctx(mock_db), file.path()).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn seed_uses_provided_message_id() {
    let msg_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let csv = format!(
        "message_id,channel_id,sender_id,content,thread_id,entity_mentions\n\
         {msg_id},{channel_id},macro|alice@example.com,Test message,,\n"
    );
    let file = write_temp_csv(&csv);

    let mut mock_db = Db::default();
    mock_db
        .expect_seed_message()
        .times(1)
        .withf(move |opts| opts.message_id == msg_id && opts.channel_id == channel_id)
        .returning(|opts| Ok(opts.message_id));

    let result = seed_from_file(mock_ctx(mock_db), file.path()).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn seed_with_thread_id() {
    let msg_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let thread_id = Uuid::new_v4();
    let csv = format!(
        "message_id,channel_id,sender_id,content,thread_id,entity_mentions\n\
         {msg_id},{channel_id},macro|alice@example.com,Thread reply,{thread_id},\n"
    );
    let file = write_temp_csv(&csv);

    let mut mock_db = Db::default();
    mock_db
        .expect_seed_message()
        .times(1)
        .withf(move |opts| opts.thread_id == Some(thread_id))
        .returning(|opts| Ok(opts.message_id));

    let result = seed_from_file(mock_ctx(mock_db), file.path()).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn seed_empty_csv_fails() {
    let csv = "message_id,channel_id,sender_id,content,thread_id,entity_mentions\n";
    let file = write_temp_csv(csv);

    let mock_db = Db::default();

    let result = seed_from_file(mock_ctx(mock_db), file.path()).await;
    let err = result.unwrap_err();
    assert!(err.to_string().contains("no messages found"));
}

#[tokio::test]
async fn seed_continues_on_failure() {
    let msg1 = Uuid::new_v4();
    let msg2 = Uuid::new_v4();
    let msg3 = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let csv = format!(
        "message_id,channel_id,sender_id,content,thread_id,entity_mentions\n\
         {msg1},{channel_id},macro|alice@example.com,Good 1,,\n\
         {msg2},{channel_id},macro|bad@example.com,Bad,,\n\
         {msg3},{channel_id},macro|bob@example.com,Good 2,,\n"
    );
    let file = write_temp_csv(&csv);

    let mut mock_db = Db::default();
    mock_db.expect_seed_message().times(3).returning(|opts| {
        if opts.sender_id == "macro|bad@example.com" {
            Err(anyhow::anyhow!("db error"))
        } else {
            Ok(opts.message_id)
        }
    });

    let result = seed_from_file(mock_ctx(mock_db), file.path()).await;
    assert!(result.is_ok());
}

// ── Mention flow tests ────────────────────────────────────

#[tokio::test]
async fn seed_with_mentions_calls_create_message_mentions() {
    let msg_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let csv = format!(
        "message_id,channel_id,sender_id,content,thread_id,entity_mentions\n\
         {msg_id},{channel_id},macro|alice@example.com,Check this doc,,document|doc-123;user|macro|bob@example.com\n"
    );
    let file = write_temp_csv(&csv);

    let mut mock_db = Db::default();
    mock_db
        .expect_seed_message()
        .times(1)
        .returning(|opts| Ok(opts.message_id));
    mock_db
        .expect_create_message_mentions()
        .times(1)
        .withf(move |mid, mentions| {
            *mid == msg_id
                && mentions.len() == 2
                && mentions[0]
                    == (SimpleMention {
                        entity_type: "document".to_string(),
                        entity_id: "doc-123".to_string(),
                    })
                && mentions[1]
                    == (SimpleMention {
                        entity_type: "user".to_string(),
                        entity_id: "macro|bob@example.com".to_string(),
                    })
        })
        .returning(|_, _| Ok(vec![]));
    mock_db
        .expect_update_share_permissions_for_mention()
        .times(1)
        .withf(move |cid, item_id, item_type| {
            *cid == channel_id && item_id == "doc-123" && item_type == "document"
        })
        .returning(|_, _, _| Ok(()));

    let result = seed_from_file(mock_ctx(mock_db), file.path()).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn seed_without_mentions_does_not_call_mention_methods() {
    let msg_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let csv = format!(
        "message_id,channel_id,sender_id,content,thread_id,entity_mentions\n\
         {msg_id},{channel_id},macro|alice@example.com,No mentions here,,\n"
    );
    let file = write_temp_csv(&csv);

    let mut mock_db = Db::default();
    mock_db
        .expect_seed_message()
        .times(1)
        .returning(|opts| Ok(opts.message_id));
    mock_db
        .expect_create_message_mentions()
        .never()
        .returning(|_, _| Ok(vec![]));
    mock_db
        .expect_update_share_permissions_for_mention()
        .never()
        .returning(|_, _, _| Ok(()));

    let result = seed_from_file(mock_ctx(mock_db), file.path()).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn seed_mention_failure_does_not_prevent_message_creation() {
    let msg1 = Uuid::new_v4();
    let msg2 = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let csv = format!(
        "message_id,channel_id,sender_id,content,thread_id,entity_mentions\n\
         {msg1},{channel_id},macro|alice@example.com,With mentions,,document|doc-123\n\
         {msg2},{channel_id},macro|bob@example.com,After mention fail,,\n"
    );
    let file = write_temp_csv(&csv);

    let mut mock_db = Db::default();
    mock_db
        .expect_seed_message()
        .times(2)
        .returning(|opts| Ok(opts.message_id));
    mock_db
        .expect_create_message_mentions()
        .times(1)
        .returning(|_, _| Err(anyhow::anyhow!("mention insert failed")));
    mock_db
        .expect_update_share_permissions_for_mention()
        .times(1)
        .returning(|_, _, _| Ok(()));

    let result = seed_from_file(mock_ctx(mock_db), file.path()).await;
    assert!(result.is_ok());
}
