//! Channel message entity commands for seeding message data.

#[cfg(test)]
mod test;

use std::path::Path;
use std::str::FromStr;

use crate::entity::utils::deserialize_semicolon_list;
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
    /// Seed channel messages from a fixed CSV file with pre-defined UUIDs
    Seed,
}

/// A row in the seed CSV file.
#[derive(Debug, Deserialize)]
struct CsvSeedMessageRow {
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
    /// Entity mentions in the message
    /// Each entity mention is {ENTITY_TYPE}|{ENTITY_ID}
    #[serde(default, deserialize_with = "deserialize_semicolon_list")]
    entity_mentions: Vec<String>,
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
            ChannelMessageCommand::Seed => seed(ctx).await,
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
async fn seed(ctx: SeedCliContext) -> anyhow::Result<()> {
    seed_from_file(ctx, Path::new("seed/channel_messages.csv")).await
}

fn parse_entity_mentions(raw: &[String]) -> anyhow::Result<Vec<SimpleMention>> {
    raw.iter()
        .map(|s| {
            let (entity_type, entity_id) = s
                .split_once('|')
                .with_context(|| format!("invalid entity mention format: {s}"))?;
            Ok(SimpleMention {
                entity_type: entity_type.to_string(),
                entity_id: entity_id.to_string(),
            })
        })
        .collect()
}

async fn seed_from_file(ctx: SeedCliContext, path: &Path) -> anyhow::Result<()> {
    tracing::info!("seeding channel messages");

    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read csv file: {}", path.display()))?;

    let mut reader = csv::Reader::from_reader(content.as_bytes());
    let rows: Vec<CsvSeedMessageRow> = reader
        .deserialize()
        .collect::<Result<Vec<_>, _>>()
        .context("failed to parse csv")?;

    if rows.is_empty() {
        anyhow::bail!("no messages found in csv file");
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

        let mentions = match parse_entity_mentions(&entity_mentions) {
            Ok(m) => m,
            Err(e) => {
                tracing::error!(error=?e, message = message_label, "failed to parse entity mentions");
                println!("Warning: failed to parse mentions for {message_label}: {e}");
                continue;
            }
        };

        if let Err(e) = ctx
            .db
            .create_message_mentions(message_id, mentions.clone())
            .await
        {
            tracing::error!(error=?e, message = message_label, "failed to create message mentions");
            println!("Warning: failed to create mentions for {message_label}: {e}");
        }

        for mention in &mentions {
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
