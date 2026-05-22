/// Connection-gateway realtime adapter for channel side effects.
pub mod connection_gateway_realtime;
/// Contacts adapter for channel side effects.
pub mod contacts_dispatcher;
/// Entity-access adapter for channel share permissions.
pub mod entity_access_share_permissions;
/// Notification adapter for channel notification side effects.
pub mod notification_sender;
/// Postgres repository for channels.
pub mod pg_channels_repo;
/// Postgres context adapter for channel side-effect policy.
pub mod pg_side_effect_context;
/// SQS search-index adapter for channel side effects.
pub mod sqs_search_indexer;
