use macro_env::Environment;

use super::*;
use crate::config::Config;
use crate::config::test::{TestSecretManager, config_values};

/// Production runs no Firecracker fleet yet: with no `COMPUTERS_FLEET` (or
/// the retired `incus`) and none of the `COMPUTERS_FIRECRACKER_*` values,
/// the harness still builds its agent-enrollment client and attaches no fleet.
#[tokio::test]
async fn a_prod_config_without_firecracker_starts_with_agent_enrollment_and_no_fleet() {
    for fleet in [None, Some("incus")] {
        let mut values = config_values();
        values["ENVIRONMENT"] = "prod".into();
        if let Some(fleet) = fleet {
            values["COMPUTERS_FLEET"] = fleet.into();
        }
        let config: Config = serde_json::from_value(values).unwrap();
        let config = config
            .resolve_remote_secrets(Environment::Production, &TestSecretManager)
            .await
            .unwrap();

        assert!(config.computer_fleet().unwrap().is_none(), "{fleet:?}");
        AuthAgentEnrollment::new(config.authentication_service_secret_key.as_ref()).unwrap();
    }
}
