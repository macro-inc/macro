#![recursion_limit = "256"]
//! Starts the agent harness service; see the library for what it is.

use macro_entrypoint::{DroppedDependencyEvent, MacroEntrypoint};

/// rmcp events dropped from every log sink.
const DROPPED_RMCP_EVENTS: &[DroppedDependencyEvent] = &[
    // A stateless streamable HTTP request ends when its client closes the
    // stream, which is how an MCP Events stream always ends. rmcp then sends
    // the cancelled handler's response into the closed stream and logs the
    // failure as an error, once per stream.
    DroppedDependencyEvent {
        target: "rmcp::service",
        message: "failed to send pending response during drain",
        error_contains: "channel closed",
    },
    // rmcp logs every error response with its data. The first step of an
    // MCP Events subscribe is answered with an error whose data repeats the
    // user's query and the filter compiled from it, under the key
    // `com.macro/filter` (`FILTER_META` in `public_mcp::events::protocol`).
    DroppedDependencyEvent {
        target: "rmcp::service",
        message: "response error",
        error_contains: "com.macro/filter",
    },
];

/// glibc malloc spreads allocations over per-thread arenas and gives memory
/// back to the system only from the top of each heap, and tokio frees a value
/// on whichever worker held it last. Whole-log reads, folds and reattach
/// bursts churn large buffers across workers, so freed memory stays resident
/// as fragmentation. mimalloc returns freed blocks to the page they came from.
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // rmcp logs every request it receives at debug and trace; an MCP Events
    // subscribe carries the subscriber's signing secret in its params.
    let entrypoint = MacroEntrypoint::default()
        .quiet_dependency_debug_logs(&["rmcp"])
        .drop_dependency_events(DROPPED_RMCP_EVENTS)
        .init();
    let result = agent_harness_service::run().await;
    entrypoint.shutdown();
    result
}
