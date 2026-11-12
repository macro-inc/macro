pub mod backfill;
pub mod crm_cleanup;
#[cfg(test)]
mod emulated_inbox;
pub mod gmail_ops;
pub mod inbox_sync;
#[cfg(test)]
mod label_write_sim;
pub mod link_manager;
pub mod scheduled;
#[cfg(feature = "sfs_delete")]
pub mod sfs_deleter;
pub mod sfs_uploader;
#[cfg(test)]
mod test_support;
pub(crate) mod util;
pub(crate) mod worker_lifecycle;
/// Log-and-drop publisher for `macro.email` events, re-exported for the
/// HTTP binary's handlers.
pub use util::publish_email_event;
