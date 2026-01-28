#![deny(missing_docs)]

//! This crate creates a standard way to make AWS configs.

use macro_env_var::env_var;

maybe_env_var!{
    LocalHost
}
/// Creates a aws_config to use.
/// If you provide `LOCAL_AWS_URL` environment variable we create a local aws
/// config with test credentials.
/// Otherwise we load normally.
pub async fn get_macro_aws_config() -> aws_config::SdkConfig {
    let is_local = 
    let aws_config = if is_local {
        aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .test_credentials()
            .load()
            .await
    } else {
        aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .load()
            .await
    };

    aws_config
}
