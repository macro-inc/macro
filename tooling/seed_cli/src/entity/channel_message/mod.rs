//! Channel message entity commands for seeding message data.

#[cfg(test)]
mod test;

use std::path::Path;
use std::str::FromStr;

use anyhow::Context;
use clap::{Args, Subcommand};
use comms_db_client::messages::create_message::CreateMessageOptions;
use comms_db_client::messages::seed_message::SeedMessageOptions;
use comms_db_client::model::SimpleMention;
use model::item::ShareableItemType;
use serde::Deserialize;
use uuid::Uuid;

use crate::config::SeedCliContext;

/// Arguments for the `channel-message` entity subcommand.
#[derive(Debug, Args)]
pub struct ChannelMessageArgs {
    /// The action to perform on channel messages
    #[command(subcommand)]
    pub command: ChannelMessageCommand,
}

/// Available commands for the channel message entity.
#[derive(Debug, Subcommand)]
pub enum ChannelMessageCommand {
    /// Create a single channel message
    Create(CreateArgs),
    /// Seed channel messages from a JSON file with pre-defined UUIDs
    Seed(SeedArgs),
}

/// Arguments for seeding channel messages from a JSON file.
#[derive(Debug, Args)]
pub struct SeedArgs {
    /// Path to the JSON file containing messages to seed (defaults to seed/channel_messages.json)
    #[arg(long)]
    pub file_path: Option<String>,
}

/// A row in the seed JSON file.
#[derive(Debug, Deserialize)]
struct SeedMessageRow {
    /// Pre-defined message UUID.
    message_id: Uuid,
    /// The channel ID to post the message to.
    channel_id: Uuid,
    /// The user ID of the message sender.
    sender_id: String,
    /// The message content.
    content: String,
    /// Optional thread ID if this is a reply.
    thread_id: Option<Uuid>,
    /// Entity mentions in the message.
    #[serde(default)]
    entity_mentions: Vec<SimpleMention>,
}

/// Arguments for creating a single channel message.
#[derive(Debug, Args)]
pub struct CreateArgs {
    /// The channel ID to post the message to
    #[arg(long)]
    pub channel_id: Uuid,
    /// The user ID of the message sender
    #[arg(long)]
    pub sender_id: String,
    /// The message content
    #[arg(long)]
    pub content: String,
    /// Optional thread ID if this is a reply
    #[arg(long)]
    pub thread_id: Option<Uuid>,
}

impl ChannelMessageArgs {
    /// Execute the channel message command.
    pub async fn execute(self, ctx: SeedCliContext) -> anyhow::Result<()> {
        match self.command {
            ChannelMessageCommand::Create(args) => create(args, ctx).await,
            ChannelMessageCommand::Seed(args) => seed(args, ctx).await,
        }
    }
}

#[tracing::instrument(skip(ctx), err)]
async fn create(args: CreateArgs, ctx: SeedCliContext) -> anyhow::Result<()> {
    tracing::info!("creating channel message");

    let options = CreateMessageOptions {
        channel_id: args.channel_id,
        sender_id: args.sender_id,
        content: args.content,
        thread_id: args.thread_id,
    };

    let message_id = ctx.db.create_message(options).await?;
    println!("Created message with id {message_id}");

    Ok(())
}

#[tracing::instrument(skip(ctx), err)]
async fn seed(args: SeedArgs, ctx: SeedCliContext) -> anyhow::Result<()> {
    let default_path = Path::new("seed/channel_messages.json").to_path_buf();
    let path = args
        .file_path
        .map(std::path::PathBuf::from)
        .unwrap_or(default_path);
    seed_from_file_ref(&ctx, &path).await
}

#[cfg(test)]
async fn seed_from_file(ctx: SeedCliContext, path: &Path) -> anyhow::Result<()> {
    seed_from_file_ref(&ctx, path).await
}

pub(crate) async fn seed_from_file_ref(ctx: &SeedCliContext, path: &Path) -> anyhow::Result<()> {
    tracing::info!("seeding channel messages");

    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read json file: {}", path.display()))?;

    let rows: Vec<SeedMessageRow> =
        serde_json::from_str(&content).context("failed to parse json")?;

    if rows.is_empty() {
        anyhow::bail!("no messages found in json file");
    }

    println!("Found {} messages to seed", rows.len());

    let mut created = 0;
    let mut failed = 0;

    for row in rows {
        let message_label = format!("channel={} sender={}", row.channel_id, row.sender_id);
        let entity_mentions = row.entity_mentions;
        let channel_id = row.channel_id;

        let options = SeedMessageOptions {
            message_id: row.message_id,
            channel_id,
            sender_id: row.sender_id,
            content: row.content,
            thread_id: row.thread_id,
        };

        let message_id = match ctx.db.seed_message(options).await {
            Ok(id) => {
                println!("Seeded message {message_label} with id {id}");
                created += 1;
                id
            }
            Err(e) => {
                tracing::error!(error=?e, message = message_label, "failed to seed message");
                println!("Failed to seed message {message_label}: {e}");
                failed += 1;
                continue;
            }
        };

        if entity_mentions.is_empty() {
            continue;
        }

        if let Err(e) = ctx
            .db
            .create_message_mentions(message_id, entity_mentions.clone())
            .await
        {
            tracing::error!(error=?e, message = message_label, "failed to create message mentions");
            println!("Warning: failed to create mentions for {message_label}: {e}");
        }

        for mention in &entity_mentions {
            if mention.entity_type == "user" {
                continue;
            }
            if ShareableItemType::from_str(&mention.entity_type).is_err() {
                continue;
            }
            if let Err(e) = ctx
                .db
                .update_share_permissions_for_mention(
                    channel_id,
                    &mention.entity_id,
                    &mention.entity_type,
                )
                .await
            {
                tracing::error!(
                    error=?e,
                    message = message_label,
                    entity_type = mention.entity_type,
                    entity_id = mention.entity_id,
                    "failed to update share permissions for mention"
                );
                println!(
                    "Warning: failed to update share permissions for {}|{} in {message_label}: {e}",
                    mention.entity_type, mention.entity_id,
                );
            }
        }
    }

    println!("\nSeed complete: {created} created, {failed} failed");

    Ok(())
}
