use anyhow::Context;
use macro_auth::macro_api_token::{EncodeMacroApiTokenArgs, encode_macro_api_token};

use crate::{LocalE2eConfig, SeedUser};

/// Default local E2E JWT lifetime: eight hours.
pub const DEFAULT_EXPIRY_SECONDS: usize = 8 * 60 * 60;

/// Options for generating a local Macro API token.
#[derive(Clone, Debug)]
pub struct LocalJwtOptions<'a> {
    /// Seed user to encode into the token.
    pub user: &'a SeedUser,
    /// Optional organization id claim.
    pub organization_id: Option<i32>,
    /// Optional token lifetime in seconds. Falls back to env, then [`DEFAULT_EXPIRY_SECONDS`].
    pub expiry_seconds: Option<usize>,
}

impl<'a> LocalJwtOptions<'a> {
    /// Create default token options for a seed user.
    pub fn new(user: &'a SeedUser) -> Self {
        Self {
            user,
            organization_id: None,
            expiry_seconds: None,
        }
    }

    /// Override the token lifetime.
    pub fn with_expiry_seconds(mut self, expiry_seconds: usize) -> Self {
        self.expiry_seconds = Some(expiry_seconds);
        self
    }
}

/// Explicit claims for generating a local Macro API token.
#[derive(Clone, Copy, Debug)]
pub struct LocalJwtClaims<'a> {
    /// FusionAuth user id claim.
    pub fusion_user_id: &'a str,
    /// Macro auth user id claim.
    pub macro_user_id: &'a str,
    /// Optional organization id claim.
    pub organization_id: Option<i32>,
    /// Optional issuer claim. Falls back to env, then `local`.
    pub issuer: Option<&'a str>,
    /// Optional token lifetime in seconds. Falls back to env, then [`DEFAULT_EXPIRY_SECONDS`].
    pub expiry_seconds: Option<usize>,
}

/// Generate a local Macro API token for a seed user.
pub fn encode_local_jwt(user: &SeedUser) -> anyhow::Result<String> {
    let config = LocalE2eConfig::load()?;
    encode_local_jwt_with(&config, LocalJwtOptions::new(user))
}

/// Generate a local Macro API token using explicit config and options.
pub fn encode_local_jwt_with(
    config: &LocalE2eConfig,
    options: LocalJwtOptions<'_>,
) -> anyhow::Result<String> {
    encode_local_jwt_claims_with(
        config,
        LocalJwtClaims {
            fusion_user_id: &options.user.fusion_user_id,
            macro_user_id: &options.user.user_id,
            organization_id: options.organization_id,
            expiry_seconds: options.expiry_seconds,
            issuer: None,
        },
    )
}

/// Generate a local Macro API token using explicit claims.
pub fn encode_local_jwt_claims_with(
    config: &LocalE2eConfig,
    claims: LocalJwtClaims<'_>,
) -> anyhow::Result<String> {
    let issuer = claims
        .issuer
        .or_else(|| config.get("MACRO_API_TOKEN_ISSUER"))
        .unwrap_or("local")
        .to_owned();
    let private_key = normalize_pem(config.required("MACRO_API_TOKEN_PRIVATE_SECRET_KEY")?);
    let expiry_seconds = match claims.expiry_seconds {
        Some(expiry_seconds) => expiry_seconds,
        None => config
            .get("MACRO_API_TOKEN_EXPIRY_SECONDS")
            .map(str::parse::<usize>)
            .transpose()
            .context("MACRO_API_TOKEN_EXPIRY_SECONDS must be an integer")?
            .unwrap_or(DEFAULT_EXPIRY_SECONDS),
    };

    encode_macro_api_token(EncodeMacroApiTokenArgs {
        fusionauth_id: claims.fusion_user_id.to_owned(),
        macro_user_id: claims.macro_user_id.to_owned(),
        organization_id: claims.organization_id,
        issuer,
        private_key,
        expiry_seconds,
    })
}

fn normalize_pem(value: &str) -> String {
    value.replace("\\n", "\n")
}
