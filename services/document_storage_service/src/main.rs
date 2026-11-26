// `run()`'s future type is deep enough to need the library's recursion limit
// wherever it is awaited.
#![recursion_limit = "256"]

use macro_entrypoint::MacroEntrypoint;

/// Worker stack in debug builds. Unoptimized builds give every future an async
/// fn awaits a full-size slot in that fn's poll frame, and the Soup request
/// chain (route, GraphQL, the Soup service and its legs, the repository)
/// overflows tokio's 2 MiB default there. Release builds overlap those slots
/// and keep the default.
#[cfg(debug_assertions)]
const DEBUG_WORKER_STACK_BYTES: usize = 8 * 1024 * 1024;

fn main() -> anyhow::Result<()> {
    let mut runtime = tokio::runtime::Builder::new_multi_thread();
    runtime.enable_all();
    #[cfg(debug_assertions)]
    runtime.thread_stack_size(DEBUG_WORKER_STACK_BYTES);
    runtime.build()?.block_on(async {
        let entrypoint = MacroEntrypoint::default().init();
        let result = document_storage_service::run().await;
        entrypoint.shutdown();
        result
    })
}
