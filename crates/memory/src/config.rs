pub use macro_env::Environment;
use macro_env_var::env_var;

pub struct Config {
    pub enable_ai_usage_enforcement: ai_usage::AiUsageEnforcement,
    /// The mandatory AI pricing shared with every other billing host.
    pub ai_pricing: ai_billing::AiPricing,
    pub environment: Environment,
    pub database_url: String,
    pub user_id: String,
}

env_var!(
    pub struct EnvVars {
        pub DatabaseUrl,
        pub UserId,
        /// The free plan's hard monthly AI cap, cents at provider cost.
        pub AiUsageFreeIncludedAllowanceCents,
        /// In-plan AI allowance per Premium seat per period, cents at provider cost.
        pub AiUsageIncludedAllowanceCents,
        /// In-plan AI allowance per Max seat per period, cents at provider cost.
        pub AiUsageMaxIncludedAllowanceCents,
        /// Markup on paid AI usage past the allowance, a whole percent of provider cost.
        pub AiUsageOverageMarkupPercent,
    }
);

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let enable_ai_usage_enforcement = ai_usage::config::load_ai_usage_enforcement()
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        let environment = Environment::new_or_prod();
        let env_vars = EnvVars::new()?;

        let EnvVars {
            database_url,
            user_id,
            ai_usage_free_included_allowance_cents,
            ai_usage_included_allowance_cents,
            ai_usage_max_included_allowance_cents,
            ai_usage_overage_markup_percent,
        } = env_vars;
        let ai_pricing = ai_billing::config::parse_ai_pricing(
            ai_billing::config::RawPlanAllowances {
                free: &ai_usage_free_included_allowance_cents,
                premium: &ai_usage_included_allowance_cents,
                max: &ai_usage_max_included_allowance_cents,
            },
            &ai_usage_overage_markup_percent,
        )
        .map_err(|error| anyhow::anyhow!("{error}"))?;

        Ok(Self {
            enable_ai_usage_enforcement,
            ai_pricing,
            environment,
            database_url: database_url.to_string(),
            user_id: user_id.to_string(),
        })
    }
}
