use crate::util::process_pre_insert::clean_message::{clean_message, clean_threads};
use crate::util::process_pre_insert::sfs_map::{store_message_images, store_threads_images};
use models_email::email::service;
use static_file_service_client::StaticFileServiceClient;

mod clean_message;
pub mod sfs_map;
pub mod sync_labels;

// perform necessary processing on threads before inserting into the database
#[tracing::instrument(skip(db, sfs_client, threads))]
pub async fn process_threads_pre_insert(
    db: &sqlx::PgPool,
    sfs_client: &StaticFileServiceClient,
    threads: &mut Vec<service::thread::Thread>,
) {
    // store the linked images in messages in sfs, acting as a cdn
    store_threads_images(threads, db, sfs_client).await;

    // clean threads content
    clean_threads(threads);
}

// perform necessary processing on a message before inserting into the database
#[tracing::instrument(skip(db, sfs_client, message), fields(message_id = %message.provider_id.clone().unwrap_or_default()))]
pub async fn process_message_pre_insert(
    db: &sqlx::PgPool,
    sfs_client: &StaticFileServiceClient,
    message: &mut service::message::Message,
) {
    // store the linked images in messages in sfs, acting as a cdn
    if let Err(err) = store_message_images(db, sfs_client, message).await {
        tracing::warn!(
            error = ?err,
            message_provider_id = %message.provider_id.clone().unwrap_or_default(),
            "Non-fatal error: Failed to store message images, but continuing processing."
        );
    }

    // clean message content
    clean_message(message);
}
