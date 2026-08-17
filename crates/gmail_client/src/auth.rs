use std::collections::HashMap;

use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use models_email::gmail::inbox_sync::{
    GoogleJwtClaims, GooglePublicKeys, JwksResponse, JwtVerificationError, KeyMap,
};

use crate::error::{decode_json_response, unsuccessful_response};
use crate::{GmailApiHttpError, GmailClient};

pub(crate) async fn fetch_google_public_keys(
    client: &GmailClient,
) -> Result<GooglePublicKeys, GmailApiHttpError> {
    let response = client
        .inner
        .get(&client.certs_url)
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    let max_age_seconds = response
        .headers()
        .get(reqwest::header::CACHE_CONTROL)
        .and_then(|value| value.to_str().ok())
        .and_then(parse_cache_max_age)
        .unwrap_or(0);
    let jwks: JwksResponse = decode_json_response(response).await?;

    let keys = jwks
        .keys
        .into_iter()
        .map(|key| (key.kid.clone(), key))
        .collect::<HashMap<_, _>>();
    if keys.is_empty() {
        return Err(GmailApiHttpError::InvalidResponse(
            "Google JWKS response did not contain any RSA keys".to_string(),
        ));
    }

    Ok(GooglePublicKeys {
        max_age_seconds,
        keys,
    })
}

fn parse_cache_max_age(cache_control: &str) -> Option<u64> {
    cache_control.split(',').find_map(|directive| {
        let (name, value) = directive.trim().split_once('=')?;
        if !name.trim().eq_ignore_ascii_case("max-age") {
            return None;
        }
        value.trim().trim_matches('"').parse().ok()
    })
}

pub(crate) fn verify_google_jwt(
    client: &GmailClient,
    token: &str,
    public_keys: KeyMap,
) -> Result<GoogleJwtClaims, JwtVerificationError> {
    let header = jsonwebtoken::decode_header(token)
        .map_err(|error| JwtVerificationError::HeaderDecodeError(error.into()))?;
    let kid = header.kid.ok_or(JwtVerificationError::MissingKid)?;
    let public_key = public_keys
        .get(&kid)
        .ok_or_else(|| JwtVerificationError::KeyNotFound(kid))?;

    if public_key.kty != "RSA" {
        return Err(JwtVerificationError::UnsupportedKeyType(
            public_key.kty.clone(),
        ));
    }

    let decoding_key = DecodingKey::from_rsa_components(&public_key.n, &public_key.e)
        .map_err(|error| JwtVerificationError::DecodingKeyCreationError(error.into()))?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[&client.audience]);
    validation.set_issuer(&["accounts.google.com", "https://accounts.google.com"]);

    decode::<GoogleJwtClaims>(token, &decoding_key, &validation)
        .map(|token_data| token_data.claims)
        .map_err(|error| match error.kind() {
            jsonwebtoken::errors::ErrorKind::InvalidSignature => {
                JwtVerificationError::InvalidSignature
            }
            jsonwebtoken::errors::ErrorKind::InvalidAudience => {
                JwtVerificationError::InvalidAudience
            }
            jsonwebtoken::errors::ErrorKind::InvalidIssuer => JwtVerificationError::InvalidIssuer,
            _ => JwtVerificationError::ValidationError(error.into()),
        })
}

#[cfg(test)]
mod test;
