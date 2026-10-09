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
use macro_env_var::{env_vars, maybe_env_vars};

#[cfg(test)]
mod test;

env_vars! {
    /// Comma-separated Kafka bootstrap servers for the macro event broker.
    pub struct KafkaBrokers;
}

maybe_env_vars! {
    /// The authentication service's own internal key, which settlement
    /// requests for counted usage present. Required while
    /// `ENABLE_AI_USAGE_BILLING` is true; otherwise unused.
    pub struct AuthenticationServiceSecretKey;
}

/// The configuration parameters for the agent schedule service.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// Default-off quota admission and prospective usage counting.
    #[macro_config_default(ai_usage::AiUsageEnforcement::Disabled)]
    pub enable_ai_usage_enforcement: ai_usage::AiUsageEnforcement,
    /// Default-off settlement of usage past allowances. When enabled, counted
    /// usage recorded here asks the authentication service to settle; that
    /// service's own policy decides whether it does.
    #[macro_config_default(ai_billing::AiUsageBilling::Disabled)]
    pub enable_ai_usage_billing: ai_billing::AiUsageBilling,
    /// Key settlement requests present to the authentication service.
    pub authentication_service_secret_key: AuthenticationServiceSecretKey,
    /// The free plan's hard monthly AI cap, in cents at provider cost.
    /// Mandatory; set in Doppler.
    pub ai_usage_free_included_allowance_cents: ai_billing::IncludedAllowanceCents,
    /// In-plan AI allowance per Premium seat per period, in cents at provider
    /// cost. Mandatory; set in Doppler.
    pub ai_usage_included_allowance_cents: ai_billing::IncludedAllowanceCents,
    /// In-plan AI allowance per Max seat per period, in cents at provider
    /// cost. Mandatory; set in Doppler.
    pub ai_usage_max_included_allowance_cents: ai_billing::IncludedAllowanceCents,
    /// Markup on paid AI usage past the allowance, as a whole percent of
    /// provider cost. Mandatory; set in Doppler.
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
    /// TypeSafe credential for the Jev classifier behind trigger conditions.
    /// Optional: routines cannot save conditions while it is unset.
    pub typesafe_api_key: jev::outbound::TypesafeApiKey,
}

impl Config {
    /// The AI pricing every billing component is composed with. Every value
    /// is validated when the configuration loads.
    pub fn ai_pricing(&self) -> ai_billing::AiPricing {
        ai_billing::AiPricing::new(
            ai_billing::PlanAllowances {
                free: self.ai_usage_free_included_allowance_cents,
                premium: self.ai_usage_included_allowance_cents,
                max: self.ai_usage_max_included_allowance_cents,
            },
            self.ai_usage_overage_markup_percent,
        )
    }

    /// Where this host's settlement requests go: the authentication service
    /// while `ENABLE_AI_USAGE_BILLING` is true, which then requires
    /// `AUTHENTICATION_SERVICE_SECRET_KEY`; nowhere otherwise.
    pub fn settlement_route(&self) -> anyhow::Result<ai_billing::composition::SettlementRoute> {
        let client = self
            .authentication_service_secret_key
            .value()
            .filter(|key| !key.trim().is_empty())
            .map(|key| {
                anyhow::Ok(std::sync::Arc::new(
                    authentication_service_client::AuthServiceClient::new(
                        key.to_owned(),
                        macro_service_urls::AuthServiceUrl::new()?.to_string(),
                    ),
                ))
            })
            .transpose()?;
        Ok(ai_billing::composition::SettlementRoute::from_policy(
            self.enable_ai_usage_billing,
            client,
        )?)
    }

    pub fn from_env() -> anyhow::Result<Self> {
        let enforcement = ai_usage::config::load_ai_usage_enforcement()
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        let billing = ai_billing::config::load_ai_usage_billing()
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        let mut config = macro_config::ConfigLoader::load::<Config>()
            .context("failed to load agent schedule service config")?;
        config.enable_ai_usage_enforcement = enforcement;
        config.enable_ai_usage_billing = billing;
        Ok(config)
    }
}
