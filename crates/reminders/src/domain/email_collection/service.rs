//! Scan private reminder candidates and authorize before producing public pages.
use std::collections::HashSet;

use email::domain::followup::{EmailFollowupMailbox, ReminderThreadFilter};
use entity_access::domain::{models::AccessError, ports::EntityAccessService};
use uuid::Uuid;

use super::*;
use crate::domain::{
    models::ReminderError,
    ports::{Clock, RemindersRepo},
};

const BATCH_SIZE: u32 = 100;
const MAX_BATCHES: usize = 5;

fn internal(error: impl std::error::Error + Send + Sync + 'static) -> ReminderError {
    ReminderError::Internal(rootcause::Report::new(error).into_dynamic())
}

fn scope(filters: &ReminderThreadFilter) -> String {
    let inboxes = filters
        .inbox_ids
        .as_ref()
        .map(|ids| {
            let mut ids = ids.clone();
            ids.sort_unstable();
            ids.dedup();
            ids.into_iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_else(|| "all".into());
    let mut tags = filters.tags.clone();
    tags.sort_unstable();
    tags.dedup();
    let mut attachments = filters.attachments.clone();
    attachments.sort_unstable();
    attachments.dedup();
    format!(
        "{inboxes}:{:?}:{:?}:{}:{tags:?}:{attachments:?}",
        filters.done, filters.read, filters.calendar
    )
}

async fn eligible<E: EmailFollowupMailbox, A: EntityAccessService>(
    mailbox: &E,
    access: &A,
    viewer: &EmailReminderViewer,
    candidates: &[EmailReminderCandidate],
    filters: &ReminderThreadFilter,
) -> Result<HashSet<Uuid>, ReminderError> {
    let ids: Vec<_> = candidates
        .iter()
        .filter(|candidate| candidate.summary.is_some())
        .map(|candidate| candidate.cursor.thread_id.to_string())
        .collect();
    if ids.is_empty() {
        return Ok(HashSet::new());
    }
    let mut results = access
        .generate_email_thread_view_access_receipts(&viewer.user_id, viewer.org_id, &ids)
        .await;
    let mut receipts = Vec::new();
    for id in ids {
        match results.remove(&id) {
            Some(Ok(receipt)) => receipts.push(receipt),
            Some(Err(
                AccessError::Unauthorized
                | AccessError::UnauthorizedWithMessage(_)
                | AccessError::NotFound(_),
            )) => {}
            Some(Err(error)) => return Err(internal(error)),
            None => {
                return Err(ReminderError::Internal(
                    rootcause::report!("missing batch email access result").into_dynamic(),
                ));
            }
        }
    }
    if receipts.is_empty() {
        return Ok(HashSet::new());
    }
    let ids = mailbox
        .reminder_threads(viewer.user_id.clone(), receipts, filters)
        .await
        .map_err(internal)?;
    Ok(ids.into_iter().collect())
}

/// Fill a page under a bounded scan budget. Sparse pages retain a continuation.
pub async fn list<R: RemindersRepo, E: EmailFollowupMailbox, A: EntityAccessService, C: Clock>(
    repo: &R,
    mailbox: &E,
    access: &A,
    clock: &C,
    viewer: EmailReminderViewer,
    query: EmailReminderQuery,
) -> Result<EmailReminderPage, ReminderError> {
    let filter_scope = scope(&query.filters);
    let mut cursor = query
        .cursor
        .as_deref()
        .map(|value| {
            let (position, cursor_scope) = value.split_once('|').ok_or(InvalidCursor)?;
            if cursor_scope != filter_scope {
                return Err(InvalidCursor);
            }
            EmailReminderCursor::decode(position)
        })
        .transpose()?;
    let as_of = cursor
        .map(|cursor| cursor.as_of)
        .unwrap_or_else(|| clock.now());
    let limit = query.limit.unwrap_or(BATCH_SIZE).clamp(1, BATCH_SIZE) as usize;
    let mut items = Vec::with_capacity(limit);
    let mut exhausted = false;
    for _ in 0..MAX_BATCHES {
        let candidates = repo
            .email_candidates(&viewer.user_id, None, cursor, as_of, BATCH_SIZE)
            .await
            .map_err(internal)?;
        let short_batch = candidates.len() < BATCH_SIZE as usize;
        let allowed = eligible(mailbox, access, &viewer, &candidates, &query.filters).await?;
        for candidate in candidates {
            if allowed.contains(&candidate.cursor.thread_id) && candidate.summary.is_some() {
                // This candidate belongs to the next page. Never move past it.
                if items.len() == limit {
                    return Ok(EmailReminderPage {
                        items,
                        next_cursor: cursor.map(|c| format!("{}|{filter_scope}", c.encode())),
                    });
                }
                if let Some(summary) = candidate.summary {
                    items.push(summary);
                }
            }
            cursor = Some(candidate.cursor);
        }
        if short_batch {
            exhausted = true;
            break;
        }
        if items.len() == limit {
            break;
        }
    }
    Ok(EmailReminderPage {
        items,
        next_cursor: (!exhausted)
            .then(|| cursor.map(|c| format!("{}|{filter_scope}", c.encode())))
            .flatten(),
    })
}
