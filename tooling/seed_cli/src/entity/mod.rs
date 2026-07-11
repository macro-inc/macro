//! Entity module containing all seed CLI entity subcommands.

pub mod channel;
pub mod channel_message;
pub mod document;
pub mod email;
pub mod scenario;
pub mod user;

use clap::Subcommand;

use crate::config::{EnvVars, SeedCliContext};

/// Top-level entity subcommands for the seed CLI.
#[derive(Debug, Subcommand)]
pub enum EntityCommand {
    /// Manage user seed data
    User(user::UserArgs),
    /// Manage channel seed data
    Channel(channel::ChannelArgs),
    /// Manage channel message seed data
    ChannelMessage(channel_message::ChannelMessageArgs),
    /// Document commands
    Document(document::DocumentArgs),
    /// Manage email seed data
    Email(email::EmailArgs),
    /// Apply predefined seed scenarios
    Scenario(scenario::ScenarioArgs),
}

impl EntityCommand {
    /// Validate environment-sensitive safety checks before connecting to services.
    pub fn validate_environment(&self, env_vars: &EnvVars) -> anyhow::Result<()> {
        match self {
            EntityCommand::Scenario(args) => args.validate_environment(env_vars),
            _ => Ok(()),
        }
    }

    /// Execute the entity command.
    pub async fn execute(self, ctx: SeedCliContext) -> anyhow::Result<()> {
        match self {
            EntityCommand::User(args) => args.execute(ctx).await,
            EntityCommand::Channel(args) => args.execute(ctx).await,
            EntityCommand::ChannelMessage(args) => args.execute(ctx).await,
            EntityCommand::Document(args) => args.execute(ctx).await,
            EntityCommand::Email(args) => args.execute(ctx).await,
            EntityCommand::Scenario(args) => args.execute(ctx).await,
        }
    }
}
