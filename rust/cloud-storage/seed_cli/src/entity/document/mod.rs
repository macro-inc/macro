//! Document entity commands for seeding document data.

use std::str::FromStr;

use anyhow::Context;
use clap::{Args, Subcommand};
use macro_db_client::document::v2::create::CreateDocumentArgs;
use macro_user_id::user_id::MacroUserIdStr;
use model::document::FileType;
use models_permissions::share_permission::{SharePermissionV2, access_level::AccessLevel};
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

impl DocumentArgs {
    /// Execute the user command.
    pub async fn execute(self, ctx: SeedCliContext) -> anyhow::Result<()> {
        match self.command {
            DocumentCommand::Create(args) => create(args, ctx).await,
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
        .last()
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
