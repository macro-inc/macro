//! Connection-gateway adapter for the calendar refresh ports. Every fan-out
//! is one gateway request, sent from a task set the host drains at shutdown.

use connection_gateway_client::client::ConnectionGatewayClient;
use sqlx::PgPool;
use tokio_util::task::TaskTracker;
use tracing::Instrument;
use uuid::Uuid;

use crate::domain::{
    models::RefreshCalendarEvent, ports::CalendarRefreshNotifier, team::CalendarTeamNotifier,
};

#[cfg(test)]
mod test;

const REFRESHED: &str = "refreshed";
const PARTIAL: &str = "partial";
const FAILED: &str = "failed";

/// [`CalendarRefreshNotifier`] and [`CalendarTeamNotifier`] backed by the
/// connection gateway. A change to an inbox's calendars refreshes the inbox's
/// owner and delegates and, with team refreshes on, their teammates, in one
/// gateway request.
#[derive(Clone)]
pub struct GatewayCalendarRefresh {
    client: ConnectionGatewayClient,
    db: PgPool,
    tasks: TaskTracker,
    team_refresh: bool,
    sends: bool,
}

impl GatewayCalendarRefresh {
    /// The adapter. `tasks` is drained at shutdown, so a refresh for a
    /// committed write still goes out when the service stops right after it.
    /// It refreshes an inbox's viewers only, until [`Self::with_team_refresh`].
    pub fn new(client: ConnectionGatewayClient, db: PgPool, tasks: TaskTracker) -> Self {
        Self {
            client,
            db,
            tasks,
            team_refresh: false,
            sends: true,
        }
    }

    /// Also refresh the team views of an inbox's viewers' teammates whenever
    /// the inbox changes. Only the calendar write authority, with team
    /// sharing on, writes what those views show.
    pub fn with_team_refresh(mut self, enabled: bool) -> Self {
        self.team_refresh = enabled;
        self
    }

    /// Send nothing when `enabled` is false, for a build without the gateway.
    pub fn with_sends(mut self, enabled: bool) -> Self {
        self.sends = enabled;
        self
    }

    /// Signal the viewers of `link_id` and wait for the gateway. Delegates are
    /// found by the link alone, as `get_event_mutation_target` admits them:
    /// a promoted shared mailbox's edges name the mailbox as their child, not
    /// the owner its older events carry. A viewer whose team sharing is
    /// `none` shows teammates nothing, so their changes refresh none of their
    /// teammates. Best effort: a viewer it misses only misses a refresh.
    #[tracing::instrument(
        name = "calendar.refresh_inbox_viewers",
        skip_all,
        fields(
            link_id = %link_id,
            team_ooo_changed = team_ooo_changed,
            viewers = tracing::field::Empty,
            teammates = tracing::field::Empty,
            outcome = tracing::field::Empty,
        )
    )]
    pub async fn refresh_inbox_viewers(
        &self,
        owner_id: &str,
        link_id: Uuid,
        team_ooo_changed: bool,
    ) {
        if !self.sends {
            return;
        }
        let mut viewers = vec![owner_id.to_owned()];
        let mut resolved = true;
        match sqlx::query_scalar!(
            "SELECT primary_macro_id FROM macro_user_links WHERE link_id = $1",
            link_id,
        )
        .fetch_all(&self.db)
        .await
        {
            Ok(delegates) => viewers.extend(delegates),
            Err(error) => {
                resolved = false;
                tracing::warn!(error=?error, %link_id, "failed to resolve calendar refresh delegates");
            }
        }
        viewers.sort();
        viewers.dedup();
        // These viewers' own refresh already refreshes their team views, so
        // only their teammates need the team refresh.
        let teammates = if self.team_refresh {
            match teammates_to_refresh(&self.db, &viewers, false).await {
                Ok(teammates) => teammates,
                Err(error) => {
                    resolved = false;
                    tracing::warn!(error=?error, "failed to resolve team calendar refresh recipients");
                    vec![]
                }
            }
        } else {
            vec![]
        };
        let span = tracing::Span::current();
        span.record("viewers", count(viewers.len()));
        span.record("teammates", count(teammates.len()));
        let synced = event(RefreshCalendarEvent::Synced {
            link_id,
            team_ooo_changed,
        });
        let team = event(RefreshCalendarEvent::TeamSharingChanged { team_ooo_changed });
        let sent = self
            .client
            .refresh_calendars(
                viewers
                    .into_iter()
                    .map(|viewer| (viewer, synced.clone()))
                    .chain(teammates.into_iter().map(|teammate| (teammate, team.clone())))
                    .collect(),
            )
            .await
            .inspect_err(
                |error| tracing::error!(error=?error, %link_id, "failed to refresh calendar viewers"),
            );
        span.record("outcome", outcome(resolved, sent.is_ok()));
    }

    /// Tell one requester their request to join `event_id` was answered. It
    /// names the event, whose id they hold, and not the sharer's inbox.
    #[tracing::instrument(
        name = "calendar.refresh_join_requester",
        skip_all,
        fields(event_id = %event_id, outcome = tracing::field::Empty)
    )]
    pub async fn refresh_requester(&self, requester_id: &str, event_id: Uuid) {
        if !self.sends {
            return;
        }
        let sent = self
            .client
            .refresh_calendar(
                requester_id,
                event(RefreshCalendarEvent::JoinRequestAnswered { event_id }),
            )
            .await
            .inspect_err(|error| {
                tracing::error!(error=?error, %event_id, "failed to refresh the requester's calendar");
            });
        tracing::Span::current().record("outcome", outcome(true, sent.is_ok()));
    }

    /// Invalidate teammate projections without exposing the underlying inbox
    /// ids after `user_id` changed their sharing setting. The sharer is
    /// refreshed too, since no inbox refresh reaches them with that change.
    #[tracing::instrument(
        name = "calendar.refresh_team",
        skip_all,
        fields(recipients = tracing::field::Empty, outcome = tracing::field::Empty)
    )]
    pub async fn refresh_team(&self, user_id: &str) {
        if !self.sends {
            return;
        }
        let (recipients, resolved) = match teammates_to_refresh(
            &self.db,
            &[user_id.to_owned()],
            true,
        )
        .await
        {
            Ok(recipients) => (recipients, true),
            Err(error) => {
                tracing::warn!(error=?error, "failed to resolve team calendar refresh recipients");
                (vec![user_id.to_owned()], false)
            }
        };
        let span = tracing::Span::current();
        span.record("recipients", count(recipients.len()));
        let team = event(RefreshCalendarEvent::TeamSharingChanged {
            team_ooo_changed: true,
        });
        let sent = self
            .client
            .refresh_calendars(
                recipients
                    .into_iter()
                    .map(|recipient| (recipient, team.clone()))
                    .collect(),
            )
            .await
            .inspect_err(
                |error| tracing::warn!(error=?error, "failed to invalidate team calendar projections"),
            );
        span.record("outcome", outcome(resolved, sent.is_ok()));
    }
}

impl CalendarRefreshNotifier for GatewayCalendarRefresh {
    async fn calendar_changed(&self, owner_id: &str, email_link_id: Uuid, team_ooo_changed: bool) {
        // Spawned so the response never waits on the gateway, while the
        // write it announces is already committed.
        let refresh = self.clone();
        let owner_id = owner_id.to_owned();
        self.tasks.spawn(
            async move {
                refresh
                    .refresh_inbox_viewers(&owner_id, email_link_id, team_ooo_changed)
                    .await;
            }
            .in_current_span(),
        );
    }

    async fn join_request_answered(&self, requester_id: &str, event_id: Uuid) {
        let refresh = self.clone();
        let requester_id = requester_id.to_owned();
        self.tasks.spawn(
            async move {
                refresh.refresh_requester(&requester_id, event_id).await;
            }
            .in_current_span(),
        );
    }
}

impl CalendarTeamNotifier for GatewayCalendarRefresh {
    async fn sharing_changed(&self, user_id: &str) {
        let refresh = self.clone();
        let user_id = user_id.to_owned();
        self.tasks.spawn(
            async move {
                refresh.refresh_team(&user_id).await;
            }
            .in_current_span(),
        );
    }
}

fn event(event: RefreshCalendarEvent) -> serde_json::Value {
    serde_json::to_value(event).unwrap_or_default()
}

/// A span field count: unsigned values reach the collector as strings.
fn count(n: usize) -> i64 {
    i64::try_from(n).unwrap_or(i64::MAX)
}

fn outcome(resolved: bool, sent: bool) -> &'static str {
    match (resolved, sent) {
        (_, false) => FAILED,
        (false, true) => PARTIAL,
        (true, true) => REFRESHED,
    }
}

/// The teammates whose team views show the calendars `shared_by` share. A
/// sharer whose setting is `none` shows teammates nothing, so their changes
/// refresh no teammate, but a sharing change reaches every teammate whatever
/// the new setting is, and the sharers too.
async fn teammates_to_refresh(
    db: &PgPool,
    shared_by: &[String],
    sharing_changed: bool,
) -> Result<Vec<String>, sqlx::Error> {
    if shared_by.is_empty() {
        return Ok(vec![]);
    }
    let found = sqlx::query_scalar!(
        r#"
        SELECT DISTINCT teammate.user_id
        FROM team_user membership
        JOIN team_user teammate ON teammate.team_id = membership.team_id
        WHERE membership.user_id = ANY($1::text[])
          AND ($2 OR NOT EXISTS (
              SELECT 1 FROM calendar_team_sharing policy
              WHERE policy.user_id = membership.user_id AND policy.sharing = 'none'
          ))
        UNION
        SELECT unnest($1::text[])
        "#,
        shared_by,
        sharing_changed,
    )
    .fetch_all(db)
    .await?;
    Ok(team_refresh_recipients(found, shared_by, sharing_changed))
}

/// The users a team refresh reaches, leaving out the sharers unless their
/// sharing changed.
fn team_refresh_recipients(
    found: Vec<Option<String>>,
    shared_by: &[String],
    sharing_changed: bool,
) -> Vec<String> {
    found
        .into_iter()
        .flatten()
        .filter(|user_id| sharing_changed || !shared_by.contains(user_id))
        .collect()
}
