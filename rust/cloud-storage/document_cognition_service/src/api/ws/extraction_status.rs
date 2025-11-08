use anyhow::{Context, Result};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};

use dashmap::DashMap;
use tokio::sync::mpsc::UnboundedSender;

use crate::{
    api::context::{ApiContext, GLOBAL_CONTEXT},
    model::ws::{ExtractionStatusPayload, FromWebSocketMessage, WebSocketError},
    service::attachment::document::get_document_plaintext_content,
};

use macro_db_client::dcs::get_document::get_document;
use macro_db_client::dcs::get_document_text::{
    ExtractionStatusEnum, batch_document_text_extraction_status, document_text_extraction_status,
    status_of_extracted_text,
};

use std::time::Duration;

use std::sync::LazyLock;

use super::connection::{CONNECTION_MAP, ws_send};

/// Max time to check for extraction status is 6 minutes
const MAX_POLL_TIME: Duration = Duration::from_secs(360);

/// Poll interval is 500 milliseconds
const POLL_INTERVAL: Duration = Duration::from_millis(500);

// RwLock allows shared read access but exclusive write access
/// single handle for the task running the poller
static HANDLE: AtomicBool = AtomicBool::new(false);

/// map of polling key to connections lisening to that key
static ATTACHMENT_POLLING_MAP: LazyLock<DashMap<String, DashMap<String, Instant>>> =
    LazyLock::new(DashMap::new);

#[tracing::instrument(skip(sender, ctx), fields(attachment_id=?payload.attachment_id, connection_id=connection_id))]
pub async fn extraction_status_handler(
    sender: &UnboundedSender<FromWebSocketMessage>,
    ctx: Arc<ApiContext>,
    connection_id: &str,
    payload: ExtractionStatusPayload,
) -> Result<(), WebSocketError> {
    // Ensure the attachment in question exists
    let document_id = payload.attachment_id.as_str();
    let document_metadata_opt = get_document(&ctx.db, payload.attachment_id.as_str())
        .await
        .context("failed to get document")?;
    let document_metadata = document_metadata_opt.unwrap();
    let extraction_status = if ["pdf", "docx"].contains(&document_metadata.file_type.as_str()) {
        document_text_extraction_status(ctx.db.clone(), document_id)
            .await
            .map_err(|e| {
                tracing::error!(error = %e,  "failed to get document text extraction status");
                WebSocketError::ExtractionStatusFailed {
                    attachment_id: payload.attachment_id.clone(),
                }
            })?
    } else {
        let document_text = get_document_plaintext_content(&ctx, document_id)
            .await
            .map_err(|e| {
                tracing::error!(error = %e,  "failed to get document plaintext content");
                WebSocketError::ExtractionStatusFailed {
                    attachment_id: payload.attachment_id.clone(),
                }
            })?
            .text_content()?;
        status_of_extracted_text(&document_text)
    };

    ws_send(
        sender,
        FromWebSocketMessage::ExtractionStatusAck {
            attachment_id: payload.attachment_id.clone(),
            status: extraction_status.into(),
        },
    );

    if extraction_status != ExtractionStatusEnum::Incomplete {
        return Ok(());
    }

    // non-[pdf/docx] should not be added to this poll
    if ["pdf", "docx"].contains(&document_metadata.file_type.as_str()) {
        push_attachment_to_poll(payload.attachment_id.as_str(), connection_id).await;
    }
    Ok(())
}

/// Pushes an attachment id and a connection id into the poller map
/// if a poller is not already running, we start a new poller
pub async fn push_attachment_to_poll(attachment_id: &str, connection_id: &str) {
    // Insert the attachment id and connection id into the poller map
    let map = &*ATTACHMENT_POLLING_MAP;
    map.entry(attachment_id.to_string())
        .or_default()
        .insert(connection_id.to_string(), Instant::now());

    // Start the poller back up if it's not already running
    if !HANDLE.load(Ordering::SeqCst) {
        spawn_poller();
    }
}

/// returns a snapshot of the current attachment polling map
/// this is used to ensure consistency between a single poller iteration
/// and void deadlocks
pub fn get_attachments_snapshot() -> HashMap<String, HashMap<String, Instant>> {
    ATTACHMENT_POLLING_MAP
        .iter()
        .map(|entry| {
            let outer_key = entry.key().clone();
            let inner_map: HashMap<String, Instant> = entry
                .value()
                .iter()
                .map(|inner_entry| (inner_entry.key().clone(), *inner_entry.value()))
                .collect();
            (outer_key, inner_map)
        })
        .collect()
}

/// removes a connection from the attachment polling map
pub fn remove_polling_connection(attachment_id: &str, connection_id: &str) {
    if let Some(attachment) = ATTACHMENT_POLLING_MAP.get_mut(attachment_id) {
        attachment.remove(connection_id);
    }
}

/// Spawns a new poller task
/// there should only ever be one poller running at a time
/// poller will poll all attachments that are currently being listened to
pub fn spawn_poller() {
    tokio::spawn(async move {
        HANDLE.store(true, Ordering::SeqCst);
        tracing::trace!("starting poller");
        let context = match GLOBAL_CONTEXT.get() {
            Some(context) => context.clone(),
            None => {
                tracing::error!("GLOBAL_CONTEXT is not set");
                return;
            }
        };

        loop {
            let attachment_map = get_attachments_snapshot();

            let attachment_ids = attachment_map
                .iter()
                .filter_map(|a| {
                    if a.1.is_empty() {
                        return None;
                    }
                    Some(a.0.to_string())
                })
                .collect::<Vec<_>>();

            if attachment_ids.is_empty() {
                tracing::trace!("stopping poller, no attachments to poll");
                break;
            }

            let res = match batch_document_text_extraction_status(
                context.db.clone(),
                &attachment_ids,
            )
            .await
            {
                Ok(res) => res,
                Err(err) => {
                    tracing::error!(error = %err,  "failed to check document text extraction status");
                    continue;
                }
            };

            let connection_map = &*CONNECTION_MAP;

            for (attachment_id, extraction_status) in res.into_iter() {
                let connections = match attachment_map.get(&attachment_id) {
                    Some(attachment_entry) => attachment_entry,
                    None => {
                        continue;
                    }
                };

                if connections.is_empty() {
                    continue;
                }

                for (connection_id, start_time) in connections {
                    let sender = match connection_map
                        .get(connection_id)
                        .and_then(|sender| sender.upgrade())
                    {
                        Some(sender) => sender,
                        None => {
                            continue;
                        }
                    };

                    if extraction_status != ExtractionStatusEnum::Incomplete {
                        ws_send(
                            &sender,
                            FromWebSocketMessage::ExtractionStatusUpdate {
                                attachment_id: attachment_id.clone(),
                                status: extraction_status.into(),
                            },
                        );
                        remove_polling_connection(&attachment_id, connection_id);
                    } else {
                        if *start_time + MAX_POLL_TIME > Instant::now() {
                            continue;
                        }

                        // We have been polling this attachment for too long, so we should stop
                        // polling it.
                        ws_send(
                            &sender,
                            FromWebSocketMessage::Error(WebSocketError::ExtractionStatusFailed {
                                attachment_id: attachment_id.to_string(),
                            }),
                        );
                        remove_polling_connection(&attachment_id, connection_id)
                    }
                }
            }

            tokio::time::sleep(POLL_INTERVAL).await;
        }
        tracing::trace!("poller stopped");
        HANDLE.store(false, Ordering::SeqCst);
    });
}
