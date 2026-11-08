//! Connection-gateway adapter that tells open pages their saved views changed,
//! however the change was made: the app, the SDK, or an agent's program.

use connection_gateway_client::client::ConnectionGatewayClient;
use entity_kind::EntityType;
use saved_views::domain::{ChangeNotifier, MembershipPort, ViewsChanged};
use std::{collections::BTreeSet, sync::Arc};
use tokio_util::task::TaskTracker;
use tracing::Instrument;

#[cfg(test)]
mod test;

/// Gateway message type of the bare change pushes; pages re-read on receipt.
const CHANGED_MESSAGE: &str = "saved_views_changed";

/// [`ChangeNotifier`] backed by the connection gateway: one bare push naming
/// the changed kind to the user who made the change and to every member of
/// the teams the views were shared with. No definition travels; the page
/// re-reads what it may see.
pub struct ConnectionGatewaySavedViewChanges<M> {
    client: ConnectionGatewayClient,
    membership: Arc<M>,
    tasks: TaskTracker,
}

// Derived Clone would require `M: Clone`; the membership is shared.
impl<M> Clone for ConnectionGatewaySavedViewChanges<M> {
    fn clone(&self) -> Self {
        Self {
            client: self.client.clone(),
            membership: Arc::clone(&self.membership),
            tasks: self.tasks.clone(),
        }
    }
}

impl<M: MembershipPort + 'static> ConnectionGatewaySavedViewChanges<M> {
    /// Construct the adapter. `tasks` is drained at shutdown, so a push for a
    /// committed write still goes out when the service stops right after it.
    pub fn new(client: ConnectionGatewayClient, membership: Arc<M>, tasks: TaskTracker) -> Self {
        Self {
            client,
            membership,
            tasks,
        }
    }

    /// Push one change. Best effort: a page that misses it re-reads when it
    /// regains focus or reconnects.
    #[tracing::instrument(
        name = "saved_view.changed.push",
        skip_all,
        fields(
            kind = change.kind.as_deref(),
            teams = change.teams.len(),
            recipients = tracing::field::Empty,
            outcome = tracing::field::Empty,
        )
    )]
    async fn push(&self, change: ViewsChanged) {
        if !cfg!(feature = "connection_gateway") {
            return;
        }
        let mut recipients = BTreeSet::from([change.user]);
        let mut teams_resolved = true;
        for team in change.teams {
            match self.membership.team_members(team).await {
                Ok(members) => recipients.extend(members),
                Err(error) => {
                    teams_resolved = false;
                    tracing::warn!(error = ?error, %team, "failed to resolve saved view team members");
                }
            }
        }
        let span = tracing::Span::current();
        span.record("recipients", recipients.len());
        let sent = self
            .client
            .batch_send_message(
                CHANGED_MESSAGE.to_owned(),
                serde_json::json!({ "kind": change.kind }),
                recipients
                    .iter()
                    .map(|user| EntityType::User.with_entity_str(user))
                    .collect(),
            )
            .await
            .inspect_err(
                |error| tracing::error!(error = ?error, "failed to push saved view change"),
            );
        span.record(
            "outcome",
            match (sent.is_ok(), teams_resolved) {
                (true, true) => "sent",
                (true, false) => "partial",
                (false, _) => "failed",
            },
        );
    }
}

impl<M: MembershipPort + 'static> ChangeNotifier for ConnectionGatewaySavedViewChanges<M> {
    async fn views_changed(&self, change: ViewsChanged) {
        // Spawned so the response never waits on the gateway or the team
        // lookup, while the write is already committed.
        let pusher = self.clone();
        self.tasks
            .spawn(async move { pusher.push(change).await }.in_current_span());
    }
}
