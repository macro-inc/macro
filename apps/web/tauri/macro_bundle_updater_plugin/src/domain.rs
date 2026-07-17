/// Domain service for resolving frontend bundle assets.
pub mod asset_service;
/// Shared routing state for active frontend bundle generations.
pub mod bundle_routes;
/// Data types and error definitions for bundle updates.
pub mod models;
/// Trait definitions (ports) for update, filesystem, and system queries.
pub mod ports;
/// Core update service and background worker.
pub mod service;
