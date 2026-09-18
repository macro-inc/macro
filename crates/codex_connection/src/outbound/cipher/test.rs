use super::*;
use crate::domain::StoredConnection;
use codex_cloud_agents::domain::{Credentials, Secret};

struct Keys;
#[async_trait]
impl DataKeys for Keys {
    async fn generate(&self, context: HashMap<String, String>) -> Result<DataKey, ConnectionError> {
        assert_eq!(context["purpose"], PURPOSE);
        Ok(DataKey {
            plaintext: Zeroizing::new(vec![7; 32]),
            encrypted: vec![3; 48],
            key_id: "test-key".into(),
        })
    }
    async fn decrypt(
        &self,
        _: &str,
        _: &[u8],
        _: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, ConnectionError> {
        Ok(Zeroizing::new(vec![7; 32]))
    }
}
fn state() -> ConnectionState {
    ConnectionState {
        connection: Some(StoredConnection {
            id: uuid::Uuid::now_v7(),
            credentials: Credentials {
                version: 1,
                access_token: Secret::new("large-access-token".repeat(1000)).unwrap(),
                refresh_token: Secret::new("private-refresh-token".into()).unwrap(),
                expires_at: u64::MAX,
                account_id: "account-test".into(),
            },
            environment_id: Some("env-test".into()),
        }),
        attempt: None,
    }
}
#[tokio::test]
async fn large_oauth_payload_roundtrips_with_fresh_nonces_and_no_plaintext_at_rest() {
    let cipher = EnvelopeCipher {
        keys: Box::new(Keys),
    };
    let first = cipher.encrypt("owner-a", &state()).await.unwrap();
    let second = cipher.encrypt("owner-a", &state()).await.unwrap();
    assert_ne!(first.nonce, second.nonce);
    let serialized = serde_json::to_string(&first).unwrap();
    assert!(!serialized.contains("private-refresh-token"));
    let decrypted = cipher.decrypt("owner-a", &first).await.unwrap();
    assert_eq!(
        decrypted
            .connection
            .unwrap()
            .credentials
            .refresh_token
            .expose(),
        "private-refresh-token"
    );
}
#[tokio::test]
async fn owner_swaps_tampering_and_unknown_versions_fail_closed() {
    let cipher = EnvelopeCipher {
        keys: Box::new(Keys),
    };
    let mut encrypted = cipher.encrypt("owner-a", &state()).await.unwrap();
    assert!(cipher.decrypt("owner-b", &encrypted).await.is_err());
    encrypted.ciphertext[0] ^= 1;
    assert!(cipher.decrypt("owner-a", &encrypted).await.is_err());
    encrypted.version = 2;
    assert!(cipher.decrypt("owner-a", &encrypted).await.is_err());
    encrypted.version = 1;
    encrypted.nonce.clear();
    assert!(cipher.decrypt("owner-a", &encrypted).await.is_err());
}
