use clap::{Parser, ValueEnum};
use database_env_vars::DatabaseUrl;
use entity_access::{
    domain::{explain::ExplainAccessServiceImpl, models::EntityType, ports::ExplainAccessService},
    outbound::PgExplainAccessRepository,
};
use macro_entrypoint::MacroEntrypoint;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::postgres::PgPoolOptions;
use std::str::FromStr;

#[derive(Clone, Copy, Debug, ValueEnum)]
enum OutputFormat {
    Text,
    Json,
}

#[derive(Debug, Parser)]
#[command(version, about = "Explain how a user has access to an entity")]
struct Args {
    /// Macro user id, for example `macro|alice@example.com`.
    #[arg(long)]
    user: String,

    /// Entity id.
    #[arg(long)]
    entity_id: String,

    /// Entity type (`document`, `email_thread`, `thread`, …).
    #[arg(long, value_parser = parse_cli_entity_type)]
    entity_type: EntityType,

    /// Output format.
    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    format: OutputFormat,
}

fn parse_cli_entity_type(value: &str) -> Result<EntityType, String> {
    let normalized = if value == "thread" {
        "email_thread"
    } else {
        value
    };
    EntityType::from_str(normalized).map_err(|_| format!("invalid entity type: {value}"))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let args = Args::parse();
    let user = MacroUserIdStr::try_from(args.user)?;
    let database_url = DatabaseUrl::new()?;
    let pool = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(5)
        .connect(database_url.as_ref())
        .await?;

    let service = ExplainAccessServiceImpl::new(PgExplainAccessRepository::new(pool));
    let explanation = service
        .explain_access(&user, &args.entity_id, args.entity_type)
        .await?;

    match args.format {
        OutputFormat::Text => print!("{explanation}"),
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&explanation)?),
    }

    Ok(())
}
