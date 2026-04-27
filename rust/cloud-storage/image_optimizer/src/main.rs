mod handler;
mod request;
mod response;
mod s3;
mod transform;

use aws_sdk_lambda::Client as LambdaClient;
use aws_sdk_s3::Client as S3Client;
use lambda_runtime::{Error, LambdaEvent, run, service_fn};
use request::LambdaRequest;

macro_env_var::env_var! {
    pub struct EnvConfig {
        pub Bucket,
        pub AwsLambdaFunctionName,
    }
}

/// One year in seconds.
pub const DEFAULT_CACHE_TTL: &str = "31536000";

/// Shared state available to all Lambda invocations.
#[derive(Clone)]
pub struct AppContext {
    pub s3_client: S3Client,
    pub lambda_client: LambdaClient,
    pub bucket: String,
    pub function_name: String,
}

async fn handle(
    ctx: AppContext,
    event: LambdaEvent<LambdaRequest>,
) -> Result<response::FunctionUrlResponse, Error> {
    let (request, _) = event.into_parts();
    match request {
        LambdaRequest::AsyncResize(req) => handler::handle_async_resize(&ctx, req).await,
        LambdaRequest::FunctionUrl(req) => handler::handle_cloudfront_request(&ctx, req).await,
    }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    macro_entrypoint::MacroEntrypoint::default().init();

    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let env = EnvConfig::unwrap_new();

    let ctx = AppContext {
        s3_client: S3Client::new(&aws_config),
        lambda_client: LambdaClient::new(&aws_config),
        bucket: env.bucket.to_string(),
        function_name: env.aws_lambda_function_name.to_string(),
    };

    run(service_fn(move |event: LambdaEvent<LambdaRequest>| {
        let ctx = ctx.clone();
        async move { handle(ctx, event).await }
    }))
    .await
}
