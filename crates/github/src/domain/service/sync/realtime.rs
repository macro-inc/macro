//! Live updates after a PR mapping has been persisted.

use documents::domain::ports::DocumentService;
use foreign_entity::domain::models::ForeignEntity;
use github_pull_requests::domain::ports::GithubPullRequestService;
use notification::domain::service::NotificationIngress;

use super::GithubSyncServiceImpl;
use crate::domain::{
    models::GithubAppInstallationSource,
    ports::{GithubSyncClient, GithubSyncRealtime, GithubSyncRepo},
};

impl<
    D: DocumentService,
    R: GithubSyncRepo,
    C: GithubSyncClient,
    G: GithubPullRequestService,
    N: NotificationIngress,
    P: GithubSyncRealtime,
> GithubSyncServiceImpl<D, R, C, G, N, P>
{
    #[tracing::instrument(
        name = "github.pull_request.realtime",
        skip_all,
        fields(foreign_entity_id = %entity.id, outcome = tracing::field::Empty)
    )]
    pub(super) async fn publish_pull_request(
        &self,
        source: &GithubAppInstallationSource,
        entity: &ForeignEntity,
    ) {
        // Unlike activity notifications, live state goes to every source member,
        // including the actor and users who are not PR participants.
        let recipients: Vec<_> = self
            .notification_recipient_ids(source)
            .await
            .into_iter()
            .collect();
        let outcome = if recipients.is_empty() {
            "no_recipients"
        } else {
            match self
                .realtime
                .publish_pull_request(&recipients, entity)
                .await
            {
                Ok(()) => "published",
                Err(error) => {
                    tracing::error!(error=?error, "failed to publish GitHub PR update");
                    "error"
                }
            }
        };
        tracing::Span::current().record("outcome", outcome);
    }
}
