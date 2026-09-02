use std::fs;

use super::*;
use crate::tui::agent_catalog::{CommandLookup, discover};

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

    ConfigForm::create(&path, &agent, directory.path()).expect("create config");
    let config = Config::load(&path).expect("load generated config");

    assert_eq!(config.harness.command, "hermes");
    assert_eq!(config.harness.args, ["acp"]);
    assert_eq!(config.workspace.path, directory.path());
    assert_eq!(config.macro_api.api_url, "https://agent-harness.macro.com");
    assert_eq!(
        config.macro_api.storage_url,
        "https://gateway.macro.com/dss"
    );
}

#[test]
fn editing_a_setting_preserves_comments() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("macrod.toml");
    let agent = discover(&HermesOnly).remove(0);
    ConfigForm::create(&path, &agent, directory.path()).expect("create config");
    let original = fs::read_to_string(&path).expect("read config");
    assert!(original.contains("# macrod configuration"));

    let workspace = directory.path().join("other");
    fs::create_dir(&workspace).expect("create workspace");
    let mut form = ConfigForm::load(&path).expect("load form");
    form.apply_text(Setting::Workspace, &workspace.to_string_lossy())
        .expect("edit");
    form.save().expect("save form");

    let edited = fs::read_to_string(path).expect("read edited config");
    assert!(edited.contains("# macrod configuration"));
    assert!(edited.contains(&format!("path = {:?}", workspace.to_string_lossy())));
}

#[test]
fn rejects_a_missing_workspace_edit() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("macrod.toml");
    let agent = discover(&HermesOnly).remove(0);
    ConfigForm::create(&path, &agent, directory.path()).expect("create config");

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
    ConfigForm::create(&path, &agent, directory.path()).expect("create config");

    let mut form = ConfigForm::load(&path).expect("load form");
    assert_eq!(
        form.apply_text(Setting::Workspace, "../other"),
        Err("Workspace must be an absolute path".to_owned())
    );
}
