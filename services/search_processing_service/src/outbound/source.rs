use std::collections::HashMap;
use std::str::FromStr;

use model::document::FileType;
use models_properties::EntityType;
use sqlx::PgPool;
use sqs_client::search::{
    SearchQueueMessage, calendar_event::UpsertCalendarEvent, call::CallRecordMessage,
    channel::ChannelMessageUpdate, chat::ChatMessage, email::EmailThreadBatchMessage,
    project::UpsertProject,
};

use crate::config::BackfillPageSizes;
use crate::domain::models::{
    BackfillError, CalendarEventBackfillCursor, CalendarEventBackfillRequest, CallBackfillCursor,
    CallBackfillRequest, ChannelBackfillRequest, ChatBackfillCursor, ChatBackfillRequest,
    DocumentBackfillCursor, DocumentBackfillRequest, EmailBackfillRequest, ProjectBackfillCursor,
    ProjectBackfillRequest, PropertiesBackfillRequest, PropertySourcePage, SourcePage,
};
use crate::domain::ports::BackfillSource;

const DEFAULT_EMAIL_BATCH_SIZE: usize = 50;

/// Page size for the properties backfill's distinct-entity-id scan. A fixed
/// value rather than a config knob: property rows are few and each entity is
/// reindexed directly.
const PROPERTIES_PAGE_SIZE: usize = 5000;

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
        cursor: Option<CallBackfillCursor>,
    ) -> Result<(SourcePage, Option<CallBackfillCursor>), BackfillError> {
        // Caller passed an explicit set of ids: walk them in order,
        // using the cursor's call_id as the "where to resume" anchor.
        // The cursor's started_at is irrelevant for this branch since
        // the ids list isn't ordered by it; we just position by id.
        if !req.call_ids.is_empty() {
            let resume_from = cursor
                .as_ref()
                .and_then(|c| {
                    req.call_ids
                        .iter()
                        .position(|id| id.parse::<uuid::Uuid>().ok() == Some(c.call_id))
                })
                .map(|i| i + 1)
                .unwrap_or(0);
            if resume_from >= req.call_ids.len() {
                return Ok((SourcePage::empty(), None));
            }
            let end = resume_from
                .saturating_add(self.page_sizes.calls)
                .min(req.call_ids.len());
            let slice = &req.call_ids[resume_from..end];
            let messages: Vec<SearchQueueMessage> = slice
                .iter()
                .map(|id| {
                    SearchQueueMessage::CallRecord(CallRecordMessage {
                        call_id: id.clone(),
                        index_override: req.index_override.clone(),
                    })
                })
                .collect();
            let rows_consumed = messages.len();
            // started_at is a placeholder for this branch (epoch) because
            // the explicit-id list isn't sorted by it; we navigate by
            // call_id position. Using Utc::now is also fine; either way
            // the only thing the loop uses next time is call_id.
            let next_cursor = slice.last().and_then(|last_id| {
                last_id
                    .parse::<uuid::Uuid>()
                    .ok()
                    .map(|call_id| CallBackfillCursor {
                        started_at: chrono::Utc::now(),
                        call_id,
                    })
            });
            return Ok((
                SourcePage {
                    messages,
                    rows_consumed,
                },
                next_cursor,
            ));
        }

        let db_cursor = cursor.map(|c| (c.started_at, c.call_id));
        let batch = macro_db_client::call_record::get::get_call_records_for_search_backfill(
            &self.db,
            self.page_sizes.calls as i64,
            db_cursor,
            req.started_after,
            req.started_before,
        )
        .await
        .map_err(BackfillError::Source)?;

        let next_cursor = batch.last().map(|r| CallBackfillCursor {
            started_at: r.started_at,
            call_id: r.call_id,
        });
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

        Ok((
            SourcePage {
                messages,
                rows_consumed,
            },
            next_cursor,
        ))
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

        // An explicit id list pages in memory: each page is a primary-key
        // lookup, so a targeted repair never runs the scan-and-sort that the
        // `since` and full variants depend on.
        if !req.thread_ids.is_empty() {
            let page = page_of(&req.thread_ids, offset, self.page_sizes.emails);
            if page.is_empty() {
                return Ok(SourcePage::empty());
            }
            let rows = email_db_client::threads::get::get_thread_ids_with_macro_user_id_by_ids(
                &self.db, page,
            )
            .await
            .map_err(BackfillError::Source)?;
            // Advance by the ids consumed, not the rows found, or unknown ids
            // would stall the drain loop on the same page forever.
            return Ok(email_source_page(
                rows,
                batch_size,
                page.len(),
                req.index_override.as_deref(),
            ));
        }

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

        Ok(email_source_page(
            rows,
            batch_size,
            rows_consumed,
            req.index_override.as_deref(),
        ))
    }

    async fn fetch_entity_properties(
        &self,
        req: &PropertiesBackfillRequest,
        offset: usize,
    ) -> Result<PropertySourcePage, BackfillError> {
        let entity_type = EntityType::from_str(&req.entity_type)
            .map_err(|e| BackfillError::Source(anyhow::Error::new(e)))?;

        let entity_ids =
            properties::outbound::entity_properties_get_query::get_entity_ids_with_properties(
                &self.db,
                entity_type,
                PROPERTIES_PAGE_SIZE as i64,
                offset as i64,
            )
            .await
            .map_err(BackfillError::Source)?;

        let rows_consumed = entity_ids.len();
        Ok(PropertySourcePage {
            entity_ids,
            entity_type,
            rows_consumed,
        })
    }

    async fn fetch_calendar_events(
        &self,
        req: &CalendarEventBackfillRequest,
        cursor: Option<CalendarEventBackfillCursor>,
    ) -> Result<(SourcePage, Option<CalendarEventBackfillCursor>), BackfillError> {
        let db_cursor = cursor.map(|c| (c.updated_at, c.event_id));
        let batch = macro_db_client::calendar_event::get_events_for_backfill::get_calendar_events_for_search_backfill(
            &self.db,
            self.page_sizes.calendar_events as i64,
            db_cursor,
            req.updated_after,
            req.updated_before,
        )
        .await
        .map_err(BackfillError::Source)?;

        let next_cursor = batch.last().map(|event| CalendarEventBackfillCursor {
            updated_at: event.updated_at,
            event_id: event.event_id,
        });
        let rows_consumed = batch.len();
        let messages: Vec<SearchQueueMessage> = batch
            .into_iter()
            .map(|event| {
                SearchQueueMessage::UpsertCalendarEvent(UpsertCalendarEvent {
                    event_id: event.event_id.to_string(),
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

    async fn fetch_projects(
        &self,
        req: &ProjectBackfillRequest,
        cursor: Option<ProjectBackfillCursor>,
    ) -> Result<(SourcePage, Option<ProjectBackfillCursor>), BackfillError> {
        let db_cursor = cursor.map(|c| (c.updated_at, c.project_id));
        let batch = macro_db_client::projects::get_projects_for_search_backfill(
            &self.db,
            self.page_sizes.projects as i64,
            db_cursor,
            req.updated_after,
            req.updated_before,
        )
        .await
        .map_err(BackfillError::Source)?;

        // `updated_at` is NOT NULL in the schema but sqlx types it as Option
        // because of the timestamptz cast; if it ever came back None we'd
        // rather stop pagination than build a bogus cursor.
        let next_cursor = batch.last().and_then(|p| {
            p.updated_at.map(|updated_at| ProjectBackfillCursor {
                updated_at,
                project_id: p.project_id.clone(),
            })
        });
        let rows_consumed = batch.len();
        // This SQS message is intentionally limited to backfills, which may
        // target an alternate OpenSearch index through `index_override`.
        let messages: Vec<SearchQueueMessage> = batch
            .into_iter()
            .map(|p| {
                SearchQueueMessage::UpsertProject(UpsertProject {
                    project_id: p.project_id,
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
}

/// The `offset..offset + limit` window of `ids`, empty once the offset passes
/// the end so the drain loop terminates.
fn page_of(ids: &[uuid::Uuid], offset: usize, limit: usize) -> &[uuid::Uuid] {
    let start = offset.min(ids.len());
    let end = start.saturating_add(limit).min(ids.len());
    &ids[start..end]
}

/// Group resolved threads by owner and chunk each owner's threads into batch
/// messages. `rows_consumed` is what the drain loop advances its offset by.
fn email_source_page(
    rows: Vec<(uuid::Uuid, String)>,
    batch_size: usize,
    rows_consumed: usize,
    index_override: Option<&str>,
) -> SourcePage {
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
                        index_override: index_override.map(str::to_string),
                    })
                })
                .collect::<Vec<_>>()
        })
        .collect();

    SourcePage {
        messages,
        rows_consumed,
    }
}

#[cfg(test)]
mod test;
