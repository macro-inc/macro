//! Live updates after a PR mapping has been persisted.

use documents::domain::ports::DocumentService;
use foreign_entity::domain::{models::ForeignEntity, ports::ForeignEntityService};
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
    F: ForeignEntityService,
    N: NotificationIngress,
    P: GithubSyncRealtime,
> GithubSyncServiceImpl<D, R, C, F, N, P>
{
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
        if recipients.is_empty() {
            return;
        }
        self.realtime
            .publish_pull_request(&recipients, entity)
            .await
            .inspect_err(|error| {
                tracing::error!(error=?error, foreign_entity_id=%entity.id,
                "failed to publish GitHub PR update")
            })
            .ok();
    }
}
