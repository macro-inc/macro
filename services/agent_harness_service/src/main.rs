//! Composition root for the agent harness service.
//!
//! The hexagon lives in `crates/agent_harness`; this binary is the shell around
//! it. Its whole job is to read the environment, turn those values into adapter
//! arguments, and run the Kafka consumer. It is the only place that knows both
//! what the config looks like and which concrete adapters are live.
//!
//! There is no HTTP server: the harness is triggered by channel messages on
//! `macro.channels`, not by an API call.
//!
//! Every adapter constructed here is real, but most of their *methods* are
//! still `todo!()`. The process starts, joins the consumer group, and logs
//! channel traffic; it will panic the first time a mention actually drives one
//! of them.
//!
//! `RuntimeAttachments` is deliberately the logging stub rather than agent_proxy:
//! wiring the real one means building its `PgChatRepo`, `SessionRegistry`,
//! `GatewayNotifier`, `PgPendingMessages`, and `RedisPostgresStreamRepo` here,
//! which is the next chunk of work.

mod config;

use std::sync::Arc;

use agent_harness::domain::handler::MentionHandler;
use agent_harness::inbound::kafka;
use agent_harness::outbound::channel_reply::ChannelsReplier;
use agent_harness::outbound::daytona::{
    DaytonaApiKey, DaytonaProvider, DaytonaSettings, GithubToken,
};
use agent_harness::testing::mock_proxy::LoggingAttachments;
use agent_session::outbound::postgres::PgAgentSessionRepo;
use anyhow::Context;
use bots::domain::models::BotId;
use channels::domain::service::ChannelServiceImpl;
use channels::outbound::pg_channels_repo::PgChannelsRepo;
use sqlx::postgres::PgPoolOptions;

use crate::config::Config;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    macro_entrypoint::MacroEntrypoint::default().init();
    agent_harness::install_tls_provider();

    let config = Config::from_env()?;
    let bot = BotId::new_from_uuid(config.harness_bot_id);

    let db = PgPoolOptions::new()
        .min_connections(3)
        .max_connections(10)
        .connect(&config.database_url)
        .await
        .context("failed to connect to macrodb")?;

    let provider = Arc::new(DaytonaProvider::new(DaytonaSettings {
        api_url: config.daytona_api_url.clone(),
        api_key: DaytonaApiKey::new(config.daytona_api_key.as_ref().to_owned()),
        snapshot: config.daytona_snapshot.clone(),
        github_token: GithubToken::new(config.github_token.as_ref().to_owned()),
    }));

    let attachments = Arc::new(LoggingAttachments::new(String::new()));
    let sessions = Arc::new(PgAgentSessionRepo::new(db.clone()));
    let channels = Arc::new(ChannelServiceImpl::new(PgChannelsRepo::new(db.clone())));
    let replier = Arc::new(ChannelsReplier::new(channels, bot));

    let handler = Arc::new(MentionHandler::new(
        bot,
        provider,
        attachments,
        sessions,
        replier,
    ));

    let consumer = kafka::consumer(config.kafka_brokers.as_ref())
        .map_err(|error| anyhow::anyhow!("failed to build kafka consumer: {error}"))?;

    tracing::info!(environment = %config.environment, "agent harness starting");

    kafka::run(handler, consumer).await
}
