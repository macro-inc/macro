#![recursion_limit = "256"]

use std::sync::Arc;

use aws_lambda_events::event::eventbridge::EventBridgeEvent;
use document_upload_finalizer_handler::{
    AppContext, inbound::eventbridge::object_created_from_event,
};
use lambda_runtime::{Error, LambdaEvent, run, service_fn, tracing};

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypointExt::init();

    let context = Arc::new(AppContext::from_env().await?);

    let func = service_fn(move |event: LambdaEvent<EventBridgeEvent>| {
        let context = context.clone();
        async move { handler(context, event).await }
    });

    run(func).await
}

#[tracing::instrument(skip(context, event), err)]
async fn handler(
    context: Arc<AppContext>,
    event: LambdaEvent<EventBridgeEvent>,
) -> Result<(), Error> {
    let Some(object_created) = object_created_from_event(&event.payload) else {
        tracing::warn!(detail=?event.payload.detail, "object-created event did not include bucket/key");
        return Ok(());
    };

    context.handle_object_created(object_created).await?;

    Ok(())
}

struct MacroEntrypointExt;

impl MacroEntrypointExt {
    fn init() {
        macro_entrypoint::MacroEntrypoint::default().init();
        tracing::trace!("initiating document upload finalizer lambda");
    }
}
