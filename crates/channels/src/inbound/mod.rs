#[cfg(feature = "inbound")]
use macro_authorization::{MacroAuthorization, MacroUserAuthentication};

#[cfg(feature = "inbound")]
fn required_user(authorization: &MacroAuthorization) -> &MacroUserAuthentication {
    authorization
        .acting_user()
        .expect("required authorization guarantees an acting user")
}

/// Attachment adapter for resolving channel references into AI-consumable context.
#[cfg(feature = "attachment")]
pub mod attachment;
/// Axum handler and router for channel messages.
#[cfg(feature = "inbound")]
pub mod axum_router;
/// Axum handler and router for legacy channel list routes.
#[cfg(all(feature = "inbound", feature = "list"))]
pub mod list_router;
/// AI toolset for reading channel messages and threads.
#[cfg(feature = "ai_tools")]
pub mod toolset;
