use crate::config::SenderBaseAddress;
use macro_env::Environment;
use std::sync::LazyLock;

pub static SENDER_ADDRESS: LazyLock<String> = LazyLock::new(|| {
    let prefix = match Environment::new_or_prod() {
        Environment::Production => "",
        Environment::Develop => "-dev",
        Environment::Local => "-local",
    };

    // The SENDER_BASE_ADDRESS is part of the config so the service will fail without it, we can
    // safely expect it here. Use macro_config so APP_SECRETS_JSON is supported too.
    let sender_base_address = SenderBaseAddress::new()
        .expect("SENDER_BASE_ADDRESS must be provided via APP_SECRETS_JSON or env");

    format!("no-reply{}@{}", prefix, sender_base_address.as_ref())
});
