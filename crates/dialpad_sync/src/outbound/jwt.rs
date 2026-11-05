//! Dialpad signs each delivery as an HS256 JWT whose claims are the event.
use crate::domain::{models::SigningSecret, ports::DeliveryVerifier};
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use serde_json::Value;

/// [`DeliveryVerifier`] for Dialpad's HS256 JWT deliveries.
pub struct JwtVerifier;

impl DeliveryVerifier for JwtVerifier {
    fn verify(&self, secret: &SigningSecret, body: &[u8]) -> Option<Value> {
        let token = std::str::from_utf8(body).ok()?.trim();
        // Dialpad does not require an expiry, but honor one when supplied.
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_required_spec_claims::<&str>(&[]);
        validation.validate_aud = false;
        // Claims stay untyped: an unexpected event shape is not a bad signature.
        jsonwebtoken::decode::<Value>(
            token,
            &DecodingKey::from_secret(secret.0.as_bytes()),
            &validation,
        )
        .ok()
        .map(|data| data.claims)
    }
}

#[cfg(test)]
mod test;
