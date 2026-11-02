//! Meeting-note links and their view-only, live audience.

use super::models::{CalendarMentionEvent, CalendarMentionPreview};
use super::team::{
    TeamCalendarContent, TeamCalendarItem, TeamCalendarSharing, TeamSourceOccurrence,
    project_team_source,
};
use entity_access::domain::models::{
    EntityAccessReceipt, EntityType, OwnerAccessLevel, ViewAccessLevel,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// One occurrence, shared across the calendar copies of the same meeting.
#[derive(Clone, Debug)]
pub struct NoteTarget {
    /// A calendar copy the caller can see.
    pub event_id: Uuid,
    /// Calendar occurrence key; one-time meetings normalize to a stable event key.
    pub occurrence_key: String,
}

/// An additional team audience, separate from the meeting's audience.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct NoteTeam {
    /// Team identity.
    pub id: Uuid,
    /// Display name.
    pub name: String,
}

/// A document available in the note picker.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct NoteDocument {
    /// Markdown document identity.
    pub document_id: String,
    /// Current document name, never a copied title.
    pub name: String,
}

/// One linked document and the extra access this link grants.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct MeetingNote {
    /// Markdown document identity.
    pub document_id: String,
    /// Current document name.
    pub name: String,
    /// Optional extra team view grant.
    pub team: Option<NoteTeam>,
    /// Whether this viewer can change this document's sharing.
    pub can_manage: bool,
}

/// Picker results; only documents whose owner is the caller are suggested.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct NotePicker {
    /// At most 30 matching markdown documents, most recently updated first.
    pub documents: Vec<NoteDocument>,
    /// Teams the caller currently belongs to.
    pub teams: Vec<NoteTeam>,
}

/// A visible meeting link, or an owner's durable grant they can no longer open.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct DocumentNoteLink {
    /// Current name of the markdown document.
    pub document_name: String,
    /// Linked calendar copy.
    pub event_id: Uuid,
    /// Original occurrence start, or `single` for a one-time meeting.
    pub occurrence_key: String,
    /// Current title, or a safe placeholder when meeting details are unavailable.
    pub event_title: String,
    /// Whether the reader may resolve this exact meeting's details right now.
    pub can_view_meeting: bool,
    /// Exact accessible calendar preview, resolved with this link's authorization snapshot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<CalendarMentionEvent>,
    /// Independent optional team audience.
    pub team: Option<NoteTeam>,
    /// Exact, sanitized team-calendar details when the meeting is shared through a team.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_event: Option<TeamCalendarItem>,
}

/// An exact linked occurrence from a currently authorized full-detail team source.
pub struct NoteReferenceSource {
    /// Durable link this source resolves.
    pub target: NoteTarget,
    /// Source-scoped event and occurrence; never borrowed from another calendar.
    pub source: TeamSourceOccurrence,
    /// Addresses owned by the reader, for requester-relative attendee fields.
    pub viewer_emails: Vec<String>,
}

/// Failures with safe, user-facing semantics.
#[derive(Debug, thiserror::Error)]
pub enum NoteError {
    /// The meeting is missing, cancelled, or not visible in detail.
    #[error("This meeting is no longer available")]
    NotFound,
    /// Sharing requires document ownership and current team membership.
    #[error("You do not have permission to share these notes")]
    Forbidden,
    /// Only live markdown documents can be linked.
    #[error("Choose a markdown document")]
    NotMarkdown,
    /// Invalid or excessive input.
    #[error("Invalid meeting notes request")]
    InvalidInput,
    /// An infrastructure operation failed.
    #[error("Meeting notes could not be saved")]
    Internal(rootcause::Report),
}

/// Persistence facts and atomic link writes.
pub trait NoteRepository: Send + Sync + 'static {
    /// Adapter error.
    type Err: std::error::Error + Send + Sync + 'static;
    /// Visible meeting links; document owners also retain unavailable grants.
    fn document_links(
        &self,
        user: &str,
        document: &str,
    ) -> impl Future<Output = Result<Vec<DocumentNoteLink>, Self::Err>> + Send;
    /// Exact linked sources with live full-detail team policy and source access.
    fn team_reference_sources(
        &self,
        user: &str,
        document: &str,
    ) -> impl Future<Output = Result<Vec<NoteReferenceSource>, rootcause::Report>> + Send;
    /// Resolve visible link targets through the existing own/channel preview reader.
    fn reference_previews(
        &self,
        user: &str,
        targets: Vec<NoteTarget>,
    ) -> impl Future<Output = Result<Vec<CalendarMentionPreview>, rootcause::Report>> + Send;
    /// Current full-detail access; busy-only projections never qualify.
    fn visible(
        &self,
        user: &str,
        target: &NoteTarget,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
    /// Whether a live, materialized occurrence exists for a new link.
    fn occurrence_exists(
        &self,
        target: &NoteTarget,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
    /// Whether the document exists, is live, and is markdown.
    fn is_markdown(&self, document: &str) -> impl Future<Output = Result<bool, Self::Err>> + Send;
    /// Current membership in the optional extra audience.
    fn team_member(
        &self,
        user: &str,
        team: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
    /// Notes from every copy of the same meeting and occurrence.
    fn list(
        &self,
        user: &str,
        target: &NoteTarget,
    ) -> impl Future<Output = Result<Vec<MeetingNote>, Self::Err>> + Send;
    /// Owned markdown suggestions and current teams.
    fn picker(
        &self,
        user: &str,
        query: &str,
    ) -> impl Future<Output = Result<NotePicker, Self::Err>> + Send;
    /// Replace this document's link atomically, including across calendar copies.
    fn link(
        &self,
        user: &str,
        target: &NoteTarget,
        document: &str,
        team: Option<Uuid>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Remove this document's link from all copies; leave the document intact.
    fn unlink(
        &self,
        target: &NoteTarget,
        document: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Inbound contract; mutation receipts prove ownership before granting access.
pub trait MeetingNotesService: Send + Sync + 'static {
    /// List visible meeting links; owners also receive unavailable durable grants.
    fn document_links(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<Vec<DocumentNoteLink>, NoteError>> + Send;
    /// Read notes using the current meeting audience.
    fn list(
        &self,
        user: &str,
        target: NoteTarget,
    ) -> impl Future<Output = Result<Vec<MeetingNote>, NoteError>> + Send;
    /// Find documents the user can share.
    fn picker(
        &self,
        user: &str,
        query: &str,
    ) -> impl Future<Output = Result<NotePicker, NoteError>> + Send;
    /// Link notes, or update their optional team audience.
    fn link(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        target: NoteTarget,
        team: Option<Uuid>,
    ) -> impl Future<Output = Result<(), NoteError>> + Send;
    /// Unlink without deleting the notes or touching other grants.
    fn unlink(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        target: NoteTarget,
    ) -> impl Future<Output = Result<(), NoteError>> + Send;
}

/// Calendar note policy, independent from transport and storage.
pub struct MeetingNotes<R> {
    repo: R,
}

impl<R: NoteRepository> MeetingNotes<R> {
    /// Compose the repository with meeting-note policy.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }

    async fn authorize(&self, user: &str, target: &NoteTarget) -> Result<(), NoteError> {
        validate_target(target)?;
        if !self.repo.visible(user, target).await.map_err(internal)? {
            return Err(NoteError::NotFound);
        }
        Ok(())
    }
}

fn validate_target(target: &NoteTarget) -> Result<(), NoteError> {
    if target.occurrence_key.is_empty() || target.occurrence_key.len() > 100 {
        return Err(NoteError::InvalidInput);
    }
    Ok(())
}

fn internal(error: impl std::error::Error + Send + Sync + 'static) -> NoteError {
    NoteError::Internal(rootcause::Report::new(error).into_dynamic())
}

impl<R: NoteRepository> MeetingNotesService for MeetingNotes<R> {
    #[tracing::instrument(name = "calendar.notes.document_links", skip_all, fields(document_id = %receipt.entity().entity_id), err)]
    async fn document_links(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<DocumentNoteLink>, NoteError> {
        let user = receipt
            .get_authenticated_user()
            .map_err(|_| NoteError::Forbidden)?;
        if receipt.entity().entity_type != EntityType::Document {
            return Err(NoteError::Forbidden);
        }
        let mut links = self
            .repo
            .document_links(user.as_ref(), &receipt.entity().entity_id)
            .await
            .map_err(internal)?;
        if links.is_empty() {
            return Ok(links);
        }
        let visible_targets = links
            .iter()
            .filter(|link| link.can_view_meeting)
            .map(|link| NoteTarget {
                event_id: link.event_id,
                occurrence_key: link.occurrence_key.clone(),
            })
            .collect::<Vec<_>>();
        if !visible_targets.is_empty() {
            let previews = self
                .repo
                .reference_previews(user.as_ref(), visible_targets)
                .await
                .map_err(NoteError::Internal)?;
            for (link, preview) in links
                .iter_mut()
                .filter(|link| link.can_view_meeting)
                .zip(previews)
            {
                if let CalendarMentionPreview::Accessible(event) = preview {
                    let exact = if link.occurrence_key == "single" {
                        !event.is_recurring
                    } else {
                        event.occurrence_key.as_deref() == Some(link.occurrence_key.as_str())
                    };
                    if exact {
                        link.event = Some(*event);
                    }
                }
            }
        }
        let sources = self
            .repo
            .team_reference_sources(user.as_ref(), &receipt.entity().entity_id)
            .await
            .map_err(NoteError::Internal)?;
        for reference in sources {
            let Some(projected) = project_team_source(
                &reference.source,
                TeamCalendarSharing::All,
                &reference.viewer_emails,
            ) else {
                continue;
            };
            if !matches!(projected.content, TeamCalendarContent::Details { .. }) {
                continue;
            }
            if let Some(link) = links.iter_mut().find(|link| {
                link.event_id == reference.target.event_id
                    && link.occurrence_key == reference.target.occurrence_key
                    && link.can_view_meeting
                    && link.team_event.is_none()
            }) {
                link.team_event = Some(projected);
            }
        }
        Ok(links)
    }
    #[tracing::instrument(name = "calendar.notes.list", skip_all, fields(event_id = %target.event_id), err)]
    async fn list(&self, user: &str, target: NoteTarget) -> Result<Vec<MeetingNote>, NoteError> {
        self.authorize(user, &target).await?;
        self.repo.list(user, &target).await.map_err(internal)
    }

    #[tracing::instrument(name = "calendar.notes.picker", skip_all, err)]
    async fn picker(&self, user: &str, query: &str) -> Result<NotePicker, NoteError> {
        if query.len() > 200 {
            return Err(NoteError::InvalidInput);
        }
        self.repo.picker(user, query.trim()).await.map_err(internal)
    }

    #[tracing::instrument(name = "calendar.notes.link", skip_all, fields(event_id = %target.event_id, document_id = %receipt.entity().entity_id), err)]
    async fn link(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        target: NoteTarget,
        team: Option<Uuid>,
    ) -> Result<(), NoteError> {
        let user = receipt
            .get_authenticated_user()
            .map_err(|_| NoteError::Forbidden)?;
        if receipt.entity().entity_type != EntityType::Document {
            return Err(NoteError::Forbidden);
        }
        self.authorize(user.as_ref(), &target).await?;
        if !self
            .repo
            .occurrence_exists(&target)
            .await
            .map_err(internal)?
        {
            return Err(NoteError::NotFound);
        }
        let document = &receipt.entity().entity_id;
        if !self.repo.is_markdown(document).await.map_err(internal)? {
            return Err(NoteError::NotMarkdown);
        }
        if let Some(team) = team
            && !self
                .repo
                .team_member(user.as_ref(), team)
                .await
                .map_err(internal)?
        {
            return Err(NoteError::Forbidden);
        }
        self.repo
            .link(user.as_ref(), &target, document, team)
            .await
            .map_err(internal)
    }

    #[tracing::instrument(name = "calendar.notes.unlink", skip_all, fields(event_id = %target.event_id, document_id = %receipt.entity().entity_id), err)]
    async fn unlink(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        target: NoteTarget,
    ) -> Result<(), NoteError> {
        receipt
            .get_authenticated_user()
            .map_err(|_| NoteError::Forbidden)?;
        if receipt.entity().entity_type != EntityType::Document {
            return Err(NoteError::Forbidden);
        }
        // A document owner must still be able to revoke sharing after the
        // meeting is cancelled or they lose access to its calendar.
        validate_target(&target)?;
        self.repo
            .unlink(&target, &receipt.entity().entity_id)
            .await
            .map_err(internal)
    }
}

#[cfg(test)]
mod test;
