//! Maps project lifecycle events to search-index reconciliations and processes them.

use std::collections::HashSet;

use macro_event_broker::MacroEvent as _;
use opensearch_client::OpensearchClient;
use projects::domain::events::{ProjectMacroEvent, ProjectTopicEvent};
use sqlx::PgPool;
use sqs_client::search::project::UpsertProject;

use super::{EventOutcome, MAX_PROCESSING_ATTEMPTS, PROCESSING_RETRY_BASE_DELAY, retry_processing};
use crate::process::{chat::remove_chat_message, project::upsert_project};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum ProjectIndexAction {
    Reconcile {
        project_ids: Vec<String>,
        purged_chat_ids: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProjectEventDescription<'a> {
    pub(super) action: ProjectIndexAction,
    pub(super) project_id: &'a str,
    pub(super) event_type: &'static str,
}

pub(super) fn collect_project_ids<'a>(
    project_ids: impl IntoIterator<Item = Option<&'a str>>,
) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut collected = Vec::new();

    for project_id in project_ids.into_iter().flatten() {
        if !project_id.is_empty() && seen.insert(project_id) {
            collected.push(project_id.to_string());
        }
    }

    collected
}

pub(super) fn describe_project_event(event: &ProjectTopicEvent) -> ProjectEventDescription<'_> {
    match event {
        ProjectTopicEvent::Created(metadata) => ProjectEventDescription {
            action: ProjectIndexAction::Reconcile {
                project_ids: collect_project_ids([
                    Some(metadata.project_id.as_str()),
                    metadata.parent_project_id.as_deref(),
                ]),
                purged_chat_ids: Vec::new(),
            },
            project_id: &metadata.project_id,
            event_type: "project.created",
        },
        ProjectTopicEvent::Updated(metadata) => ProjectEventDescription {
            action: ProjectIndexAction::Reconcile {
                project_ids: collect_project_ids([
                    Some(metadata.project_id.as_str()),
                    metadata.previous_parent_id.as_deref(),
                    metadata.parent_id.as_deref(),
                ]),
                purged_chat_ids: Vec::new(),
            },
            project_id: &metadata.project_id,
            event_type: "project.updated",
        },
        ProjectTopicEvent::Deleted(metadata) => ProjectEventDescription {
            action: ProjectIndexAction::Reconcile {
                project_ids: collect_project_ids(
                    metadata
                        .deleted_project_ids
                        .iter()
                        .map(|project_id| Some(project_id.as_str()))
                        .chain([metadata.parent_project_id.as_deref()]),
                ),
                purged_chat_ids: Vec::new(),
            },
            project_id: &metadata.project_id,
            event_type: "project.deleted",
        },
        ProjectTopicEvent::Restored(metadata) => ProjectEventDescription {
            action: ProjectIndexAction::Reconcile {
                project_ids: collect_project_ids(
                    metadata
                        .restored_project_ids
                        .iter()
                        .map(|project_id| Some(project_id.as_str()))
                        .chain([metadata.parent_project_id.as_deref()]),
                ),
                purged_chat_ids: Vec::new(),
            },
            project_id: &metadata.project_id,
            event_type: "project.restored",
        },
        ProjectTopicEvent::PermanentlyDeleted(metadata) => ProjectEventDescription {
            action: ProjectIndexAction::Reconcile {
                project_ids: collect_project_ids(
                    metadata
                        .purged_project_ids
                        .iter()
                        .map(|project_id| Some(project_id.as_str()))
                        .chain([metadata.parent_project_id.as_deref()]),
                ),
                purged_chat_ids: metadata.purged_chat_ids.clone(),
            },
            project_id: &metadata.project_id,
            event_type: "project.permanently_deleted",
        },
        ProjectTopicEvent::Uploaded(metadata) => ProjectEventDescription {
            action: ProjectIndexAction::Reconcile {
                project_ids: collect_project_ids(
                    metadata
                        .project_ids
                        .iter()
                        .map(|project_id| Some(project_id.as_str()))
                        .chain([metadata.parent_project_id.as_deref()]),
                ),
                purged_chat_ids: Vec::new(),
            },
            project_id: &metadata.root_project_id,
            event_type: "project.uploaded",
        },
    }
}

async fn process_project_index_action(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    action: ProjectIndexAction,
) -> anyhow::Result<()> {
    match action {
        ProjectIndexAction::Reconcile {
            project_ids,
            purged_chat_ids,
        } => {
            for project_id in project_ids {
                upsert_project(
                    opensearch_client,
                    db,
                    &UpsertProject {
                        project_id,
                        index_override: None,
                    },
                )
                .await?;
            }

            for chat_id in purged_chat_ids {
                remove_chat_message(opensearch_client, &chat_id, None, None).await?;
            }

            Ok(())
        }
    }
}

pub(super) async fn process_project_event(
    db: &PgPool,
    opensearch_client: &OpensearchClient,
    event: &ProjectMacroEvent,
    partition: i32,
    offset: i64,
) -> EventOutcome {
    let description = describe_project_event(&event.event().event);
    let result = retry_processing(|attempt| {
        let action = description.action.clone();
        async move {
            tracing::trace!(
                project_id = description.project_id,
                event_type = description.event_type,
                partition,
                offset,
                attempt,
                "processing project search-index event"
            );
            process_project_index_action(db, opensearch_client, action)
                .await
                .inspect_err(|error| {
                    if attempt < MAX_PROCESSING_ATTEMPTS {
                        let retry_delay =
                            PROCESSING_RETRY_BASE_DELAY * 2u32.pow(attempt.saturating_sub(1));
                        tracing::warn!(
                            error = ?error,
                            project_id = description.project_id,
                            event_type = description.event_type,
                            partition,
                            offset,
                            attempt,
                            delay_secs = retry_delay.as_secs(),
                            "project search-index processing failed, retrying"
                        );
                    }
                })
        }
    })
    .await;

    match result {
        Ok(()) => EventOutcome::Indexed,
        Err(error) => {
            tracing::error!(
                error = ?error,
                project_id = description.project_id,
                event_type = description.event_type,
                partition,
                offset,
                attempts = MAX_PROCESSING_ATTEMPTS,
                "dropping project event after processing retries were exhausted"
            );
            EventOutcome::Dropped
        }
    }
}
