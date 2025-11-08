use anyhow::Context;
use aws_lambda_events::event::eventbridge::EventBridgeEvent;
use lambda_runtime::{Error, LambdaEvent, run, service_fn, tracing};
use macro_entrypoint::MacroEntrypoint;
use std::sync::Arc;
use worker_trigger::{config::Config, service};

#[tracing::instrument(skip(ecs_client, config, event))]
async fn handler(
    ecs_client: Arc<service::ecs::ECSClient>,
    config: Arc<Config>,
    event: LambdaEvent<EventBridgeEvent<serde_json::Value>>,
) -> Result<(), Error> {
    tracing::trace!("processing event {:?}", event.payload.id);
    match ecs_client
        .run_task(
            config.task_definition.as_str(),
            config.cluster.as_str(),
            config.subnets.clone(),
        )
        .await
    {
        Ok(()) => (),
        Err(e) => return Err(Error::from(e.to_string())),
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypoint::default().init();
    tracing::info!("initiating lambda");

    let config = Config::from_env().context("all necessary env vars should be available")?;

    tracing::trace!("initialized config");

    let ecs_client = service::ecs::ECSClient::new(aws_sdk_ecs::Client::new(
        &aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .load()
            .await,
    ));

    tracing::trace!("initialized ecs client");

    // Shared references
    let shared_ecs_client = Arc::new(ecs_client);
    let shared_config = Arc::new(config);

    let func = service_fn(
        move |event: LambdaEvent<EventBridgeEvent<serde_json::Value>>| {
            let ecs_client = shared_ecs_client.clone();
            let config = shared_config.clone();

            async move { handler(ecs_client, config, event).await }
        },
    );

    run(func).await
}
