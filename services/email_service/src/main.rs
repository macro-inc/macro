// `run()`'s future type is deep enough to need the library's recursion limit
// wherever it is awaited.
#![recursion_limit = "256"]

use macro_entrypoint::MacroEntrypoint;

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    email_service::run().await
}
