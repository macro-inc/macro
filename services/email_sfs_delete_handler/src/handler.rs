use crate::{context, domain::ports::SfsDeleteService};
use aws_lambda_events::eventbridge::EventBridgeEvent;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};

#[tracing::instrument(skip_all, err)]
pub(crate) async fn handler<S: SfsDeleteService>(
    ctx: context::Context<S>,
    _event: LambdaEvent<EventBridgeEvent>,
) -> Result<(), Error> {
    ctx.service.enqueue_orphaned_attachments().await;
    Ok(())
}
