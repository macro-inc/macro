//! Issue comment, PR review, and PR review comment event handlers.

use crate::domain::{
    models::{GithubError, MacroTaskId, ValidatedGithubWebhookEvent},
    ports::{GithubSyncClient, GithubSyncRepo},
};
use documents::domain::ports::DocumentService;

use super::GithubSyncServiceImpl;

impl<D: DocumentService, R: GithubSyncRepo, C: GithubSyncClient> GithubSyncServiceImpl<D, R, C> {
    /// Handle `issue_comment`, `pull_request_review`, and
    /// `pull_request_review_comment` events.
    ///
    /// Extracts task IDs from the new comment/review text and deduplicates
    /// against tasks already tracked in the repo for this PR.
    #[tracing::instrument(skip(self, event), err)]
    pub(crate) async fn handle_comment_event(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> Result<(), GithubError> {
        // Extract task IDs from the new comment/review text only
        let searchable_texts = event.extract_searchable_text();
        let combined = searchable_texts.join(" ");
        let comment_task_ids: Vec<MacroTaskId> = MacroTaskId::extract_from_text(&combined);

        tracing::trace!(
            new_task_id_count = comment_task_ids.len(),
            task_ids = ?comment_task_ids.iter().map(|t| t.to_task_id_string()).collect::<Vec<_>>(),
            "extracted task IDs from comment/review text"
        );

        if comment_task_ids.is_empty() {
            tracing::debug!("no task IDs found in comment/review text");
            return Ok(());
        }

        let github_key = Self::github_key(event);

        // Ensure PR context task IDs are tracked in the repo (handles PRs
        // that existed before the tracking table was introduced).
        if let Some(ref key) = github_key {
            let pr_context_tasks = {
                let pr_context = event.extract_pr_context_text().join(" ");
                MacroTaskId::extract_from_text(&pr_context)
            };
            if !pr_context_tasks.is_empty() {
                tracing::trace!(
                    pr_context_task_count = pr_context_tasks.len(),
                    "upserting PR context task IDs"
                );
                self.repo
                    .upsert_task_ids(key.clone(), &pr_context_tasks)
                    .await
                    .inspect_err(
                        |e| tracing::error!(error=?e, "failed to upsert PR context task IDs"),
                    )
                    .ok();
            }
        }

        // Filter to only truly new task IDs using the repo
        let truly_new = if let Some(ref key) = github_key {
            self.repo
                .filter_duplicate_tasks(key.clone(), &comment_task_ids)
                .await
                .inspect_err(|e| tracing::error!(error=?e, "failed to filter duplicate tasks"))
                .unwrap_or_else(|_| comment_task_ids.clone())
        } else {
            comment_task_ids.clone()
        };

        tracing::trace!(
            truly_new_count = truly_new.len(),
            truly_new_task_ids = ?truly_new.iter().map(|t| t.to_task_id_string()).collect::<Vec<_>>(),
            "filtered to truly new task IDs"
        );

        if truly_new.is_empty() {
            tracing::debug!("all task IDs already tracked for this PR, skipping");
            return Ok(());
        }

        let resolved = self.resolve_tasks(&truly_new).await;

        let pr_meta = self.acquire_pr_meta(event).await;
        if let Some(ref meta) = pr_meta {
            self.post_task_comment(meta, &resolved.task_links).await;
        }

        // Track the new task IDs in the repo
        if let Some(ref key) = github_key {
            self.repo
                .upsert_task_ids(key.clone(), &comment_task_ids)
                .await
                .inspect_err(|e| tracing::error!(error=?e, "failed to upsert comment task IDs"))
                .ok();
        }

        // Only update status if the PR is open
        if let Some(status) = event.task_status_for_event() {
            self.update_task_statuses(&resolved.doc_ids, status).await;
        } else {
            tracing::trace!("no status update warranted for this event");
        }

        tracing::trace!("comment event handler complete");
        Ok(())
    }
}
