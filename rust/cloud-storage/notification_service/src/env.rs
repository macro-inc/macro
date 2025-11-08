use macro_env::Environment;
use std::sync::LazyLock;

pub static SENDER_ADDRESS: LazyLock<String> = LazyLock::new(|| {
    let prefix = match Environment::new_or_prod() {
        Environment::Production => "",
        Environment::Develop => "-dev",
        Environment::Local => "-local",
    };

    // The SENDER_BASE_ADDRESS is part of the config so the service will fail without it, we can
    // safely unwrap here
    let sender_base_address = std::env::var("SENDER_BASE_ADDRESS").unwrap();

    format!("no-reply{}@{}", prefix, sender_base_address)
});
