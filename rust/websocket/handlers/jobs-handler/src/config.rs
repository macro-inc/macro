use anyhow::Result;
use aws_config::{meta::region::RegionProviderChain, Region, SdkConfig};
use std::{env, sync::LazyLock};

pub static VERBOSE: LazyLock<bool> = LazyLock::new(|| {
    env::var("VERBOSE")
        .ok()
        .and_then(|val| val.parse::<bool>().ok())
        .unwrap_or(false)
});

pub static MOCK_ERROR: LazyLock<bool> = LazyLock::new(|| {
    env::var("MOCK_ERROR")
        .ok()
        .and_then(|val| val.parse::<bool>().ok())
        .unwrap_or(false)
});

pub static JOB_SUBMISSION_EXPIRATION_MINUTES: LazyLock<Option<i64>> = LazyLock::new(|| {
    env::var("JOB_SUBMISSION_EXPIRATION_MINUTES")
        .ok()
        .and_then(|val| val.parse::<i64>().ok())
});

pub static API_GATEWAY_ENDPOINT_URL: LazyLock<String> = LazyLock::new(|| {
    env::var("API_GATEWAY_ENDPOINT_URL")
        .expect("API_GATEWAY_ENDPOINT_URL environment variable not set")
});

pub static WEBSOCKET_CONNECTION_TABLE_NAME: LazyLock<String> = LazyLock::new(|| {
    env::var("WEBSOCKET_CONNECTION_TABLE_NAME")
        .expect("WEBSOCKET_CONNECTION_TABLE_NAME environment variable not set")
});

pub static JOB_SUBMISSION_TABLE_NAME: LazyLock<String> = LazyLock::new(|| {
    env::var("JOB_SUBMISSION_TABLE_NAME")
        .expect("JOB_SUBMISSION_TABLE_NAME environment variable not set")
});

pub static DOCUMENT_PROCESSING_SERVICE_URL: LazyLock<String> = LazyLock::new(|| {
    env::var("DOCUMENT_PROCESSING_SERVICE_URL")
        .expect("DOCUMENT_PROCESSING_SERVICE_URL environment variable not set")
});

pub static MAXIMUM_JOB_DURATION_TIME_MINUTES: LazyLock<i64> = LazyLock::new(|| {
    env::var("MAXIMUM_JOB_DURATION_TIME_MINUTES")
        .ok()
        .and_then(|val| val.parse::<i64>().ok())
        .unwrap_or(15)
});

pub fn check_env_vars() -> Result<()> {
    let _ = *API_GATEWAY_ENDPOINT_URL;
    let _ = *WEBSOCKET_CONNECTION_TABLE_NAME;
    let _ = *JOB_SUBMISSION_TABLE_NAME;
    let _ = *DOCUMENT_PROCESSING_SERVICE_URL;
    Ok(())
}

pub fn get_verbose() -> bool {
    *VERBOSE
}

pub async fn load_aws_config() -> SdkConfig {
    let region_provider = RegionProviderChain::default_provider().or_else(Region::new("us-east-1"));
    aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(region_provider)
        .load()
        .await
}
