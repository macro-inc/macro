//! GitHub pull request activity notification emitters: review requests,
//! comments, mentions, and reviews.
//!
//! All emitters follow the same shape as `notify_pr_status_transitions`:
//! one notification per installation-source upsert, errors logged rather
//! than propagated, and targeted recipients intersected with the source's
//! recipient set so users are only notified through installations they
//! belong to.

use std::collections::HashSet;

use documents::domain::ports::DocumentService;
use foreign_entity::domain::ports::ForeignEntityService;
use macro_user_id::user_id::MacroUserIdStr;
use model_notifications::GithubReviewRequested;
use notification::domain::service::NotificationIngress;

use crate::domain::{
    models::{EnrichedGithubPullRequest, ValidatedGithubWebhookEvent},
    ports::{GithubSyncClient, GithubSyncRepo},
};

use super::{GithubSyncServiceImpl, PullRequestForeignEntityUpsert};

impl<
    D: DocumentService,
    R: GithubSyncRepo,
    C: GithubSyncClient,
    F: ForeignEntityService,
    N: NotificationIngress,
> GithubSyncServiceImpl<D, R, C, F, N>
{
    /// Notify the requested reviewer that their review was requested on a
    /// pull request.
    ///
    /// Fires for `pull_request` events with action `review_requested`. The
    /// notification goes only to the requested reviewer, and only through
    /// sources whose recipients include them. Team review requests
    /// (`requested_team`) and reviewers without a `github_links` mapping are
    /// skipped.
    pub(super) async fn notify_review_requested(
        &self,
        event: &ValidatedGithubWebhookEvent,
        pull_request: &EnrichedGithubPullRequest,
        upserts: &[PullRequestForeignEntityUpsert],
    ) {
        let Some(reviewer_github_user_id) = event
            .payload
            .get("requested_reviewer")
            .and_then(|reviewer| reviewer.get("id"))
            .and_then(|id| id.as_u64())
            .map(|id| id.to_string())
        else {
            tracing::trace!(
                "skipping review-requested notification without a requested_reviewer user"
            );
            return;
        };

        let reviewer_macro_id = match self
            .repo
            .get_macro_id_by_github_user_id(&reviewer_github_user_id)
            .await
        {
            Ok(Some(macro_id)) => macro_id,
            Ok(None) => {
                tracing::trace!(
                    reviewer_github_user_id=%reviewer_github_user_id,
                    "skipping review-requested notification for unmapped reviewer"
                );
                return;
            }
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    reviewer_github_user_id=%reviewer_github_user_id,
                    "failed to map review-requested reviewer"
                );
                return;
            }
        };
        let reviewer = match MacroUserIdStr::try_from(reviewer_macro_id.clone()) {
            Ok(reviewer) => reviewer,
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    macro_id=%reviewer_macro_id,
                    "review-requested reviewer mapping is not a valid Macro user ID"
                );
                return;
            }
        };

        let reviewer_login = Self::payload_string(&event.payload, &["requested_reviewer", "login"]);
        let sender_id = self.notification_sender_id(event).await;
        for upsert in upserts {
            let recipients = self.notification_recipient_ids(&upsert.source).await;
            if !recipients.contains(&reviewer) {
                tracing::trace!(
                    source_id=%upsert.source.source_id(),
                    source_type=%upsert.source.source_type(),
                    foreign_entity_id=%upsert.foreign_entity_id,
                    "skipping review-requested notification for reviewer outside source recipients"
                );
                continue;
            }

            let notification = GithubReviewRequested {
                common: Self::github_pr_common(event, pull_request, upsert.foreign_entity_id),
                requested_reviewer_github_login: reviewer_login.clone(),
                requested_reviewer_github_user_id: Some(reviewer_github_user_id.clone()),
            };
            self.send_github_notification(
                notification,
                upsert.foreign_entity_id,
                sender_id.clone(),
                HashSet::from([reviewer.clone()]),
            )
            .await;
        }
    }
}
