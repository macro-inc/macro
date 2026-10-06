//! Workflow-oriented booking links, with deferred review only on hosts that can finish it.
use crate::domain::{
    booking_links::{BookingLink, BookingLinks},
    models::Error,
};
use ai_toolset::{AsyncToolCollection, ToolCallError};
use schemars::JsonSchema;
use serde::Serialize;
use std::sync::Arc;
mod create_booking_link;
mod edit_booking_link;
mod list_booking_links;
pub use create_booking_link::CreateBookingLink;
pub use edit_booking_link::EditBookingLink;
pub use list_booking_links::ListBookingLinks;

/// Scheduling port and the application's public origin, supplied by the host.
pub struct BookingLinkToolContext<Scheduling> {
    /// Authorized domain workflow implementation.
    pub service: Arc<Scheduling>,
    /// Public application origin; empty for local relative URLs.
    pub public_origin: String,
}
impl<Scheduling> Clone for BookingLinkToolContext<Scheduling> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            public_origin: self.public_origin.clone(),
        }
    }
}
/// Saved link and shareable URL. Paused links remain discoverable but do not accept bookings.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingLinkResult {
    /// Actual saved identities, revision, and full configuration.
    #[serde(flatten)]
    pub link: BookingLink,
    /// Link to share; enabled in the draft determines whether guests can book.
    pub url: String,
}
impl<Scheduling> BookingLinkToolContext<Scheduling> {
    fn result(&self, link: BookingLink) -> BookingLinkResult {
        let url = format!(
            "{}/app/book/{}/{}",
            self.public_origin.trim_end_matches('/'),
            link.profile_id,
            link.draft.event.slug
        );
        BookingLinkResult { link, url }
    }
}
fn tool_error(error: Error) -> ToolCallError {
    ToolCallError {
        description: error.to_string(),
        internal_error: anyhow::Error::new(error),
    }
}
/// Chat and agent-session tools: mutations await the user's actual review card.
pub fn booking_link_toolset<Scheduling: BookingLinks>()
-> AsyncToolCollection<BookingLinkToolContext<Scheduling>> {
    AsyncToolCollection::new()
        .add_tool::<ListBookingLinks, BookingLinkToolContext<Scheduling>>()
        .add_user_tool::<CreateBookingLink, BookingLinkToolContext<Scheduling>>()
        .add_user_tool::<EditBookingLink, BookingLinkToolContext<Scheduling>>()
}
/// Headless hosts execute real tools using their own confirmation policy, never a pending placeholder.
pub fn mcp_toolset<Scheduling: BookingLinks>()
-> AsyncToolCollection<BookingLinkToolContext<Scheduling>> {
    AsyncToolCollection::new()
        .add_tool::<ListBookingLinks, BookingLinkToolContext<Scheduling>>()
        .add_tool::<CreateBookingLink, BookingLinkToolContext<Scheduling>>()
        .add_tool::<EditBookingLink, BookingLinkToolContext<Scheduling>>()
}
