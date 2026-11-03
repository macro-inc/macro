//! Dialpad signs each delivery as an HS256 JWT whose claims are the event.
use crate::domain::{
    models::{CallEvent, SigningSecret},
    ports::DeliveryVerifier,
};
use jsonwebtoken::{Algorithm, DecodingKey, Validation};

/// [`DeliveryVerifier`] for Dialpad's HS256 JWT deliveries.
pub struct JwtVerifier;

impl DeliveryVerifier for JwtVerifier {
    fn verify(&self, secret: &SigningSecret, body: &[u8]) -> Option<CallEvent> {
        let token = std::str::from_utf8(body).ok()?.trim();
        // Only HS256 under our secret; the events carry no registered claims.
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_required_spec_claims::<&str>(&[]);
        validation.validate_exp = false;
        validation.validate_aud = false;
        jsonwebtoken::decode::<CallEvent>(
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
