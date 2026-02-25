use std::io::Write;

use clap::Parser;
use macro_user_id::user_id::MacroUserIdStr;
use model::document::{DocumentMetadata, FileType};
use tempfile::NamedTempFile;

use crate::Cli;
use crate::config::SeedCliContext;
use crate::service::auth::Auth;
use crate::service::db::Db;
use crate::service::s3::S3;

use super::*;

// ── Parsing tests ──────────────────────────────────────────

#[test]
fn parse_document_create_minimal() {
    let cli = Cli::try_parse_from([
        "seed_cli",
        "document",
        "create",
        "--owner",
        "macro|alice@example.com",
        "--file-path",
        "/tmp/test.pdf",
        "--document-name",
        "My Document",
    ])
    .unwrap();

    match cli.command {
        crate::entity::EntityCommand::Document(args) => {
            let DocumentCommand::Create(create) = args.command else {
                panic!("expected Create");
            };
            assert_eq!(create.owner, "macro|alice@example.com");
            assert_eq!(create.file_path, "/tmp/test.pdf");
            assert_eq!(create.document_name, "My Document");
            assert!(!create.is_public);
            assert!(create.public_access_level.is_none());
            assert!(create.id.is_none());
            assert!(!create.skip_history);
        }
        other => panic!("expected Document, got {other:?}"),
    }
}

#[test]
fn parse_document_create_full() {
    let cli = Cli::try_parse_from([
        "seed_cli",
        "document",
        "create",
        "--owner",
        "macro|alice@example.com",
        "--file-path",
        "/tmp/test.pdf",
        "--document-name",
        "My Document",
        "--is-public",
        "--public-access-level",
        "view",
        "--id",
        "custom-doc-id",
        "--skip-history",
    ])
    .unwrap();

    match cli.command {
        crate::entity::EntityCommand::Document(args) => {
            let DocumentCommand::Create(create) = args.command else {
                panic!("expected Create");
            };
            assert_eq!(create.owner, "macro|alice@example.com");
            assert_eq!(create.file_path, "/tmp/test.pdf");
            assert_eq!(create.document_name, "My Document");
            assert!(create.is_public);
            assert_eq!(create.public_access_level.as_deref(), Some("view"));
            assert_eq!(create.id.as_deref(), Some("custom-doc-id"));
            assert!(create.skip_history);
        }
        other => panic!("expected Document, got {other:?}"),
    }
}

#[test]
fn parse_document_create_missing_owner_fails() {
    let result = Cli::try_parse_from([
        "seed_cli",
        "document",
        "create",
        "--file-path",
        "/tmp/test.pdf",
        "--document-name",
        "My Document",
    ]);
    assert!(result.is_err());
}

#[test]
fn parse_document_create_missing_file_path_fails() {
    let result = Cli::try_parse_from([
        "seed_cli",
        "document",
        "create",
        "--owner",
        "macro|alice@example.com",
        "--document-name",
        "My Document",
    ]);
    assert!(result.is_err());
}

#[test]
fn parse_document_create_missing_name_fails() {
    let result = Cli::try_parse_from([
        "seed_cli",
        "document",
        "create",
        "--owner",
        "macro|alice@example.com",
        "--file-path",
        "/tmp/test.pdf",
    ]);
    assert!(result.is_err());
}

// ── Parsing tests (seed) ──────────────────────────────────

#[test]
fn parse_document_seed() {
    let cli = Cli::try_parse_from([
        "seed_cli",
        "document",
        "seed",
        "--user-id",
        "macro|alice@example.com",
    ])
    .unwrap();

    match cli.command {
        crate::entity::EntityCommand::Document(args) => match args.command {
            DocumentCommand::Seed(seed) => {
                assert_eq!(seed.user_id, "macro|alice@example.com");
            }
            other => panic!("expected Seed, got {other:?}"),
        },
        other => panic!("expected Document, got {other:?}"),
    }
}

#[test]
fn parse_document_seed_missing_user_id_fails() {
    let result = Cli::try_parse_from(["seed_cli", "document", "seed"]);
    assert!(result.is_err());
}

// ── Helpers ────────────────────────────────────────────────

fn mock_ctx(db: Db, s3: S3) -> SeedCliContext {
    SeedCliContext {
        db,
        fusionauth_client: Auth::default(),
        s3,
    }
}

fn write_temp_file(content: &[u8], suffix: &str) -> NamedTempFile {
    let mut file = tempfile::Builder::new().suffix(suffix).tempfile().unwrap();
    file.write_all(content).unwrap();
    file.flush().unwrap();
    file
}

fn write_temp_csv(content: &str) -> NamedTempFile {
    let mut file = NamedTempFile::new().unwrap();
    file.write_all(content.as_bytes()).unwrap();
    file.flush().unwrap();
    file
}

fn test_document_metadata() -> DocumentMetadata {
    let owner = MacroUserIdStr::parse_from_str("macro|alice@example.com").unwrap();
    DocumentMetadata::new_document(
        "doc-123",
        1,
        owner,
        "My Document",
        Some(FileType::Pdf),
        "sha",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
}

fn test_document_metadata_with_type(file_type: FileType) -> DocumentMetadata {
    let owner = MacroUserIdStr::parse_from_str("macro|alice@example.com").unwrap();
    DocumentMetadata::new_document(
        "doc-123",
        1,
        owner,
        "Test Doc",
        Some(file_type),
        "sha",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
}

// ── Execution tests ───────────────────────────────────────

#[tokio::test]
async fn create_document_success() {
    let file = write_temp_file(b"%PDF-1.4 fake content", ".pdf");

    let mut mock_db = Db::default();
    mock_db
        .expect_create_document()
        .times(1)
        .returning(|_| Ok(test_document_metadata()));

    let mut mock_s3 = S3::default();
    mock_s3
        .expect_upload_file()
        .times(1)
        .returning(|_, _| Ok(()));

    let args = DocumentArgs {
        command: DocumentCommand::Create(CreateArgs {
            owner: "macro|alice@example.com".to_string(),
            file_path: file.path().to_str().unwrap().to_string(),
            document_name: "My Document".to_string(),
            is_public: false,
            public_access_level: None,
            id: None,
            skip_history: false,
        }),
    };

    let result = args.execute(mock_ctx(mock_db, mock_s3)).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn create_document_db_failure_propagates() {
    let file = write_temp_file(b"%PDF-1.4 fake content", ".pdf");

    let mut mock_db = Db::default();
    mock_db
        .expect_create_document()
        .times(1)
        .returning(|_| Err(anyhow::anyhow!("db connection failed")));

    let mock_s3 = S3::default();

    let args = DocumentArgs {
        command: DocumentCommand::Create(CreateArgs {
            owner: "macro|alice@example.com".to_string(),
            file_path: file.path().to_str().unwrap().to_string(),
            document_name: "My Document".to_string(),
            is_public: false,
            public_access_level: None,
            id: None,
            skip_history: false,
        }),
    };

    let result = args.execute(mock_ctx(mock_db, mock_s3)).await;
    let err = result.unwrap_err();
    assert!(err.to_string().contains("db connection failed"));
}

#[tokio::test]
async fn create_document_s3_failure_propagates() {
    let file = write_temp_file(b"%PDF-1.4 fake content", ".pdf");

    let mut mock_db = Db::default();
    mock_db
        .expect_create_document()
        .times(1)
        .returning(|_| Ok(test_document_metadata()));

    let mut mock_s3 = S3::default();
    mock_s3
        .expect_upload_file()
        .times(1)
        .returning(|_, _| Err(anyhow::anyhow!("s3 upload failed")));

    let args = DocumentArgs {
        command: DocumentCommand::Create(CreateArgs {
            owner: "macro|alice@example.com".to_string(),
            file_path: file.path().to_str().unwrap().to_string(),
            document_name: "My Document".to_string(),
            is_public: false,
            public_access_level: None,
            id: None,
            skip_history: false,
        }),
    };

    let result = args.execute(mock_ctx(mock_db, mock_s3)).await;
    let err = result.unwrap_err();
    assert!(err.to_string().contains("s3 upload failed"));
}

// ── Seed CSV tests ────────────────────────────────────────

#[tokio::test]
async fn seed_creates_all_documents() {
    let doc1 = Uuid::new_v4();
    let doc2 = Uuid::new_v4();
    let csv = format!(
        "document_id,document_name,file_name,is_public\n\
         {doc1},Test PDF,pdf.pdf,false\n\
         {doc2},Test Markdown,md.md,true\n"
    );
    let file = write_temp_csv(&csv);

    let mut mock_db = Db::default();
    mock_db
        .expect_create_document()
        .times(2)
        .returning(|_| Ok(test_document_metadata()));

    let mut mock_s3 = S3::default();
    mock_s3
        .expect_upload_file()
        .times(2)
        .returning(|_, _| Ok(()));

    let args = SeedArgs {
        user_id: "macro|alice@example.com".to_string(),
    };

    let result = seed_from_file(args, mock_ctx(mock_db, mock_s3), file.path()).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn seed_empty_csv_fails() {
    let csv = "document_id,document_name,file_name,is_public\n";
    let file = write_temp_csv(csv);

    let mock_db = Db::default();
    let mock_s3 = S3::default();

    let args = SeedArgs {
        user_id: "macro|alice@example.com".to_string(),
    };

    let result = seed_from_file(args, mock_ctx(mock_db, mock_s3), file.path()).await;
    let err = result.unwrap_err();
    assert!(err.to_string().contains("no documents found"));
}

#[tokio::test]
async fn seed_continues_on_db_failure() {
    let doc1 = Uuid::new_v4();
    let doc2 = Uuid::new_v4();
    let doc3 = Uuid::new_v4();
    let csv = format!(
        "document_id,document_name,file_name,is_public\n\
         {doc1},Good Doc 1,pdf.pdf,false\n\
         {doc2},Bad Doc,md.md,false\n\
         {doc3},Good Doc 2,canvas.canvas,false\n"
    );
    let file = write_temp_csv(&csv);

    let mut call_count = 0;
    let mut mock_db = Db::default();
    mock_db
        .expect_create_document()
        .times(3)
        .returning(move |_| {
            call_count += 1;
            if call_count == 2 {
                Err(anyhow::anyhow!("db error"))
            } else {
                Ok(test_document_metadata())
            }
        });

    let mut mock_s3 = S3::default();
    mock_s3
        .expect_upload_file()
        .times(2)
        .returning(|_, _| Ok(()));

    let args = SeedArgs {
        user_id: "macro|alice@example.com".to_string(),
    };

    let result = seed_from_file(args, mock_ctx(mock_db, mock_s3), file.path()).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn seed_continues_on_s3_failure() {
    let doc1 = Uuid::new_v4();
    let doc2 = Uuid::new_v4();
    let csv = format!(
        "document_id,document_name,file_name,is_public\n\
         {doc1},Good Doc,pdf.pdf,false\n\
         {doc2},S3 Fail Doc,md.md,false\n"
    );
    let file = write_temp_csv(&csv);

    let mut mock_db = Db::default();
    mock_db
        .expect_create_document()
        .times(2)
        .returning(|_| Ok(test_document_metadata()));

    let mut s3_call_count = 0;
    let mut mock_s3 = S3::default();
    mock_s3
        .expect_upload_file()
        .times(2)
        .returning(move |_, _| {
            s3_call_count += 1;
            if s3_call_count == 2 {
                Err(anyhow::anyhow!("s3 upload failed"))
            } else {
                Ok(())
            }
        });

    let args = SeedArgs {
        user_id: "macro|alice@example.com".to_string(),
    };

    let result = seed_from_file(args, mock_ctx(mock_db, mock_s3), file.path()).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn seed_handles_all_file_types() {
    let doc1 = Uuid::new_v4();
    let doc2 = Uuid::new_v4();
    let doc3 = Uuid::new_v4();
    let csv = format!(
        "document_id,document_name,file_name,is_public\n\
         {doc1},PDF Doc,pdf.pdf,false\n\
         {doc2},Markdown Doc,md.md,false\n\
         {doc3},Canvas Doc,canvas.canvas,false\n"
    );
    let file = write_temp_csv(&csv);

    let mut mock_db = Db::default();
    mock_db.expect_create_document().times(3).returning(|args| {
        let file_type = args.file_type.unwrap();
        Ok(test_document_metadata_with_type(file_type))
    });

    let mut mock_s3 = S3::default();
    mock_s3
        .expect_upload_file()
        .times(3)
        .returning(|_, _| Ok(()));

    let args = SeedArgs {
        user_id: "macro|alice@example.com".to_string(),
    };

    let result = seed_from_file(args, mock_ctx(mock_db, mock_s3), file.path()).await;
    assert!(result.is_ok());
}
