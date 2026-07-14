use std::sync::Arc;

use document_upload_finalizer_handler::{AppContext, inbound::local_sqs::run_local_sqs_worker};
use lambda_runtime::tracing;

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    macro_entrypoint::MacroEntrypoint::default().init();
    tracing::trace!("initiating local document upload finalizer worker");

    let context = Arc::new(AppContext::from_env().await?);
    run_local_sqs_worker(context).await
}
