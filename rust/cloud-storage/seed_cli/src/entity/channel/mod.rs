//! Channel entity commands for seeding channel data.

#[cfg(test)]
mod test;

use std::path::Path;

use anyhow::Context;
use clap::{Args, Subcommand, ValueEnum};
use comms_db_client::channels::create_channel::CreateChannelOptions;
use comms_db_client::channels::seed_channel::SeedChannelOptions;
use model::comms::ChannelType;
use serde::Deserialize;
use uuid::Uuid;

use crate::config::SeedCliContext;

/// Arguments for the `channel` entity subcommand.
#[derive(Debug, Args)]
pub struct ChannelArgs {
    /// The action to perform on channels
    #[command(subcommand)]
    pub command: ChannelCommand,
}

/// Available commands for the channel entity.
#[derive(Debug, Subcommand)]
pub enum ChannelCommand {
    /// Create a single channel
    Create(CreateArgs),
    /// Bulk create multiple channels
    BulkCreate(BulkCreateArgs),
    /// Seed channels from a fixed CSV file with pre-defined UUIDs
    Seed(SeedArgs),
}

/// Arguments for seeding channels from a fixed CSV file.
#[derive(Debug, Args)]
pub struct SeedArgs {
    /// The user ID to set as channel owner and append to participants
    #[arg(long)]
    pub user_id: String,
}

/// A row in the seed CSV file.
#[derive(Debug, Deserialize)]
struct CsvSeedChannelRow {
    /// Pre-defined channel UUID.
    channel_id: Uuid,
    /// Channel name (optional).
    channel_name: Option<String>,
    /// Channel type.
    channel_type: ChannelType,
    /// Semicolon-separated list of participant user IDs.
    #[serde(default, deserialize_with = "deserialize_semicolon_list")]
    participants: Vec<String>,
}

/// CLI-friendly channel type enum with kebab-case values.
#[derive(Debug, Clone, ValueEnum)]
pub enum CliChannelType {
    /// Public channel
    Public,
    /// Organization channel
    Organization,
    /// Private channel
    Private,
    /// Direct message channel
    DirectMessage,
}

impl From<CliChannelType> for ChannelType {
    fn from(value: CliChannelType) -> Self {
        match value {
            CliChannelType::Public => ChannelType::Public,
            CliChannelType::Organization => ChannelType::Organization,
            CliChannelType::Private => ChannelType::Private,
            CliChannelType::DirectMessage => ChannelType::DirectMessage,
        }
    }
}

/// Arguments for creating a single channel.
#[derive(Debug, Args)]
pub struct CreateArgs {
    /// The name of the channel (optional)
    #[arg(long)]
    pub channel_name: Option<String>,
    /// The user ID of the channel owner
    #[arg(long)]
    pub channel_owner: String,
    /// The type of channel to create
    #[arg(long)]
    pub channel_type: CliChannelType,
    /// Comma-delimited list of member user IDs
    #[arg(long, value_delimiter = ',')]
    pub channel_members: Vec<String>,
    /// Organization ID (optional)
    #[arg(long)]
    pub org_id: Option<i64>,
}

/// Arguments for bulk creating channels.
#[derive(Debug, Args)]
pub struct BulkCreateArgs {
    /// Path to the CSV file containing channels to create
    #[arg(long)]
    pub file_path: String,
}

/// A row in the bulk-create CSV file.
#[derive(Debug, Deserialize)]
struct CsvChannelRow {
    /// Channel name (optional)
    name: Option<String>,
    /// User ID of the channel owner
    owner_id: String,
    /// Channel type
    channel_type: ChannelType,
    /// Organization ID (optional)
    org_id: Option<i64>,
    /// Semicolon-separated list of participant user IDs
    #[serde(default, deserialize_with = "deserialize_semicolon_list")]
    participants: Vec<String>,
}

fn deserialize_semicolon_list<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    if s.is_empty() {
        return Ok(Vec::new());
    }
    Ok(s.split(';').map(|s| s.trim().to_string()).collect())
}

impl ChannelArgs {
    /// Execute the channel command.
    pub async fn execute(self, ctx: SeedCliContext) -> anyhow::Result<()> {
        match self.command {
            ChannelCommand::Create(args) => create(args, ctx).await,
            ChannelCommand::BulkCreate(args) => bulk_create(args, ctx).await,
            ChannelCommand::Seed(args) => seed(args, ctx).await,
        }
    }
}

#[tracing::instrument(skip(ctx), err)]
async fn create(args: CreateArgs, ctx: SeedCliContext) -> anyhow::Result<()> {
    tracing::info!("creating channel");

    let options = CreateChannelOptions {
        name: args.channel_name,
        owner_id: args.channel_owner,
        channel_type: args.channel_type.into(),
        org_id: args.org_id,
        participants: args.channel_members,
    };

    let channel_id = ctx.db.create_channel(options).await?;
    println!("Created channel with id {channel_id}");

    Ok(())
}

#[tracing::instrument(skip(ctx), err)]
async fn bulk_create(args: BulkCreateArgs, ctx: SeedCliContext) -> anyhow::Result<()> {
    tracing::info!("bulk creating channels");

    let content = std::fs::read_to_string(Path::new(&args.file_path))
        .with_context(|| format!("failed to read csv file: {}", args.file_path))?;

    let mut reader = csv::Reader::from_reader(content.as_bytes());
    let rows: Vec<CsvChannelRow> = reader
        .deserialize()
        .collect::<Result<Vec<_>, _>>()
        .context("failed to parse csv")?;

    if rows.is_empty() {
        anyhow::bail!("no channels found in csv file");
    }

    println!("Found {} channels to create", rows.len());

    let mut created = 0;
    let mut failed = 0;

    for row in rows {
        let channel_label = row
            .name
            .as_deref()
            .map_or_else(|| format!("{:?}", row.channel_type), str::to_string);

        let options = CreateChannelOptions {
            name: row.name,
            owner_id: row.owner_id,
            channel_type: row.channel_type,
            org_id: row.org_id,
            participants: row.participants,
        };

        match ctx.db.create_channel(options).await {
            Ok(channel_id) => {
                println!("Created channel {channel_label} with id {channel_id}");
                created += 1;
            }
            Err(e) => {
                tracing::error!(error=?e, channel = channel_label, "failed to create channel");
                println!("Failed to create channel {channel_label}: {e}");
                failed += 1;
            }
        }
    }

    println!("\nBulk create complete: {created} created, {failed} failed");

    Ok(())
}

#[tracing::instrument(skip(ctx), err)]
async fn seed(args: SeedArgs, ctx: SeedCliContext) -> anyhow::Result<()> {
    seed_from_file(args, ctx, Path::new("seed/channels.csv")).await
}

async fn seed_from_file(args: SeedArgs, ctx: SeedCliContext, path: &Path) -> anyhow::Result<()> {
    tracing::info!("seeding channels");

    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read csv file: {}", path.display()))?;

    let mut reader = csv::Reader::from_reader(content.as_bytes());
    let rows: Vec<CsvSeedChannelRow> = reader
        .deserialize()
        .collect::<Result<Vec<_>, _>>()
        .context("failed to parse csv")?;

    if rows.is_empty() {
        anyhow::bail!("no channels found in csv file");
    }

    println!("Found {} channels to seed", rows.len());

    let mut created = 0;
    let mut failed = 0;

    for row in rows {
        let channel_label = row
            .channel_name
            .as_deref()
            .map_or_else(|| format!("{:?}", row.channel_type), str::to_string);

        let mut participants = row.participants;
        if !participants.contains(&args.user_id) {
            participants.push(args.user_id.clone());
        }

        let options = SeedChannelOptions {
            channel_id: row.channel_id,
            name: row.channel_name,
            owner_id: args.user_id.clone(),
            channel_type: row.channel_type,
            org_id: None,
            participants,
        };

        match ctx.db.seed_channel(options).await {
            Ok(channel_id) => {
                println!("Seeded channel {channel_label} with id {channel_id}");
                created += 1;
            }
            Err(e) => {
                tracing::error!(error=?e, channel = channel_label, "failed to seed channel");
                println!("Failed to seed channel {channel_label}: {e}");
                failed += 1;
            }
        }
    }

    println!("\nSeed complete: {created} created, {failed} failed");

    Ok(())
}
