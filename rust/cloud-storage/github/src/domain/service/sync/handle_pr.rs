//! PR open/edit/close event handlers.

use crate::domain::{
    models::{GithubError, MacroTaskId, ValidatedGithubWebhookEvent},
    ports::{GithubSyncClient, GithubSyncRepo},
};
use documents::domain::ports::DocumentService;
use std::collections::HashSet;

use super::GithubSyncServiceImpl;

impl<D: DocumentService, R: GithubSyncRepo, C: GithubSyncClient> GithubSyncServiceImpl<D, R, C> {
    /// Handle `pull_request` events with action `opened` or `reopened`.
    #[tracing::instrument(skip(self, event), err)]
    pub(crate) async fn handle_pr_open(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> Result<(), GithubError> {
        let searchable_texts = event.extract_searchable_text();
        let combined = searchable_texts.join(" ");
        let task_ids = MacroTaskId::extract_from_text(&combined);

        tracing::trace!(
            task_id_count = task_ids.len(),
            task_ids = ?task_ids.iter().map(|t| t.to_task_id_string()).collect::<Vec<_>>(),
            "extracted task IDs from PR text"
        );

        if task_ids.is_empty() {
            tracing::debug!("no task IDs found in PR text");
            return Ok(());
        }

        // Resolve all extracted IDs against the document service to validate
        // they are actual task documents (filters out false positives like "macro-inc")
        let resolved_all = self.resolve_tasks(&task_ids).await;

        if resolved_all.validated_task_ids.is_empty() {
            tracing::debug!("no valid task documents found for extracted IDs");
            return Ok(());
        }

        let github_key = Self::github_key(event);

        // Determine which validated tasks are new for this PR
        let new_task_ids = if let Some(ref key) = github_key {
            self.repo
                .filter_duplicate_tasks(key.clone(), &resolved_all.validated_task_ids)
                .await
                .inspect_err(|e| tracing::error!(error=?e, "failed to filter duplicate tasks"))
                .unwrap_or_else(|_| resolved_all.validated_task_ids.clone())
        } else {
            resolved_all.validated_task_ids.clone()
        };

        // Post comment for newly discovered tasks
        if !new_task_ids.is_empty() {
            let new_task_id_set: HashSet<&MacroTaskId> = new_task_ids.iter().collect();
            let new_task_links: Vec<_> = resolved_all
                .validated_task_ids
                .iter()
                .zip(resolved_all.task_links.iter())
                .filter(|(id, _)| new_task_id_set.contains(id))
                .map(|(_, link)| link.clone())
                .collect();

            let pr_meta = self.acquire_pr_meta(event).await;
            if let Some(ref meta) = pr_meta {
                self.post_task_comment(meta, &new_task_links).await;
            }
        }

        // Track only validated task IDs in the repo
        if let Some(ref key) = github_key {
            self.repo
                .upsert_task_ids(key.clone(), &resolved_all.validated_task_ids)
                .await
                .inspect_err(|e| tracing::error!(error=?e, "failed to upsert task IDs"))
                .ok();
        }

        // Update status for all validated tasks
        self.update_task_statuses(&resolved_all.doc_ids, "In Review")
            .await;

        tracing::trace!("PR open handler complete");
        Ok(())
    }

    /// Handle `pull_request` events with action `edited`.
    ///
    /// Searches PR title/body/branch for task IDs, uses the repo to
    /// deduplicate, posts a bot comment for newly discovered tasks, and
    /// sets status to "In Review".
    #[tracing::instrument(skip(self, event), err)]
    pub(crate) async fn handle_pr_edit(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> Result<(), GithubError> {
        let searchable_texts = event.extract_searchable_text();
        let combined = searchable_texts.join(" ");
        let task_ids: Vec<MacroTaskId> = MacroTaskId::extract_from_text(&combined);

        tracing::trace!(
            task_id_count = task_ids.len(),
            task_ids = ?task_ids.iter().map(|t| t.to_task_id_string()).collect::<Vec<_>>(),
            "extracted task IDs from PR text"
        );

        if task_ids.is_empty() {
            tracing::debug!("no task IDs found in PR text");
            return Ok(());
        }

        // Resolve all extracted IDs against the document service to validate
        // they are actual task documents (filters out false positives like "macro-inc")
        let resolved_all = self.resolve_tasks(&task_ids).await;

        if resolved_all.validated_task_ids.is_empty() {
            tracing::debug!("no valid task documents found for extracted IDs");
            return Ok(());
        }

        let github_key = Self::github_key(event);

        // Determine which validated tasks are new for this PR
        let new_task_ids = if let Some(ref key) = github_key {
            self.repo
                .filter_duplicate_tasks(key.clone(), &resolved_all.validated_task_ids)
                .await
                .inspect_err(|e| tracing::error!(error=?e, "failed to filter duplicate tasks"))
                .unwrap_or_else(|_| resolved_all.validated_task_ids.clone())
        } else {
            resolved_all.validated_task_ids.clone()
        };

        // Post comment for newly discovered tasks
        if !new_task_ids.is_empty() {
            let new_task_id_set: HashSet<&MacroTaskId> = new_task_ids.iter().collect();
            let new_task_links: Vec<_> = resolved_all
                .validated_task_ids
                .iter()
                .zip(resolved_all.task_links.iter())
                .filter(|(id, _)| new_task_id_set.contains(id))
                .map(|(_, link)| link.clone())
                .collect();

            let pr_meta = self.acquire_pr_meta(event).await;
            if let Some(ref meta) = pr_meta {
                self.post_task_comment(meta, &new_task_links).await;
            }
        }

        // Track only validated task IDs in the repo
        if let Some(ref key) = github_key {
            self.repo
                .upsert_task_ids(key.clone(), &resolved_all.validated_task_ids)
                .await
                .inspect_err(|e| tracing::error!(error=?e, "failed to upsert task IDs"))
                .ok();
        }

        // Update status for all validated tasks
        self.update_task_statuses(&resolved_all.doc_ids, "In Review")
            .await;

        tracing::trace!("PR edit handler complete");
        Ok(())
    }

    /// Handle `pull_request` events with action `closed`.
    ///
    /// Gathers all tracked task IDs from the repo plus any from PR text.
    ///
    /// If the PR was merged, updates their status to "Completed". If the PR was
    /// closed without being merged, moves associated tasks back to "Not Started"
    /// (the TODO status) instead of canceling them.
    /// Does NOT post a new bot comment.
    #[tracing::instrument(skip(self, event), err)]
    pub(crate) async fn handle_pr_close(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> Result<(), GithubError> {
        let is_merged = event.is_merged();
        tracing::trace!(is_merged, "handling PR close");

        // Gather task IDs from PR title/body/branch
        let searchable_texts = event.extract_searchable_text();
        let combined = searchable_texts.join(" ");
        let mut task_id_set: HashSet<MacroTaskId> = MacroTaskId::extract_from_text(&combined)
            .into_iter()
            .collect();

        tracing::trace!(
            pr_text_task_ids = task_id_set.len(),
            task_ids = ?task_id_set.iter().map(|t| t.to_task_id_string()).collect::<Vec<_>>(),
            "extracted task IDs from PR text"
        );

        // Also include all previously tracked tasks from the repo
        // (these were already validated when they were stored)
        if let Some(key) = Self::github_key(event) {
            match self.repo.get_task_ids(key).await {
                Ok(repo_tasks) => {
                    tracing::trace!(
                        repo_task_count = repo_tasks.len(),
                        "fetched tracked task IDs from repo"
                    );
                    task_id_set.extend(repo_tasks);
                }
                Err(e) => {
                    tracing::error!(error=?e, "failed to get task IDs from repo");
                }
            }
        }

        if task_id_set.is_empty() {
            tracing::debug!("no task IDs found anywhere for PR close event");
            return Ok(());
        }

        let all_task_ids: Vec<_> = task_id_set.into_iter().collect();
        tracing::trace!(
            total_task_ids = all_task_ids.len(),
            task_ids = ?all_task_ids.iter().map(|t| t.to_task_id_string()).collect::<Vec<_>>(),
            "total task IDs for close event"
        );

        // resolve_tasks validates each ID is an actual task document
        let resolved = self.resolve_tasks(&all_task_ids).await;

        // No bot comment on close
        let status = if is_merged {
            "Completed"
        } else {
            "Not Started"
        };
        tracing::trace!(
            status,
            doc_count = resolved.doc_ids.len(),
            "updating task statuses for PR close"
        );
        self.update_task_statuses(&resolved.doc_ids, status).await;

        tracing::trace!("PR close handler complete");
        Ok(())
    }
}
