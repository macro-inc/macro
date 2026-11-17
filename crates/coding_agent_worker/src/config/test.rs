use super::*;

const EXAMPLE: &str = include_str!("../../config.example.toml");
const DEFAULT: &str = include_str!("../../default.macrod.toml");

#[test]
fn the_example_config_parses() {
    let config: Config = toml::from_str(EXAMPLE).expect("example config parses");
    assert_eq!(config.harness.command, "hermes");
    assert_eq!(config.harness.args, vec!["acp"]);
    assert_eq!(config.credentials, None);
}

#[test]
fn macro_defaults_to_production() {
    let config: Config = toml::from_str(DEFAULT).expect("default config parses");
    assert_eq!(
        config.macro_api.api_url,
        "https://gateway.macro.com/agent-harness"
    );
    assert_eq!(
        config.macro_api.storage_url,
        "https://gateway.macro.com/dss"
    );
    assert_eq!(config.macro_api.web_url, "https://macro.com/app");
    assert!(config.harness.args.contains(&"acp".to_owned()));
}

#[test]
fn a_partial_macro_table_overrides_only_its_keys() {
    let config: Config = toml::from_str(&format!(
        "{DEFAULT}\n[macro]\nweb_url = \"http://localhost:3000/app\"\n"
    ))
    .expect("partial macro table parses");
    assert_eq!(
        config.macro_api.api_url,
        "https://gateway.macro.com/agent-harness"
    );
    assert_eq!(config.macro_api.web_url, "http://localhost:3000/app");
}

#[test]
fn embedded_credentials_parse() {
    let with_credentials = format!(
        "{EXAMPLE}\n[credentials]\nharness_id = \"{}\"\ntoken = \"mhns_secret\"\n",
        harness_id::HarnessId::TEST_A
    );
    let config: Config = toml::from_str(&with_credentials).expect("embedded credentials parse");
    let credentials = config.credentials.expect("credentials");

    assert_eq!(credentials.harness_id, harness_id::HarnessId::TEST_A);
    assert!(credentials.is_valid());
}

#[test]
fn malformed_bearer_token_is_not_valid() {
    let credentials = HarnessCredentials {
        harness_id: harness_id::HarnessId::TEST_A,
        token: "not-a-harness-token".to_owned(),
        pairing_id: None,
    };

    assert!(!credentials.is_valid());
}

/// Load `contents` from a real file, as macrod does.
fn load(contents: &str) -> Result<Config, ConfigError> {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("macrod.toml");
    std::fs::write(&path, contents).expect("write config");
    Config::load(&path)
}

#[test]
fn web_settings_in_the_file_fail_naming_where_they_live_now() {
    let identity = load(&format!(
        "{EXAMPLE}\n[identity]\nname = \"erics-macbook\"\nscope = \"team\"\nallow_permission_bypass = true\n"
    ))
    .expect_err("[identity] is refused");
    assert!(matches!(
        identity,
        ConfigError::WebSetting {
            key: "[identity]",
            ..
        }
    ));
    assert!(identity.to_string().contains("Settings → Machines"));

    let scope = load(&format!(
        "{EXAMPLE}\n[credentials]\nharness_id = \"{}\"\ntoken = \"mhns_secret\"\nscope = \"team\"\n",
        harness_id::HarnessId::TEST_A
    ))
    .expect_err("a cached scope is refused");
    assert!(matches!(
        scope,
        ConfigError::WebSetting {
            key: "`scope` in [credentials]",
            ..
        }
    ));
}

#[test]
fn the_retired_server_table_is_an_unknown_field() {
    let error =
        load(&format!("{EXAMPLE}\n[server]\nport = 8790\n")).expect_err("[server] is refused");
    assert!(matches!(error, ConfigError::Parse { .. }));
}

#[test]
fn unknown_fields_are_rejected() {
    let with_typo = EXAMPLE.replace("repo_url", "repo_uri");
    assert!(toml::from_str::<Config>(&with_typo).is_err());

    let macro_typo = format!("{DEFAULT}\n[macro]\napi_uri = \"http://localhost\"\n");
    assert!(toml::from_str::<Config>(&macro_typo).is_err());
}

#[test]
fn removed_credential_fields_fail_loudly() {
    // Pre-pairing configs carried bot credentials; a stale one should fail
    // with a parse error pointing at the removed key rather than serve with
    // half an identity.
    let stale = format!(
        "{DEFAULT}\n[macro]\nstorage_url = \"http://localhost:50009/dss\"\nbot_token = \"mbot_x\"\n"
    );
    assert!(toml::from_str::<Config>(&stale).is_err());
}

#[test]
fn harness_env_is_optional() {
    // The example carries no `env`, as every config written before it existed.
    let config: Config = toml::from_str(EXAMPLE).expect("example config parses");
    assert!(config.harness.env.is_empty());

    let with_env = EXAMPLE.replace(
        "args = [\"acp\"]\n",
        "args = [\"acp\"]\nenv = { CODEX_PATH = \"/nix/store/x/bin/codex\", CLAUDE_CODE_EXECUTABLE = \"/bin/claude\" }\n",
    );
    let config: Config = toml::from_str(&with_env).expect("harness env parses");
    assert_eq!(
        config.harness.env,
        BTreeMap::from([
            ("CODEX_PATH".to_owned(), "/nix/store/x/bin/codex".to_owned()),
            (
                "CLAUDE_CODE_EXECUTABLE".to_owned(),
                "/bin/claude".to_owned()
            ),
        ])
    );
}

#[test]
fn the_gateway_url_is_the_api_base_with_a_websocket_scheme() {
    let local = MacroApi {
        egress_url: None,
        api_url: "http://localhost:50009/agent-harness".to_owned(),
        storage_url: "http://localhost:50009/dss".to_owned(),
        web_url: "http://localhost:3000/app".to_owned(),
    };
    assert_eq!(
        local.gateway_url(),
        "ws://localhost:50009/agent-harness/runtime/ws",
    );

    let secure = MacroApi {
        egress_url: None,
        api_url: "https://gateway.macro.com/agent-harness/".to_owned(),
        storage_url: "https://gateway.macro.com/dss".to_owned(),
        web_url: "https://macro.com/app/".to_owned(),
    };
    assert_eq!(
        secure.gateway_url(),
        "wss://gateway.macro.com/agent-harness/runtime/ws",
    );
    assert_eq!(
        secure.pairing_approval_url("KX7M-4QHD"),
        "https://macro.com/app/settings/runtimes?pair=KX7M-4QHD",
    );
    assert_eq!(
        secure.settings_url(),
        "https://macro.com/app/settings/runtimes"
    );
}

#[test]
fn macrods_directory_lives_in_home_or_the_windows_user_profile() {
    assert_eq!(
        macrod_directory_in_home(Some("/home/eric"), Some("C:\\Users\\eric")),
        Some(PathBuf::from("/home/eric").join(".macrod"))
    );
    assert_eq!(
        macrod_directory_in_home(None, Some("C:\\Users\\eric")),
        Some(PathBuf::from("C:\\Users\\eric").join(".macrod"))
    );
    assert_eq!(
        macrod_directory_in_home(Some(""), Some("C:\\Users\\eric")),
        Some(PathBuf::from("C:\\Users\\eric").join(".macrod"))
    );
    assert_eq!(macrod_directory_in_home(None, None), None);
}

#[test]
fn a_second_lock_on_one_config_is_refused_until_the_first_is_released() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("macrod.toml");

    let held = lock(&path).expect("first lock");
    let error = lock(&path).expect_err("second lock is refused");
    assert!(matches!(error, LockError::Held { .. }));
    assert!(
        error
            .to_string()
            .contains("another macrod is already running")
    );

    drop(held);
    lock(&path).expect("lock after release");
}

#[test]
fn probing_a_config_reports_whether_it_is_served_without_taking_it() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("macrod.toml");

    assert!(!is_served(&path).expect("probe without a lock file"));
    assert!(!directory.path().join("macrod.toml.lock").exists());

    // A lock file nobody holds, as a stopped macrod leaves it.
    std::fs::write(directory.path().join("macrod.toml.lock"), "").expect("lock file");
    assert!(!is_served(&path).expect("probe an unheld lock file"));

    let _held = lock(&path).expect("the probe left the lock free");
    assert!(is_served(&path).expect("probe while held"));
}

#[test]
fn updates_are_on_unless_the_config_turns_them_off() {
    let config: Config = toml::from_str(EXAMPLE).expect("example config parses");
    assert!(config.update.auto);

    let opted_out: Config =
        toml::from_str(&format!("{EXAMPLE}\n[update]\nauto = false\n")).expect("opt-out parses");
    assert!(!opted_out.update.auto);
}
