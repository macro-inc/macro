//! Driving adapters: the Axum syncs router, the worker that runs due syncs,
//! and the call import's hook that marks Granola syncs due.

pub mod axum_router;
pub mod call_imports;
pub mod worker;
