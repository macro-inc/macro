//! Team policy is applied before data reaches any transport adapter.

use super::*;
use crate::domain::{
    models::{EventVisibility, OccurrenceRange},
    team_availability::{self, TeamAvailability},
};
use chrono::Utc;
use rootcause::Report;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

/// Invalid team-calendar request or unavailable source access.
#[derive(Debug, thiserror::Error)]
pub enum TeamCalendarError {
    /// The bounded query is outside supported limits.
    #[error("invalid calendar range, cursor, or page size")]
    InvalidQuery,
    /// The requested availability selection exceeds the supported member bound.
    #[error("too many people selected; choose at most 100 teammates using userIds")]
    TooManyMembers,
    /// The source calendar is no longer directly visible to the requester.
    #[error("calendar not found")]
    NotFound,
    /// Team data reads have not been enabled for this deployment.
    #[error("team calendar sharing is not enabled")]
    Disabled,
}

/// Source-aware team calendar domain implementation.
pub struct CalendarTeamServiceImpl<R, N = NoopTeamNotifier> {
    repository: R,
    notifier: N,
    enabled: bool,
}

impl<R> CalendarTeamServiceImpl<R> {
    /// Construct a read-only host's service.
    pub fn new(repository: R, enabled: bool) -> Self {
        Self {
            repository,
            notifier: NoopTeamNotifier,
            enabled,
        }
    }
}

impl<R, N> CalendarTeamServiceImpl<R, N> {
    /// Construct the write authority with entitlement-change notifications.
    pub fn with_notifier(repository: R, notifier: N, enabled: bool) -> Self {
        Self {
            repository,
            notifier,
            enabled,
        }
    }
}

fn validate_range(range: &OccurrenceRange) -> Result<(), Report> {
    if !range.is_valid() || !range.is_materialized_at(Utc::now()) {
        return Err(rootcause::report!(TeamCalendarError::InvalidQuery).into());
    }
    Ok(())
}

impl<R: CalendarTeamRepository, N: CalendarTeamNotifier> CalendarTeamService
    for CalendarTeamServiceImpl<R, N>
{
    async fn list_team_calendar(
        &self,
        requester: &str,
        range: OccurrenceRange,
        cursor: Option<TeamCalendarCursor>,
        limit: u16,
    ) -> Result<TeamCalendarPage, Report> {
        if !self.enabled {
            return Err(rootcause::report!(TeamCalendarError::Disabled).into());
        }
        validate_range(&range)?;
        if limit > 2000 || (limit == 0 && cursor.is_some()) {
            return Err(rootcause::report!(TeamCalendarError::InvalidQuery).into());
        }
        let revision = self.repository.projection_revision(requester).await?;
        if cursor
            .as_ref()
            .is_some_and(|cursor| cursor.revision != revision)
        {
            return Err(rootcause::report!(TeamCalendarError::InvalidQuery).into());
        }
        let members = self.repository.members(requester, false, &range).await?;
        if limit == 0 {
            if self.repository.projection_revision(requester).await? != revision {
                return Err(rootcause::report!(TeamCalendarError::InvalidQuery).into());
            }
            return Ok(TeamCalendarPage {
                members,
                items: vec![],
                next_cursor: None,
            });
        }
        let owners: Vec<_> = members
            .iter()
            .filter(|member| member.sharing != TeamCalendarSharing::None)
            .map(|member| member.user_id.clone())
            .collect();
        let mut sources = self
            .repository
            .sources(
                requester,
                range,
                &owners,
                cursor.as_ref(),
                u32::from(limit) + 1,
            )
            .await?;
        let more = sources.len() > usize::from(limit);
        sources.truncate(usize::from(limit));
        let next_cursor = if more {
            sources
                .last()
                .map(|row| {
                    serde_json::to_string(&TeamCalendarCursor {
                        revision: revision.clone(),
                        user_id: row.shared_by.clone(),
                        source_id: row.source_id,
                        occurrence_key: row.occurrence.occurrence_key.clone(),
                    })
                })
                .transpose()
                .map_err(|error| rootcause::report!(error))?
        } else {
            None
        };
        let policies: HashMap<_, _> = members
            .iter()
            .map(|member| (member.user_id.as_str(), member.sharing))
            .collect();
        let viewer_emails = self.repository.owned_emails(requester).await?;
        let items = sources
            .into_iter()
            .filter_map(|source| {
                let sharing = policies.get(source.shared_by.as_str()).copied()?;
                // Keep deterministic source order across page boundaries. The
                // consumer replaces whole projections with equal opaque ids;
                // collapsing only within a page would make the selected copy
                // depend on page size. No fields from different sources merge.
                project(&source, sharing, &viewer_emails)
            })
            .collect();
        if self.repository.projection_revision(requester).await? != revision {
            return Err(rootcause::report!(TeamCalendarError::InvalidQuery).into());
        }
        Ok(TeamCalendarPage {
            members,
            items,
            next_cursor,
        })
    }

    async fn team_sharing(&self, requester: &str) -> Result<TeamCalendarSharing, Report> {
        self.repository.sharing(requester).await
    }

    async fn set_team_sharing(
        &self,
        requester: &str,
        sharing: TeamCalendarSharing,
    ) -> Result<TeamCalendarSharing, Report> {
        self.repository.set_sharing(requester, sharing).await?;
        self.notifier.sharing_changed(requester).await;
        Ok(sharing)
    }

    async fn availability_calendars(
        &self,
        requester: &str,
    ) -> Result<Vec<AvailabilityCalendar>, Report> {
        self.repository.availability_calendars(requester).await
    }

    async fn set_availability_calendar(
        &self,
        requester: &str,
        calendar: Uuid,
        contributes: bool,
    ) -> Result<(), Report> {
        if !self
            .repository
            .set_availability_calendar(requester, calendar, contributes)
            .await?
        {
            return Err(rootcause::report!(TeamCalendarError::NotFound).into());
        }
        self.notifier.sharing_changed(requester).await;
        Ok(())
    }

    async fn get_team_availability(
        &self,
        requester: &str,
        range: OccurrenceRange,
        user_ids: Option<&[String]>,
    ) -> Result<TeamAvailability, Report> {
        if !self.enabled {
            return Err(rootcause::report!(TeamCalendarError::Disabled).into());
        }
        validate_range(&range)?;
        if user_ids.is_some_and(|ids| ids.len() > 100) {
            return Err(rootcause::report!(TeamCalendarError::TooManyMembers).into());
        }
        let revision = self.repository.projection_revision(requester).await?;
        let mut source_range = range.clone();
        source_range.start_date = range
            .starts_at
            .date_naive()
            .pred_opt()
            .ok_or_else(|| rootcause::report!(TeamCalendarError::InvalidQuery))?;
        source_range.end_date = range
            .ends_at
            .date_naive()
            .checked_add_days(chrono::Days::new(2))
            .ok_or_else(|| rootcause::report!(TeamCalendarError::InvalidQuery))?;
        let mut members = self
            .repository
            .members(requester, true, &source_range)
            .await?;
        let known: HashSet<_> = members
            .iter()
            .map(|member| member.user_id.clone())
            .collect();
        let unknown_user_ids: Vec<_> = user_ids
            .unwrap_or_default()
            .iter()
            .filter(|id| !known.contains(*id))
            .cloned()
            .collect();
        members.retain(|member| {
            member.user_id == requester || user_ids.is_none_or(|ids| ids.contains(&member.user_id))
        });
        if members.len() > 101 {
            return Err(rootcause::report!(TeamCalendarError::TooManyMembers).into());
        }
        let owners: Vec<_> = members
            .iter()
            .filter(|member| {
                member.user_id == requester || member.sharing != TeamCalendarSharing::None
            })
            .map(|member| member.user_id.clone())
            .collect();
        let mut sources = self
            .repository
            .sources(
                requester,
                source_range,
                &owners,
                None,
                TEAM_AVAILABILITY_LIMIT + 1,
            )
            .await?;
        let complete = sources.len() <= TEAM_AVAILABILITY_LIMIT as usize;
        sources.truncate(TEAM_AVAILABILITY_LIMIT as usize);
        if self.repository.projection_revision(requester).await? != revision {
            return Err(rootcause::report!(TeamCalendarError::InvalidQuery).into());
        }
        Ok(team_availability::calculate(
            range,
            TeamAvailabilitySources {
                members,
                sources,
                complete,
                unknown_user_ids,
            },
        ))
    }
}

fn project(
    source: &TeamSourceOccurrence,
    sharing: TeamCalendarSharing,
    viewer_emails: &[String],
) -> Option<TeamCalendarItem> {
    if sharing == TeamCalendarSharing::None
        || source.occurrence.is_cancelled
        || source.event.status == crate::domain::models::EventStatus::Cancelled
        || source.exception().and_then(|item| item.status)
            == Some(crate::domain::models::EventStatus::Cancelled)
    {
        return None;
    }
    let may_show_details = sharing == TeamCalendarSharing::All
        && matches!(
            source.visibility(),
            EventVisibility::Default | EventVisibility::Public
        );
    let content = if may_show_details {
        let exception = source.exception();
        let mut attendees = source.attendees().to_vec();
        for attendee in &mut attendees {
            attendee.is_self = viewer_emails
                .iter()
                .any(|email| email.eq_ignore_ascii_case(&attendee.email));
        }
        TeamCalendarContent::Details {
            details: TeamCalendarDetails {
                title: exception
                    .and_then(|item| item.title.clone())
                    .unwrap_or_else(|| source.event.title.clone()),
                description: exception
                    .and_then(|item| item.description.clone())
                    .or_else(|| source.event.description.clone()),
                location: exception
                    .and_then(|item| item.location.clone())
                    .or_else(|| source.event.location.clone()),
                conference_url: source.event.conference_url.clone(),
                organizer_email: source.event.organizer_email.clone(),
                organizer_name: source.event.organizer_name.clone(),
                attendees,
                calendar_name: source.calendar_name.clone(),
            },
        }
    } else {
        if !source.is_busy() || !source.time().has_positive_duration() {
            return None;
        }
        TeamCalendarContent::Busy
    };
    let identity = serde_json::to_vec(&(
        &source.shared_by,
        source.source_id,
        &source.event.ical_uid,
        &source.occurrence.occurrence_key,
    ))
    .ok()?;
    Some(TeamCalendarItem {
        id: Uuid::new_v5(&Uuid::NAMESPACE_OID, &identity).to_string(),
        owner_id: source.shared_by.clone(),
        time: source.time().clone(),
        contributes_to_availability: source.is_personally_busy()
            && source.time().has_positive_duration(),
        content,
    })
}

#[cfg(test)]
mod test;
