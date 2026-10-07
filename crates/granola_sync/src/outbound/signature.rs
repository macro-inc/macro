use crate::domain::{
    models::{Delivery, SigningSecret},
    ports::DeliveryVerifier,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use hmac::{Hmac, Mac};
use sha2::Sha256;

/// Standard Webhooks HMAC verification with a five-minute replay window.
pub struct StandardWebhooks;

impl DeliveryVerifier for StandardWebhooks {
    fn verify(&self, secret: &SigningSecret, delivery: &Delivery<'_>) -> bool {
        verify_at(secret, delivery, chrono::Utc::now().timestamp())
    }
}

fn verify_at(secret: &SigningSecret, delivery: &Delivery<'_>, now: i64) -> bool {
    let Ok(timestamp) = delivery.timestamp.parse::<i64>() else {
        return false;
    };
    if now.abs_diff(timestamp) > 300 {
        return false;
    }
    let Some(secret) = secret.0.strip_prefix("whsec_") else {
        return false;
    };
    let Ok(key) = STANDARD.decode(secret) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(&key) else {
        return false;
    };
    mac.update(delivery.id.as_bytes());
    mac.update(b".");
    mac.update(delivery.timestamp.as_bytes());
    mac.update(b".");
    mac.update(delivery.body);
    delivery.signature.split_whitespace().any(|signature| {
        let Some(signature) = signature.strip_prefix("v1,") else {
            return false;
        };
        let Ok(signature) = STANDARD.decode(signature) else {
            return false;
        };
        mac.clone().verify_slice(&signature).is_ok()
    })
}

#[cfg(test)]
mod test;
