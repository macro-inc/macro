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
use agent_harness::outbound::agent_session_store::PgAgentSessionStore;
use agent_harness::outbound::channel_reply::ChannelsReplier;
use agent_harness::outbound::daytona::{
    DaytonaApiKey, DaytonaProvider, DaytonaSettings, GithubToken,
};
use agent_harness::testing::mock_proxy::LoggingAttachments;
use anyhow::Context;
use channels::domain::service::ChannelServiceImpl;
use channels::outbound::pg_channels_repo::PgChannelsRepo;
use sqlx::postgres::PgPoolOptions;

use crate::config::Config;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    macro_entrypoint::MacroEntrypoint::default().init();
    agent_harness::install_tls_provider();

    let config = Config::from_env()?;

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

    // TODO: the real session manager is agent_proxy, wired in once its
    // five ports are built here. Until then a mention logs its run instead of
    // persisting it.
    let attachments = Arc::new(LoggingAttachments::new(String::new()));
    let sessions = Arc::new(PgAgentSessionStore::new(db.clone()));
    // In process: no HTTP, no bot token. `ChannelServiceImpl::new` uses a no-op
    // event dispatcher, so replies persist but are not pushed to connected
    // clients - `with_dependencies` is what makes them appear live.
    let channels = Arc::new(ChannelServiceImpl::new(PgChannelsRepo::new(db.clone())));
    let replier = Arc::new(ChannelsReplier::new(
        channels,
        agent_harness::domain::mentions::HARNESS_BOT_ID,
    ));

    let handler = Arc::new(MentionHandler::new(
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
