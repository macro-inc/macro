pub use macro_env::Environment;
use macro_env_var::env_var;

pub struct Config {
    pub enable_ai_usage_enforcement: ai_usage::AiUsageEnforcement,
    pub environment: Environment,
    pub database_url: String,
    pub user_id: String,
}

env_var!(
    pub struct EnvVars {
        pub DatabaseUrl,
        pub UserId,
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
        } = env_vars;

        Ok(Self {
            enable_ai_usage_enforcement,
            environment,
            database_url: database_url.to_string(),
            user_id: user_id.to_string(),
        })
    }
}
