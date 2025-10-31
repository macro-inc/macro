use super::constant::{ANTHROPIC_API_KEY, ANTHROPIC_ROUTER_BASE_URL};
use crate::error::{Error, Result};
use secrecy::SecretString;

#[derive(Debug, Clone, Default)]
pub struct Config {
    pub api_base: String,
    pub api_key: SecretString,
}

impl Config {
    pub fn try_from_env() -> Result<Self> {
        Ok(Self {
            api_base: ANTHROPIC_ROUTER_BASE_URL.into(),
            api_key: std::env::var(ANTHROPIC_API_KEY)
                .map_err(Error::Config)?
                .into(),
        })
    }
}
