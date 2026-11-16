use crate::{context, domain::ports::RefreshService};
use aws_lambda_events::eventbridge::EventBridgeEvent;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};

#[tracing::instrument(skip(ctx, _event))]
pub(crate) async fn handler<S: RefreshService>(
    ctx: context::Context<S>,
    _event: LambdaEvent<EventBridgeEvent>,
) -> Result<(), Error> {
    ctx.service.refresh().await?;
    Ok(())
}
