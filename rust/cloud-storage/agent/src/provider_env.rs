use rig_core::client::{ProviderClientError, ProviderClientResult};
use rig_core::providers::{anthropic, openai};

// TODO: remove this shim once our rig fork's client env helpers call macro_env_var directly.
/// Mirror rig-core's required env var helper, but with macro_env_var's APP_SECRETS_JSON support.
pub(crate) fn required_env_var(name: &'static str) -> ProviderClientResult<String> {
    macro_env_var::read_env_var(name)
        .map_err(|source| ProviderClientError::EnvironmentVariable { name, source })
}

/// Mirror rig-core's optional env var helper, but with macro_env_var's APP_SECRETS_JSON support.
pub(crate) fn optional_env_var(name: &'static str) -> ProviderClientResult<Option<String>> {
    macro_env_var::optional_read_env_var(name)
        .map_err(|source| ProviderClientError::EnvironmentVariable { name, source })
}

/// Create an Anthropic client from APP_SECRETS_JSON-aware environment values.
pub(crate) fn anthropic_client_from_env() -> ProviderClientResult<anthropic::Client> {
    let api_key = required_env_var("ANTHROPIC_API_KEY")?;

    anthropic::Client::builder()
        .api_key(api_key)
        .build()
        .map_err(Into::into)
}

/// Create an OpenAI client from APP_SECRETS_JSON-aware environment values.
pub(crate) fn openai_client_from_env() -> ProviderClientResult<openai::Client> {
    let base_url = optional_env_var("OPENAI_BASE_URL")?;
    let api_key = required_env_var("OPENAI_API_KEY")?;

    let mut builder = openai::Client::builder().api_key(api_key);

    if let Some(base_url) = base_url {
        builder = builder.base_url(base_url);
    }

    builder.build().map_err(Into::into)
}
