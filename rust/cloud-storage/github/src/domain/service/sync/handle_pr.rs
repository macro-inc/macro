//! PR open/edit/close event handlers.

use crate::domain::{
    models::{GithubError, MacroTaskId, ValidatedGithubWebhookEvent},
    ports::GithubSyncClient,
};
use documents::domain::ports::DocumentService;
use std::collections::HashSet;

use super::GithubSyncServiceImpl;

impl<D: DocumentService, C: GithubSyncClient> GithubSyncServiceImpl<D, C> {
    /// Handle `pull_request` events with action `opened` or `reopened`.
    ///
    /// Only looks at PR title/body/branch for task IDs — does not fetch
    /// existing comments.
    pub(crate) async fn handle_pr_open(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> Result<(), GithubError> {
        let searchable_texts = event.extract_searchable_text();
        let combined = searchable_texts.join(" ");
        let task_ids = MacroTaskId::extract_from_text(&combined);

        if task_ids.is_empty() {
            tracing::debug!("no task IDs found in PR text");
            return Ok(());
        }

        let pr_meta = self.acquire_pr_meta(event).await;

        // Fetch existing comments only for dedup (don't extract task IDs from them)
        let existing_comments = if let Some(ref meta) = pr_meta {
            self.fetch_pr_comments(meta).await
        } else {
            Vec::new()
        };

        let resolved = self.resolve_tasks(&task_ids, &existing_comments).await;

        if let Some(ref meta) = pr_meta {
            self.post_task_comment(meta, &resolved.new_task_links).await;
        }

        self.update_task_statuses(&resolved.doc_ids, "In Review")
            .await;

        Ok(())
    }

    /// Handle `pull_request` events with action `edited`.
    ///
    /// Searches PR title/body/branch and existing PR comments for task IDs,
    /// posts a bot comment for any newly discovered tasks, and sets status to
    /// "In Review".
    pub(crate) async fn handle_pr_edit(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> Result<(), GithubError> {
        let searchable_texts = event.extract_searchable_text();
        let combined = searchable_texts.join(" ");
        let mut task_id_set: HashSet<MacroTaskId> = MacroTaskId::extract_from_text(&combined)
            .into_iter()
            .collect();

        if task_id_set.is_empty() {
            tracing::debug!("no task IDs found in PR text");
            return Ok(());
        }

        let pr_meta = self.acquire_pr_meta(event).await;

        // For edits, also search existing comments for additional task IDs
        let existing_comments = if let Some(ref meta) = pr_meta {
            let comments = self.fetch_pr_comments(meta).await;
            let comment_combined = comments.join(" ");
            let comment_task_ids = MacroTaskId::extract_from_text(&comment_combined);
            task_id_set.extend(comment_task_ids);
            comments
        } else {
            Vec::new()
        };

        let all_task_ids: Vec<_> = task_id_set.into_iter().collect();
        let resolved = self.resolve_tasks(&all_task_ids, &existing_comments).await;

        if let Some(ref meta) = pr_meta {
            self.post_task_comment(meta, &resolved.new_task_links).await;
        }

        self.update_task_statuses(&resolved.doc_ids, "In Review")
            .await;

        Ok(())
    }

    /// Handle `pull_request` events with action `closed`.
    ///
    /// Always fetches comments since tasks may only exist there. Does NOT post
    /// a new bot comment (PR is closing). Updates task status to "Completed"
    /// (if merged) or "Canceled" (if closed without merge).
    pub(crate) async fn handle_pr_close(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> Result<(), GithubError> {
        let pr_meta = self.acquire_pr_meta(event).await;

        // Gather task IDs from PR title/body/branch
        let searchable_texts = event.extract_searchable_text();
        let combined = searchable_texts.join(" ");
        let mut task_id_set: HashSet<MacroTaskId> = MacroTaskId::extract_from_text(&combined)
            .into_iter()
            .collect();

        // Always fetch comments — tasks may only exist there
        if let Some(ref meta) = pr_meta {
            let comments = self.fetch_pr_comments(meta).await;
            let comment_combined = comments.join(" ");
            let comment_task_ids = MacroTaskId::extract_from_text(&comment_combined);
            task_id_set.extend(comment_task_ids);
        }

        if task_id_set.is_empty() {
            tracing::debug!("no task IDs found anywhere for PR close event");
            return Ok(());
        }

        let all_task_ids: Vec<_> = task_id_set.into_iter().collect();
        // Empty existing_comments — no comment dedup needed since we won't post
        let resolved = self.resolve_tasks(&all_task_ids, &[]).await;

        // No bot comment on close

        let status = if event.is_merged() {
            "Completed"
        } else {
            "Canceled"
        };
        self.update_task_statuses(&resolved.doc_ids, status).await;

        Ok(())
    }
}
