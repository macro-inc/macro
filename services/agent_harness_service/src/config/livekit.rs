//! Validated server-only LiveKit Cloud credentials.

/// A configured calls provider; absence is represented by `Option` at composition.
pub(crate) struct LiveKitCredentials {
    api_key: String,
    api_secret: String,
}

impl LiveKitCredentials {
    pub(crate) fn new(api_key: String, api_secret: String) -> anyhow::Result<Self> {
        if api_key.trim().is_empty() || api_secret.trim().is_empty() {
            anyhow::bail!("LIVEKIT_API_KEY and LIVEKIT_API_SECRET must both be nonblank");
        }
        if api_key.trim() != api_key || api_secret.trim() != api_secret {
            anyhow::bail!(
                "LIVEKIT_API_KEY and LIVEKIT_API_SECRET must not have surrounding whitespace"
            );
        }
        Ok(Self {
            api_key,
            api_secret,
        })
    }

    pub(crate) fn api_key(&self) -> &str {
        &self.api_key
    }

    pub(crate) fn api_secret(&self) -> &str {
        &self.api_secret
    }
}
