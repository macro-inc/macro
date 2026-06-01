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
fn parse_channel_create_minimal() {
    let cli = Cli::try_parse_from([
        "seed_cli",
        "channel",
        "create",
        "--channel-owner",
        "macro|alice@example.com",
        "--channel-type",
        "public",
    ])
    .unwrap();

    match cli.command {
        crate::entity::EntityCommand::Channel(args) => match args.command {
            ChannelCommand::Create(create) => {
                assert_eq!(create.channel_owner, "macro|alice@example.com");
                assert!(matches!(create.channel_type, CliChannelType::Public));
                assert!(create.channel_name.is_none());
                assert!(create.channel_members.is_empty());
            }
            other => panic!("expected Create, got {other:?}"),
        },
        other => panic!("expected Channel, got {other:?}"),
    }
}

#[test]
fn parse_channel_create_full() {
    let cli = Cli::try_parse_from([
        "seed_cli",
        "channel",
        "create",
        "--channel-name",
        "general",
        "--channel-owner",
        "macro|alice@example.com",
        "--channel-type",
        "private",
        "--channel-members",
        "macro|bob@example.com,macro|charlie@example.com",
    ])
    .unwrap();

    match cli.command {
        crate::entity::EntityCommand::Channel(args) => match args.command {
            ChannelCommand::Create(create) => {
                assert_eq!(create.channel_name.as_deref(), Some("general"));
                assert_eq!(create.channel_owner, "macro|alice@example.com");
                assert!(matches!(create.channel_type, CliChannelType::Private));
                assert_eq!(
                    create.channel_members,
                    vec!["macro|bob@example.com", "macro|charlie@example.com"]
                );
            }
            other => panic!("expected Create, got {other:?}"),
        },
        other => panic!("expected Channel, got {other:?}"),
    }
}

#[test]
fn parse_channel_create_direct_message_type() {
    let cli = Cli::try_parse_from([
        "seed_cli",
        "channel",
        "create",
        "--channel-owner",
        "macro|alice@example.com",
        "--channel-type",
        "direct-message",
    ])
    .unwrap();

    match cli.command {
        crate::entity::EntityCommand::Channel(args) => match args.command {
            ChannelCommand::Create(create) => {
                assert!(matches!(create.channel_type, CliChannelType::DirectMessage));
            }
            other => panic!("expected Create, got {other:?}"),
        },
        other => panic!("expected Channel, got {other:?}"),
    }
}

#[test]
fn parse_channel_create_missing_owner_fails() {
    let result = Cli::try_parse_from(["seed_cli", "channel", "create", "--channel-type", "public"]);
    assert!(result.is_err());
}

#[test]
fn parse_channel_create_missing_type_fails() {
    let result = Cli::try_parse_from([
        "seed_cli",
        "channel",
        "create",
        "--channel-owner",
        "macro|alice@example.com",
    ]);
    assert!(result.is_err());
}

#[test]
fn parse_channel_create_invalid_type_fails() {
    let result = Cli::try_parse_from([
        "seed_cli",
        "channel",
        "create",
        "--channel-owner",
        "macro|alice@example.com",
        "--channel-type",
        "bogus",
    ]);
    assert!(result.is_err());
}

#[test]
fn parse_channel_create_organization_type_fails() {
    let result = Cli::try_parse_from([
        "seed_cli",
        "channel",
        "create",
        "--channel-owner",
        "macro|alice@example.com",
        "--channel-type",
        "organization",
    ]);
    assert!(result.is_err());
}

#[test]
fn parse_channel_create_org_id_argument_fails() {
    let result = Cli::try_parse_from([
        "seed_cli",
        "channel",
        "create",
        "--channel-owner",
        "macro|alice@example.com",
        "--channel-type",
        "private",
        "--org-id",
        "42",
    ]);
    assert!(result.is_err());
}

#[test]
fn parse_channel_seed() {
    let cli = Cli::try_parse_from([
        "seed_cli",
        "channel",
        "seed",
        "--user-id",
        "macro|alice@example.com",
    ])
    .unwrap();

    match cli.command {
        crate::entity::EntityCommand::Channel(args) => match args.command {
            ChannelCommand::Seed(seed) => {
                assert_eq!(seed.user_id, "macro|alice@example.com");
            }
            other => panic!("expected Seed, got {other:?}"),
        },
        other => panic!("expected Channel, got {other:?}"),
    }
}

#[test]
fn parse_channel_seed_missing_user_id_fails() {
    let result = Cli::try_parse_from(["seed_cli", "channel", "seed"]);
    assert!(result.is_err());
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

// ── Integration tests (single create) ─────────────────────

#[tokio::test]
async fn create_channel_success() {
    let mut mock_db = Db::default();
    mock_db
        .expect_create_channel()
        .times(1)
        .withf(|opts| {
            opts.name.as_deref() == Some("general")
                && opts.owner_id == "macro|alice@example.com"
                && opts.channel_type == ChannelType::Public
        })
        .returning(|_| Ok(uuid::Uuid::nil()));

    let args = ChannelArgs {
        command: ChannelCommand::Create(CreateArgs {
            channel_name: Some("general".to_string()),
            channel_owner: "macro|alice@example.com".to_string(),
            channel_type: CliChannelType::Public,
            channel_members: vec!["macro|bob@example.com".to_string()],
        }),
    };

    let result = args.execute(mock_ctx(mock_db)).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn create_channel_without_name() {
    let mut mock_db = Db::default();
    mock_db
        .expect_create_channel()
        .times(1)
        .withf(|opts| opts.name.is_none() && opts.channel_type == ChannelType::DirectMessage)
        .returning(|_| Ok(uuid::Uuid::nil()));

    let args = ChannelArgs {
        command: ChannelCommand::Create(CreateArgs {
            channel_name: None,
            channel_owner: "macro|alice@example.com".to_string(),
            channel_type: CliChannelType::DirectMessage,
            channel_members: vec!["macro|bob@example.com".to_string()],
        }),
    };

    let result = args.execute(mock_ctx(mock_db)).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn create_channel_db_failure_propagates_error() {
    let mut mock_db = Db::default();
    mock_db
        .expect_create_channel()
        .times(1)
        .returning(|_| Err(anyhow::anyhow!("db connection failed")));

    let args = ChannelArgs {
        command: ChannelCommand::Create(CreateArgs {
            channel_name: Some("general".to_string()),
            channel_owner: "macro|alice@example.com".to_string(),
            channel_type: CliChannelType::Public,
            channel_members: vec![],
        }),
    };

    let result = args.execute(mock_ctx(mock_db)).await;
    let err = result.unwrap_err();
    assert!(err.to_string().contains("db connection failed"));
}

// ── Seed JSON tests ────────────────────────────────────────

#[tokio::test]
async fn seed_creates_all_channels() {
    let id1 = uuid::Uuid::new_v4();
    let id2 = uuid::Uuid::new_v4();
    let json = serde_json::json!([
        {
            "channel_id": id1,
            "channel_name": "general",
            "channel_type": "public",
            "participants": ["macro|bob@example.com", "macro|charlie@example.com"]
        },
        {
            "channel_id": id2,
            "channel_type": "direct_message",
            "participants": ["macro|bob@example.com"]
        }
    ])
    .to_string();
    let file = write_temp_json(&json);

    let mut mock_db = Db::default();
    mock_db
        .expect_seed_channel()
        .times(2)
        .returning(|opts| Ok(opts.channel_id));

    let args = SeedArgs {
        user_id: "macro|alice@example.com".to_string(),
        file_path: None,
    };

    let result = seed_from_file(args, mock_ctx(mock_db), file.path()).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn seed_sets_user_id_as_owner_and_appends_to_participants() {
    let id = uuid::Uuid::new_v4();
    let json = serde_json::json!([
        {
            "channel_id": id,
            "channel_name": "general",
            "channel_type": "public",
            "participants": ["macro|bob@example.com"]
        }
    ])
    .to_string();
    let file = write_temp_json(&json);

    let mut mock_db = Db::default();
    mock_db
        .expect_seed_channel()
        .times(1)
        .withf(|opts| {
            opts.owner_id == "macro|alice@example.com"
                && opts
                    .participants
                    .contains(&"macro|alice@example.com".to_string())
                && opts
                    .participants
                    .contains(&"macro|bob@example.com".to_string())
        })
        .returning(|opts| Ok(opts.channel_id));

    let args = SeedArgs {
        user_id: "macro|alice@example.com".to_string(),
        file_path: None,
    };

    let result = seed_from_file(args, mock_ctx(mock_db), file.path()).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn seed_does_not_duplicate_user_in_participants() {
    let id = uuid::Uuid::new_v4();
    let json = serde_json::json!([
        {
            "channel_id": id,
            "channel_name": "general",
            "channel_type": "public",
            "participants": ["macro|alice@example.com", "macro|bob@example.com"]
        }
    ])
    .to_string();
    let file = write_temp_json(&json);

    let mut mock_db = Db::default();
    mock_db
        .expect_seed_channel()
        .times(1)
        .withf(|opts| {
            opts.participants
                .iter()
                .filter(|p| *p == "macro|alice@example.com")
                .count()
                == 1
        })
        .returning(|opts| Ok(opts.channel_id));

    let args = SeedArgs {
        user_id: "macro|alice@example.com".to_string(),
        file_path: None,
    };

    let result = seed_from_file(args, mock_ctx(mock_db), file.path()).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn seed_empty_json_fails() {
    let json = "[]";
    let file = write_temp_json(json);

    let mock_db = Db::default();

    let args = SeedArgs {
        user_id: "macro|alice@example.com".to_string(),
        file_path: None,
    };

    let result = seed_from_file(args, mock_ctx(mock_db), file.path()).await;
    let err = result.unwrap_err();
    assert!(err.to_string().contains("no channels found"));
}

#[tokio::test]
async fn seed_continues_on_failure() {
    let id1 = uuid::Uuid::new_v4();
    let id2 = uuid::Uuid::new_v4();
    let id3 = uuid::Uuid::new_v4();
    let json = serde_json::json!([
        {
            "channel_id": id1,
            "channel_name": "good-1",
            "channel_type": "public"
        },
        {
            "channel_id": id2,
            "channel_name": "bad",
            "channel_type": "public"
        },
        {
            "channel_id": id3,
            "channel_name": "good-2",
            "channel_type": "private"
        }
    ])
    .to_string();
    let file = write_temp_json(&json);

    let mut mock_db = Db::default();
    mock_db.expect_seed_channel().times(3).returning(|opts| {
        if opts.name.as_deref() == Some("bad") {
            Err(anyhow::anyhow!("db error"))
        } else {
            Ok(opts.channel_id)
        }
    });

    let args = SeedArgs {
        user_id: "macro|alice@example.com".to_string(),
        file_path: None,
    };

    let result = seed_from_file(args, mock_ctx(mock_db), file.path()).await;
    assert!(result.is_ok());
}
