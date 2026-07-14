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

/// The webhook actor resolved to Macro users via `github_links`.
///
/// `sender_id` is the single Macro user a notification is attributed to. A
/// GitHub account may be linked to several Macro users, so `actor_user_ids`
/// carries every linked user; `send_github_notification` excludes all of them
/// from recipients so nobody is notified about their own GitHub activity.
#[derive(Default)]
pub(super) struct NotificationSender {
    sender_id: Option<MacroUserIdStr<'static>>,
    actor_user_ids: HashSet<MacroUserIdStr<'static>>,
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

        let participant_user_ids = self
            .pull_request_participant_macro_user_ids(pull_request, upserts)
            .await;
        if participant_user_ids.is_empty() {
            return;
        }

        let sender = self.notification_sender(event).await;
        for (upsert, transition) in transitions {
            let recipient_ids = self
                .participant_scoped_recipient_ids(&upsert.source, &participant_user_ids)
                .await;
            if recipient_ids.is_empty() {
                tracing::trace!(
                    source_id=%upsert.source.source_id(),
                    source_type=%upsert.source.source_type(),
                    foreign_entity_id=%upsert.foreign_entity_id,
                    "skipping GitHub PR status notification without participant-scoped recipients"
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
                &sender,
                recipient_ids,
            )
            .await;
        }
    }

    /// Send a GitHub pull request notification over the connection gateway,
    /// logging (rather than propagating) delivery failures.
    ///
    /// Every Macro user linked to the actor's GitHub account is dropped from
    /// the recipients: users should not be notified about their own GitHub
    /// activity, and the notification service's sender exclusion only knows
    /// the single attributed `sender_id`.
    pub(super) async fn send_github_notification<T: Notification + Clone + 'static>(
        &self,
        notification: T,
        foreign_entity_id: uuid::Uuid,
        sender: &NotificationSender,
        mut recipient_ids: HashSet<MacroUserIdStr<'static>>,
    ) {
        recipient_ids.retain(|recipient| !sender.actor_user_ids.contains(recipient));
        if recipient_ids.is_empty() {
            tracing::trace!(
                notification_type=%T::TYPE_NAME,
                foreign_entity_id=%foreign_entity_id,
                "skipping GitHub PR notification with no recipients besides the actor"
            );
            return;
        }

        let notification_entity =
            EntityType::ForeignEntity.with_entity_string(foreign_entity_id.to_string());
        let request = SendNotificationRequestBuilder {
            notification_entity,
            secondary_notification_entity: None,
            notification,
            sender_id: sender.sender_id.clone(),
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

    pub(super) async fn pull_request_participant_macro_user_ids(
        &self,
        pull_request: &EnrichedGithubPullRequest,
        upserts: &[PullRequestForeignEntityUpsert],
    ) -> HashSet<MacroUserIdStr<'static>> {
        let github_user_ids = Self::pull_request_participant_github_user_ids(pull_request, upserts);
        if github_user_ids.is_empty() {
            tracing::trace!("skipping GitHub PR notification without participant GitHub user IDs");
            return HashSet::new();
        }

        let user_ids = self.macro_users_for_github_user_ids(&github_user_ids).await;
        if user_ids.is_empty() {
            tracing::trace!(
                participant_github_user_count = github_user_ids.len(),
                "skipping GitHub PR notification without mapped participant users"
            );
        }

        user_ids
    }

    fn pull_request_participant_github_user_ids(
        pull_request: &EnrichedGithubPullRequest,
        upserts: &[PullRequestForeignEntityUpsert],
    ) -> HashSet<String> {
        let mut github_user_ids = HashSet::new();

        if let Some(ids) = &pull_request.participant_github_user_ids {
            github_user_ids.extend(ids.iter().filter(|id| !id.is_empty()).cloned());
        }

        for upsert in upserts {
            github_user_ids.extend(
                upsert
                    .participant_github_user_ids
                    .iter()
                    .filter(|id| !id.is_empty())
                    .cloned(),
            );
        }

        github_user_ids
    }

    async fn macro_users_for_github_user_ids(
        &self,
        github_user_ids: &HashSet<String>,
    ) -> HashSet<MacroUserIdStr<'static>> {
        if github_user_ids.is_empty() {
            return HashSet::new();
        }

        let github_user_ids: Vec<String> = github_user_ids.iter().cloned().collect();
        let links = match self
            .repo
            .get_macro_ids_by_github_user_ids(&github_user_ids)
            .await
        {
            Ok(links) => links,
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    "failed to map GitHub PR participants"
                );
                return HashSet::new();
            }
        };

        let mut user_ids = HashSet::new();
        for (github_user_id, macro_ids) in links {
            if macro_ids.is_empty() {
                tracing::trace!(
                    participant_github_user_id=%github_user_id,
                    "GitHub PR participant has no Macro user mapping"
                );
                continue;
            }

            for macro_id in macro_ids {
                match MacroUserIdStr::try_from(macro_id.clone()) {
                    Ok(user_id) => {
                        user_ids.insert(user_id);
                    }
                    Err(error) => {
                        tracing::warn!(
                            error=?error,
                            macro_id=%macro_id,
                            participant_github_user_id=%github_user_id,
                            "GitHub PR participant mapping is not a valid Macro user ID"
                        );
                    }
                }
            }
        }

        user_ids
    }

    pub(super) async fn participant_scoped_recipient_ids(
        &self,
        source: &GithubAppInstallationSource,
        participant_user_ids: &HashSet<MacroUserIdStr<'static>>,
    ) -> HashSet<MacroUserIdStr<'static>> {
        if participant_user_ids.is_empty() {
            return HashSet::new();
        }

        self.notification_recipient_ids(source)
            .await
            .intersection(participant_user_ids)
            .cloned()
            .collect()
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

    pub(super) async fn notification_sender(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> NotificationSender {
        let Some(github_user_id) = event.sender_github_user_id() else {
            return NotificationSender::default();
        };
        let links = match self
            .repo
            .get_macro_ids_by_github_user_ids(std::slice::from_ref(&github_user_id))
            .await
        {
            Ok(links) => links,
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    sender_github_user_id=%github_user_id,
                    "failed to map GitHub PR notification sender"
                );
                return NotificationSender::default();
            }
        };

        let mut sender = NotificationSender::default();
        for macro_id in links.get(&github_user_id).into_iter().flatten() {
            match MacroUserIdStr::try_from(macro_id.clone()) {
                Ok(user_id) => {
                    // A notification has a single sender; many Macro users may
                    // share one GitHub account, so attribute to the first
                    // mapped user but track all of them as the actor.
                    if sender.sender_id.is_none() {
                        sender.sender_id = Some(user_id.clone());
                    }
                    sender.actor_user_ids.insert(user_id);
                }
                Err(error) => {
                    tracing::warn!(
                        error=?error,
                        macro_id=%macro_id,
                        sender_github_user_id=%github_user_id,
                        "GitHub PR notification sender mapping is not a valid Macro user ID"
                    );
                }
            }
        }

        sender
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
