/// Broker envelopes and message publication.
#[cfg(feature = "broker")]
pub mod broker;
/// Authorized websocket delivery.
#[cfg(feature = "delivery")]
pub mod connection_gateway;
/// Current audience capabilities from the entity access service.
#[cfg(feature = "outbound")]
pub mod entity_access_audience;
/// Contextual notification transport.
#[cfg(feature = "delivery")]
pub mod notification_sender;
/// Postgres persistence for PDF annotation geometry.
#[cfg(all(feature = "outbound", feature = "annotations"))]
pub mod pg_annotation_repo;
/// Parent and thread audience facts.
#[cfg(feature = "delivery")]
pub mod pg_discussion_context;
/// Postgres persistence for the shared message store.
#[cfg(feature = "outbound")]
pub mod pg_message_repo;
