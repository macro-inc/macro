//! In-process Google test JWT signing with the lab's tracked local-only identity.

use super::*;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use jsonwebtoken::{Algorithm, EncodingKey, jwk::Jwk};

pub(super) struct Key {
    pub jwk: Value,
}

impl Key {
    pub fn new(lab: &mut Lab, kid: &str) -> Self {
        let key = EncodingKey::from_rsa_pem(crate::parity::PRIVATE_KEY.as_bytes())
            .expect("tracked local-only signing key");
        let mut jwk = serde_json::to_value(
            Jwk::from_encoding_key(&key, Algorithm::RS256).expect("local identity public JWK"),
        )
        .expect("public JWK JSON");
        if kid != "current" {
            // A different 2048-bit public modulus exercises a signature mismatch
            // with the same kid. No additional private key is needed.
            let mut n = URL_SAFE_NO_PAD
                .decode(jwk["n"].as_str().expect("RSA modulus"))
                .expect("public modulus bytes");
            n[1] ^= 1;
            jwk["n"] = json!(URL_SAFE_NO_PAD.encode(n));
        }
        lab.transcript.normalizer.replace(
            jwk["n"].as_str().expect("RSA modulus"),
            format!("<rsa-modulus:{kid}>"),
        );
        // Preserve the cached fixture's original field order as well as its values.
        Self {
            jwk: json!({"kid":kid,"kty":"RSA","alg":"RS256","n":jwk["n"],"e":jwk["e"]}),
        }
    }

    pub fn claims() -> Value {
        // The production verifier checks real expiry. Fresh claims keep this
        // suite valid without freezing process time; tokens are normalized whole.
        let now = chrono::Utc::now().timestamp();
        json!({"iss":"https://accounts.google.com", "sub":"parity-subject", "aud":"parity",
            "iat":now, "exp":now + 3600, "email":"push@example.com", "email_verified":true})
    }

    pub fn token(&self, lab: &mut Lab, name: &str, header: Value, claims: Value) -> String {
        let unsigned = format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&header).expect("JWT header")),
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).expect("JWT claims"))
        );
        let key = EncodingKey::from_rsa_pem(crate::parity::PRIVATE_KEY.as_bytes())
            .expect("tracked local-only signing key");
        let signature = jsonwebtoken::crypto::sign(unsigned.as_bytes(), &key, Algorithm::RS256)
            .expect("Google test JWT signature");
        let token = format!("{unsigned}.{signature}");
        lab.transcript
            .normalizer
            .replace(&token, format!("<google-jwt:{name}>"));
        token
    }

    pub fn valid(&self, lab: &mut Lab) -> String {
        self.token(
            lab,
            "valid",
            json!({"alg":"RS256","kid":self.jwk["kid"],"typ":"JWT"}),
            Self::claims(),
        )
    }

    pub fn serve(&self, lab: &Lab) {
        lab.stub
            .reply("GET", "/certs", 200, json!({"keys":[self.jwk]}));
    }

    pub async fn cache(&self, redis: &mut RedisDatabase) {
        let _: () = redis::cmd("SET")
            .arg("google_public_keys")
            .arg(json!({self.jwk["kid"].as_str().expect("kid"):self.jwk}).to_string())
            .query_async(&mut redis.connection)
            .await
            .expect("cached JWKS");
    }
}
