//! Approve exactly the saved selection before scheduling a workspace write.

use super::*;

impl<R, S, C, W, N> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: ConnectorSelect,
    C: EntityCreator + WorkspaceWriter,
    W: SlackWorkspaceSource,
    N: NotionConnections,
{
    #[tracing::instrument(name = "notion.start_write", skip_all, fields(review_id = %review_id), err)]
    pub(super) async fn start_write(
        &self,
        user: &MacroUserIdStr<'static>,
        review_id: Uuid,
        choices: NotionWriteChoices,
    ) -> Result<NotionImportReport> {
        if self.workspace_source != ImportSource::Notion {
            return self.start_tracker_write(user, review_id, choices).await;
        }
        let staged = self
            .repo
            .list(
                user,
                Some(self.workspace_source),
                Some(ImportStatus::Staged),
            )
            .await?;
        let mut planned: Vec<(ImportEntity, write::WriteItem)> = staged
            .into_iter()
            .filter(|row| row.review_id == Some(review_id))
            .filter_map(|row| write::WriteItem::from_entity(&row).map(|item| (row, item)))
            .collect();
        if planned.is_empty() {
            return Err(ImportError::NotReady(
                "This plan has nothing left to import.",
            ));
        }
        let dependency_review = self
            .review_dependencies(user, review_id, &choices.excluded, false)
            .await?;
        let approved_dependencies: std::collections::HashSet<Uuid> = dependency_review
            .included
            .into_iter()
            .filter(|id| choices.included_dependencies.contains(id))
            .collect();
        // The owner's sharing changes are recorded on the rows first, so a
        // resumed write shares exactly what they approved.
        let items: Vec<write::WriteItem> = planned.iter().map(|(_, item)| item.clone()).collect();
        let (to_share, to_keep) =
            sharing::sharing_changes(&items, &choices.shared, &choices.personal);
        self.repo
            .set_plan_sharing(user, &to_share, &to_keep)
            .await?;
        for (_, item) in &mut planned {
            if to_share.contains(&item.import_id) {
                item.shared = true;
            } else if to_keep.contains(&item.import_id) {
                item.shared = false;
            }
        }
        let team_id = self.repo.user_team_id(user).await?;
        if !self
            .repo
            .transition_run(
                user,
                self.workspace_source,
                &SETTLED,
                RunStatus::Importing,
                None,
            )
            .await?
        {
            return Err(ImportError::NotReady(
                "A workspace import is already being planned or written.",
            ));
        }
        self.hold_new_run(user, RunStatus::Importing, &NotionJob::Write { review_id })
            .await?;

        let mut to_write = Vec::new();
        let mut link_only = Vec::new();
        for (row, mut item) in planned {
            let left_out = choices.excluded.contains(&row.id)
                || (!item.dependency_of.is_empty() && !approved_dependencies.contains(&row.id));
            match (left_out, item.decision) {
                (true, _) | (false, NotionDecision::Skip) => {
                    self.repo.discard(user, row.id).await?;
                    if item.kind == ImportKind::DataSource {
                        item.decision = NotionDecision::Skip;
                        link_only.push(item);
                    }
                }
                // Left staged for the agent, which handles it by hand.
                (false, NotionDecision::Hand) => {}
                (false, NotionDecision::Copy | NotionDecision::Tasks) => to_write.push(item),
            }
        }
        let consent: Vec<_> = to_write
            .iter()
            .filter(|item| !item.dependency_of.is_empty())
            .map(|item| crate::domain::models::WrittenObject {
                import_id: item.import_id,
                kind: crate::domain::models::WrittenKind::DependencyIncluded,
                object: review_id.to_string(),
                macro_id: review_id,
            })
            .collect();
        self.repo.record_written(user, &consent).await?;
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
        let mut all = to_write.clone();
        all.extend(link_only);
        let set = WriteSet {
            review_id,
            all,
            pending: to_write,
        };
        self.jobs
            .tracker
            .spawn(async move { service.write_plan(&owner, set).await }.in_current_span());
        self.notion_import_report(user).await
    }
}
