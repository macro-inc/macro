//! Thin AI adapter for the team calendar domain service.

use std::sync::Arc;

use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use async_trait::async_trait;
use chrono::{DateTime, NaiveTime, Utc};
use rootcause::compat::boxed_error::IntoBoxedError;
use schemars::JsonSchema;
use serde::Deserialize;

use crate::domain::{
    models::OccurrenceRange,
    team::{CalendarTeamService, TeamCalendarError},
    team_availability::TeamAvailability,
};

/// Dependencies for the read-only team availability tool.
pub struct TeamCalendarToolContext<T: CalendarTeamService> {
    /// Domain service owning authorization, coverage, and busy-time policy.
    pub service: Arc<T>,
}

impl<T: CalendarTeamService> Clone for TeamCalendarToolContext<T> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
        }
    }
}

/// Read-only availability tools shared by chat, agents, and MCP hosts.
pub fn team_calendar_toolset<T: CalendarTeamService>()
-> AsyncToolCollection<TeamCalendarToolContext<T>> {
    AsyncToolCollection::new().add_tool::<GetTeamAvailability, TeamCalendarToolContext<T>>()
}

/// Ask when the requester and selected current teammates have calendar gaps.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "GetTeamAvailability",
    description = "Check personal busy time for you and your current teammates in a bounded UTC time window. \
Always includes you, even when userIds selects particular teammates. Omit userIds for the whole team, \
or use ids from ListTeamMembers for specific people. An empty list checks only you. \
Returns merged busy intervals without event titles, plus coverage and unknown reasons. \
Subscribed coworkers' events do not block a person's time unless they attend or included that calendar. \
Common freeWindows are present only when every requested person's data is complete and current. \
When freeWindows is absent, report uncertainty and never infer free time from missing busy blocks. \
Free windows cover the requested range only; working hours are not applied. Prefer a day or a week; \
the maximum is 370 days within one year past to two years future. This tool grants no Google Calendar \
access and does not invite, RSVP, or modify events."
)]
pub struct GetTeamAvailability {
    /// Inclusive start of the requested window.
    #[schemars(description = "Inclusive start, RFC 3339 UTC (for example 2026-10-07T09:00:00Z).")]
    pub start: DateTime<Utc>,
    /// Exclusive end of the requested window.
    #[schemars(description = "Exclusive end, RFC 3339 UTC. Must be later than start.")]
    pub end: DateTime<Utc>,
    /// Selected current teammates; the requester is always added by the domain.
    #[schemars(
        description = "At most 100 Macro user ids from ListTeamMembers. Omit for the whole team; an empty list checks only you. Unknown ids never expand access and suppress common free windows."
    )]
    pub user_ids: Option<Vec<String>>,
}

impl ToolAnnotated for GetTeamAvailability {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Get team availability");
}

#[async_trait]
impl<T: CalendarTeamService> AsyncTool<TeamCalendarToolContext<T>> for GetTeamAvailability {
    type Output = TeamAvailability;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        service_context: ServiceContext<TeamCalendarToolContext<T>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let end_date = if self.end.time() == NaiveTime::MIN {
            self.end.date_naive()
        } else {
            self.end
                .date_naive()
                .succ_opt()
                .unwrap_or(self.end.date_naive())
        };
        service_context
            .service
            .get_team_availability(
                request_context.user_id.as_ref(),
                OccurrenceRange {
                    starts_at: self.start,
                    ends_at: self.end,
                    start_date: self.start.date_naive(),
                    end_date,
                },
                self.user_ids.as_deref(),
            )
            .await
            .map_err(tool_error)
    }
}

fn tool_error(error: rootcause::Report) -> ToolCallError {
    let description = match error
        .as_ref()
        .downcast_current_context::<TeamCalendarError>()
    {
        Some(TeamCalendarError::InvalidQuery) => {
            "The window must be positive, at most 370 days, and within one year past to two years future."
        }
        Some(TeamCalendarError::TooManyMembers) => {
            "Too many people selected. Choose at most 100 teammates using userIds; the requester is always included. Omitting userIds selects the whole team."
        }
        Some(TeamCalendarError::Disabled) => {
            "Team calendar sharing is not enabled for this deployment."
        }
        Some(TeamCalendarError::NotFound) => "The requested calendar is no longer accessible.",
        None => {
            "Could not establish team availability. Try again shortly; missing results do not mean people are free."
        }
    };
    ToolCallError {
        description: description.to_string(),
        internal_error: anyhow::Error::from_boxed(error.into_boxed_error()),
    }
}

#[cfg(test)]
mod test;
