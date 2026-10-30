//! Validate the required runtime keys in the Connect Doppler project.

use connect_registry::{App, ClientRegistration, Status, all_apps};
use serde_json::Value;

fn required_keys(apps: &[App]) -> Vec<String> {
    let mut keys = vec![
        "DATABASE_URL".to_owned(),
        "CONNECT_KMS_KEY_ID".to_owned(),
        "CONNECT_PUBLIC_URL".to_owned(),
    ];
    for app in apps.iter().filter(|app| {
        app.status == Status::Live && app.client_registration == ClientRegistration::OwnApp
    }) {
        let prefix = app.id.as_str().to_ascii_uppercase();
        keys.push(format!("{prefix}_CLIENT_ID"));
        keys.push(format!("{prefix}_CLIENT_SECRET"));
    }
    keys
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let apps = all_apps()?;
    for config in ["dev", "prd"] {
        let doppler = doppler_config::DopplerConfig::builder()
            .token_from_env("DOPPLER_TOKEN")
            .project("connect-api")
            .config(config)
            .build()?;
        let values: serde_json::Map<String, Value> = doppler.load().await?;
        for key in required_keys(apps) {
            if values
                .get(&key)
                .and_then(Value::as_str)
                .is_none_or(|value| value.is_empty())
            {
                return Err(format!("{config}: missing or empty {key}").into());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "doppler_config_test.rs"]
mod test;
