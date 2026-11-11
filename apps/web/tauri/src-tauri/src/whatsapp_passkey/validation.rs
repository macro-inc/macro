//! The WhatsApp boundary around the authenticator: what we agree to sign, and
//! what we agree to hand back.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use webauthn_rs_proto::{
    PublicKeyCredential, PublicKeyCredentialRequestOptions, RequestChallengeResponse,
    UserVerificationPolicy,
};

use super::AuthenticationError;

/// The origin every assertion is made for, whatever the caller asks.
pub(super) const WHATSAPP_ORIGIN: &str = "https://web.whatsapp.com";
/// Relying-party ids WhatsApp may ask for; anything else is refused.
const RELYING_PARTY_IDS: [&str; 2] = ["whatsapp.com", "web.whatsapp.com"];
const MAX_CHALLENGE_BYTES: usize = 1024;
/// The authenticator library caps ceremonies at 60 seconds anyway.
const TIMEOUT_MS: u32 = 60_000;

/// Authenticator-data flag: user present.
const FLAG_USER_PRESENT: u8 = 0x01;
/// Authenticator-data flag: user verified.
const FLAG_USER_VERIFIED: u8 = 0x04;

/// Parse WhatsApp's request options and pin them to WhatsApp: refuse any other
/// relying party, force user verification, and drop extensions that would
/// widen what may answer (`appid`) or what comes back (`hmacGetSecret`).
pub(super) fn request_options(
    challenge: serde_json::Value,
) -> Result<RequestChallengeResponse, AuthenticationError> {
    let mut options: PublicKeyCredentialRequestOptions =
        serde_json::from_value(challenge).map_err(|_| AuthenticationError::Invalid)?;
    if !RELYING_PARTY_IDS.contains(&options.rp_id.as_str())
        || options.challenge.is_empty()
        || options.challenge.len() > MAX_CHALLENGE_BYTES
    {
        return Err(AuthenticationError::Invalid);
    }
    options.user_verification = UserVerificationPolicy::Required;
    options.timeout = Some(TIMEOUT_MS);
    if let Some(extensions) = options.extensions.as_mut() {
        extensions.appid = None;
        extensions.hmac_get_secret = None;
    }
    Ok(RequestChallengeResponse {
        public_key: options,
        mediation: None,
    })
}

#[derive(Deserialize)]
struct ClientData {
    #[serde(rename = "type")]
    kind: String,
    challenge: String,
    origin: String,
}

/// Check the assertion answers exactly the request: same challenge, WhatsApp's
/// origin and relying party, an allowed credential, and a verified user.
pub(super) fn verify_assertion(
    options: &PublicKeyCredentialRequestOptions,
    credential: &PublicKeyCredential,
) -> Result<(), AuthenticationError> {
    let client: ClientData = serde_json::from_slice(&credential.response.client_data_json)
        .map_err(|_| AuthenticationError::Unavailable)?;
    let signed_challenge = URL_SAFE_NO_PAD
        .decode(client.challenge.trim_end_matches('='))
        .map_err(|_| AuthenticationError::Unavailable)?;
    if credential.type_ != "public-key"
        || client.kind != "webauthn.get"
        || client.origin != WHATSAPP_ORIGIN
        || signed_challenge != options.challenge
    {
        return Err(AuthenticationError::Unavailable);
    }
    if !options.allow_credentials.is_empty()
        && !options
            .allow_credentials
            .iter()
            .any(|allowed| allowed.id == credential.raw_id)
    {
        return Err(AuthenticationError::Unavailable);
    }

    let authenticator_data = &credential.response.authenticator_data;
    let (Some(relying_party_hash), Some(&flags)) =
        (authenticator_data.get(..32), authenticator_data.get(32))
    else {
        return Err(AuthenticationError::Unavailable);
    };
    if relying_party_hash != Sha256::digest(options.rp_id.as_bytes()).as_slice() {
        return Err(AuthenticationError::Unavailable);
    }
    if flags & FLAG_USER_PRESENT == 0 || flags & FLAG_USER_VERIFIED == 0 {
        return Err(AuthenticationError::Unverified);
    }
    Ok(())
}

#[cfg(test)]
mod test;
