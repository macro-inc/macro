#![recursion_limit = "256"]
//! Starts the agent harness service; see the library for what it is.

use macro_entrypoint::MacroEntrypoint;

/// glibc malloc spreads allocations over per-thread arenas and gives memory
/// back to the system only from the top of each heap, and tokio frees a value
/// on whichever worker held it last. Whole-log reads, folds and reattach
/// bursts churn large buffers across workers, so freed memory stays resident
/// as fragmentation. mimalloc returns freed blocks to the page they came from.
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let entrypoint = MacroEntrypoint::default().init();
    let result = agent_harness_service::run().await;
    entrypoint.shutdown();
    result
}
