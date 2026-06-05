use super::*;
use serde::Deserialize;
use std::sync::Mutex;

static ENV_LOCK: Mutex<()> = Mutex::new(());

struct EnvGuard {
    saved: Vec<(&'static str, Option<String>)>,
}

impl EnvGuard {
    fn new(keys: &[&'static str]) -> EnvGuard {
        let saved = keys
            .iter()
            .copied()
            .map(|key| {
                let value = std::env::var(key).ok();
                unsafe {
                    std::env::remove_var(key);
                }
                (key, value)
            })
            .collect();

        EnvGuard { saved }
    }

    fn set(&self, key: &'static str, value: &str) {
        unsafe {
            std::env::set_var(key, value);
        }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        for (key, value) in self.saved.drain(..) {
            match value {
                Some(value) => unsafe {
                    std::env::set_var(key, value);
                },
                None => unsafe {
                    std::env::remove_var(key);
                },
            }
        }
    }
}

macro_env_var::env_var! {
    #[derive(Debug)]
    struct ConfigSecret;
}

macro_env_var::maybe_env_var! {
    #[derive(Debug)]
    struct OptionalConfigSecret;
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
struct ScreamingSnakeConfig {
    required_value: String,
    optional_value: Option<u16>,
    missing_optional: Option<String>,
}

#[test]
fn load_uses_serde_renamed_field_names() {
    let _lock = ENV_LOCK.lock().expect("env lock poisoned");
    let env = EnvGuard::new(&[
        "APP_SECRETS_JSON",
        "REQUIRED_VALUE",
        "OPTIONAL_VALUE",
        "MISSING_OPTIONAL",
    ]);
    env.set("REQUIRED_VALUE", "required");
    env.set("OPTIONAL_VALUE", "42");

    let config = ConfigLoader::load::<ScreamingSnakeConfig>().expect("config should load");

    assert_eq!(
        config,
        ScreamingSnakeConfig {
            required_value: "required".to_string(),
            optional_value: Some(42),
            missing_optional: None,
        }
    );
}

#[derive(Debug, Deserialize, PartialEq)]
struct LowercaseConfig {
    lowercase: String,
}

#[test]
fn load_uses_default_field_names() {
    let _lock = ENV_LOCK.lock().expect("env lock poisoned");
    let env = EnvGuard::new(&["APP_SECRETS_JSON", "lowercase"]);
    env.set("lowercase", "lowercase value");

    let config = load::<LowercaseConfig>().expect("config should load");

    assert_eq!(
        config,
        LowercaseConfig {
            lowercase: "lowercase value".to_string(),
        }
    );
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
struct JsonConfig {
    required_value: String,
    count: u32,
    items: Vec<String>,
}

#[test]
fn load_reads_values_from_app_secrets_json() {
    let _lock = ENV_LOCK.lock().expect("env lock poisoned");
    let env = EnvGuard::new(&["APP_SECRETS_JSON", "REQUIRED_VALUE", "COUNT", "ITEMS"]);
    env.set(
        "APP_SECRETS_JSON",
        r#"{"REQUIRED_VALUE":"from json","COUNT":7,"ITEMS":["first","second"]}"#,
    );
    env.set("REQUIRED_VALUE", "from env");

    let config = ConfigLoader::load::<JsonConfig>().expect("config should load");

    assert_eq!(
        config,
        JsonConfig {
            required_value: "from json".to_string(),
            count: 7,
            items: vec!["first".to_string(), "second".to_string()],
        }
    );
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
struct EnvVarFieldConfig {
    config_secret: ConfigSecret,
    optional_config_secret: Option<OptionalConfigSecret>,
    missing_optional_secret: Option<OptionalConfigSecret>,
}

#[test]
fn load_deserializes_macro_env_var_fields() {
    let _lock = ENV_LOCK.lock().expect("env lock poisoned");
    let env = EnvGuard::new(&[
        "APP_SECRETS_JSON",
        "CONFIG_SECRET",
        "OPTIONAL_CONFIG_SECRET",
        "MISSING_OPTIONAL_SECRET",
    ]);
    env.set("CONFIG_SECRET", "secret");
    env.set("OPTIONAL_CONFIG_SECRET", "optional-secret");

    let config = ConfigLoader::load::<EnvVarFieldConfig>().expect("config should load");

    assert_eq!(&*config.config_secret, "secret");
    assert_eq!(
        config
            .optional_config_secret
            .as_ref()
            .map(|value| value.as_ref()),
        Some("optional-secret")
    );
    assert!(config.missing_optional_secret.is_none());
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct MissingRequiredConfig {
    missing: String,
}

#[test]
fn load_errors_when_required_value_is_missing() {
    let _lock = ENV_LOCK.lock().expect("env lock poisoned");
    let _env = EnvGuard::new(&["APP_SECRETS_JSON", "missing"]);

    let error = ConfigLoader::load::<MissingRequiredConfig>().expect_err("config should fail");

    assert!(matches!(
        error,
        MacroConfigError::MissingRequiredValue("missing")
    ));
}
