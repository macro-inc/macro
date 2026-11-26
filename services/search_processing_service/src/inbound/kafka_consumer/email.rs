//! Maps email lifecycle events to search-index actions and processes them.

use std::borrow::Cow;

use ::email::domain::events::{EmailEventOrigin, EmailMacroEvent, EmailTopicEvent};
use macro_event_broker::MacroEvent as _;
use opensearch_client::OpensearchClient;
use sqlx::PgPool;
use uuid::Uuid;

use super::{Attempted, Attempts, Handled};
use crate::process::email::{mailbox_delete::MailboxDeletes, remove, upsert};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum EmailIndexAction {
    UpsertMessage {
        message_id: Uuid,
        owner: String,
    },
    /// Index a sent message under its thread and drop the copies it left
    /// under threads the send moved it from.
    UpsertSentMessage {
        message_id: Uuid,
        owner: String,
    },
    RemoveMessage {
        message_id: Uuid,
        thread_id: Uuid,
    },
    ReindexThread {
        thread_id: Uuid,
        owner: String,
    },
    ReindexThreads {
        thread_ids: Vec<Uuid>,
        owner: String,
    },
    RemoveLink {
        link_id: Uuid,
    },
    Ignore,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct EmailEventDescription {
    pub(super) action: EmailIndexAction,
    pub(super) link_id: Uuid,
    pub(super) event_type: &'static str,
}

/// Worker-sharding key for an email event.
///
/// Email events are produced with a link-scoped (whole inbox) Kafka key, so
/// thread- and message-scoped events shard by thread id instead: one inbox's
/// backfill or reindex spreads across the worker pool while events for a
/// single thread stay ordered. A reindex request naming several threads
/// shards by its first, so only that thread's events stay ordered with it.
/// Link-scoped events keep the link-id producer key, so their ordering
/// against a buffered thread event (e.g. a link removal racing a message
/// upsert) is not guaranteed — an accepted risk of the same order as this
/// consumer's existing commit-at-handoff drop window.
pub(super) fn email_ordering_key(event: &EmailMacroEvent) -> Cow<'_, str> {
    let thread_id = match &event.event().event {
        EmailTopicEvent::LinkConnected(_)
        | EmailTopicEvent::LinkDisconnected(_)
        | EmailTopicEvent::LinkReauthRequired(_) => return Cow::Borrowed(event.key()),
        EmailTopicEvent::ThreadsReindexRequested(metadata) => match metadata.thread_ids.first() {
            Some(thread_id) => *thread_id,
            None => return Cow::Borrowed(event.key()),
        },
        EmailTopicEvent::MessageReceived(metadata) => metadata.thread_id,
        EmailTopicEvent::MessageDraftSynced(metadata) => metadata.thread_id,
        EmailTopicEvent::MessageSent(metadata) => metadata.thread_id,
        EmailTopicEvent::MessageDeleted(metadata) => metadata.thread_id,
        EmailTopicEvent::MessageSendQueued(metadata) => metadata.thread_id,
        EmailTopicEvent::MessageSendCancelled(metadata) => metadata.thread_id,
        EmailTopicEvent::ThreadArchived(metadata) => metadata.thread_id,
        EmailTopicEvent::ThreadTrashed(metadata) => metadata.thread_id,
        EmailTopicEvent::ThreadRead(metadata) => metadata.thread_id,
        EmailTopicEvent::ThreadStarred(metadata) => metadata.thread_id,
        EmailTopicEvent::ThreadSpamChanged(metadata) => metadata.thread_id,
        EmailTopicEvent::ThreadProjectChanged(metadata) => metadata.thread_id,
        EmailTopicEvent::ThreadLabelsUpdated(metadata) => metadata.thread_id,
        EmailTopicEvent::ThreadBackfilled(metadata) => metadata.thread_id,
    };
    Cow::Owned(thread_id.to_string())
}

/// Key of a reindex request for one thread, which only rereads that thread,
/// so a reread of it already queued covers the request.
pub(super) fn reread_key(event: &EmailMacroEvent) -> Option<String> {
    match &event.event().event {
        EmailTopicEvent::ThreadsReindexRequested(metadata) => {
            match metadata.thread_ids.as_slice() {
                [thread_id] => Some(thread_id.to_string()),
                _ => None,
            }
        }
        EmailTopicEvent::LinkConnected(_)
        | EmailTopicEvent::LinkDisconnected(_)
        | EmailTopicEvent::LinkReauthRequired(_)
        | EmailTopicEvent::MessageReceived(_)
        | EmailTopicEvent::MessageDraftSynced(_)
        | EmailTopicEvent::MessageSent(_)
        | EmailTopicEvent::MessageDeleted(_)
        | EmailTopicEvent::MessageSendQueued(_)
        | EmailTopicEvent::MessageSendCancelled(_)
        | EmailTopicEvent::ThreadArchived(_)
        | EmailTopicEvent::ThreadTrashed(_)
        | EmailTopicEvent::ThreadRead(_)
        | EmailTopicEvent::ThreadStarred(_)
        | EmailTopicEvent::ThreadSpamChanged(_)
        | EmailTopicEvent::ThreadProjectChanged(_)
        | EmailTopicEvent::ThreadLabelsUpdated(_)
        | EmailTopicEvent::ThreadBackfilled(_) => None,
    }
}

pub(super) fn describe_email_event(event: &EmailTopicEvent) -> EmailEventDescription {
    match event {
        EmailTopicEvent::LinkConnected(metadata) => EmailEventDescription {
            action: EmailIndexAction::Ignore,
            link_id: metadata.link_id,
            event_type: "email.link_connected",
        },
        EmailTopicEvent::LinkDisconnected(metadata) => EmailEventDescription {
            action: EmailIndexAction::RemoveLink {
                link_id: metadata.link_id,
            },
            link_id: metadata.link_id,
            event_type: "email.link_disconnected",
        },
        EmailTopicEvent::LinkReauthRequired(metadata) => EmailEventDescription {
            action: EmailIndexAction::Ignore,
            link_id: metadata.link_id,
            event_type: "email.link_reauth_required",
        },
        EmailTopicEvent::MessageReceived(metadata) => EmailEventDescription {
            action: if metadata.is_spam_or_trash {
                EmailIndexAction::RemoveMessage {
                    message_id: metadata.message_id,
                    thread_id: metadata.thread_id,
                }
            } else {
                EmailIndexAction::UpsertMessage {
                    message_id: metadata.message_id,
                    owner: metadata.owner.to_string(),
                }
            },
            link_id: metadata.link_id,
            event_type: "email.message_received",
        },
        EmailTopicEvent::MessageDraftSynced(metadata) => EmailEventDescription {
            action: if metadata.is_spam_or_trash {
                EmailIndexAction::RemoveMessage {
                    message_id: metadata.message_id,
                    thread_id: metadata.thread_id,
                }
            } else {
                EmailIndexAction::UpsertMessage {
                    message_id: metadata.message_id,
                    owner: metadata.owner.to_string(),
                }
            },
            link_id: metadata.link_id,
            event_type: "email.message_draft_synced",
        },
        EmailTopicEvent::MessageSent(metadata) => EmailEventDescription {
            // Only a send made in Macro can move an existing message to
            // another thread; a sent message synced from the provider is a
            // new row with no older copy to clean up.
            action: match metadata.origin {
                EmailEventOrigin::UserAction => EmailIndexAction::UpsertSentMessage {
                    message_id: metadata.message_id,
                    owner: metadata.owner.to_string(),
                },
                EmailEventOrigin::ProviderSync => EmailIndexAction::UpsertMessage {
                    message_id: metadata.message_id,
                    owner: metadata.owner.to_string(),
                },
            },
            link_id: metadata.link_id,
            event_type: "email.message_sent",
        },
        EmailTopicEvent::MessageDeleted(metadata) => EmailEventDescription {
            action: EmailIndexAction::RemoveMessage {
                message_id: metadata.message_id,
                thread_id: metadata.thread_id,
            },
            link_id: metadata.link_id,
            event_type: "email.message_deleted",
        },
        EmailTopicEvent::MessageSendQueued(metadata) => EmailEventDescription {
            action: EmailIndexAction::Ignore,
            link_id: metadata.link_id,
            event_type: "email.message_send_queued",
        },
        EmailTopicEvent::MessageSendCancelled(metadata) => EmailEventDescription {
            action: EmailIndexAction::Ignore,
            link_id: metadata.link_id,
            event_type: "email.message_send_cancelled",
        },
        EmailTopicEvent::ThreadArchived(metadata) => EmailEventDescription {
            action: EmailIndexAction::ReindexThread {
                thread_id: metadata.thread_id,
                owner: metadata.owner.to_string(),
            },
            link_id: metadata.link_id,
            event_type: "email.thread_archived",
        },
        EmailTopicEvent::ThreadTrashed(metadata) => EmailEventDescription {
            action: EmailIndexAction::ReindexThread {
                thread_id: metadata.thread_id,
                owner: metadata.owner.to_string(),
            },
            link_id: metadata.link_id,
            event_type: "email.thread_trashed",
        },
        EmailTopicEvent::ThreadRead(metadata) => EmailEventDescription {
            action: EmailIndexAction::ReindexThread {
                thread_id: metadata.thread_id,
                owner: metadata.owner.to_string(),
            },
            link_id: metadata.link_id,
            event_type: "email.thread_read",
        },
        EmailTopicEvent::ThreadStarred(metadata) => EmailEventDescription {
            action: EmailIndexAction::ReindexThread {
                thread_id: metadata.thread_id,
                owner: metadata.owner.to_string(),
            },
            link_id: metadata.link_id,
            event_type: "email.thread_starred",
        },
        EmailTopicEvent::ThreadSpamChanged(metadata) => EmailEventDescription {
            action: EmailIndexAction::ReindexThread {
                thread_id: metadata.thread_id,
                owner: metadata.owner.to_string(),
            },
            link_id: metadata.link_id,
            event_type: "email.thread_spam_changed",
        },
        EmailTopicEvent::ThreadProjectChanged(metadata) => EmailEventDescription {
            action: EmailIndexAction::Ignore,
            link_id: metadata.link_id,
            event_type: "email.thread_project_changed",
        },
        EmailTopicEvent::ThreadLabelsUpdated(metadata) => EmailEventDescription {
            action: EmailIndexAction::ReindexThread {
                thread_id: metadata.thread_id,
                owner: metadata.owner.to_string(),
            },
            link_id: metadata.link_id,
            event_type: "email.thread_labels_updated",
        },
        EmailTopicEvent::ThreadBackfilled(metadata) => EmailEventDescription {
            action: EmailIndexAction::ReindexThread {
                thread_id: metadata.thread_id,
                owner: metadata.owner.to_string(),
            },
            link_id: metadata.link_id,
            event_type: "email.thread_backfilled",
        },
        EmailTopicEvent::ThreadsReindexRequested(metadata) => EmailEventDescription {
            action: EmailIndexAction::ReindexThreads {
                thread_ids: metadata.thread_ids.clone(),
                owner: metadata.owner.to_string(),
            },
            link_id: metadata.link_id,
            event_type: "email.threads_reindex_requested",
        },
    }
}

async fn process_email_index_action(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    mailbox_deletes: &MailboxDeletes,
    action: EmailIndexAction,
) -> anyhow::Result<()> {
    match action {
        EmailIndexAction::UpsertMessage { message_id, owner } => {
            upsert::process_upsert_message(opensearch_client, db, message_id, &owner).await
        }
        EmailIndexAction::UpsertSentMessage { message_id, owner } => {
            upsert::process_upsert_sent_message(opensearch_client, db, message_id, &owner).await
        }
        EmailIndexAction::RemoveMessage {
            message_id,
            thread_id,
        } => remove::process_remove_message(opensearch_client, message_id, thread_id, None).await,
        EmailIndexAction::ReindexThread { thread_id, owner } => {
            upsert::process_upsert_thread_message(opensearch_client, db, thread_id, &owner, None)
                .await
        }
        EmailIndexAction::ReindexThreads { thread_ids, owner } => {
            upsert::process_upsert_thread_batch_message(
                opensearch_client,
                db,
                &thread_ids,
                &owner,
                None,
            )
            .await
        }
        EmailIndexAction::RemoveLink { link_id } => mailbox_deletes.start(link_id).await,
        EmailIndexAction::Ignore => Ok(()),
    }
}

pub(super) async fn process_email_event(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    mailbox_deletes: &MailboxDeletes,
    event: &EmailMacroEvent,
    partition: i32,
    offset: i64,
    attempts: &Attempts,
) -> Attempted {
    let description = describe_email_event(&event.event().event);
    if description.action == EmailIndexAction::Ignore {
        tracing::trace!(
            link_id = %description.link_id,
            event_type = description.event_type,
            partition,
            offset,
            "ignoring email event without a search-index action"
        );
        return Ok((Handled::Ignored, 0));
    }

    attempts
        .run(|attempt| {
            let action = description.action.clone();
            async move {
                tracing::trace!(
                    link_id = %description.link_id,
                    event_type = description.event_type,
                    partition,
                    offset,
                    attempt,
                    "processing email search-index event"
                );
                process_email_index_action(db, opensearch_client, mailbox_deletes, action).await
            }
        })
        .await
}
