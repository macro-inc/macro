use clap::Parser;

use crate::Cli;
use crate::config::SeedCliContext;
use crate::service::auth::Auth;
use crate::service::db::Db;

use super::*;

#[test]
fn parse_user_create() {
    let cli = Cli::try_parse_from(["seed_cli", "user", "create", "--email", "alice@example.com"])
        .unwrap();

    match cli.command {
        crate::entity::EntityCommand::User(args) => match args.command {
            super::UserCommand::Create(create) => {
                assert_eq!(create.email, "alice@example.com");
            }
            other => panic!("expected Create, got {other:?}"),
        },
    }
}

#[test]
fn parse_user_bulk_create() {
    let cli = Cli::try_parse_from(["seed_cli", "user", "bulk-create", "--file-path", "test.csv"])
        .unwrap();

    match cli.command {
        crate::entity::EntityCommand::User(args) => match args.command {
            super::UserCommand::BulkCreate(bulk) => {
                assert_eq!(bulk.file_path, "test.csv");
            }
            other => panic!("expected BulkCreate, got {other:?}"),
        },
    }
}

#[test]
fn parse_user_delete() {
    let cli = Cli::try_parse_from(["seed_cli", "user", "delete", "--id", "user-123"]).unwrap();

    match cli.command {
        crate::entity::EntityCommand::User(args) => match args.command {
            super::UserCommand::Delete(del) => {
                assert_eq!(del.id, "user-123");
            }
            other => panic!("expected Delete, got {other:?}"),
        },
    }
}

#[test]
fn parse_user_read_with_id() {
    let cli = Cli::try_parse_from(["seed_cli", "user", "read", "--id", "user-456"]).unwrap();

    match cli.command {
        crate::entity::EntityCommand::User(args) => match args.command {
            super::UserCommand::Read(read) => {
                assert_eq!(read.id.as_deref(), Some("user-456"));
            }
            other => panic!("expected Read, got {other:?}"),
        },
    }
}

#[test]
fn parse_user_read_without_id() {
    let cli = Cli::try_parse_from(["seed_cli", "user", "read"]).unwrap();

    match cli.command {
        crate::entity::EntityCommand::User(args) => match args.command {
            super::UserCommand::Read(read) => {
                assert!(read.id.is_none());
            }
            other => panic!("expected Read, got {other:?}"),
        },
    }
}

#[test]
fn parse_user_create_missing_email_fails() {
    let result = Cli::try_parse_from(["seed_cli", "user", "create"]);
    assert!(result.is_err());
}

#[test]
fn parse_unknown_entity_fails() {
    let result = Cli::try_parse_from(["seed_cli", "bogus", "create"]);
    assert!(result.is_err());
}

#[test]
fn parse_unknown_user_command_fails() {
    let result = Cli::try_parse_from(["seed_cli", "user", "bogus"]);
    assert!(result.is_err());
}

fn mock_ctx(auth: Auth) -> SeedCliContext {
    SeedCliContext {
        db: Db::default(),
        fusionauth_client: auth,
    }
}

#[tokio::test]
async fn create_user_success() {
    let mut mock_auth = Auth::default();
    mock_auth
        .expect_create_user()
        .times(1)
        .withf(|user| user.email == "alice@example.com")
        .returning(|_| Ok("new-user-id-123".to_string()));

    let args = UserArgs {
        command: UserCommand::Create(CreateArgs {
            email: "alice@example.com".to_string(),
        }),
    };

    let result = args.execute(mock_ctx(mock_auth)).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn create_user_passes_email_as_username() {
    let mut mock_auth = Auth::default();
    mock_auth
        .expect_create_user()
        .times(1)
        .withf(|user| user.username.as_deref() == Some("bob@example.com"))
        .returning(|_| Ok("user-id".to_string()));

    let args = UserArgs {
        command: UserCommand::Create(CreateArgs {
            email: "bob@example.com".to_string(),
        }),
    };

    let result = args.execute(mock_ctx(mock_auth)).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn create_user_auth_failure_propagates_error() {
    let mut mock_auth = Auth::default();
    mock_auth
        .expect_create_user()
        .times(1)
        .returning(|_| Err(anyhow::anyhow!("user already exists")));

    let args = UserArgs {
        command: UserCommand::Create(CreateArgs {
            email: "duplicate@example.com".to_string(),
        }),
    };

    let result = args.execute(mock_ctx(mock_auth)).await;
    let err = result.unwrap_err();
    assert!(err.to_string().contains("user already exists"));
}

#[tokio::test]
async fn create_user_network_error_propagates() {
    let mut mock_auth = Auth::default();
    mock_auth
        .expect_create_user()
        .times(1)
        .returning(|_| Err(anyhow::anyhow!("connection refused")));

    let args = UserArgs {
        command: UserCommand::Create(CreateArgs {
            email: "test@example.com".to_string(),
        }),
    };

    let result = args.execute(mock_ctx(mock_auth)).await;
    let err = result.unwrap_err();
    assert!(err.to_string().contains("connection refused"));
}
