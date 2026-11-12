//! Issue tracker planning and writes. The shared workspace engine owns jobs,
//! leases, approval, cancellation, adoption and session notifications.

use futures::StreamExt;
use import_notion::domain::ports::NotionConnections;
use import_tracker::domain::model::{Group, Inventory, Issue, TrackerError};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_select::ConnectorSelect;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::Instrument;
use uuid::Uuid;

use super::notion_workspace::{sharing, triage};
use super::workspace::run::{JobControl, WriteSet};
use super::{ImportServiceImpl, NOTION_IMPORT_MODEL, NotionWorkspaceImporter};
use crate::domain::models::{
    ImportEntity, ImportKind, ImportSource, ImportStatus, NotionDecision, NotionImportReport,
    NotionJob, NotionPlanItem, NotionSharing, NotionWriteChoices, RunStatus, ScanCounts, TeamClaim,
    WrittenKind, WrittenObject,
};
use crate::domain::ports::{
    CanonicalImportRepo, EntityCreator, ImportError, ImportRepo, ImportedTaskProperties,
    NotionPlanRepo, NotionRunRepo, PlanRow, Result, SharedEntity, SlackWorkspaceSource,
    TrackerTaskRelations, WorkspaceWriter, WrittenObjects,
};

mod claim;
pub(in crate::domain::service) mod plan;
pub(in crate::domain::service) mod values;

#[cfg(test)]
mod test;

/// Source payload kept alongside the shared plan metadata. Writing never
/// rescans a tracker after approval, so the review remains an exact snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
enum TrackerObject {
    Group(Group),
    Issue(Box<Issue>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TrackerMeta {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    warnings: Vec<String>,
    title: String,
    url: Option<String>,
    summary: Option<String>,
    plan: NotionPlanItem,
    object: TrackerObject,
}

impl<R, S, C, W, N> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: ConnectorSelect,
    C: EntityCreator + WorkspaceWriter,
    W: SlackWorkspaceSource,
    N: NotionConnections,
{
    #[tracing::instrument(skip_all, fields(source = self.workspace_source.as_ref()), err)]
    pub(super) async fn plan_tracker(
        &self,
        user: &MacroUserIdStr<'static>,
        sharing: NotionSharing,
        control: &JobControl,
    ) -> Result<()> {
        let connection = self
            .trackers
            .get(&self.workspace_source)
            .ok_or(TrackerError::NotConnected)?;
        let (counts, scanned) = tokio::sync::watch::channel(ScanCounts::default());
        let walk = async {
            let found = connection
                .inventory(user, &|issues, groups| {
                    counts.send_replace(ScanCounts {
                        pages: u32::try_from(issues).unwrap_or(u32::MAX),
                        data_sources: u32::try_from(groups).unwrap_or(u32::MAX),
                    });
                })
                .await;
            drop(counts);
            found
        };
        let (found, ()) = tokio::join!(
            walk,
            super::workspace::scan::record_scan(&self.repo, user, scanned, self.workspace_source)
        );
        let found = found?;
        if control.reason().is_some() {
            return Ok(());
        }
        let on_team = self.repo.user_team_id(user).await?.is_some();
        let mut rows = plan::rows(self.workspace_source, &found, sharing, on_team)?;
        let copies = self
            .repo
            .team_copies(
                user,
                &rows
                    .iter()
                    .map(|row| row.foreign_id.clone())
                    .collect::<Vec<_>>(),
            )
            .await?;
        plan::link_existing(&mut rows, &copies)?;
        self.repo
            .replace_plan(user, self.workspace_source, &rows)
            .await?;
        self.notify(user).await;
        let items = plan::triage_items(&rows, &found)?;
        let batches = triage::decide(
            &items,
            self.workspace_source,
            sharing,
            || {
                let service = self.clone();
                let user = user.clone();
                async move { service.admit_ai(&user).await.map_err(anyhow::Error::from) }
            },
            self.recorder.as_ref(),
            ai_usage::UsageContext::new(ai_usage::AiFeature::Import, user.clone()),
            NOTION_IMPORT_MODEL,
        );
        let mut batches = std::pin::pin!(batches);
        let mut verdicts = HashMap::new();
        while let Some(batch) = batches.next().await {
            if control.reason().is_some() {
                return Ok(());
            }
            verdicts.extend(batch);
            let decided = plan::decide(&rows, &verdicts, sharing, on_team)?;
            self.repo
                .update_plan_rows(user, self.workspace_source, &decided)
                .await?;
            self.notify(user).await;
        }
        // Empty groups and issues outside a visible group need no model call.
        let decided = plan::decide(&rows, &verdicts, sharing, on_team)?;
        self.repo
            .update_plan_rows(user, self.workspace_source, &decided)
            .await?;
        Ok(())
    }

    pub(super) async fn start_tracker_write(
        &self,
        user: &MacroUserIdStr<'static>,
        review: Uuid,
        choices: NotionWriteChoices,
    ) -> Result<NotionImportReport> {
        let rows = self
            .repo
            .list(
                user,
                Some(self.workspace_source),
                Some(ImportStatus::Staged),
            )
            .await?;
        let planned: Vec<_> = rows
            .into_iter()
            .filter(|row| row.review_id == Some(review) && row.user_id == user.as_ref())
            .collect();
        if planned.is_empty() {
            return Err(ImportError::NotReady(
                "This plan has nothing left to import.",
            ));
        }
        // A source's current run and exact review must both match. A stale
        // card can never approve the replacement plan.
        let report = self.current_report(user).await?;
        if report.review_id != Some(review) || report.status != Some(RunStatus::Ready) {
            return Err(ImportError::NotReady(
                "This import plan is not ready for this review.",
            ));
        }
        let mut shared = Vec::new();
        let mut personal = Vec::new();
        for row in &planned {
            let meta: TrackerMeta = serde_json::from_value(row.metadata.clone())?;
            if meta.plan.shareable {
                if choices.personal.contains(&row.id) {
                    personal.push(row.id);
                } else if choices.shared.contains(&row.id) {
                    shared.push(row.id);
                }
            }
        }
        self.repo.set_plan_sharing(user, &shared, &personal).await?;
        if !self
            .repo
            .transition_run(
                user,
                self.workspace_source,
                &[RunStatus::Ready],
                RunStatus::Importing,
                None,
            )
            .await?
        {
            return Err(ImportError::NotReady(
                "This import is already being written.",
            ));
        }
        self.hold_new_run(
            user,
            RunStatus::Importing,
            &NotionJob::Write { review_id: review },
        )
        .await?;
        let mut ids = Vec::new();
        // Claims are taken per object during writing, so one failed claimant
        // does not prevent unrelated rows being copied.
        for row in &planned {
            let meta: TrackerMeta = serde_json::from_value(row.metadata.clone())?;
            if choices.excluded.contains(&row.id)
                || meta.plan.decision == Some(NotionDecision::Skip)
            {
                self.repo.discard(user, row.id).await?;
            } else if meta.plan.decision == Some(NotionDecision::Copy) {
                ids.push(row.id);
            }
        }
        self.repo.claim_importing(user, &ids, &[], None).await?;
        let service = self.clone();
        let owner = user.clone();
        self.jobs.tracker.spawn(
            async move {
                service
                    .write_plan(
                        &owner,
                        WriteSet {
                            review_id: review,
                            ..WriteSet::default()
                        },
                    )
                    .await
            }
            .in_current_span(),
        );
        self.notion_import_report(user).await
    }

    #[tracing::instrument(skip_all, fields(source = self.workspace_source.as_ref(), %review), err)]
    pub(super) async fn write_tracker(
        &self,
        user: &MacroUserIdStr<'static>,
        review: Uuid,
        control: &JobControl,
    ) -> Result<usize> {
        let rows: Vec<_> = self
            .repo
            .list(user, Some(self.workspace_source), None)
            .await?
            .into_iter()
            .filter(|row| {
                row.user_id == user.as_ref()
                    && row.review_id == Some(review)
                    && row.status != ImportStatus::Discarded
            })
            .collect();
        let mut failed = 0;
        let team = self.repo.user_team_id(user).await?;
        // Groups precede tasks. Stable identities heal a crash between entity
        // creation and the ledger update without creating a second object.
        for groups in [true, false] {
            for row in rows
                .iter()
                .filter(|row| row.status == ImportStatus::Importing)
            {
                if control.reason().is_some() {
                    return Ok(failed);
                }
                let meta: TrackerMeta = serde_json::from_value(row.metadata.clone())?;
                if matches!(meta.object, TrackerObject::Group(_)) != groups {
                    continue;
                }
                if let Err(error) = self
                    .write_tracker_object(user, row, &meta, team, control)
                    .await
                {
                    failed += 1;
                    self.repo
                        .mark_import_failed(user, row.id, &error.to_string())
                        .await?;
                }
                self.notify(user).await;
            }
        }
        // A task remains importing until its links are applied. The marker
        // distinguishes our creations from teammate copies, which we never edit.
        let current = self
            .repo
            .list(user, Some(self.workspace_source), None)
            .await?;
        let ids: Vec<_> = current
            .iter()
            .filter(|row| row.user_id == user.as_ref() && row.review_id == Some(review))
            .map(|row| row.id)
            .collect();
        let written = self.repo.written(user, &ids).await?;
        let task_ids: HashMap<_, _> = written
            .iter()
            .filter(|object| object.kind == WrittenKind::Task)
            .map(|object| (object.import_id, object.macro_id))
            .collect();
        let targets: HashMap<_, _> = current
            .iter()
            .filter(|row| row.user_id == user.as_ref())
            .filter_map(|row| {
                let id = if row.status == ImportStatus::Imported {
                    row.entity_id
                        .as_deref()
                        .and_then(|id| id.parse::<Uuid>().ok())
                } else if row.review_id == Some(review) && row.status == ImportStatus::Importing {
                    task_ids.get(&row.id).copied()
                } else {
                    None
                };
                id.map(|id| (row.foreign_id.clone(), id))
            })
            .collect();
        for row in current.iter().filter(|row| {
            row.user_id == user.as_ref()
                && row.review_id == Some(review)
                && row.status == ImportStatus::Importing
                && row.waiting_on.is_none()
        }) {
            if control.reason().is_some() {
                return Ok(failed);
            }
            let Some(id) = task_ids.get(&row.id).copied() else {
                continue;
            };
            let meta: TrackerMeta = serde_json::from_value(row.metadata.clone())?;
            let TrackerObject::Issue(issue) = meta.object else {
                continue;
            };
            let group_key = issue
                .group
                .as_ref()
                .or(issue.team.as_ref())
                .map(plan::group_key);
            let dependency_missing = [
                group_key.as_deref(),
                issue.parent.as_ref().map(|parent| parent.as_str()),
            ]
            .into_iter()
            .flatten()
            .any(|key| {
                !targets.contains_key(key)
                    && current.iter().any(|parent| {
                        parent.foreign_id == key
                            && parent.user_id == user.as_ref()
                            && parent.review_id == Some(review)
                            && parent.status != ImportStatus::Discarded
                            && serde_json::from_value::<TrackerMeta>(parent.metadata.clone())
                                .is_ok_and(|meta| meta.plan.decision == Some(NotionDecision::Copy))
                    })
            });
            if dependency_missing {
                failed += 1;
                self.repo.mark_import_failed(user, row.id, "Its selected project or parent has not finished importing. Plan again to retry its relationship.").await?;
                continue;
            }
            let relations = TrackerTaskRelations {
                project: group_key
                    .as_ref()
                    .and_then(|group| targets.get(group))
                    .copied(),
                parent: issue
                    .parent
                    .as_ref()
                    .and_then(|parent| targets.get(parent.as_str()))
                    .copied(),
                labels: issue.labels,
            };
            let enriched = async {
                self.creator.link_tracker_task(user, id, &relations).await?;
                if meta.plan.shared && team.is_some() {
                    self.creator
                        .share_with_team(user, SharedEntity::Document(id))
                        .await?;
                }
                anyhow::Ok(())
            }
            .await;
            match enriched {
                Ok(()) => {
                    self.repo
                        .mark_imported(
                            user,
                            row.id,
                            &id.to_string(),
                            "task",
                            team.filter(|_| meta.plan.shared),
                        )
                        .await?;
                }
                Err(error) => {
                    failed += 1;
                    self.repo
                        .mark_import_failed(user, row.id, &error.to_string())
                        .await?;
                }
            }
        }
        Ok(failed)
    }

    async fn write_tracker_object(
        &self,
        user: &MacroUserIdStr<'static>,
        row: &ImportEntity,
        meta: &TrackerMeta,
        team: Option<Uuid>,
        control: &JobControl,
    ) -> Result<()> {
        if meta.plan.shared
            && let Some(team) = team
        {
            let resolved = claim::resolve(
                || async {
                    if control.reason().is_some() {
                        return Err(ImportError::NotReady("The import stopped."));
                    }
                    self.repo.claim_team_object(user, row.id, team, true).await
                },
                |holder| self.repo.wait_on(user, row.id, holder),
            )
            .await?;
            match resolved {
                TeamClaim::Linked {
                    entity_id,
                    entity_type,
                } => {
                    self.repo
                        .mark_imported(user, row.id, &entity_id, &entity_type, None)
                        .await?;
                    return Ok(());
                }
                TeamClaim::Waiting { .. } => return Ok(()),
                TeamClaim::Held | TeamClaim::Free => {}
            }
        }
        let id = values::target_id(row.id);
        match &meta.object {
            TrackerObject::Group(group) => {
                let project = self
                    .creator
                    .create_tracker_project(
                        user,
                        id,
                        &group.title,
                        &values::group_body(group),
                        meta.plan.shared && team.is_some(),
                    )
                    .await?;
                self.repo
                    .mark_imported(
                        user,
                        row.id,
                        &project.to_string(),
                        "initiative",
                        team.filter(|_| meta.plan.shared),
                    )
                    .await?;
            }
            TrackerObject::Issue(issue) => {
                self.creator
                    .create_tracker_task(
                        user,
                        id,
                        &issue.title,
                        &values::task_body(issue),
                        &values::properties(issue),
                        false,
                    )
                    .await?;
                self.repo
                    .record_written(user, &[WrittenObject::own(row.id, WrittenKind::Task, id)])
                    .await?;
            }
        }
        Ok(())
    }
}
