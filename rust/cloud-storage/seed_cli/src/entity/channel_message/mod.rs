//! Channel message entity commands for seeding message data.

#[cfg(test)]
mod test;

use std::path::Path;

use anyhow::Context;
use clap::{Args, Subcommand};
use comms_db_client::messages::create_message::CreateMessageOptions;
use comms_db_client::messages::seed_message::SeedMessageOptions;
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
    /// Bulk create multiple channel messages
    BulkCreate(BulkCreateArgs),
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

/// Arguments for bulk creating channel messages.
#[derive(Debug, Args)]
pub struct BulkCreateArgs {
    /// Path to the CSV file containing messages to create
    #[arg(long)]
    pub file_path: String,
}

/// A row in the bulk-create CSV file.
#[derive(Debug, Deserialize)]
struct CsvMessageRow {
    /// The channel ID to post the message to
    channel_id: Uuid,
    /// The user ID of the message sender
    sender_id: String,
    /// The message content
    content: String,
    /// Optional thread ID if this is a reply
    thread_id: Option<Uuid>,
}

impl ChannelMessageArgs {
    /// Execute the channel message command.
    pub async fn execute(self, ctx: SeedCliContext) -> anyhow::Result<()> {
        match self.command {
            ChannelMessageCommand::Create(args) => create(args, ctx).await,
            ChannelMessageCommand::BulkCreate(args) => bulk_create(args, ctx).await,
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
async fn bulk_create(args: BulkCreateArgs, ctx: SeedCliContext) -> anyhow::Result<()> {
    tracing::info!("bulk creating channel messages");

    let content = std::fs::read_to_string(Path::new(&args.file_path))
        .with_context(|| format!("failed to read csv file: {}", args.file_path))?;

    let mut reader = csv::Reader::from_reader(content.as_bytes());
    let rows: Vec<CsvMessageRow> = reader
        .deserialize()
        .collect::<Result<Vec<_>, _>>()
        .context("failed to parse csv")?;

    if rows.is_empty() {
        anyhow::bail!("no messages found in csv file");
    }

    println!("Found {} messages to create", rows.len());

    let mut created = 0;
    let mut failed = 0;

    for row in rows {
        let message_label = format!("channel={} sender={}", row.channel_id, row.sender_id);

        let options = CreateMessageOptions {
            channel_id: row.channel_id,
            sender_id: row.sender_id,
            content: row.content,
            thread_id: row.thread_id,
        };

        match ctx.db.create_message(options).await {
            Ok(message_id) => {
                println!("Created message {message_label} with id {message_id}");
                created += 1;
            }
            Err(e) => {
                tracing::error!(error=?e, message = message_label, "failed to create message");
                println!("Failed to create message {message_label}: {e}");
                failed += 1;
            }
        }
    }

    println!("\nBulk create complete: {created} created, {failed} failed");

    Ok(())
}

#[tracing::instrument(skip(ctx), err)]
async fn seed(ctx: SeedCliContext) -> anyhow::Result<()> {
    seed_from_file(ctx, Path::new("seed/channel_messages.csv")).await
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

        let options = SeedMessageOptions {
            message_id: row.message_id,
            channel_id: row.channel_id,
            sender_id: row.sender_id,
            content: row.content,
            thread_id: row.thread_id,
        };

        match ctx.db.seed_message(options).await {
            Ok(message_id) => {
                println!("Seeded message {message_label} with id {message_id}");
                created += 1;
            }
            Err(e) => {
                tracing::error!(error=?e, message = message_label, "failed to seed message");
                println!("Failed to seed message {message_label}: {e}");
                failed += 1;
            }
        }
    }

    println!("\nSeed complete: {created} created, {failed} failed");

    Ok(())
}
