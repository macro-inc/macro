use crate::context;
use aws_lambda_events::eventbridge::EventBridgeEvent;
use lambda_runtime::{Error, LambdaEvent, tracing};

#[tracing::instrument(skip(ctx, _event), err)]
pub async fn handler(
    ctx: context::Context,
    _event: LambdaEvent<EventBridgeEvent>,
) -> Result<(), Error> {
    ctx.recovery.scan().await?;
    Ok(())
}
