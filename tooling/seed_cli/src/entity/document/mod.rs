//! Document entity commands for seeding document data.

use std::path::Path;
use std::str::FromStr;

use anyhow::Context;
use clap::{Args, Subcommand};
use macro_db_client::document::v2::create::CreateDocumentArgs;
use macro_user_id::user_id::MacroUserIdStr;
use model::document::FileType;
use models_permissions::share_permission::{SharePermissionV2, access_level::AccessLevel};
use serde::Deserialize;
use uuid::{NoContext, Timestamp, Uuid};

use crate::config::SeedCliContext;

#[cfg(test)]
mod test;

/// Arguments for the `document` entity subcommand.
#[derive(Debug, Args)]
pub struct DocumentArgs {
    /// The action to perform on documents
    #[command(subcommand)]
    pub command: DocumentCommand,
}

/// Available commands for the document entity.
#[derive(Debug, Subcommand)]
pub enum DocumentCommand {
    /// Create a single document
    Create(CreateArgs),
    /// Seed documents from a fixed JSON file with pre-defined UUIDs
    Seed(SeedArgs),
}

/// Arguments for creating a single user.
#[derive(Debug, Args)]
pub struct CreateArgs {
    /// The owner of the document
    #[arg(long)]
    pub owner: String,
    /// The path to the file you want to upload
    #[arg(long)]
    pub file_path: String,
    /// Whether the document should be public or not. If enabled this will give
    /// the document view access publicly
    #[arg(long, default_value = "false")]
    pub is_public: bool,
    /// If you have a public document you need to provide the public access level
    #[arg(long)]
    pub public_access_level: Option<String>,
    /// Name of the document.
    /// Without the extension
    #[arg(long)]
    pub document_name: String,
    /// Specific id to give to document
    #[arg(long)]
    pub id: Option<String>,
    /// Whether to skip adding document to history
    #[arg(long, default_value = "false")]
    pub skip_history: bool,
}

/// Arguments for seeding documents from a JSON file.
#[derive(Debug, Args)]
pub struct SeedArgs {
    /// The user ID to set as document owner
    #[arg(long)]
    pub user_id: String,
    /// Path to the JSON file containing documents to seed (defaults to seed/documents/documents.json)
    #[arg(long)]
    pub file_path: Option<String>,
}

/// A row in the seed JSON file.
#[derive(Debug, Deserialize)]
struct SeedDocumentRow {
    /// Pre-defined document UUID.
    document_id: Uuid,
    /// Document name.
    document_name: String,
    /// File name from the seed/documents/files/ directory.
    file_name: String,
    /// Whether the document is public.
    is_public: bool,
}

impl DocumentArgs {
    /// Execute the user command.
    pub async fn execute(self, ctx: SeedCliContext) -> anyhow::Result<()> {
        match self.command {
            DocumentCommand::Create(args) => create(args, ctx).await,
            DocumentCommand::Seed(args) => seed(args, ctx).await,
        }
    }
}

#[tracing::instrument(skip(ctx), err)]
async fn create(args: CreateArgs, ctx: SeedCliContext) -> anyhow::Result<()> {
    tracing::info!("creating document");

    let owner = MacroUserIdStr::parse_from_str(args.owner.leak()).context("valid owner id")?;

    let generated_id;
    let id = match args.id.as_deref() {
        Some(id) => Some(id),
        None => {
            generated_id = Uuid::new_v7(Timestamp::now(NoContext)).to_string();
            Some(generated_id.as_str())
        }
    };

    let file_type = args
        .file_path
        .split('.')
        .next_back()
        .context("expected to have a file extension")?;

    let file_type = FileType::from_str(file_type).context("valid file type")?;

    // create file in db
    let document = ctx
        .db
        .create_document(CreateDocumentArgs {
            id,
            sha: "sha",
            document_name: &args.document_name,
            user_id: owner.clone(),
            file_type: Some(file_type),
            project_id: None,
            project_name: None,
            share_permission: &SharePermissionV2 {
                id: String::new(),
                owner: owner.as_ref().to_string(),
                is_public: args.is_public,
                public_access_level: args
                    .public_access_level
                    .map(|s| AccessLevel::from_str(&s).unwrap()),
                channel_share_permissions: None,
            },
            skip_history: args.skip_history,
            email_attachment_id: None,
            created_at: None,
            is_task: false,
        })
        .await?;

    let key = format!(
        "{}/{}/{}.{}",
        document.owner,
        document.document_id,
        document.document_version_id,
        file_type.as_str()
    );

    ctx.s3.upload_file(&key, &args.file_path).await?;

    Ok(())
}

#[tracing::instrument(skip(ctx), err)]
async fn seed(args: SeedArgs, ctx: SeedCliContext) -> anyhow::Result<()> {
    let default_path = Path::new("seed/documents/documents.json").to_path_buf();
    let path = args
        .file_path
        .as_deref()
        .map(std::path::PathBuf::from)
        .unwrap_or(default_path);
    seed_from_file_ref(&args, &ctx, &path).await
}

#[cfg(test)]
async fn seed_from_file(args: SeedArgs, ctx: SeedCliContext, path: &Path) -> anyhow::Result<()> {
    seed_from_file_ref(&args, &ctx, path).await
}

pub(crate) async fn seed_from_file_ref(
    args: &SeedArgs,
    ctx: &SeedCliContext,
    path: &Path,
) -> anyhow::Result<()> {
    tracing::info!("seeding documents");

    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read json file: {}", path.display()))?;

    let rows: Vec<SeedDocumentRow> =
        serde_json::from_str(&content).context("failed to parse json")?;

    if rows.is_empty() {
        anyhow::bail!("no documents found in json file");
    }

    println!("Found {} documents to seed", rows.len());

    let owner_user_id = args.user_id.clone();
    let owner = MacroUserIdStr::parse_from_str(owner_user_id.leak()).context("valid owner id")?;

    let mut created = 0;
    let mut failed = 0;
    let files_dir = path
        .parent()
        .context("document seed json should have a parent directory")?
        .join("files");

    for row in rows {
        let file_path = files_dir.join(&row.file_name);
        let file_type = row
            .file_name
            .split('.')
            .next_back()
            .context("expected file to have an extension")?;
        let file_type = FileType::from_str(file_type).context("valid file type")?;
        let doc_id = row.document_id.to_string();

        let create_result = ctx
            .db
            .create_document(CreateDocumentArgs {
                id: Some(&doc_id),
                sha: "sha",
                document_name: &row.document_name,
                user_id: owner.clone(),
                file_type: Some(file_type),
                project_id: None,
                project_name: None,
                share_permission: &SharePermissionV2 {
                    id: String::new(),
                    owner: owner.as_ref().to_string(),
                    is_public: row.is_public,
                    public_access_level: if row.is_public {
                        Some(AccessLevel::View)
                    } else {
                        None
                    },
                    channel_share_permissions: None,
                },
                skip_history: true,
                email_attachment_id: None,
                created_at: None,
                is_task: false,
            })
            .await;

        match create_result {
            Ok(document) => {
                let key = format!(
                    "{}/{}/{}.{}",
                    document.owner,
                    document.document_id,
                    document.document_version_id,
                    file_type.as_str()
                );

                match ctx.s3.upload_file(&key, &file_path.to_string_lossy()).await {
                    Ok(()) => {
                        println!("Seeded document '{}' with id {}", row.document_name, doc_id);
                        created += 1;
                    }
                    Err(e) => {
                        tracing::error!(error=?e, document = row.document_name, "failed to upload file to s3");
                        println!(
                            "Failed to upload file for document '{}': {e}",
                            row.document_name
                        );
                        failed += 1;
                    }
                }
            }
            Err(e) => {
                tracing::error!(error=?e, document = row.document_name, "failed to seed document");
                println!("Failed to seed document '{}': {e}", row.document_name);
                failed += 1;
            }
        }
    }

    println!("\nSeed complete: {created} created, {failed} failed");

    Ok(())
}
