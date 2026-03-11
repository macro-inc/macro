use crate::util::process_pre_insert::clean_message::{clean_message, clean_threads};
use models_email::email::service;

mod clean_message;
pub mod sfs_map;
pub mod sync_labels;

// perform necessary processing on threads before inserting into the database
#[tracing::instrument(skip(threads))]
pub async fn process_threads_pre_insert(threads: &mut Vec<service::thread::Thread>) {
    // clean threads content
    clean_threads(threads);
}

// perform necessary processing on a message before inserting into the database
#[tracing::instrument(skip(message), fields(message_id = %message.provider_id.clone().unwrap_or_default()
))]
pub async fn process_message_pre_insert(message: &mut service::message::Message) {
    // clean message content
    clean_message(message);
}
