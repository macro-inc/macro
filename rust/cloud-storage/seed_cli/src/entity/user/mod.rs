//! User entity commands for seeding user data.

#[cfg(test)]
mod test;

use std::borrow::Cow;
use std::path::Path;

use anyhow::Context;
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

impl UserArgs {
    /// Execute the user command.
    pub async fn execute(self, ctx: SeedCliContext) -> anyhow::Result<()> {
        match self.command {
            UserCommand::Create(args) => create(args, ctx).await,
            UserCommand::BulkCreate(args) => bulk_create(args, ctx).await,
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

    let content = std::fs::read_to_string(Path::new(&args.file_path))
        .with_context(|| format!("failed to read csv file: {}", args.file_path))?;

    let emails: Vec<&str> = content
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty() && *line != "email")
        .collect();

    if emails.is_empty() {
        anyhow::bail!("no emails found in csv file");
    }

    println!("Found {} emails to create", emails.len());

    let mut created = 0;
    let mut failed = 0;

    for email in &emails {
        match ctx
            .fusionauth_client
            .create_user(fusionauth::user::create::User {
                email: Cow::Borrowed(email),
                username: Some(Cow::Borrowed(email)),
                password: "hardcodeLocalPassword123!".into(),
            })
            .await
        {
            Ok(user_id) => {
                println!("Created user {email} with id {user_id}");
                created += 1;
            }
            Err(e) => {
                tracing::error!(error=?e, email, "failed to create user");
                println!("Failed to create user {email}: {e}");
                failed += 1;
            }
        }
    }

    println!("\nBulk create complete: {created} created, {failed} failed");

    Ok(())
}
