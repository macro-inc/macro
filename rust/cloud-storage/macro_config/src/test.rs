use super::*;
use serde::Deserialize;
use std::sync::{Arc, Mutex};

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

#[derive(Debug, MacroConfig, PartialEq)]
struct DefaultValueConfig {
    #[macro_config_default(8080)]
    port: usize,
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

#[test]
fn load_uses_macro_config_default_value_when_key_is_missing() {
    let _lock = ENV_LOCK.lock().expect("env lock poisoned");
    let _env = EnvGuard::new(&["APP_SECRETS_JSON", "port"]);

    let config = load::<DefaultValueConfig>().expect("config should load");

    assert_eq!(config, DefaultValueConfig { port: 8080 });
}

#[test]
fn load_uses_config_value_over_macro_config_default_value() {
    let _lock = ENV_LOCK.lock().expect("env lock poisoned");
    let env = EnvGuard::new(&["APP_SECRETS_JSON", "port"]);
    env.set("port", "3000");

    let config = load::<DefaultValueConfig>().expect("config should load");

    assert_eq!(config, DefaultValueConfig { port: 3000 });
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

#[test]
fn load_panics_when_app_secrets_json_is_invalid() {
    let _lock = ENV_LOCK.lock().expect("env lock poisoned");
    let env = EnvGuard::new(&["APP_SECRETS_JSON", "lowercase"]);
    env.set("APP_SECRETS_JSON", "not json");
    env.set("lowercase", "fallback value");

    let panic = std::panic::catch_unwind(ConfigLoader::load::<LowercaseConfig>)
        .expect_err("config load should panic");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .expect("panic should have a string message");

    assert!(message.contains("APP_SECRETS_JSON contains invalid JSON"));
}

#[test]
fn load_does_not_fallback_to_env_when_app_secrets_json_is_present_without_key() {
    let _lock = ENV_LOCK.lock().expect("env lock poisoned");
    let env = EnvGuard::new(&["APP_SECRETS_JSON", "lowercase"]);
    env.set("APP_SECRETS_JSON", r#"{}"#);
    env.set("lowercase", "fallback value");

    let error = ConfigLoader::load::<LowercaseConfig>().expect_err("config should fail");

    assert!(matches!(
        error,
        MacroConfigError::MissingRequiredValue("lowercase")
    ));
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
struct EnvVarFieldConfig {
    config_secret: ConfigSecret,
    optional_config_secret: Option<OptionalConfigSecret>,
    missing_optional_secret: Option<OptionalConfigSecret>,
}

#[derive(MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
struct RemoteSecretFieldConfig {
    remote_config_secret: remote_env_var::LocalOrRemoteSecret<ConfigSecret>,
    optional_remote_config_secret:
        remote_env_var::OptionalLocalOrRemoteSecret<OptionalConfigSecret>,
    missing_remote_config_secret: remote_env_var::OptionalLocalOrRemoteSecret<OptionalConfigSecret>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
struct BareMaybeEnvVarConfig {
    optional_config_secret: OptionalConfigSecret,
    missing_optional_secret: OptionalConfigSecret,
    null_optional_secret: OptionalConfigSecret,
}

#[test]
fn load_deserializes_bare_maybe_env_var_fields_without_option_wrapper() {
    let _lock = ENV_LOCK.lock().expect("env lock poisoned");
    let env = EnvGuard::new(&[
        "APP_SECRETS_JSON",
        "OPTIONAL_CONFIG_SECRET",
        "MISSING_OPTIONAL_SECRET",
        "NULL_OPTIONAL_SECRET",
    ]);
    env.set("OPTIONAL_CONFIG_SECRET", "optional-secret");
    env.set("NULL_OPTIONAL_SECRET", "null");

    let config = ConfigLoader::load::<BareMaybeEnvVarConfig>().expect("config should load");

    assert_eq!(
        config.optional_config_secret.value(),
        Some("optional-secret")
    );
    assert!(config.optional_config_secret.is_set());
    assert_eq!(config.missing_optional_secret.value(), None);
    assert!(!config.missing_optional_secret.is_set());
    assert_eq!(config.null_optional_secret.value(), None);
}

#[test]
fn load_deserializes_bare_maybe_env_var_fields_from_app_secrets_json() {
    let _lock = ENV_LOCK.lock().expect("env lock poisoned");
    let env = EnvGuard::new(&[
        "APP_SECRETS_JSON",
        "OPTIONAL_CONFIG_SECRET",
        "MISSING_OPTIONAL_SECRET",
        "NULL_OPTIONAL_SECRET",
    ]);
    env.set(
        "APP_SECRETS_JSON",
        r#"{"OPTIONAL_CONFIG_SECRET":"from-json","NULL_OPTIONAL_SECRET":null}"#,
    );

    let config = ConfigLoader::load::<BareMaybeEnvVarConfig>().expect("config should load");

    assert_eq!(config.optional_config_secret.value(), Some("from-json"));
    assert_eq!(config.missing_optional_secret.value(), None);
    assert_eq!(config.null_optional_secret.value(), None);
}

#[test]
fn load_deserializes_local_or_remote_macro_env_var_fields() {
    let _lock = ENV_LOCK.lock().expect("env lock poisoned");
    let env = EnvGuard::new(&[
        "APP_SECRETS_JSON",
        "REMOTE_CONFIG_SECRET",
        "OPTIONAL_REMOTE_CONFIG_SECRET",
        "MISSING_REMOTE_CONFIG_SECRET",
    ]);
    env.set("REMOTE_CONFIG_SECRET", "remote-secret-name");
    env.set(
        "OPTIONAL_REMOTE_CONFIG_SECRET",
        "optional-remote-secret-name",
    );

    let config = ConfigLoader::load::<RemoteSecretFieldConfig>().expect("config should load");

    match config.remote_config_secret {
        remote_env_var::LocalOrRemoteSecret::Local(value) => {
            assert_eq!(value.as_ref(), "remote-secret-name");
        }
        remote_env_var::LocalOrRemoteSecret::Remote(_) => {
            panic!("deserialized secret should be local until resolved")
        }
    }

    assert_eq!(
        config.optional_remote_config_secret.as_str(),
        Some("optional-remote-secret-name")
    );
    assert_eq!(config.missing_remote_config_secret.as_str(), None);
}

#[derive(Debug)]
struct TestSecretManagerError;

impl std::fmt::Display for TestSecretManagerError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("test secret manager error")
    }
}

impl std::error::Error for TestSecretManagerError {}

struct TestSecretManager;

impl remote_env_var::SecretManager for TestSecretManager {
    type Err = TestSecretManagerError;

    async fn get_secret_value<T: AsRef<str> + Send>(
        &self,
        secret_name: T,
    ) -> Result<Arc<str>, Self::Err> {
        Ok(Arc::from(format!("resolved-{}", secret_name.as_ref())))
    }
}

#[tokio::test]
async fn macro_config_derived_resolve_remote_secrets_resolves_local_or_remote_fields() {
    let _lock = ENV_LOCK.lock().expect("env lock poisoned");
    let env = EnvGuard::new(&[
        "APP_SECRETS_JSON",
        "REMOTE_CONFIG_SECRET",
        "OPTIONAL_REMOTE_CONFIG_SECRET",
        "MISSING_REMOTE_CONFIG_SECRET",
    ]);
    env.set("REMOTE_CONFIG_SECRET", "remote-secret-name");
    env.set(
        "OPTIONAL_REMOTE_CONFIG_SECRET",
        "optional-remote-secret-name",
    );

    let config = ConfigLoader::load::<RemoteSecretFieldConfig>().expect("config should load");
    let config = config
        .resolve_remote_secrets(macro_env::Environment::Develop, &TestSecretManager)
        .await
        .expect("remote secrets should resolve");

    assert_eq!(
        config.remote_config_secret.as_ref(),
        "resolved-remote-secret-name"
    );
    assert_eq!(
        config.optional_remote_config_secret.as_str(),
        Some("resolved-optional-remote-secret-name")
    );
    assert_eq!(config.missing_remote_config_secret.as_str(), None);
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

macro_env_var::env_var! {
    #[derive(Debug, Clone)]
    struct NarrowableSecret;
}

#[derive(MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
struct NarrowConfig {
    #[from_ref]
    narrowable_secret: NarrowableSecret,
    // a plain, untagged field: it gets no FromRef impl, so it never collides with other
    // String fields and can't be narrowed.
    plain_value: String,
}

/// Consumes any config that can produce a `NarrowableSecret`, regardless of its concrete type.
/// This compiling at all is the proof that `#[from_ref]` generated `FromRef<NarrowConfig>`.
fn requires_narrowable<E>(env: &E) -> NarrowableSecret
where
    NarrowableSecret: FromRef<E>,
{
    NarrowableSecret::from_ref(env)
}

#[test]
fn from_ref_narrows_tagged_marker_field() {
    let _lock = ENV_LOCK.lock().expect("env lock poisoned");
    let env = EnvGuard::new(&["APP_SECRETS_JSON", "NARROWABLE_SECRET", "PLAIN_VALUE"]);
    env.set("NARROWABLE_SECRET", "secret-value");
    env.set("PLAIN_VALUE", "plain");

    let config = ConfigLoader::load::<NarrowConfig>().expect("config should load");

    assert_eq!(&*config.plain_value, "plain");

    let narrowed = requires_narrowable(&config);
    assert_eq!(&*narrowed, "secret-value");
}

macro_env_var::env_var! {
    #[derive(Debug, Clone)]
    struct AllConfigDatabaseUrl;
}

macro_env_var::env_var! {
    #[derive(Debug, Clone)]
    struct AllConfigRedisUri;
}

// `#[from_ref_all]` opts every field into a FromRef impl without per-field tags. Requires every
// field to be a distinct marker type.
#[derive(MacroConfig)]
#[from_ref_all]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
struct AllNarrowConfig {
    database_url: AllConfigDatabaseUrl,
    redis_uri: AllConfigRedisUri,
}

fn requires_both<E>(env: &E) -> (AllConfigDatabaseUrl, AllConfigRedisUri)
where
    AllConfigDatabaseUrl: FromRef<E>,
    AllConfigRedisUri: FromRef<E>,
{
    (
        AllConfigDatabaseUrl::from_ref(env),
        AllConfigRedisUri::from_ref(env),
    )
}

#[test]
fn from_ref_all_narrows_every_field() {
    let _lock = ENV_LOCK.lock().expect("env lock poisoned");
    let env = EnvGuard::new(&["APP_SECRETS_JSON", "DATABASE_URL", "REDIS_URI"]);
    env.set("DATABASE_URL", "postgres://db");
    env.set("REDIS_URI", "redis://cache");

    let config = ConfigLoader::load::<AllNarrowConfig>().expect("config should load");

    let (db, redis) = requires_both(&config);
    assert_eq!(&*db, "postgres://db");
    assert_eq!(&*redis, "redis://cache");
}
