/// Connection-gateway realtime adapter for channel side effects.
pub mod connection_gateway_realtime;
/// Contacts adapter for channel side effects.
pub mod contacts_dispatcher;
/// Notification adapter for channel notification side effects.
pub mod notification_sender;
/// Postgres adapter for channel reference share-permission side effects.
pub mod pg_channel_reference_share_permissions;
/// Postgres repository for channels.
pub mod pg_channels_repo;
/// Postgres context adapter for channel side-effect policy.
pub mod pg_side_effect_context;
/// SQS search-index adapter for channel side effects.
pub mod sqs_search_indexer;
