//! Configuration for the agent schedule service, loaded via the standard
//! `macro_config` pattern so it gets a `doppler_config` validation binary.
//!
//! All required env vars are declared here as typed fields. The
//! `doppler_config` binary loads this `Config` from Doppler for both the dev
//! and prod environments, surfacing any missing or mistyped values at CI time.

use anyhow::Context;
use database_env_vars::DatabaseUrl;
use macro_auth::InternalApiKey;
pub use macro_env::Environment;
use macro_env_var::env_vars;

#[cfg(test)]
mod test;

env_vars! {
    /// Comma-separated Kafka bootstrap servers for the macro event broker.
    pub struct KafkaBrokers;
}

/// The configuration parameters for the agent schedule service.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// Default-off quota admission and prospective usage counting.
    #[macro_config_default(ai_usage::AiUsageEnforcement::Disabled)]
    pub enable_ai_usage_enforcement: ai_usage::AiUsageEnforcement,
    /// In-plan AI allowance per paid seat per period, in cents at provider
    /// cost. Mandatory; set in Doppler.
    pub ai_usage_included_allowance_cents: ai_billing::IncludedAllowanceCents,
    /// Markup on AI usage past the allowance, as a whole percent of provider
    /// cost. Mandatory; set in Doppler.
    pub ai_usage_overage_markup_percent: ai_billing::OverageMarkupPercent,
    /// The environment we are in.
    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
    /// Port to listen on. Defaults to `8080` when unset.
    #[macro_config_default(8080)]
    pub port: usize,
    /// The connection URL for the Postgres database this application uses.
    pub database_url: DatabaseUrl,
    pub kafka_brokers: KafkaBrokers,
    /// Enables event-trigger management, Kafka intake, and pending dispatch together.
    /// Register EVENT_ROUTINES_ENABLED as a raw boolean in Doppler before rollout.
    #[macro_config_default(false)]
    pub event_routines_enabled: bool,
    /// Accept agent-target configuration only after all scheduler workers are upgraded.
    /// Register ROUTINE_AGENTS_ENABLED as a raw boolean in Doppler before rollout.
    #[macro_config_default(false)]
    pub routine_agents_enabled: bool,
    /// The internal api key
    pub internal_api_key: InternalApiKey,
}

impl Config {
    /// The AI pricing every billing component is composed with. Both values
    /// are validated when the configuration loads.
    pub fn ai_pricing(&self) -> ai_billing::AiPricing {
        ai_billing::AiPricing::new(
            self.ai_usage_included_allowance_cents,
            self.ai_usage_overage_markup_percent,
        )
    }

    pub fn from_env() -> anyhow::Result<Self> {
        let enforcement = ai_usage::config::load_ai_usage_enforcement()
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        let mut config = macro_config::ConfigLoader::load::<Config>()
            .context("failed to load agent schedule service config")?;
        config.enable_ai_usage_enforcement = enforcement;
        Ok(config)
    }
}
