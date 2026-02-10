use clap::Parser;

use crate::Cli;

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
    let cli = Cli::try_parse_from(["seed_cli", "user", "bulk-create", "--file-path", "test.csv"]).unwrap();

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
