use std::io::Write;

use clap::Parser;
use tempfile::NamedTempFile;

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

fn write_temp_csv(content: &str) -> NamedTempFile {
    let mut file = NamedTempFile::new().unwrap();
    file.write_all(content.as_bytes()).unwrap();
    file.flush().unwrap();
    file
}

#[tokio::test]
async fn bulk_create_creates_all_users() {
    let file = write_temp_csv("alice@example.com\nbob@example.com\n");

    let mut mock_auth = Auth::default();
    mock_auth
        .expect_create_user()
        .times(2)
        .returning(|user| Ok(format!("id-for-{}", user.email)));

    let args = UserArgs {
        command: UserCommand::BulkCreate(BulkCreateArgs {
            file_path: file.path().to_str().unwrap().to_string(),
        }),
    };

    let result = args.execute(mock_ctx(mock_auth)).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn bulk_create_skips_email_header() {
    let file = write_temp_csv("email\nalice@example.com\n");

    let mut mock_auth = Auth::default();
    mock_auth
        .expect_create_user()
        .times(1)
        .withf(|user| user.email == "alice@example.com")
        .returning(|_| Ok("user-id".to_string()));

    let args = UserArgs {
        command: UserCommand::BulkCreate(BulkCreateArgs {
            file_path: file.path().to_str().unwrap().to_string(),
        }),
    };

    let result = args.execute(mock_ctx(mock_auth)).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn bulk_create_skips_empty_lines() {
    let file = write_temp_csv("\nalice@example.com\n\n\nbob@example.com\n\n");

    let mut mock_auth = Auth::default();
    mock_auth
        .expect_create_user()
        .times(2)
        .returning(|_| Ok("user-id".to_string()));

    let args = UserArgs {
        command: UserCommand::BulkCreate(BulkCreateArgs {
            file_path: file.path().to_str().unwrap().to_string(),
        }),
    };

    let result = args.execute(mock_ctx(mock_auth)).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn bulk_create_empty_file_fails() {
    let file = write_temp_csv("");

    let mock_auth = Auth::default();

    let args = UserArgs {
        command: UserCommand::BulkCreate(BulkCreateArgs {
            file_path: file.path().to_str().unwrap().to_string(),
        }),
    };

    let result = args.execute(mock_ctx(mock_auth)).await;
    let err = result.unwrap_err();
    assert!(err.to_string().contains("no emails found"));
}

#[tokio::test]
async fn bulk_create_missing_file_fails() {
    let mock_auth = Auth::default();

    let args = UserArgs {
        command: UserCommand::BulkCreate(BulkCreateArgs {
            file_path: "/nonexistent/path.csv".to_string(),
        }),
    };

    let result = args.execute(mock_ctx(mock_auth)).await;
    let err = result.unwrap_err();
    assert!(err.to_string().contains("failed to read csv file"));
}

#[tokio::test]
async fn bulk_create_continues_on_failure() {
    let file = write_temp_csv("alice@example.com\nbad@example.com\nbob@example.com\n");

    let mut mock_auth = Auth::default();
    mock_auth.expect_create_user().times(3).returning(|user| {
        if user.email == "bad@example.com" {
            Err(anyhow::anyhow!("user already exists"))
        } else {
            Ok(format!("id-for-{}", user.email))
        }
    });

    let args = UserArgs {
        command: UserCommand::BulkCreate(BulkCreateArgs {
            file_path: file.path().to_str().unwrap().to_string(),
        }),
    };

    let result = args.execute(mock_ctx(mock_auth)).await;
    assert!(result.is_ok());
}
