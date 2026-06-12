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
use model_notifications::{
    GithubPrComment, GithubPrCommentKind, GithubPrMention, GithubPrMentionLocation,
    GithubPrNotificationCommon, GithubReviewRequested,
};
use notification::domain::service::NotificationIngress;

use crate::domain::{
    models::{
        EnrichedGithubPullRequest, GithubWebhookEventType, ValidatedGithubWebhookEvent,
        extract_github_mentions,
    },
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

    /// Notify recipients that a pull request was commented on, and notify
    /// @mentioned users separately.
    ///
    /// Fires for `issue_comment` and `pull_request_review_comment` events with
    /// action `created`. Mentioned users receive only the more specific
    /// `github_pr_mention` notification; everyone else in the source receives
    /// `github_pr_comment`. Bot-authored comments (including the Macro app's
    /// own task-link comments) are skipped entirely.
    pub(super) async fn notify_pr_comment_and_mentions(
        &self,
        event: &ValidatedGithubWebhookEvent,
        pull_request: &EnrichedGithubPullRequest,
        upserts: &[PullRequestForeignEntityUpsert],
    ) {
        if Self::is_bot_sender(event) {
            tracing::trace!("skipping comment notification from bot sender");
            return;
        }

        let body = Self::payload_string(&event.payload, &["comment", "body"]).unwrap_or_default();
        let comment_github_id = event
            .payload
            .get("comment")
            .and_then(|comment| comment.get("id"))
            .and_then(|id| id.as_u64());
        let comment_url = Self::payload_string(&event.payload, &["comment", "html_url"]);
        let (comment_kind, mention_location) = match event.parsed_event_type() {
            GithubWebhookEventType::PullRequestReviewComment => (
                GithubPrCommentKind::ReviewComment,
                GithubPrMentionLocation::ReviewComment,
            ),
            _ => (GithubPrCommentKind::Issue, GithubPrMentionLocation::Comment),
        };

        let mentioned_users = self.mentioned_macro_users(&body).await;
        let snippet = GithubPrNotificationCommon::snippet(&body);
        let sender_id = self.notification_sender_id(event).await;
        for upsert in upserts {
            let recipients = self.notification_recipient_ids(&upsert.source).await;

            // Mention wins: mentioned users get only github_pr_mention.
            let mention_recipients: HashSet<_> =
                recipients.intersection(&mentioned_users).cloned().collect();
            let comment_recipients: HashSet<_> = recipients
                .difference(&mention_recipients)
                .cloned()
                .collect();

            if !mention_recipients.is_empty() {
                let notification = GithubPrMention {
                    common: Self::github_pr_common(event, pull_request, upsert.foreign_entity_id),
                    location: mention_location,
                    comment_github_id,
                    comment_url: comment_url.clone(),
                    text_snippet: snippet.clone(),
                };
                self.send_github_notification(
                    notification,
                    upsert.foreign_entity_id,
                    sender_id.clone(),
                    mention_recipients,
                )
                .await;
            }

            if !comment_recipients.is_empty() {
                let notification = GithubPrComment {
                    common: Self::github_pr_common(event, pull_request, upsert.foreign_entity_id),
                    comment_kind,
                    comment_github_id,
                    comment_url: comment_url.clone(),
                    comment_snippet: snippet.clone(),
                };
                self.send_github_notification(
                    notification,
                    upsert.foreign_entity_id,
                    sender_id.clone(),
                    comment_recipients,
                )
                .await;
            }
        }
    }

    /// Resolve the Macro users @mentioned in `text` via their `github_links`
    /// login mappings. Unmapped logins and invalid Macro IDs are skipped.
    async fn mentioned_macro_users(&self, text: &str) -> HashSet<MacroUserIdStr<'static>> {
        let logins = extract_github_mentions(text);
        if logins.is_empty() {
            return HashSet::new();
        }

        let links = match self.repo.get_macro_ids_by_github_logins(&logins).await {
            Ok(links) => links,
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    "failed to map GitHub mention logins to Macro users"
                );
                return HashSet::new();
            }
        };

        links
            .into_values()
            .flatten()
            .filter_map(
                |macro_id| match MacroUserIdStr::try_from(macro_id.clone()) {
                    Ok(user_id) => Some(user_id),
                    Err(error) => {
                        tracing::warn!(
                            error=?error,
                            macro_id=%macro_id,
                            "GitHub mention mapping is not a valid Macro user ID"
                        );
                        None
                    }
                },
            )
            .collect()
    }
}
