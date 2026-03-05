//! Issue comment, PR review, and PR review comment event handlers.

use crate::domain::{
    models::{GithubError, MacroTaskId, ValidatedGithubWebhookEvent},
    ports::GithubSyncClient,
};
use documents::domain::ports::DocumentService;
use std::collections::HashSet;

use super::GithubSyncServiceImpl;

impl<D: DocumentService, C: GithubSyncClient> GithubSyncServiceImpl<D, C> {
    /// Handle `issue_comment`, `pull_request_review`, and
    /// `pull_request_review_comment` events.
    ///
    /// Extracts task IDs from the new comment/review text and deduplicates
    /// against PR context text and all existing PR comments.
    #[tracing::instrument(skip(self, event), err)]
    pub(crate) async fn handle_comment_event(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> Result<(), GithubError> {
        // Extract task IDs from the new comment/review text only
        let searchable_texts = event.extract_searchable_text();
        let combined = searchable_texts.join(" ");
        let new_task_ids: HashSet<MacroTaskId> = MacroTaskId::extract_from_text(&combined)
            .into_iter()
            .collect();

        tracing::trace!(
            new_task_id_count = new_task_ids.len(),
            task_ids = ?new_task_ids.iter().map(|t| t.to_task_id_string()).collect::<Vec<_>>(),
            "extracted task IDs from comment/review text"
        );

        if new_task_ids.is_empty() {
            tracing::debug!("no task IDs found in comment/review text");
            return Ok(());
        }

        let pr_meta = self.acquire_pr_meta(event).await;

        // Build the set of pre-existing task IDs from PR context text + all
        // existing comment bodies
        let pr_context = event.extract_pr_context_text().join(" ");
        let mut existing_task_ids: HashSet<MacroTaskId> =
            MacroTaskId::extract_from_text(&pr_context)
                .into_iter()
                .collect();

        tracing::trace!(
            pr_context_task_ids = existing_task_ids.len(),
            existing_task_ids = ?existing_task_ids.iter().map(|t| t.to_task_id_string()).collect::<Vec<_>>(),
            "extracted pre-existing task IDs from PR context"
        );

        let existing_comments = if let Some(ref meta) = pr_meta {
            let comments = self.fetch_pr_comments(meta).await;
            let comment_combined = comments.join(" ");
            let comment_task_ids = MacroTaskId::extract_from_text(&comment_combined);
            tracing::trace!(
                comment_task_id_count = comment_task_ids.len(),
                comment_task_ids = ?comment_task_ids.iter().map(|t| t.to_task_id_string()).collect::<Vec<_>>(),
                "extracted task IDs from existing PR comments"
            );
            existing_task_ids.extend(comment_task_ids);
            comments
        } else {
            Vec::new()
        };

        // Filter to only task IDs that are truly new
        let truly_new: Vec<_> = new_task_ids
            .into_iter()
            .filter(|id| !existing_task_ids.contains(id))
            .collect();

        tracing::trace!(
            truly_new_count = truly_new.len(),
            truly_new_task_ids = ?truly_new.iter().map(|t| t.to_task_id_string()).collect::<Vec<_>>(),
            "filtered to truly new task IDs"
        );

        if truly_new.is_empty() {
            tracing::debug!(
                "all task IDs already present in PR context or prior comments, skipping"
            );
            return Ok(());
        }

        let resolved = self.resolve_tasks(&truly_new, &existing_comments).await;

        if let Some(ref meta) = pr_meta {
            self.post_task_comment(meta, &resolved.new_task_links).await;
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
