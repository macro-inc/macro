/// Broker envelopes and message publication.
#[cfg(feature = "broker")]
pub mod broker;
/// Authorized websocket delivery.
#[cfg(feature = "delivery")]
pub mod connection_gateway;
/// Current audience capabilities from the entity access service.
#[cfg(feature = "outbound")]
pub mod entity_access_audience;
/// Who has link previews, read from the `enable-link-previews` flag.
#[cfg(feature = "link_previews")]
pub mod flagged_link_previews;
/// Contextual notification transport.
#[cfg(feature = "delivery")]
pub mod notification_sender;
/// Parent and thread audience facts.
#[cfg(feature = "delivery")]
pub mod pg_discussion_context;
/// Postgres persistence for the shared message store.
#[cfg(feature = "outbound")]
pub mod pg_message_repo;
/// Link previews read through the SSRF-safe unfurl crate.
#[cfg(feature = "link_previews")]
pub mod unfurl_link_previews;
