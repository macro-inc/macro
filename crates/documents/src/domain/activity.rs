//! What counts as activity in the documents domain.
//!
//! Documents have no entity-exclusive actions yet, so every mapping goes
//! through [`Activity::common`].

#[cfg(test)]
mod test;

use ::activity::{
    Activity, ActivitySource, Actor, Attribution, CommonAction, EntityType, Ingest, event_time,
};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::events::{DocumentSyncEditor, DocumentTopicEvent};
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;

// Display attribution only: teams cannot act. Prefer the initiating user when
// known, otherwise represent an unattributed team creation as system activity.
fn actor_from_owner(
    owner: &Owner,
    on_behalf_of: Option<&MacroUserIdStr<'static>>,
) -> Actor<'static> {
    match owner {
        Owner::User(user) => Actor::new_from_user(user.clone()),
        Owner::Bot(bot_id) => Actor::new_from_bot(*bot_id),
        Owner::Team(_) => on_behalf_of
            .cloned()
            .map(Actor::new_from_user)
            .unwrap_or_else(|| Actor::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID)),
    }
}

/// Attribution for `updated` / `deleted` events. Bot receipts publish `actor`;
/// user receipts (and events from before attribution) only `actor_user_id`.
/// `None` when neither is set, e.g. internal callers.
fn mutation_attribution(
    actor: &Option<Actor<'static>>,
    actor_user_id: &Option<MacroUserIdStr<'static>>,
    on_behalf_of: &Option<MacroUserIdStr<'static>>,
) -> Option<Attribution> {
    let actor = actor
        .clone()
        .or_else(|| actor_user_id.clone().map(Actor::new_from_user))?;
    Some(Attribution::new(actor, on_behalf_of.clone()))
}

impl ActivitySource for DocumentTopicEvent {
    /// Maps one `macro.documents` event to its ingest outcome.
    ///
    /// Exhaustive on purpose: a new event variant fails compilation here
    /// until someone classifies it or explicitly drops it.
    fn ingest(&self, event_id: Uuid) -> Ingest {
        let single = |attribution: Attribution,
                      action: CommonAction,
                      document_id: &str,
                      occurred_at: DateTime<Utc>| {
            Ingest::Insert(vec![Activity::attributed(
                event_id,
                0,
                attribution,
                EntityType::Document,
                document_id,
                action,
                occurred_at,
            )])
        };

        match self {
            DocumentTopicEvent::Created(metadata) => {
                let actor = metadata.actor.clone().unwrap_or_else(|| {
                    actor_from_owner(&metadata.owner, metadata.on_behalf_of.as_ref())
                });
                single(
                    Attribution::new(actor, metadata.on_behalf_of.clone()),
                    CommonAction::Created,
                    &metadata.document_id,
                    metadata.created_at.unwrap_or_else(|| event_time(event_id)),
                )
            }
            DocumentTopicEvent::Updated(metadata) => {
                match mutation_attribution(
                    &metadata.actor,
                    &metadata.actor_user_id,
                    &metadata.on_behalf_of,
                ) {
                    Some(attribution) => single(
                        attribution,
                        CommonAction::Edited,
                        &metadata.document_id,
                        event_time(event_id),
                    ),
                    None => Ingest::Ignore,
                }
            }
            DocumentTopicEvent::Deleted(metadata) => {
                match mutation_attribution(
                    &metadata.actor,
                    &metadata.actor_user_id,
                    &metadata.on_behalf_of,
                ) {
                    Some(attribution) => single(
                        attribution,
                        CommonAction::Deleted,
                        &metadata.document_id,
                        event_time(event_id),
                    ),
                    None => Ingest::Ignore,
                }
            }
            // The copy is a new document; its creation is the activity.
            DocumentTopicEvent::Copied(metadata) => single(
                Attribution::direct(actor_from_owner(&metadata.owner, None)),
                CommonAction::Created,
                &metadata.document_id,
                event_time(event_id),
            ),
            DocumentTopicEvent::Purged(metadata) => {
                Ingest::Purge(vec![(EntityType::Document, metadata.document_id.clone())])
            }
            // Extraction-pipeline noise, not user activity.
            DocumentTopicEvent::ContentUploaded(_) => Ingest::Ignore,
            DocumentTopicEvent::SyncContentUpdated(metadata) => {
                let legacy = metadata.actor.clone().map(|actor| DocumentSyncEditor {
                    actor,
                    on_behalf_of: metadata.on_behalf_of.clone(),
                });
                let mut editors: Vec<_> = metadata.editors.iter().cloned().chain(legacy).collect();
                // A stable order keeps ordinals, and so activity ids, identical on replay.
                editors.sort_by(|a, b| editor_key(a).cmp(&editor_key(b)));
                editors.dedup();
                let activities: Vec<_> = editors
                    .into_iter()
                    .enumerate()
                    .map(|(ordinal, editor)| {
                        Activity::attributed(
                            event_id,
                            ordinal as u32,
                            Attribution::new(editor.actor, editor.on_behalf_of),
                            EntityType::Document,
                            &metadata.document_id,
                            CommonAction::Edited,
                            event_time(event_id),
                        )
                    })
                    .collect();
                if activities.is_empty() {
                    Ingest::Ignore
                } else {
                    Ingest::Insert(activities)
                }
            }
            // Session lifecycle (first join / last leave), no actor.
            DocumentTopicEvent::Interaction(_) => Ingest::Ignore,
        }
    }
}

fn editor_key(editor: &DocumentSyncEditor) -> (&str, Option<&str>) {
    (
        editor.actor.as_ref(),
        editor.on_behalf_of.as_ref().map(|user| user.as_ref()),
    )
}

/// Classify document activity and debounce Sync edits in the Activity consumer.
/// Search consumes the same source event independently and never waits on this work.
#[cfg(feature = "ports")]
pub async fn ingest_with_editing_sessions(
    event: &DocumentTopicEvent,
    event_id: Uuid,
    store: &impl super::ports::EditingActivityStore,
) -> Ingest {
    const EDITING_IDLE: std::time::Duration = std::time::Duration::from_secs(5 * 60);
    const STORE_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(100);

    let rows = match (event, event.ingest(event_id)) {
        (DocumentTopicEvent::SyncContentUpdated(_), Ingest::Insert(rows)) => rows,
        (_, ingest) => return ingest,
    };
    // Redis may apply a refresh before its response times out. Losing that
    // session's Activity is acceptable here: delivery is best effort, and
    // emitting on uncertainty would turn cache failures into noisy edit feeds.
    let refresh = store.refresh_editing_sessions(&rows, event_id, EDITING_IDLE);
    let admitted = match tokio::time::timeout(STORE_TIMEOUT, refresh).await {
        Ok(Ok(admitted)) => admitted,
        result => {
            tracing::warn!(?result, "skipping best-effort editing activity");
            return Ingest::Ignore;
        }
    };
    // Assign ordinals before filtering so retries keep the same activity ids.
    let rows: Vec<_> = rows
        .into_iter()
        .zip(admitted)
        .filter_map(|(row, admitted)| admitted.then_some(row))
        .collect();
    if rows.is_empty() {
        Ingest::Ignore
    } else {
        Ingest::Insert(rows)
    }
}
