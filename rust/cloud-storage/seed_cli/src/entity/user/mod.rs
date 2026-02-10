//! User entity commands for seeding user data.

#[cfg(test)]
mod test;

use clap::{Args, Subcommand};

/// Arguments for the `user` entity subcommand.
#[derive(Debug, Args)]
pub struct UserArgs {
    /// The action to perform on users
    #[command(subcommand)]
    pub command: UserCommand,
}

/// Available commands for the user entity.
#[derive(Debug, Subcommand)]
pub enum UserCommand {
    /// Create a single user
    Create(CreateArgs),
    /// Bulk create multiple users
    BulkCreate(BulkCreateArgs),
    /// Delete a user
    Delete(DeleteArgs),
    /// Read user information
    Read(ReadArgs),
}

/// Arguments for creating a single user.
#[derive(Debug, Args)]
pub struct CreateArgs {
    /// The email of the user to create
    #[arg(long)]
    pub email: String,
}

/// Arguments for bulk creating users.
#[derive(Debug, Args)]
pub struct BulkCreateArgs {
    /// Path to the csv containing users to create
    #[arg(long)]
    pub file_path: String,
}

/// Arguments for deleting a user.
#[derive(Debug, Args)]
pub struct DeleteArgs {
    /// The ID of the user to delete
    #[arg(long)]
    pub id: String,
}

/// Arguments for reading user information.
#[derive(Debug, Args)]
pub struct ReadArgs {
    /// The ID of the user to read.
    #[arg(long)]
    pub id: String,
}

impl UserArgs {
    /// Execute the user command.
    pub async fn execute(self) -> anyhow::Result<()> {
        match self.command {
            UserCommand::Create(args) => create(args).await,
            UserCommand::BulkCreate(args) => bulk_create(args).await,
            UserCommand::Delete(args) => delete(args).await,
            UserCommand::Read(args) => read(args).await,
        }
    }
}

#[tracing::instrument(err)]
async fn create(args: CreateArgs) -> anyhow::Result<()> {
    tracing::info!("creating user");
    todo!()
}

#[tracing::instrument(err)]
async fn bulk_create(args: BulkCreateArgs) -> anyhow::Result<()> {
    tracing::info!("bulk creating users");
    todo!()
}

#[tracing::instrument(err)]
async fn delete(args: DeleteArgs) -> anyhow::Result<()> {
    tracing::info!("deleting user");
    todo!()
}

#[tracing::instrument(err)]
async fn read(args: ReadArgs) -> anyhow::Result<()> {
    tracing::info!("reading user");
    todo!()
}
