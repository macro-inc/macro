//! GitHub pull request check-run notification helpers.

use chrono::{DateTime, Utc};
use documents::domain::ports::DocumentService;
use foreign_entity::domain::ports::ForeignEntityService;
use model_notifications::{GithubPrCheckRun, GithubPrCheckRunState};
use notification::domain::service::NotificationIngress;

use crate::domain::{
    models::{EnrichedGithubPullRequest, ValidatedGithubWebhookEvent},
    ports::{GithubSyncClient, GithubSyncRepo},
};

use super::{GithubSyncServiceImpl, PullRequestForeignEntityUpsert};

struct CheckRunNotificationFields {
    check_run_github_id: u64,
    check_name: String,
    check_status: String,
    conclusion: String,
    state: GithubPrCheckRunState,
    check_url: String,
    completed_at: DateTime<Utc>,
}

impl<
    D: DocumentService,
    R: GithubSyncRepo,
    C: GithubSyncClient,
    F: ForeignEntityService,
    N: NotificationIngress,
> GithubSyncServiceImpl<D, R, C, F, N>
{
    /// Notify pull request participants when an associated GitHub check run finishes.
    ///
    /// Fires only for completed `check_run` webhooks whose conclusion is either successful or
    /// failure-like. Recipients are scoped to PR participants that also belong to the installation
    /// source that owns the foreign entity.
    pub(super) async fn notify_pr_check_run(
        &self,
        event: &ValidatedGithubWebhookEvent,
        pull_request: &EnrichedGithubPullRequest,
        upserts: &[PullRequestForeignEntityUpsert],
    ) {
        let Some(check_run) = Self::check_run_notification_fields(event) else {
            return;
        };

        let participant_user_ids = self
            .pull_request_participant_macro_user_ids(pull_request, upserts)
            .await;
        if participant_user_ids.is_empty() {
            return;
        }

        let sender_id = self.notification_sender_id(event).await;
        for upsert in upserts {
            let recipient_ids = self
                .participant_scoped_recipient_ids(&upsert.source, &participant_user_ids)
                .await;
            if recipient_ids.is_empty() {
                tracing::trace!(
                    source_id=%upsert.source.source_id(),
                    source_type=%upsert.source.source_type(),
                    foreign_entity_id=%upsert.foreign_entity_id,
                    "skipping GitHub PR check-run notification without participant-scoped recipients"
                );
                continue;
            }

            let notification = Self::github_pr_check_run(
                event,
                pull_request,
                upsert.foreign_entity_id,
                &check_run,
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

    fn github_pr_check_run(
        event: &ValidatedGithubWebhookEvent,
        pull_request: &EnrichedGithubPullRequest,
        foreign_entity_id: uuid::Uuid,
        check_run: &CheckRunNotificationFields,
    ) -> GithubPrCheckRun {
        GithubPrCheckRun {
            common: Self::github_pr_common(event, pull_request, foreign_entity_id),
            check_run_github_id: check_run.check_run_github_id,
            check_name: check_run.check_name.clone(),
            check_status: check_run.check_status.clone(),
            conclusion: check_run.conclusion.clone(),
            state: check_run.state,
            check_url: check_run.check_url.clone(),
            completed_at: check_run.completed_at,
        }
    }

    fn check_run_notification_fields(
        event: &ValidatedGithubWebhookEvent,
    ) -> Option<CheckRunNotificationFields> {
        if event.action() != Some("completed") {
            tracing::trace!(
                action = event.action(),
                "skipping check-run notification for non-completed action"
            );
            return None;
        }

        let Some(check_run) = event.payload.get("check_run") else {
            tracing::trace!("skipping check-run notification without check_run payload");
            return None;
        };

        let check_status = Self::check_run_string(check_run, "status")?;
        if check_status != "completed" {
            tracing::trace!(
                check_status,
                "skipping check-run notification for non-completed status"
            );
            return None;
        }

        let conclusion = Self::check_run_string(check_run, "conclusion")?;
        let Some(state) = Self::check_run_state(&conclusion) else {
            tracing::trace!(
                conclusion,
                "skipping check-run notification for unhandled conclusion"
            );
            return None;
        };

        Some(CheckRunNotificationFields {
            check_run_github_id: check_run.get("id").and_then(|value| value.as_u64())?,
            check_name: Self::check_run_string(check_run, "name").unwrap_or_default(),
            check_status,
            conclusion,
            state,
            check_url: Self::check_run_url(check_run)?,
            completed_at: Self::check_run_completed_at(check_run)?,
        })
    }

    fn check_run_state(conclusion: &str) -> Option<GithubPrCheckRunState> {
        match conclusion {
            "success" => Some(GithubPrCheckRunState::Completed),
            "failure" | "timed_out" | "cancelled" | "action_required" => {
                Some(GithubPrCheckRunState::Failed)
            }
            _ => None,
        }
    }

    fn check_run_string(check_run: &serde_json::Value, field: &str) -> Option<String> {
        check_run
            .get(field)
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    fn check_run_url(check_run: &serde_json::Value) -> Option<String> {
        ["html_url", "details_url"]
            .into_iter()
            .find_map(|field| Self::check_run_string(check_run, field))
    }

    fn check_run_completed_at(check_run: &serde_json::Value) -> Option<DateTime<Utc>> {
        let completed_at = Self::check_run_string(check_run, "completed_at")?;
        match DateTime::parse_from_rfc3339(&completed_at) {
            Ok(completed_at) => Some(completed_at.with_timezone(&Utc)),
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    completed_at,
                    "failed to parse GitHub check_run completed_at timestamp for notification"
                );
                None
            }
        }
    }
}
