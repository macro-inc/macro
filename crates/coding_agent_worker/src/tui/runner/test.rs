use harness_id::HarnessId;

use super::*;
use crate::config::{HarnessCredentials, HarnessScope};

#[test]
fn working_state_requires_valid_embedded_credentials() {
    let mut config: Config =
        toml::from_str(include_str!("../../../config.example.toml")).expect("example config");
    assert!(!config_is_working(&config));

    config.credentials = Some(HarnessCredentials {
        harness_id: HarnessId::TEST_A,
        token: "invalid".to_owned(),
        scope: HarnessScope::User,
    });
    assert!(!config_is_working(&config));

    config.credentials.as_mut().unwrap().token = "mhns_secret".to_owned();
    assert!(config_is_working(&config));
}
