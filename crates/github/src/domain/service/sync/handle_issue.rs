//! Standalone GitHub issue (`issues` webhook) event handlers.
//!
//! Mirrors the `pull_request` handlers in [`super::handle_pr`], but for
//! issues that are not backed by a pull request (see
//! [`ValidatedGithubWebhookEvent::is_issue`]). Extracts task references from
//! the issue title/body, tracks them under an `owner/repo/issues/number`
//! key (issues share GitHub's numbering space with PRs, so the `pull` key
//! format must not be reused), posts a bot comment for newly discovered
//! tasks, and moves task statuses via
//! [`ValidatedGithubWebhookEvent::task_status_for_event`].

use std::collections::HashSet;

use crate::domain::{
    models::{GithubError, MacroTaskId, ValidatedGithubWebhookEvent},
    ports::{GithubSyncClient, GithubSyncRealtime, GithubSyncRepo},
};
use documents::domain::ports::DocumentService;
use github_pull_requests::domain::ports::GithubPullRequestService;
use notification::domain::service::NotificationIngress;

use super::GithubSyncServiceImpl;

impl<
    D: DocumentService,
    R: GithubSyncRepo,
    C: GithubSyncClient,
    G: GithubPullRequestService,
    N: NotificationIngress,
    P: GithubSyncRealtime,
> GithubSyncServiceImpl<D, R, C, G, N, P>
{
    /// Handle `issues` webhook events for standalone issues.
    ///
    /// PR-backed `issues` events never reach here (the dispatcher routes them
    /// to the pull request pipeline); this is a defensive second guard.
    #[tracing::instrument(
        skip(self, event),
        fields(
            repository_id = ?event.repository_id(),
            issue_number = ?event.issue_number(),
        ),
        err
    )]
    pub(crate) async fn handle_issue_event(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> Result<(), GithubError> {
        if !event.is_issue() {
            tracing::debug!("skipping non-standalone issues event");
            return Ok(());
        }

        let action = event.action();
        tracing::trace!(?action, "handling issues event");

        match action {
            Some(
                "opened" | "reopened" | "edited" | "labeled" | "unlabeled" | "assigned"
                | "unassigned" | "milestoned" | "demilestoned",
            ) => self.handle_issue_sync(event).await,
            Some("closed") => self.handle_issue_close(event).await,
            // deleted, transferred, pinned, etc.: no task linkage to maintain.
            _ => {
                tracing::debug!(?action, "skipping unhandled issues action");
                Ok(())
            }
        }
    }

    /// Track task references from the issue title/body.
    ///
    /// Applies the status from [`ValidatedGithubWebhookEvent::task_status_for_event`]
    /// when the action warrants one (`opened`/`reopened` → `Not Started`).
    #[tracing::instrument(
        skip(self, event),
        fields(
            repository_id = ?event.repository_id(),
            issue_number = ?event.issue_number(),
            task_id_count = tracing::field::Empty,
            resolved_task_count = tracing::field::Empty,
            new_task_count = tracing::field::Empty,
            status = tracing::field::Empty,
        ),
        err
    )]
    async fn handle_issue_sync(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> Result<(), GithubError> {
        let searchable_texts = event.extract_searchable_text();
        let combined = searchable_texts.join(" ");
        let task_ids = self.extract_task_ids_from_text(event, &combined).await;

        tracing::trace!(
            task_id_count = task_ids.len(),
            task_ids = ?task_ids.iter().map(|t| t.to_task_id_string()).collect::<Vec<_>>(),
            "extracted task IDs from issue text"
        );
        tracing::Span::current().record("task_id_count", task_ids.len() as u64);

        if task_ids.is_empty() {
            tracing::debug!("no task IDs found in issue text");
            return Ok(());
        }

        let resolved = self.resolve_tasks(&task_ids).await;

        tracing::Span::current().record(
            "resolved_task_count",
            resolved.validated_task_ids.len() as u64,
        );

        if resolved.validated_task_ids.is_empty() {
            tracing::debug!("no valid task documents found for extracted IDs");
            return Ok(());
        }

        let github_key = Self::github_issue_key(event);

        let new_task_ids = if let Some(ref key) = github_key {
            self.repo
                .filter_duplicate_tasks(key.clone(), &resolved.validated_task_ids)
                .await
                .inspect_err(|e| tracing::error!(error=?e, "failed to filter duplicate tasks"))
                .unwrap_or_else(|_| resolved.validated_task_ids.clone())
        } else {
            resolved.validated_task_ids.clone()
        };
        tracing::Span::current().record("new_task_count", new_task_ids.len() as u64);

        if !new_task_ids.is_empty() {
            let new_task_id_set: HashSet<&MacroTaskId> = new_task_ids.iter().collect();
            let new_task_links: Vec<_> = resolved
                .validated_task_ids
                .iter()
                .zip(resolved.task_links.iter())
                .filter(|(id, _)| new_task_id_set.contains(id))
                .map(|(_, link)| link.clone())
                .collect();

            // `acquire_pr_meta` resolves the number via `pull_number()`, which
            // falls back to `issue.number`; the issues comment endpoint is the
            // same one `create_pr_comment` already posts through.
            let issue_meta = self.acquire_pr_meta(event).await;
            if let Some(ref meta) = issue_meta {
                self.post_task_comment(meta, &new_task_links).await;
            }
        }

        if let Some(ref key) = github_key {
            self.repo
                .upsert_task_ids(key.clone(), &resolved.validated_task_ids)
                .await
                .inspect_err(|e| tracing::error!(error=?e, "failed to upsert task IDs"))
                .ok();
        }

        if let Some(status) = event.task_status_for_event() {
            tracing::Span::current().record("status", status);
            self.update_task_statuses(&resolved.doc_ids, status).await;
        } else {
            tracing::trace!("no status update warranted for this issues event");
        }

        tracing::trace!("issues sync handler complete");
        Ok(())
    }

    /// Handle `issues` events with action `closed`.
    ///
    /// Gathers task IDs from the issue title/body plus every task previously
    /// tracked for the issue, then moves them to `Completed` (closed as
    /// completed) or back to `Not Started` (closed as not planned/duplicate).
    /// Does NOT post a new bot comment.
    #[tracing::instrument(
        skip(self, event),
        fields(
            repository_id = ?event.repository_id(),
            issue_number = ?event.issue_number(),
            issue_text_task_count = tracing::field::Empty,
            total_task_count = tracing::field::Empty,
            resolved_task_count = tracing::field::Empty,
            status = tracing::field::Empty,
        ),
        err
    )]
    async fn handle_issue_close(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> Result<(), GithubError> {
        let searchable_texts = event.extract_searchable_text();
        let combined = searchable_texts.join(" ");
        let mut task_id_set: HashSet<MacroTaskId> = self
            .extract_task_ids_from_text(event, &combined)
            .await
            .into_iter()
            .collect();

        tracing::trace!(
            issue_text_task_id_count = task_id_set.len(),
            task_ids = ?task_id_set.iter().map(|t| t.to_task_id_string()).collect::<Vec<_>>(),
            "extracted task IDs from issue text"
        );
        tracing::Span::current().record("issue_text_task_count", task_id_set.len() as u64);

        if let Some(key) = Self::github_issue_key(event) {
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
            tracing::debug!("no task IDs found anywhere for issues close event");
            return Ok(());
        }

        tracing::Span::current().record("total_task_count", task_id_set.len() as u64);

        let all_task_ids: Vec<_> = task_id_set.into_iter().collect();
        let resolved = self.resolve_tasks(&all_task_ids).await;

        let status = event.task_status_for_event().unwrap_or("Not Started");
        tracing::Span::current().record("resolved_task_count", resolved.doc_ids.len() as u64);
        tracing::Span::current().record("status", status);
        tracing::trace!(
            status,
            doc_count = resolved.doc_ids.len(),
            "updating task statuses for issues close"
        );
        self.update_task_statuses(&resolved.doc_ids, status).await;

        tracing::trace!("issues close handler complete");
        Ok(())
    }
}
