//! Entity module containing all seed CLI entity subcommands.

pub mod user;

use clap::Subcommand;

/// Top-level entity subcommands for the seed CLI.
#[derive(Debug, Subcommand)]
pub enum EntityCommand {
    /// Manage user seed data
    User(user::UserArgs),
}

impl EntityCommand {
    /// Execute the entity command.
    pub async fn execute(self) -> anyhow::Result<()> {
        match self {
            EntityCommand::User(args) => args.execute().await,
        }
    }
}
