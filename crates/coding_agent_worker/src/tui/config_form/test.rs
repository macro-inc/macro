use std::fs;

use super::*;
use crate::config::{HarnessCredentials, HarnessScope};
use crate::tui::agent_catalog::{CommandLookup, discover};
use harness_id::HarnessId;

struct HermesOnly;

impl CommandLookup for HermesOnly {
    fn resolve(&self, command: &str) -> Option<&Path> {
        (command == "hermes").then_some(Path::new("/bin/hermes"))
    }
}

#[test]
fn creates_a_valid_production_config() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("macrod.toml");
    let agent = discover(&HermesOnly).remove(0);

    ConfigForm::create_for_deployment(&path, &agent, directory.path(), Deployment::Production)
        .expect("create config");
    let config = Config::load(&path).expect("load generated config");

    assert_eq!(config.harness.command, "hermes");
    assert_eq!(config.harness.args, ["acp"]);
    assert_eq!(config.workspace.path, directory.path());
    assert_eq!(config.macro_api.api_url, "https://agent-harness.macro.com");
    assert_eq!(
        config.macro_api.storage_url,
        "https://gateway.macro.com/dss"
    );
    assert_eq!(config.credentials, None);
    assert_private_mode(&path);
}

#[test]
fn creates_a_dev_config_when_dev_mode_is_set() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("macrod.toml");
    let agent = discover(&HermesOnly).remove(0);

    ConfigForm::create_for_deployment(&path, &agent, directory.path(), Deployment::Development)
        .expect("create config");
    let config = Config::load(&path).expect("load generated config");

    assert_eq!(config.macro_api.api_url, DEV_API_URL);
    assert_eq!(config.macro_api.storage_url, DEV_STORAGE_URL);
    assert_eq!(config.macro_api.web_url, DEV_WEB_URL);
}

#[test]
fn editing_a_setting_preserves_comments() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("macrod.toml");
    let agent = discover(&HermesOnly).remove(0);
    ConfigForm::create_for_deployment(&path, &agent, directory.path(), Deployment::Production)
        .expect("create config");
    let original = fs::read_to_string(&path).expect("read config");
    assert!(original.contains("# macrod configuration"));

    let workspace = directory.path().join("other");
    fs::create_dir(&workspace).expect("create workspace");
    let mut form = ConfigForm::load(&path).expect("load form");
    form.apply_text(Setting::Workspace, &workspace.to_string_lossy())
        .expect("edit");
    form.save().expect("save form");

    let edited = fs::read_to_string(&path).expect("read edited config");
    assert!(edited.contains("# macrod configuration"));
    assert!(edited.contains(&format!("path = {:?}", workspace.to_string_lossy())));
    assert_private_mode(&path);
}

#[test]
fn persists_and_clears_embedded_credentials_without_losing_comments() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("macrod.toml");
    let agent = discover(&HermesOnly).remove(0);
    ConfigForm::create_for_deployment(&path, &agent, directory.path(), Deployment::Production)
        .expect("create config");
    let credentials = HarnessCredentials {
        harness_id: HarnessId::TEST_A,
        token: "mhns_abc_secret".to_owned(),
        scope: HarnessScope::Team,
    };

    let mut form = ConfigForm::load(&path).expect("load form");
    form.persist_credentials(&credentials)
        .expect("persist credentials");
    let paired = Config::load(&path).expect("load paired config");
    assert_eq!(paired.credentials, Some(credentials));
    assert!(
        fs::read_to_string(&path)
            .expect("read config")
            .contains("# macrod configuration")
    );
    assert_private_mode(&path);

    form.clear_credentials().expect("clear credentials");
    let unpaired = Config::load(&path).expect("load unpaired config");
    assert_eq!(unpaired.credentials, None);
    assert!(
        !fs::read_to_string(&path)
            .expect("read config")
            .contains("[credentials]")
    );
    assert_private_mode(&path);
}

#[test]
fn quickstart_edits_preserve_existing_deployment_and_comments() {
    let directory = tempfile::tempdir().expect("temp dir");
    let workspace = directory.path().join("workspace");
    fs::create_dir(&workspace).expect("create workspace");
    let path = directory.path().join("macrod.toml");
    fs::write(
        &path,
        format!(
            "# keep me\n[macro]\napi_url = \"https://custom-api\"\nstorage_url = \"https://custom-storage\"\nweb_url = \"https://custom-web\"\n\n[identity]\nscope = \"private\"\n\n[harness]\ncommand = \"old\"\nargs = []\n\n[workspace]\npath = {:?}\n",
            directory.path().to_string_lossy()
        ),
    )
    .expect("write existing config");
    let agent = discover(&HermesOnly).remove(0);

    let mut form = ConfigForm::load(&path).expect("load existing config");
    form.apply_quickstart(&agent, &workspace, IdentityScope::Team);
    form.save().expect("save Quickstart changes");

    let config = Config::load(&path).expect("load edited config");
    assert_eq!(config.macro_api.api_url, "https://custom-api");
    assert_eq!(config.macro_api.storage_url, "https://custom-storage");
    assert_eq!(config.macro_api.web_url, "https://custom-web");
    assert_eq!(config.harness.command, "hermes");
    assert_eq!(config.workspace.path, workspace);
    assert_eq!(config.identity.scope, IdentityScope::Team);
    assert!(
        fs::read_to_string(&path)
            .expect("read config")
            .contains("# keep me")
    );
    assert_private_mode(&path);
}

#[test]
fn rejects_a_missing_workspace_edit() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("macrod.toml");
    let agent = discover(&HermesOnly).remove(0);
    ConfigForm::create_for_deployment(&path, &agent, directory.path(), Deployment::Production)
        .expect("create config");

    let mut form = ConfigForm::load(&path).expect("load form");
    assert_eq!(
        form.apply_text(Setting::Workspace, "/path/that/does/not/exist"),
        Err("Workspace must be an existing directory".to_owned())
    );
}

#[test]
fn rejects_a_relative_workspace_edit() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("macrod.toml");
    let agent = discover(&HermesOnly).remove(0);
    ConfigForm::create_for_deployment(&path, &agent, directory.path(), Deployment::Production)
        .expect("create config");

    let mut form = ConfigForm::load(&path).expect("load form");
    assert_eq!(
        form.apply_text(Setting::Workspace, "../other"),
        Err("Workspace must be an absolute path".to_owned())
    );
}

#[cfg(unix)]
fn assert_private_mode(path: &Path) {
    use std::os::unix::fs::PermissionsExt as _;

    assert_eq!(
        fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[cfg(not(unix))]
fn assert_private_mode(_path: &Path) {}
