//! GitHub pull request activity notification emitters: review requests,
//! comments, mentions, and reviews.
//!
//! All emitters follow the same shape as `notify_pr_status_transitions`:
//! one notification per installation-source upsert, errors logged rather
//! than propagated, and targeted recipients intersected with the source's
//! recipient set so users are only notified through installations they
//! belong to. Broad comment fan-out is participant-scoped; review requests
//! and mentions stay explicitly targeted.

use std::collections::HashSet;

use documents::domain::ports::DocumentService;
use foreign_entity::domain::ports::ForeignEntityService;
use macro_user_id::user_id::MacroUserIdStr;
use model_notifications::{
    GithubPrComment, GithubPrCommentKind, GithubPrMention, GithubPrMentionLocation,
    GithubPrNotificationCommon, GithubPrReview, GithubPrReviewState, GithubReviewRequested,
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
    /// `github_pr_mention` notification; non-mentioned PR participants in the
    /// source receive `github_pr_comment`. Bot-authored comments (including
    /// the Macro app's own task-link comments) are skipped entirely.
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
        let participant_users = self
            .pull_request_participant_macro_user_ids(pull_request, upserts)
            .await;
        let snippet = GithubPrNotificationCommon::snippet(&body);
        let sender_id = self.notification_sender_id(event).await;
        for upsert in upserts {
            let source_recipients = self.notification_recipient_ids(&upsert.source).await;

            // Mention wins: mentioned users get only github_pr_mention.
            let mention_recipients: HashSet<_> = source_recipients
                .intersection(&mentioned_users)
                .cloned()
                .collect();
            let mut comment_recipients: HashSet<_> = source_recipients
                .intersection(&participant_users)
                .cloned()
                .collect();
            comment_recipients.retain(|recipient| !mention_recipients.contains(recipient));

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

    /// Notify the pull request author that a review was submitted, and notify
    /// users @mentioned in the review body.
    ///
    /// Fires for `pull_request_review` events with action `submitted`. The
    /// `github_pr_review` notification goes only to the PR author; mentioned
    /// users receive `github_pr_mention` (the author gets only the review
    /// notification when both apply). Bot reviews are skipped, as are empty
    /// `commented` reviews, which GitHub also fires alongside every
    /// `pull_request_review_comment` event.
    pub(super) async fn notify_pr_review(
        &self,
        event: &ValidatedGithubWebhookEvent,
        pull_request: &EnrichedGithubPullRequest,
        upserts: &[PullRequestForeignEntityUpsert],
    ) {
        if Self::is_bot_sender(event) {
            tracing::trace!("skipping review notification from bot sender");
            return;
        }

        let state = Self::payload_string(&event.payload, &["review", "state"]).unwrap_or_default();
        let body = Self::payload_string(&event.payload, &["review", "body"]).unwrap_or_default();
        let state = match state.as_str() {
            "approved" => GithubPrReviewState::Approved,
            "changes_requested" => GithubPrReviewState::ChangesRequested,
            "commented" if body.trim().is_empty() => {
                // GitHub submits an empty "commented" review with every inline
                // review comment; the comment itself already notifies.
                tracing::trace!("skipping empty commented review");
                return;
            }
            "commented" => GithubPrReviewState::Commented,
            other => {
                tracing::trace!(state=%other, "skipping review with unhandled state");
                return;
            }
        };

        let author = self.pull_request_author_macro_user(event).await;
        let review_github_id = event
            .payload
            .get("review")
            .and_then(|review| review.get("id"))
            .and_then(|id| id.as_u64());
        let review_url = Self::payload_string(&event.payload, &["review", "html_url"]);
        let review_snippet =
            (!body.trim().is_empty()).then(|| GithubPrNotificationCommon::snippet(&body));

        let mentioned_users = self.mentioned_macro_users(&body).await;
        let sender_id = self.notification_sender_id(event).await;
        for upsert in upserts {
            let recipients = self.notification_recipient_ids(&upsert.source).await;

            let review_recipient = author
                .as_ref()
                .filter(|author| recipients.contains(*author))
                .cloned();
            if let Some(review_recipient) = &review_recipient {
                let notification = GithubPrReview {
                    common: Self::github_pr_common(event, pull_request, upsert.foreign_entity_id),
                    review_github_id,
                    review_url: review_url.clone(),
                    state,
                    review_snippet: review_snippet.clone(),
                };
                self.send_github_notification(
                    notification,
                    upsert.foreign_entity_id,
                    sender_id.clone(),
                    HashSet::from([review_recipient.clone()]),
                )
                .await;
            }

            // Review wins for the author: drop them from the mention fan-out.
            let mut mention_recipients: HashSet<_> =
                recipients.intersection(&mentioned_users).cloned().collect();
            if let Some(review_recipient) = &review_recipient {
                mention_recipients.remove(review_recipient);
            }
            if !mention_recipients.is_empty() {
                let notification = GithubPrMention {
                    common: Self::github_pr_common(event, pull_request, upsert.foreign_entity_id),
                    location: GithubPrMentionLocation::Review,
                    comment_github_id: review_github_id,
                    comment_url: review_url.clone(),
                    text_snippet: GithubPrNotificationCommon::snippet(&body),
                };
                self.send_github_notification(
                    notification,
                    upsert.foreign_entity_id,
                    sender_id.clone(),
                    mention_recipients,
                )
                .await;
            }
        }
    }

    /// Notify users @mentioned in a pull request description.
    ///
    /// Fires for `pull_request` events with actions `opened` and `edited`.
    /// On `edited`, only mentions added relative to the previous body
    /// (`changes.body.from`) are notified, so re-editing a description does
    /// not re-notify existing mentions; an edit without a body change carries
    /// no `changes.body.from` and notifies nobody. Bot-authored bodies are
    /// skipped.
    pub(super) async fn notify_pr_body_mentions(
        &self,
        event: &ValidatedGithubWebhookEvent,
        pull_request: &EnrichedGithubPullRequest,
        upserts: &[PullRequestForeignEntityUpsert],
    ) {
        if Self::is_bot_sender(event) {
            tracing::trace!("skipping PR body mention notification from bot sender");
            return;
        }

        let body =
            Self::payload_string(&event.payload, &["pull_request", "body"]).unwrap_or_default();
        let mut logins = extract_github_mentions(&body);
        if event.action() == Some("edited") {
            // Key presence matters: an absent `changes.body.from` means the body
            // was not part of this edit, while a present-but-empty (or null) one
            // means the description was previously blank and every current
            // mention is new.
            let Some(previous_body) = event
                .payload
                .get("changes")
                .and_then(|changes| changes.get("body"))
                .and_then(|body| body.get("from"))
                .map(|from| from.as_str().unwrap_or_default())
            else {
                return;
            };
            let previous_logins: HashSet<String> =
                extract_github_mentions(previous_body).into_iter().collect();
            logins.retain(|login| !previous_logins.contains(login));
        }
        if logins.is_empty() {
            return;
        }

        let mentioned_users = self.macro_users_for_logins(&logins).await;
        if mentioned_users.is_empty() {
            return;
        }

        let comment_url = Self::payload_string(&event.payload, &["pull_request", "html_url"]);
        let snippet = GithubPrNotificationCommon::snippet(&body);
        let sender_id = self.notification_sender_id(event).await;
        for upsert in upserts {
            let recipients = self.notification_recipient_ids(&upsert.source).await;
            let mention_recipients: HashSet<_> =
                recipients.intersection(&mentioned_users).cloned().collect();
            if mention_recipients.is_empty() {
                continue;
            }

            let notification = GithubPrMention {
                common: Self::github_pr_common(event, pull_request, upsert.foreign_entity_id),
                location: GithubPrMentionLocation::PrBody,
                comment_github_id: None,
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
    }

    /// Resolve the pull request author from `pull_request.user.id` to a Macro
    /// user via `github_links`. Returns `None` (with a trace) when unmapped.
    async fn pull_request_author_macro_user(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> Option<MacroUserIdStr<'static>> {
        let author_github_user_id = event
            .payload
            .get("pull_request")
            .and_then(|pull_request| pull_request.get("user"))
            .and_then(|user| user.get("id"))
            .and_then(|id| id.as_u64())
            .map(|id| id.to_string())?;

        let macro_id = match self
            .repo
            .get_macro_id_by_github_user_id(&author_github_user_id)
            .await
        {
            Ok(Some(macro_id)) => macro_id,
            Ok(None) => {
                tracing::trace!(
                    author_github_user_id=%author_github_user_id,
                    "pull request author has no Macro mapping"
                );
                return None;
            }
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    author_github_user_id=%author_github_user_id,
                    "failed to map pull request author"
                );
                return None;
            }
        };

        match MacroUserIdStr::try_from(macro_id.clone()) {
            Ok(author) => Some(author),
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    macro_id=%macro_id,
                    "pull request author mapping is not a valid Macro user ID"
                );
                None
            }
        }
    }

    /// Resolve the Macro users @mentioned in `text` via their `github_links`
    /// login mappings. Unmapped logins and invalid Macro IDs are skipped.
    async fn mentioned_macro_users(&self, text: &str) -> HashSet<MacroUserIdStr<'static>> {
        self.macro_users_for_logins(&extract_github_mentions(text))
            .await
    }

    /// Resolve GitHub logins to Macro users via their `github_links` login
    /// mappings. Unmapped logins and invalid Macro IDs are skipped.
    async fn macro_users_for_logins(&self, logins: &[String]) -> HashSet<MacroUserIdStr<'static>> {
        if logins.is_empty() {
            return HashSet::new();
        }

        let links = match self.repo.get_macro_ids_by_github_logins(logins).await {
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
