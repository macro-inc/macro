use std::path::PathBuf;

use super::LocalE2eConfig;

#[test]
fn explicit_environment_file_is_loaded() {
    let env_file = std::env::temp_dir().join(format!(
        "macro-local-e2e-config-test-{}.env",
        std::process::id()
    ));
    std::fs::write(&env_file, "LOCAL_E2E_CONFIG_TEST=instance\n").unwrap();

    let config =
        LocalE2eConfig::from_repo_root_and_env_file(PathBuf::from("/unused"), env_file.clone())
            .unwrap();
    std::fs::remove_file(env_file).unwrap();

    assert_eq!(config.get("LOCAL_E2E_CONFIG_TEST"), Some("instance"));
}
