use anyhow::Result;
use aws_config::{meta::region::RegionProviderChain, Region, SdkConfig};
use std::{env, sync::LazyLock};

pub static VERBOSE: LazyLock<bool> = LazyLock::new(|| match env::var("VERBOSE") {
    Ok(val) => val.parse::<bool>().unwrap_or(false),
    Err(_) => false,
});

pub fn get_verbose() -> bool {
    *VERBOSE
}

pub static WEBSOCKET_CONNECTION_TABLE_NAME: LazyLock<String> = LazyLock::new(|| {
    env::var("WEBSOCKET_CONNECTION_TABLE_NAME")
        .expect("WEBSOCKET_CONNECTION_TABLE_NAME environment variable not set")
});

pub static WEBSOCKET_CONNECTION_EXPIRATION_MINUTES: LazyLock<Option<i64>> = LazyLock::new(|| {
    env::var("WEBSOCKET_CONNECTION_EXPIRATION_MINUTES")
        .ok()
        .and_then(|val| val.parse::<i64>().ok())
});

pub fn check_env_vars() -> Result<()> {
    let _ = *WEBSOCKET_CONNECTION_TABLE_NAME;
    let _ = *WEBSOCKET_CONNECTION_EXPIRATION_MINUTES;
    Ok(())
}

pub async fn load_aws_config() -> SdkConfig {
    let region_provider = RegionProviderChain::default_provider().or_else(Region::new("us-east-1"));
    aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(region_provider)
        .load()
        .await
}
