//! User entity commands for seeding user data.

#[cfg(test)]
mod test;

use std::borrow::Cow;

use clap::{Args, Subcommand};

use crate::config::SeedCliContext;

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
    pub id: Option<String>,
}

impl UserArgs {
    /// Execute the user command.
    pub async fn execute(self, ctx: SeedCliContext) -> anyhow::Result<()> {
        match self.command {
            UserCommand::Create(args) => create(args, ctx).await,
            UserCommand::BulkCreate(args) => bulk_create(args, ctx).await,
            UserCommand::Delete(args) => delete(args, ctx).await,
            UserCommand::Read(args) => read(args, ctx).await,
        }
    }
}

#[tracing::instrument(skip(ctx), err)]
async fn create(args: CreateArgs, ctx: SeedCliContext) -> anyhow::Result<()> {
    tracing::info!("creating user");
    let user_id = ctx
        .fusionauth_client
        .create_user(fusionauth::user::create::User {
            email: Cow::Borrowed(&args.email),
            username: Some(Cow::Borrowed(&args.email)),
            // TODO: do we want to bother with random generated passwords?
            password: "hardcodeLocalPassword123!".into(),
        })
        .await?;

    println!("Created FusionAuth user with id {user_id}");

    Ok(())
}

#[tracing::instrument(skip(ctx), err)]
async fn bulk_create(args: BulkCreateArgs, ctx: SeedCliContext) -> anyhow::Result<()> {
    tracing::info!("bulk creating users");
    todo!()
}

#[tracing::instrument(skip(ctx), err)]
async fn delete(args: DeleteArgs, ctx: SeedCliContext) -> anyhow::Result<()> {
    tracing::info!("deleting user");
    todo!()
}

#[tracing::instrument(skip(ctx), err)]
async fn read(args: ReadArgs, ctx: SeedCliContext) -> anyhow::Result<()> {
    tracing::info!("reading user");
    todo!()
}
