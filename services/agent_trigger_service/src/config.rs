//! Environment-backed service configuration.

use anyhow::Context as _;
use database_env_vars::DatabaseUrl;
use macro_env_var::env_vars;

env_vars! {
    /// Comma-separated Kafka bootstrap servers.
    pub struct KafkaBrokers;
}

/// Configuration required by the agent trigger worker.
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// Default-off quota admission and prospective usage counting.
    #[macro_config_default(ai_usage::AiUsageEnforcement::Disabled)]
    pub enable_ai_usage_enforcement: ai_usage::AiUsageEnforcement,
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
    /// MacroDB connection URL.
    pub database_url: DatabaseUrl,
    /// Kafka bootstrap servers.
    pub kafka_brokers: KafkaBrokers,
    /// Key for internal service-to-service calls (the lexical service).
    pub internal_api_key: String,
    /// Key required by document storage's internal endpoints.
    pub document_storage_service_auth_key: String,
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

    /// Loads configuration from the process environment.
    pub fn from_env() -> anyhow::Result<Self> {
        let enforcement = ai_usage::config::load_ai_usage_enforcement()
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        let mut config = macro_config::ConfigLoader::load::<Self>()
            .context("failed to load agent trigger service config")?;
        config.enable_ai_usage_enforcement = enforcement;
        Ok(config)
    }
}
