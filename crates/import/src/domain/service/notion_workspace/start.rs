//! Approve exactly the saved selection before scheduling a workspace write.

use super::*;
use crate::domain::ports::PlanRow;

impl<R, S, C, W, N> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: McpConnectionsService,
    C: EntityCreator + WorkspaceWriter,
    W: SlackWorkspaceSource,
    N: NotionConnections,
{
    #[tracing::instrument(
        name = "notion.start_write",
        skip_all,
        fields(
            review_id = %review_id,
            copy_overrides = tracing::field::Empty,
            copy_override_outcome = tracing::field::Empty,
        ),
        err
    )]
    pub(super) async fn start_write(
        &self,
        user: &MacroUserIdStr<'static>,
        review_id: Uuid,
        choices: NotionWriteChoices,
    ) -> Result<NotionImportReport> {
        if self.workspace_source != ImportSource::Notion {
            return self.start_tracker_write(user, review_id, choices).await;
        }
        // Rows an earlier writer left mid-write go back to staged first, so a
        // retry of a failed write writes them too. Nothing moves while a
        // write is running.
        self.repo
            .settle_importing(user, IMPORT_STOPPED)
            .await
            .map_err(ImportError::not_started)?;
        let staged = self
            .repo
            .list(
                user,
                Some(self.workspace_source),
                Some(ImportStatus::Staged),
            )
            .await
            .map_err(ImportError::not_started)?;
        let mut planned: Vec<(ImportEntity, write::WriteItem)> = staged
            .into_iter()
            .filter(|row| row.review_id == Some(review_id))
            .filter_map(|row| write::WriteItem::from_entity(&row).map(|item| (row, item)))
            .collect();
        if planned.is_empty() {
            return Err(crate::domain::ports::UnreviewableRun::NothingLeft.into());
        }
        let dependencies = self
            .repo
            .dependency_ids(user, review_id)
            .await
            .map_err(ImportError::not_started)?;
        let scope = review_id.to_string();
        let approved_dependencies: std::collections::HashSet<Uuid> = self
            .repo
            .written(user, &dependencies)
            .await
            .map_err(ImportError::not_started)?
            .into_iter()
            .filter(|fact| {
                fact.kind == crate::domain::models::WrittenKind::DependencyIncluded
                    && fact.object == scope
                    && fact.macro_id == review_id
            })
            .map(|fact| fact.import_id)
            .collect();
        let requested_copies: std::collections::HashSet<_> =
            choices.copy_skipped.iter().copied().collect();
        let excluded: std::collections::HashSet<_> = choices.excluded.iter().copied().collect();
        let mut promoted = Vec::new();
        for (row, item) in &mut planned {
            if item.kind == ImportKind::Page
                && item.decision == NotionDecision::Skip
                && !item.already_imported
                && requested_copies.contains(&row.id)
                && !excluded.contains(&row.id)
            {
                item.decision = NotionDecision::Copy;
                row.metadata["plan"]["decision"] = serde_json::json!(NotionDecision::Copy);
                row.metadata["plan"]["reason"] =
                    serde_json::json!("Selected in the import review.");
                promoted.push(PlanRow {
                    kind: row.kind,
                    foreign_id: row.foreign_id.clone(),
                    parent_foreign_id: None,
                    metadata: row.metadata.clone(),
                });
            }
        }
        tracing::Span::current().record("copy_overrides", promoted.len());
        let team_id = self
            .repo
            .user_team_id(user)
            .await
            .map_err(ImportError::not_started)?;
        // Only the ready plan this review presents is written, or the failed
        // write it was admitted to: a failed or replaced plan, another
        // review's write, or a still-planning plan is refused here, whoever
        // approved, before anything about it changes. Until the write is held, every
        // failure leaves the plan as it was (`NotStarted`); after, it may not.
        let from = self
            .repo
            .start_reviewed_write(user, self.workspace_source, review_id)
            .await
            .map_err(ImportError::not_started)?;
        // The reviewed Copy overrides are saved right after the fence, before
        // the run is held, so a resume rebuilds the same selection and a
        // failure here leaves the plan as it was, approvable again.
        let (outcome, persisted) = if promoted.is_empty() {
            ("none", Ok(()))
        } else {
            match self
                .repo
                .update_plan_rows(user, self.workspace_source, &promoted)
                .await
            {
                Ok(count) if count == promoted.len() as u64 => ("persisted", Ok(())),
                Ok(_) => (
                    "stale",
                    Err(ImportError::NotReady(
                        "The Notion plan changed before the selected pages could be saved. Review the plan again.",
                    )),
                ),
                Err(error) => ("failed", Err(error)),
            }
        };
        tracing::Span::current().record("copy_override_outcome", outcome);
        if let Err(error) = persisted {
            self.reopen_plan(user, from).await;
            return Err(error.not_started());
        }
        // The owner's sharing changes are recorded on the rows before the
        // write starts, so a resumed write shares exactly what they approved.
        let items: Vec<write::WriteItem> = planned.iter().map(|(_, item)| item.clone()).collect();
        let (to_share, to_keep) =
            sharing::sharing_changes(&items, &choices.shared, &choices.personal);
        if let Err(error) = self.repo.set_plan_sharing(user, &to_share, &to_keep).await {
            self.reopen_plan(user, from).await;
            return Err(error.not_started());
        }
        for (_, item) in &mut planned {
            if to_share.contains(&item.import_id) {
                item.shared = true;
            } else if to_keep.contains(&item.import_id) {
                item.shared = false;
            }
        }
        self.hold_new_run(user, RunStatus::Importing, &NotionJob::Write { review_id })
            .await?;

        let mut to_write = Vec::new();
        for (row, item) in planned {
            let left_out = excluded.contains(&row.id)
                || (!item.dependency_of.is_empty() && !approved_dependencies.contains(&row.id));
            match (left_out, item.decision) {
                (true, _) | (false, NotionDecision::Skip) => {
                    self.repo.discard(user, row.id).await?;
                }
                // Left staged for the agent, which handles it by hand.
                (false, NotionDecision::Hand) => {}
                (false, NotionDecision::Copy | NotionDecision::Tasks) => to_write.push(item),
            }
        }
        let ids: Vec<Uuid> = to_write.iter().map(|item| item.import_id).collect();
        // Shared objects are claimed for the team now, before anything is
        // written, so a teammate writing the same object links to this copy.
        let shared: Vec<Uuid> = to_write
            .iter()
            .filter(|item| item.shared && item.writes())
            .map(|item| item.import_id)
            .collect();
        let claimed: std::collections::HashSet<Uuid> = self
            .repo
            .claim_importing(user, &ids, &shared, team_id)
            .await?
            .into_iter()
            .map(|row| row.id)
            .collect();
        to_write.retain(|item| claimed.contains(&item.import_id));
        self.notify(user).await;

        let service = self.clone();
        let owner = user.clone();
        let set = WriteSet {
            review_id,
            all: to_write.clone(),
            pending: to_write,
        };
        self.jobs
            .tracker
            .spawn(async move { service.write_plan(&owner, set).await }.in_current_span());
        Ok(self.report_after_start(user).await)
    }
}
