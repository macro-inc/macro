//! Meeting-note links and their view-only, live audience.

use entity_access::domain::models::{EntityAccessReceipt, EntityType, OwnerAccessLevel};
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

/// An owner's durable sharing link, including meetings they can no longer open.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct DocumentNoteLink {
    /// Current name of the owned markdown document.
    pub document_name: String,
    /// Linked calendar copy.
    pub event_id: Uuid,
    /// Original occurrence start, or `single` for a one-time meeting.
    pub occurrence_key: String,
    /// Current title, or a safe placeholder when meeting details are unavailable.
    pub event_title: String,
    /// Independent optional team audience.
    pub team: Option<NoteTeam>,
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
    /// All links on the caller's document, even after meeting access is lost.
    fn document_links(
        &self,
        user: &str,
        document: &str,
    ) -> impl Future<Output = Result<Vec<DocumentNoteLink>, Self::Err>> + Send;
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
    /// List an owned document's durable calendar sharing grants.
    fn document_links(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
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
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<Vec<DocumentNoteLink>, NoteError> {
        let user = receipt
            .get_authenticated_user()
            .map_err(|_| NoteError::Forbidden)?;
        if receipt.entity().entity_type != EntityType::Document {
            return Err(NoteError::Forbidden);
        }
        self.repo
            .document_links(user.as_ref(), &receipt.entity().entity_id)
            .await
            .map_err(internal)
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
