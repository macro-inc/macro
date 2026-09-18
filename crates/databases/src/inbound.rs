//! Driving adapters: the Axum HTTP router and the AI toolset.

#[cfg(feature = "inbound")]
pub mod axum_router;

#[cfg(feature = "ai_tools")]
pub mod toolset;
