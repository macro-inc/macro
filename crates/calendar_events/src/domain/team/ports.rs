//! Domain ports for team projections and sharing policy.

use super::*;
use crate::domain::{models::OccurrenceRange, team_availability::TeamAvailability};
use rootcause::Report;
use std::future::Future;
use uuid::Uuid;

/// Repository facts scoped to current membership and direct synced-source access.
pub trait CalendarTeamRepository: Send + Sync + 'static {
    /// Changes when membership, policy, source access, or source content changes.
    fn projection_revision(
        &self,
        requester: &str,
    ) -> impl Future<Output = Result<String, Report>> + Send;
    /// Current teammates; include_self adds the requester's direct source context.
    fn members(
        &self,
        requester: &str,
        include_self: bool,
        range: &OccurrenceRange,
    ) -> impl Future<Output = Result<Vec<TeamCalendarMember>, Report>> + Send;
    /// Read one bounded page; selected owners can only narrow current membership.
    fn sources(
        &self,
        requester: &str,
        range: OccurrenceRange,
        owners: &[String],
        cursor: Option<&TeamCalendarCursor>,
        limit: u32,
    ) -> impl Future<Output = Result<Vec<TeamSourceOccurrence>, Report>> + Send;
    /// Addresses owned by this viewer for requester-relative attendee flags.
    fn owned_emails(
        &self,
        requester: &str,
    ) -> impl Future<Output = Result<Vec<String>, Report>> + Send;
    /// Stored or default sharing policy.
    fn sharing(
        &self,
        requester: &str,
    ) -> impl Future<Output = Result<TeamCalendarSharing, Report>> + Send;
    /// Set only the authenticated user's own policy.
    fn set_sharing(
        &self,
        requester: &str,
        sharing: TeamCalendarSharing,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Visible source calendars and their personal availability inclusion.
    fn availability_calendars(
        &self,
        requester: &str,
    ) -> impl Future<Output = Result<Vec<AvailabilityCalendar>, Report>> + Send;
    /// Change inclusion if this source is still directly visible; false if access vanished.
    fn set_availability_calendar(
        &self,
        requester: &str,
        calendar: Uuid,
        contributes: bool,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
}

/// Notify current viewers after changing a sharing entitlement.
pub trait CalendarTeamNotifier: Send + Sync + 'static {
    /// Promptly purge/refetch projections derived from this user's policy.
    fn sharing_changed(&self, user_id: &str) -> impl Future<Output = ()> + Send;
}

/// No notifications for services exposing reads only.
pub struct NoopTeamNotifier;
impl CalendarTeamNotifier for NoopTeamNotifier {
    async fn sharing_changed(&self, _user_id: &str) {}
}

/// Team calendar use cases. Provider writes are deliberately absent.
pub trait CalendarTeamService: Send + Sync + 'static {
    /// Paginated read-only team calendar projections.
    fn list_team_calendar(
        &self,
        requester: &str,
        range: OccurrenceRange,
        cursor: Option<TeamCalendarCursor>,
        limit: u16,
    ) -> impl Future<Output = Result<TeamCalendarPage, Report>> + Send;
    /// Policy for the authenticated user.
    fn team_sharing(
        &self,
        requester: &str,
    ) -> impl Future<Output = Result<TeamCalendarSharing, Report>> + Send;
    /// Set the authenticated user's policy without changing Google permissions.
    fn set_team_sharing(
        &self,
        requester: &str,
        sharing: TeamCalendarSharing,
    ) -> impl Future<Output = Result<TeamCalendarSharing, Report>> + Send;
    /// Calendars contributing to personal availability.
    fn availability_calendars(
        &self,
        requester: &str,
    ) -> impl Future<Output = Result<Vec<AvailabilityCalendar>, Report>> + Send;
    /// Change the inclusion of a directly visible source.
    fn set_availability_calendar(
        &self,
        requester: &str,
        calendar: Uuid,
        contributes: bool,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Compute coverage-aware availability using authorized source snapshots.
    fn get_team_availability(
        &self,
        requester: &str,
        range: OccurrenceRange,
        user_ids: Option<&[String]>,
    ) -> impl Future<Output = Result<TeamAvailability, Report>> + Send;
}
