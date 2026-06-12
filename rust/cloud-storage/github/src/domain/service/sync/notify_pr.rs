//! GitHub pull request notification helpers.

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use documents::domain::ports::DocumentService;
use foreign_entity::domain::ports::ForeignEntityService;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::{
    GithubPrEventAction, GithubPrEventStatus, GithubPrNotificationCommon, GithubPrStatusChanged,
};
use notification::domain::{
    models::{Notification, SendNotificationRequestBuilder},
    service::NotificationIngress,
};

use crate::domain::{
    models::{
        EnrichedGithubPullRequest, GithubAppInstallationSource, GithubPullRequestStatus,
        ValidatedGithubWebhookEvent,
    },
    ports::{GithubSyncClient, GithubSyncRepo},
};

use super::{GithubSyncServiceImpl, PullRequestForeignEntityUpsert};

struct PullRequestStatusTransition {
    previous_status: Option<GithubPullRequestStatus>,
    status: GithubPullRequestStatus,
}

impl<
    D: DocumentService,
    R: GithubSyncRepo,
    C: GithubSyncClient,
    F: ForeignEntityService,
    N: NotificationIngress,
> GithubSyncServiceImpl<D, R, C, F, N>
{
    pub(super) async fn notify_pr_status_transitions(
        &self,
        event: &ValidatedGithubWebhookEvent,
        pull_request: &EnrichedGithubPullRequest,
        upserts: &[PullRequestForeignEntityUpsert],
    ) {
        let Some(action) = Self::github_pr_event_action(event) else {
            return;
        };

        let transitions: Vec<_> = upserts
            .iter()
            .filter_map(|upsert| {
                Self::status_transition(upsert).map(|transition| (upsert, transition))
            })
            .collect();
        if transitions.is_empty() {
            return;
        }

        let sender_id = self.notification_sender_id(event).await;
        for (upsert, transition) in transitions {
            let recipient_ids = self.notification_recipient_ids(&upsert.source).await;
            if recipient_ids.is_empty() {
                tracing::trace!(
                    source_id=%upsert.source.source_id(),
                    source_type=%upsert.source.source_type(),
                    foreign_entity_id=%upsert.foreign_entity_id,
                    "skipping GitHub PR notification without recipients"
                );
                continue;
            }

            let notification = Self::github_pr_status_changed(
                event,
                pull_request,
                upsert.foreign_entity_id,
                action,
                transition,
            );
            self.send_github_notification(
                notification,
                upsert.foreign_entity_id,
                sender_id.clone(),
                recipient_ids,
            )
            .await;
        }
    }

    /// Send a GitHub pull request notification over the connection gateway,
    /// logging (rather than propagating) delivery failures.
    pub(super) async fn send_github_notification<T: Notification + Clone + 'static>(
        &self,
        notification: T,
        foreign_entity_id: uuid::Uuid,
        sender_id: Option<MacroUserIdStr<'static>>,
        recipient_ids: HashSet<MacroUserIdStr<'static>>,
    ) {
        let notification_entity =
            EntityType::ForeignEntity.with_entity_string(foreign_entity_id.to_string());
        let request = SendNotificationRequestBuilder {
            notification_entity,
            notification,
            sender_id,
            recipient_ids,
        }
        .into_request()
        .with_conn_gateway();

        if let Err(error) = self.notification_ingress.send_notification(request).await {
            tracing::error!(
                error=?error,
                notification_type=%T::TYPE_NAME,
                foreign_entity_id=%foreign_entity_id,
                "failed to send GitHub PR notification"
            );
        }
    }

    /// Whether the webhook event was triggered by a bot account (including the
    /// Macro GitHub App itself, whose task-link comments echo back as
    /// `issue_comment` webhooks).
    pub(super) fn is_bot_sender(event: &ValidatedGithubWebhookEvent) -> bool {
        Self::payload_string(&event.payload, &["sender", "type"]).as_deref() == Some("Bot")
    }

    fn status_transition(
        upsert: &PullRequestForeignEntityUpsert,
    ) -> Option<PullRequestStatusTransition> {
        let status = upsert.status?;
        if upsert.previous_status == Some(status) {
            return None;
        }

        Some(PullRequestStatusTransition {
            previous_status: upsert.previous_status,
            status,
        })
    }

    pub(super) async fn notification_recipient_ids(
        &self,
        source: &GithubAppInstallationSource,
    ) -> HashSet<MacroUserIdStr<'static>> {
        match source {
            GithubAppInstallationSource::Team(team_id) => self.team_recipient_ids(*team_id).await,
            GithubAppInstallationSource::User(user_id) => {
                match MacroUserIdStr::try_from(user_id.clone()) {
                    Ok(user_id) => HashSet::from([user_id]),
                    Err(error) => {
                        tracing::warn!(
                            error=?error,
                            source_id=%user_id,
                            "skipping GitHub PR notification for invalid user source"
                        );
                        HashSet::new()
                    }
                }
            }
        }
    }

    async fn team_recipient_ids(&self, team_id: uuid::Uuid) -> HashSet<MacroUserIdStr<'static>> {
        match self.repo.get_team_member_ids(team_id).await {
            Ok(member_ids) => member_ids.into_iter().collect(),
            Err(error) => {
                tracing::error!(
                    error=?error,
                    team_id=%team_id,
                    "failed to expand GitHub PR notification team recipients"
                );
                HashSet::new()
            }
        }
    }

    pub(super) async fn notification_sender_id(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> Option<MacroUserIdStr<'static>> {
        let github_user_id = event.sender_github_user_id()?;
        let macro_id = match self
            .repo
            .get_macro_id_by_github_user_id(&github_user_id)
            .await
        {
            Ok(Some(macro_id)) => macro_id,
            Ok(None) => return None,
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    sender_github_user_id=%github_user_id,
                    "failed to map GitHub PR notification sender"
                );
                return None;
            }
        };

        match MacroUserIdStr::try_from(macro_id.clone()) {
            Ok(sender_id) => Some(sender_id),
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    macro_id=%macro_id,
                    sender_github_user_id=%github_user_id,
                    "GitHub PR notification sender mapping is not a valid Macro user ID"
                );
                None
            }
        }
    }

    /// Build the metadata fields shared by every GitHub pull request notification type.
    pub(super) fn github_pr_common(
        event: &ValidatedGithubWebhookEvent,
        pull_request: &EnrichedGithubPullRequest,
        foreign_entity_id: uuid::Uuid,
    ) -> GithubPrNotificationCommon {
        GithubPrNotificationCommon {
            foreign_entity_id,
            github_key: pull_request.github_key.clone(),
            owner: pull_request.owner.clone(),
            repo: pull_request.repo.clone(),
            number: pull_request.number,
            url: pull_request.url.clone(),
            display_name: pull_request.display_name.clone(),
            title: GithubPrNotificationCommon::title_or_display_name(
                pull_request.name.clone(),
                &pull_request.display_name,
            ),
            sender_github_login: Self::payload_string(&event.payload, &["sender", "login"]),
            sender_github_user_id: event.sender_github_user_id(),
            sender_github_avatar_url: Self::payload_string(
                &event.payload,
                &["sender", "avatar_url"],
            ),
        }
    }

    fn github_pr_status_changed(
        event: &ValidatedGithubWebhookEvent,
        pull_request: &EnrichedGithubPullRequest,
        foreign_entity_id: uuid::Uuid,
        action: GithubPrEventAction,
        transition: PullRequestStatusTransition,
    ) -> GithubPrStatusChanged {
        GithubPrStatusChanged {
            common: Self::github_pr_common(event, pull_request, foreign_entity_id),
            status: Self::github_pr_event_status(transition.status),
            action,
            previous_status: transition.previous_status.map(Self::github_pr_event_status),
            head_branch: Self::payload_string(&event.payload, &["pull_request", "head", "ref"]),
            base_branch: Self::payload_string(&event.payload, &["pull_request", "base", "ref"]),
            merged_at: Self::pull_request_merged_at(event),
        }
    }

    fn github_pr_event_action(event: &ValidatedGithubWebhookEvent) -> Option<GithubPrEventAction> {
        match event.action() {
            Some("opened") => Some(GithubPrEventAction::Opened),
            Some("reopened") => Some(GithubPrEventAction::Reopened),
            Some("closed") => Some(GithubPrEventAction::Closed),
            _ => None,
        }
    }

    fn github_pr_event_status(status: GithubPullRequestStatus) -> GithubPrEventStatus {
        match status {
            GithubPullRequestStatus::Open => GithubPrEventStatus::Open,
            GithubPullRequestStatus::Closed => GithubPrEventStatus::Closed,
            GithubPullRequestStatus::Merged => GithubPrEventStatus::Merged,
        }
    }

    pub(super) fn payload_string(payload: &serde_json::Value, path: &[&str]) -> Option<String> {
        let mut value = payload;
        for key in path {
            value = value.get(*key)?;
        }

        value
            .as_str()
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    fn pull_request_merged_at(event: &ValidatedGithubWebhookEvent) -> Option<DateTime<Utc>> {
        let merged_at = Self::payload_string(&event.payload, &["pull_request", "merged_at"])?;
        match DateTime::parse_from_rfc3339(&merged_at) {
            Ok(merged_at) => Some(merged_at.with_timezone(&Utc)),
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    merged_at,
                    "failed to parse GitHub PR merged_at timestamp for notification"
                );
                None
            }
        }
    }
}
