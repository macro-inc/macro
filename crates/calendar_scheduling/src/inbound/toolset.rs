//! Booking links saved directly after the user confirms the proposal in conversation.
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
/// Booking tools execute after conversational confirmation; no host opens a review form.
pub fn booking_link_toolset<Scheduling: BookingLinks>()
-> AsyncToolCollection<BookingLinkToolContext<Scheduling>> {
    AsyncToolCollection::new()
        .add_tool::<ListBookingLinks, BookingLinkToolContext<Scheduling>>()
        .add_tool::<CreateBookingLink, BookingLinkToolContext<Scheduling>>()
        .add_tool::<EditBookingLink, BookingLinkToolContext<Scheduling>>()
}
/// Headless hosts use the same conversational-confirmation contract.
pub fn mcp_toolset<Scheduling: BookingLinks>()
-> AsyncToolCollection<BookingLinkToolContext<Scheduling>> {
    booking_link_toolset()
}

// Matches the confirmed email/calendar tools: require evidence of approval before
// execution. This rejects missing/blank quotes, but does not verify conversation history.
fn require_confirmation(confirmation: &str) -> Result<(), ToolCallError> {
    if confirmation.trim().is_empty() {
        return Err(ToolCallError {
            description: "Quote the user's reply approving the booking details in userConfirmation. First explain the proposal in conversation, ask whether to proceed, and wait for their reply.".into(),
            internal_error: anyhow::anyhow!("Booking link called without confirmation"),
        });
    }
    Ok(())
}

#[cfg(test)]
mod test;
