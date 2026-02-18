//! Entity module containing all seed CLI entity subcommands.

pub mod channel;
pub mod channel_message;
pub mod email;
pub mod user;

use clap::Subcommand;

use crate::config::SeedCliContext;

/// Top-level entity subcommands for the seed CLI.
#[derive(Debug, Subcommand)]
pub enum EntityCommand {
    /// Manage user seed data
    User(user::UserArgs),
    /// Manage channel seed data
    Channel(channel::ChannelArgs),
    /// Manage channel message seed data
    ChannelMessage(channel_message::ChannelMessageArgs),
    /// Manage email seed data
    Email(email::EmailArgs),
}

impl EntityCommand {
    /// Execute the entity command.
    pub async fn execute(self, ctx: SeedCliContext) -> anyhow::Result<()> {
        match self {
            EntityCommand::User(args) => args.execute(ctx).await,
            EntityCommand::Channel(args) => args.execute(ctx).await,
            EntityCommand::ChannelMessage(args) => args.execute(ctx).await,
            EntityCommand::Email(args) => args.execute(ctx).await,
        }
    }
}
