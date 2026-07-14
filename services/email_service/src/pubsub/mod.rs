pub mod backfill;
pub(crate) mod context;
/// The flag-selected CRM metadata resolver, re-exported for the
/// pubsub_workers binary to construct.
pub use context::CrmMetadataResolver;
pub mod gmail_ops;
pub mod inbox_sync;
pub mod link_manager;
pub mod scheduled;
#[cfg(feature = "sfs_delete")]
pub mod sfs_deleter;
pub mod sfs_uploader;
pub(crate) mod util;
/// Log-and-drop publisher for `macro.email` events, re-exported for the
/// HTTP binary's handlers.
pub use util::publish_email_event;
