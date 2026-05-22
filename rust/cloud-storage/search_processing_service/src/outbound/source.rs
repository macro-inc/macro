use std::collections::HashMap;

use model::document::FileType;
use sqlx::PgPool;
use sqs_client::search::{
    SearchQueueMessage, call::CallRecordMessage, channel::ChannelMessageUpdate, chat::ChatMessage,
    email::EmailThreadBatchMessage,
};

use crate::config::BackfillPageSizes;
use crate::domain::models::{
    BackfillError, CallBackfillRequest, ChannelBackfillRequest, ChatBackfillCursor,
    ChatBackfillRequest, DocumentBackfillCursor, DocumentBackfillRequest, EmailBackfillRequest,
    SourcePage,
};
use crate::domain::ports::BackfillSource;

const DEFAULT_EMAIL_BATCH_SIZE: usize = 50;

/// Postgres-backed [`BackfillSource`] for every search-indexed entity. One
/// struct, one DB pool, per-entity page sizes — collapses what used to be
/// five parallel adapters. New entity types just add a method here.
pub struct PgBackfillSource {
    db: PgPool,
    page_sizes: BackfillPageSizes,
}

impl PgBackfillSource {
    pub fn new(db: PgPool, page_sizes: BackfillPageSizes) -> Self {
        Self { db, page_sizes }
    }
}

impl BackfillSource for PgBackfillSource {
    async fn fetch_calls(
        &self,
        req: &CallBackfillRequest,
        offset: usize,
    ) -> Result<SourcePage, BackfillError> {
        // Caller passed an explicit set of ids: page through them at the
        // configured page size so this branch and the full-scan branch share
        // the same loop shape and failure semantics.
        if !req.call_ids.is_empty() {
            let start = offset;
            if start >= req.call_ids.len() {
                return Ok(SourcePage::empty());
            }
            let end = start
                .saturating_add(self.page_sizes.calls)
                .min(req.call_ids.len());
            let messages: Vec<SearchQueueMessage> = req.call_ids[start..end]
                .iter()
                .map(|id| {
                    SearchQueueMessage::CallRecord(CallRecordMessage {
                        call_id: id.clone(),
                        index_override: req.index_override.clone(),
                    })
                })
                .collect();
            let rows_consumed = messages.len();
            return Ok(SourcePage {
                messages,
                rows_consumed,
            });
        }

        let batch = macro_db_client::call_record::get::get_call_records_for_search_backfill(
            &self.db,
            self.page_sizes.calls as i64,
            offset as i64,
        )
        .await
        .map_err(BackfillError::Source)?;

        let rows_consumed = batch.len();
        let messages: Vec<SearchQueueMessage> = batch
            .into_iter()
            .map(|r| {
                SearchQueueMessage::CallRecord(CallRecordMessage {
                    call_id: r.call_id.to_string(),
                    index_override: req.index_override.clone(),
                })
            })
            .collect();

        Ok(SourcePage {
            messages,
            rows_consumed,
        })
    }

    async fn fetch_chats(
        &self,
        req: &ChatBackfillRequest,
        cursor: Option<ChatBackfillCursor>,
    ) -> Result<(SourcePage, Option<ChatBackfillCursor>), BackfillError> {
        let chat_ids = (!req.chat_ids.is_empty()).then_some(&req.chat_ids);
        let user_ids = (!req.user_ids.is_empty()).then_some(&req.user_ids);
        let db_cursor = cursor.map(|c| (c.updated_at, c.message_id));

        let batch = macro_db_client::chat::get::get_chat_messages_for_search_backfill(
            &self.db,
            self.page_sizes.chats as i64,
            db_cursor,
            chat_ids,
            user_ids,
            req.updated_after,
            req.updated_before,
            req.deletion_filter.as_only_deleted(),
        )
        .await
        .map_err(BackfillError::Source)?;

        let next_cursor = batch.last().map(|row| ChatBackfillCursor {
            updated_at: row.updated_at,
            message_id: row.message_id.clone(),
        });
        let rows_consumed = batch.len();
        let messages: Vec<SearchQueueMessage> = batch
            .into_iter()
            .map(|chat| {
                SearchQueueMessage::ChatMessage(ChatMessage {
                    chat_id: chat.chat_id,
                    message_id: chat.message_id,
                    user_id: chat.user_id,
                    created_at: chat.created_at,
                    updated_at: chat.updated_at,
                    index_override: req.index_override.clone(),
                })
            })
            .collect();

        Ok((
            SourcePage {
                messages,
                rows_consumed,
            },
            next_cursor,
        ))
    }

    async fn fetch_channels(
        &self,
        req: &ChannelBackfillRequest,
        offset: usize,
    ) -> Result<SourcePage, BackfillError> {
        let batch = comms_db_client::messages::get_messages::get_channel_messages(
            &self.db,
            self.page_sizes.channels as i64,
            offset as i64,
            req.deletion_filter.as_only_deleted(),
        )
        .await
        .map_err(BackfillError::Source)?;

        let rows_consumed = batch.len();
        let messages: Vec<SearchQueueMessage> = batch
            .into_iter()
            .map(|(channel_id, message_id)| {
                SearchQueueMessage::ChannelMessageUpdate(ChannelMessageUpdate {
                    channel_id: channel_id.to_string(),
                    message_id: message_id.to_string(),
                    index_override: req.index_override.clone(),
                })
            })
            .collect();

        Ok(SourcePage {
            messages,
            rows_consumed,
        })
    }

    async fn fetch_documents(
        &self,
        req: &DocumentBackfillRequest,
        cursor: Option<DocumentBackfillCursor>,
    ) -> Result<(SourcePage, Option<DocumentBackfillCursor>), BackfillError> {
        let db_cursor = cursor.map(|c| (c.updated_at, c.document_id));
        let batch = macro_db_client::document::get_documents_search::get_documents_for_search(
            &self.db,
            self.page_sizes.documents as i64,
            db_cursor,
            &req.file_types,
            &req.sub_type,
            &req.updated_after,
            &req.updated_before,
            req.deletion_filter.as_only_deleted(),
        )
        .await
        .map_err(BackfillError::Source)?;

        // Build the next cursor from the last row before we move the
        // batch into the messages mapper. The query sorts ascending so
        // the last row carries the sort-tuple that resumes the scan.
        // `updated_at` is NOT NULL in the schema but sqlx types it as
        // Option because of the timestamptz cast; if it ever did come
        // back None we'd rather stop pagination than build a bogus
        // cursor — `and_then` does exactly that.
        let next_cursor = batch.last().and_then(|d| {
            d.updated_at.map(|updated_at| DocumentBackfillCursor {
                updated_at,
                document_id: d.document_id.clone(),
            })
        });
        let rows_consumed = batch.len();
        let messages: Vec<SearchQueueMessage> = batch
            .iter()
            .map(|d| {
                let mut msg: sqs_client::search::document::SearchExtractorMessage = d.into();
                msg.index_override.clone_from(&req.index_override);
                if d.file_type == FileType::Md {
                    SearchQueueMessage::ExtractSync(msg)
                } else {
                    SearchQueueMessage::ExtractDocumentText(msg)
                }
            })
            .collect();

        Ok((
            SourcePage {
                messages,
                rows_consumed,
            },
            next_cursor,
        ))
    }

    async fn fetch_emails(
        &self,
        req: &EmailBackfillRequest,
        offset: usize,
    ) -> Result<SourcePage, BackfillError> {
        let batch_size = req
            .batch_size
            .filter(|n| *n > 0)
            .unwrap_or(DEFAULT_EMAIL_BATCH_SIZE);

        let rows = match req.since {
            Some(since) => {
                email_db_client::threads::get::get_paginated_thread_ids_with_macro_user_id_since(
                    &self.db,
                    self.page_sizes.emails as i64,
                    offset as i64,
                    since,
                )
                .await
                .map_err(BackfillError::Source)?
            }
            None => email_db_client::threads::get::get_paginated_thread_ids_with_macro_user_id(
                &self.db,
                self.page_sizes.emails as i64,
                offset as i64,
            )
            .await
            .map_err(BackfillError::Source)?,
        };

        let rows_consumed = rows.len();
        if rows_consumed == 0 {
            return Ok(SourcePage::empty());
        }

        let mut by_user: HashMap<String, Vec<String>> = HashMap::new();
        for (thread_id, macro_user_id) in rows {
            by_user
                .entry(macro_user_id)
                .or_default()
                .push(thread_id.to_string());
        }

        let messages: Vec<SearchQueueMessage> = by_user
            .into_iter()
            .flat_map(|(macro_user_id, thread_ids)| {
                thread_ids
                    .chunks(batch_size)
                    .map(|chunk| {
                        SearchQueueMessage::ExtractEmailThreadBatch(EmailThreadBatchMessage {
                            thread_ids: chunk.to_vec(),
                            macro_user_id: macro_user_id.clone(),
                            index_override: req.index_override.clone(),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .collect();

        Ok(SourcePage {
            messages,
            rows_consumed,
        })
    }
}
