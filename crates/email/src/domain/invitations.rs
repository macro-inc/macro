//! Saved calendar invitation use cases with their dependencies composed once.

use super::invitation_resolution::InvitationSnapshotRepository;
use calendar_events::domain::{
    invitations::{CalendarInvitationService, InvitationResolution},
    models::CalendarEvent,
    ports::{CalendarMutationError, CalendarSnapshotImporter},
};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use rootcause::Report;
use std::{collections::HashMap, sync::Arc};
use uuid::Uuid;

/// Resolves and imports invitations from an already-authorized email thread.
pub struct InvitationService<S, C, I> {
    snapshots: S,
    calendar: C,
    importer: Arc<I>,
}

impl<S, C, I> InvitationService<S, C, I> {
    /// Bind saved invitations to the calendar capabilities used by both operations.
    pub fn new(snapshots: S, calendar: C, importer: Arc<I>) -> Self {
        Self {
            snapshots,
            calendar,
            importer,
        }
    }
}

impl<S: InvitationSnapshotRepository, C: CalendarInvitationService, I> InvitationService<S, C, I> {
    /// Resolve the newest saved components of an authorized thread.
    pub async fn resolve(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<HashMap<String, InvitationResolution>, Report> {
        super::invitation_resolution::resolve(&self.calendar, &self.snapshots, receipt).await
    }
}

impl<S: InvitationSnapshotRepository, C, I: CalendarSnapshotImporter> InvitationService<S, C, I> {
    /// Add a saved published event to the viewer's calendar.
    pub async fn add_to_calendar(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        message_id: Uuid,
        invitation_id: &str,
        calendar_id: Option<Uuid>,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        super::invitation_import::add_to_calendar(
            self.importer.as_ref(),
            &self.snapshots,
            receipt,
            message_id,
            invitation_id,
            calendar_id,
        )
        .await
    }
}
