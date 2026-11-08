use super::*;
use remote_env_var::SecretManager;
use std::sync::Arc;

struct FakeSecrets;
impl SecretManager for FakeSecrets {
    type Err = std::io::Error;
    async fn get_secret_value<T: AsRef<str> + Send>(&self, name: T) -> Result<Arc<str>, Self::Err> {
        assert_eq!(name.as_ref(), "sync-key-reference");
        Ok(Arc::from("resolved-test-key"))
    }
}
#[tokio::test]
async fn remote_startup_resolves_the_sync_secret_instead_of_sending_its_name() {
    let config: RawDocumentConfig = serde_json::from_value(serde_json::json!({
        "ENVIRONMENT":"dev", "SYNC_SERVICE_AUTH_KEY":"sync-key-reference"
    }))
    .unwrap();
    let environment = config.environment;
    let resolved = config
        .resolve_remote_secrets(environment, &FakeSecrets)
        .await
        .unwrap();
    assert_eq!(resolved.sync_service_auth_key.as_ref(), "resolved-test-key");
}
