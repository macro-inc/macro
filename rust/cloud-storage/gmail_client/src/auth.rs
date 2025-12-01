use crate::GmailClient;
use anyhow::Context;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use models_email::gmail::webhook::{
    GoogleJwtClaims, GooglePublicKeys, JwksResponse, JwtVerificationError, KeyMap,
};
use std::collections::HashMap;

pub(crate) async fn fetch_google_public_keys(
    client: &GmailClient,
) -> anyhow::Result<GooglePublicKeys> {
    let response = client
        .inner
        .get(&client.certs_url)
        .send()
        .await
        .context("Failed to send request to Google certificates endpoint")?;

    let response = response
        .error_for_status()
        .context("Google certificates endpoint returned an error status")?;

    // Extract the Cache-Control header and parse max-age
    let max_age_seconds = response
        .headers()
        .get("Cache-Control")
        .and_then(|value| value.to_str().ok())
        .and_then(|cc| {
            cc.split(',')
                .map(|s| s.trim())
                .find(|s| s.starts_with("max-age="))
                .and_then(|max_age_str| {
                    max_age_str
                        .strip_prefix("max-age=")
                        .and_then(|age| age.parse::<u64>().ok())
                })
        })
        .unwrap_or(0); // Default to 0 if header is missing or invalid

    let jwks_response = response
        .json::<JwksResponse>()
        .await
        .context("Failed to parse JWKS response from Google certificates endpoint")?;

    let mut keys_map = HashMap::new();
    for key in jwks_response.keys {
        keys_map.insert(key.kid.clone(), key);
    }

    if keys_map.is_empty() {
        return Err(anyhow::anyhow!(
            "No valid RSA keys found in Google JWKS response"
        ));
    }

    Ok(GooglePublicKeys {
        max_age_seconds,
        keys: keys_map,
    })
}

pub(crate) fn verify_google_jwt(
    client: &GmailClient,
    token: &str,
    public_keys: KeyMap,
) -> Result<GoogleJwtClaims, JwtVerificationError> {
    // Extract the key ID from the JWT header
    let header = jsonwebtoken::decode_header(token)
        .map_err(|e| JwtVerificationError::HeaderDecodeError(e.into()))?;

    let kid = header.kid.ok_or_else(|| JwtVerificationError::MissingKid)?;

    // Find the corresponding public key
    let public_key = public_keys
        .get(&kid)
        .ok_or_else(|| JwtVerificationError::KeyNotFound(kid))?;

    if public_key.kty != "RSA" {
        return Err(JwtVerificationError::UnsupportedKeyType(
            public_key.kty.clone(),
        ));
    }

    let decoding_key = DecodingKey::from_rsa_components(&public_key.n, &public_key.e)
        .map_err(|e| JwtVerificationError::DecodingKeyCreationError(e.into()))?;

    // Set up validation parameters
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[&client.audience]);
    validation.set_issuer(&["accounts.google.com", "https://accounts.google.com"]);

    // Verify and decode the token
    let token_data = match decode::<GoogleJwtClaims>(token, &decoding_key, &validation) {
        Ok(data) => data,
        Err(err) => {
            // Provide more specific error information based on the JWT error
            return Err(match &err.kind() {
                jsonwebtoken::errors::ErrorKind::InvalidSignature => {
                    JwtVerificationError::InvalidSignature
                }
                jsonwebtoken::errors::ErrorKind::InvalidAudience => {
                    JwtVerificationError::InvalidAudience
                }
                jsonwebtoken::errors::ErrorKind::InvalidIssuer => {
                    JwtVerificationError::InvalidIssuer
                }
                _ => JwtVerificationError::ValidationError(err.into()),
            });
        }
    };

    Ok(token_data.claims)
}

#[cfg(feature = "gmail_test")]
#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::Context;

    #[tokio::test]
    #[ignore = "Jwt env var is not available in CI"]
    async fn test_verify_real_google_jwt() -> anyhow::Result<()> {
        let gmail_client = super::GmailClient::new("hello".to_string());

        let public_keys = fetch_google_public_keys(&gmail_client).await?;

        let jwt = std::env::var("GOOGLE_TEST_JWT")
            .context("GOOGLE_TEST_JWT environment variable not set")?;

        let expected_audience = gmail_client.audience.as_str();

        let claims = verify_google_jwt(&gmail_client, &jwt, public_keys.keys)?;

        assert_eq!(
            claims.iss, "https://accounts.google.com",
            "Issuer should be accounts.google.com"
        );
        assert!(!claims.sub.is_empty(), "Subject should not be empty");
        assert!(!claims.email.is_empty(), "Email should not be empty");
        assert!(claims.email_verified, "Email should be verified");
        assert!(
            claims.exp > claims.iat,
            "Expiration time should be after issued at time"
        );

        println!("✅ Successfully verified Google JWT");
        println!("Email: {}", claims.email);
        println!("Subject: {}", claims.sub);
        println!(
            "Issued at: {}",
            chrono::DateTime::from_timestamp(claims.iat as i64, 0).unwrap()
        );
        println!(
            "Expires at: {}",
            chrono::DateTime::from_timestamp(claims.exp as i64, 0).unwrap()
        );

        Ok(())
    }
}
