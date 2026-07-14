//! [`TeamAnalytics`] adapter backed by `analytics_client::AnalyticsClient`.

#[cfg(test)]
mod test;

use std::sync::Arc;

use analytics_client::AnalyticsClient;
use serde::Serialize;

use crate::domain::team_analytics::{TeamAnalytics, TeamAnalyticsEvent};

/// Team analytics adapter that records events through the shared analytics client.
#[derive(Clone)]
pub struct AnalyticsClientTeamAnalytics {
    client: Arc<AnalyticsClient>,
}

impl AnalyticsClientTeamAnalytics {
    /// Construct a new team analytics adapter from a shared analytics client.
    pub fn new(client: Arc<AnalyticsClient>) -> Self {
        Self { client }
    }
}

#[derive(Debug, Eq, PartialEq, Serialize)]
struct TeamAnalyticsProperties {
    team_id: uuid::Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    team_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    team_invite_id: Option<uuid::Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    inviter_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    member_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    removed_by_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
}

impl TeamAnalyticsProperties {
    fn new(team_id: uuid::Uuid) -> Self {
        Self {
            team_id,
            team_name: None,
            team_invite_id: None,
            owner_id: None,
            inviter_id: None,
            member_id: None,
            removed_by_id: None,
            role: None,
        }
    }
}

#[derive(Debug, Eq, PartialEq)]
struct PostHogTeamAnalyticsEvent {
    distinct_id: String,
    event_name: &'static str,
    properties: TeamAnalyticsProperties,
}

impl PostHogTeamAnalyticsEvent {
    fn from_team_event(event: TeamAnalyticsEvent) -> Self {
        match event {
            TeamAnalyticsEvent::TeamCreated {
                team_id,
                owner_id,
                team_name,
            } => Self {
                distinct_id: owner_id.as_ref().to_owned(),
                event_name: "team_create",
                properties: TeamAnalyticsProperties {
                    team_name: Some(team_name),
                    owner_id: Some(owner_id.as_ref().to_owned()),
                    ..TeamAnalyticsProperties::new(team_id)
                },
            },
            TeamAnalyticsEvent::TeamInvited {
                team_id,
                team_invite_id,
                inviter_id,
                team_name,
            } => Self {
                distinct_id: inviter_id.as_ref().to_owned(),
                event_name: "team_invite",
                properties: TeamAnalyticsProperties {
                    team_name,
                    team_invite_id: Some(team_invite_id),
                    inviter_id: Some(inviter_id.as_ref().to_owned()),
                    ..TeamAnalyticsProperties::new(team_id)
                },
            },
            TeamAnalyticsEvent::TeamJoined {
                team_id,
                team_invite_id,
                member_id,
                role,
            } => Self {
                distinct_id: member_id.as_ref().to_owned(),
                event_name: "team_join",
                properties: TeamAnalyticsProperties {
                    team_invite_id: Some(team_invite_id),
                    member_id: Some(member_id.as_ref().to_owned()),
                    role: Some(role.to_string()),
                    ..TeamAnalyticsProperties::new(team_id)
                },
            },
            TeamAnalyticsEvent::TeamLeft {
                team_id,
                member_id,
                removed_by_id,
                role,
            } => Self {
                distinct_id: member_id.as_ref().to_owned(),
                event_name: "team_leave",
                properties: TeamAnalyticsProperties {
                    member_id: Some(member_id.as_ref().to_owned()),
                    removed_by_id: Some(removed_by_id.as_ref().to_owned()),
                    role: Some(role.to_string()),
                    ..TeamAnalyticsProperties::new(team_id)
                },
            },
        }
    }
}

impl TeamAnalytics for AnalyticsClientTeamAnalytics {
    type Err = String;

    async fn track_team_event(&self, event: TeamAnalyticsEvent) -> Result<(), Self::Err> {
        let posthog_event = PostHogTeamAnalyticsEvent::from_team_event(event);
        let event_name = posthog_event.event_name;

        self.client
            .track_posthog(
                &posthog_event.distinct_id,
                event_name,
                &posthog_event.properties,
            )
            .await
            .map_err(|err| format!("failed to track PostHog team event {event_name}: {err}"))
    }
}
