use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Context;
use uuid::Uuid;

/// A Macro-signed API token with optional agent attribution for SDK messages.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
pub struct MacroApiToken {
    /// The expiration time of the token
    pub exp: usize,
    /// The issuer of the token
    /// This is the fuisionauth domain
    pub iss: String,
    /// The root fusionauth id of the user. This is provided from the macro-access-token
    /// root_macro_id which is put into the UserContext
    pub fusion_user_id: String,
    /// The macro user id of the user
    pub macro_user_id: String,
    /// The organization id for the user if they belong to one
    pub macro_organization_id: Option<i32>,
    /// Agent responsible for this user-authorized execution, signed by the harness.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<Uuid>,
}

pub struct EncodeMacroApiTokenArgs {
    /// The fusionauth id
    pub fusionauth_id: String,
    /// The macro user id
    pub macro_user_id: String,
    /// The organization id
    pub organization_id: Option<i32>,
    /// The issuer of the token
    pub issuer: String,
    /// The private key used to sign the token
    pub private_key: String,
    /// The token expiry duration in seconds
    pub expiry_seconds: usize,
    /// Optional agent attribution; never supplied by an API caller.
    pub agent_id: Option<Uuid>,
}

#[tracing::instrument(skip(args))]
pub fn encode_macro_api_token(args: EncodeMacroApiTokenArgs) -> anyhow::Result<String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize;

    let claims = MacroApiToken {
        exp: now + args.expiry_seconds,
        agent_id: args.agent_id,
        iss: args.issuer.clone(),
        fusion_user_id: args.fusionauth_id.clone(),
        macro_user_id: args.macro_user_id.clone(),
        macro_organization_id: args.organization_id,
    };

    let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
    header.kid = Some("macro".to_string());

    let token = jsonwebtoken::encode(
        &header,
        &claims,
        &jsonwebtoken::EncodingKey::from_rsa_pem(args.private_key.as_ref())
            .context("failed to create encoding key")?,
    )
    .context("failed to encode token")?;

    Ok(token)
}
