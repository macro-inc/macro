//! Authorization for editing geometry and explicitly deleting PDF annotations.
use super::{models::MessageParent, ports::MessageError, service::MessageWrite};
use entity_access::domain::{
    models::{EntityAccessAuth, EntityAccessReceipt, EntityType, OwnerAccessLevel},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use model::annotations::{
    delete::{DeleteUnthreadedAnchorRequest, DeleteUnthreadedAnchorResponse},
    edit::{EditAnchorRequest, EditAnchorResponse},
};
use uuid::Uuid;

/// Immutable ownership facts for an annotation.
#[derive(Debug, Clone)]
pub struct AnnotationTarget {
    /// Annotation identity.
    pub id: Uuid,
    /// Document identity, including historical non-UUID IDs.
    pub document_id: String,
    /// Annotation creator.
    pub owner: String,
    /// Discussion attachment observed when authorization was granted.
    pub thread_id: Option<Uuid>,
    /// Creator of an attached discussion, if present.
    pub thread_owner: Option<String>,
}

/// Capability issued only by the annotation domain policy.
pub struct AnnotationMutation {
    target: AnnotationTarget,
}
impl AnnotationMutation {
    /// Authorized annotation identity and ownership facts.
    pub fn target(&self) -> &AnnotationTarget {
        &self.target
    }
}

/// PDF geometry persistence; adapters receive an authorized mutation capability.
pub trait AnnotationRepository: Send + Sync {
    /// Read current annotation ownership without performing a mutation.
    fn target(
        &self,
        id: Uuid,
        highlight: bool,
    ) -> impl Future<Output = Result<AnnotationTarget, MessageError>> + Send;
    /// Persist geometry changes for the exact authorized annotation.
    fn edit(
        &self,
        access: AnnotationMutation,
        input: EditAnchorRequest,
    ) -> impl Future<Output = Result<EditAnchorResponse, MessageError>> + Send;
    /// Delete an annotation and its discussion in one transaction.
    fn delete(
        &self,
        access: AnnotationMutation,
        input: DeleteUnthreadedAnchorRequest,
    ) -> impl Future<Output = Result<DeleteUnthreadedAnchorResponse, MessageError>> + Send;
}

/// Existing PDF operations composed with current document access.
pub struct AnnotationService<R, A> {
    repo: R,
    access: A,
}
impl<R: AnnotationRepository, A: EntityAccessService> AnnotationService<R, A> {
    /// Compose persistence and access ports.
    pub fn new(repo: R, access: A) -> Self {
        Self { repo, access }
    }

    async fn capability(
        &self,
        user: &MacroUserIdStr<'_>,
        org: Option<i64>,
        id: Uuid,
        highlight: bool,
    ) -> Result<AnnotationMutation, MessageError> {
        let target = self.repo.target(id, highlight).await?;
        let receipt = self
            .access
            .generate_entity_access_receipt::<MessageWrite>(
                &user.0,
                org,
                &target.document_id,
                EntityType::Document,
            )
            .await
            .map_err(|error| match error {
                entity_access::domain::models::AccessError::Unavailable(error)
                | entity_access::domain::models::AccessError::Internal(error) => {
                    MessageError::Repository(error)
                }
                _ => MessageError::Forbidden,
            })?;
        authorize(receipt, target, highlight)
    }

    /// Change geometry after checking ownership and current comment permission.
    pub async fn edit(
        &self,
        user: &MacroUserIdStr<'_>,
        org: Option<i64>,
        input: EditAnchorRequest,
    ) -> Result<EditAnchorResponse, MessageError> {
        let EditAnchorRequest::Pdf(model::annotations::edit::EditPdfAnchorRequest::FreeComment(
            ref request,
        )) = input;
        if [
            request.x_pct,
            request.y_pct,
            request.width_pct,
            request.height_pct,
            request.rotation,
        ]
        .into_iter()
        .flatten()
        .any(|v| !v.is_finite())
            || request.width_pct.is_some_and(|v| v <= 0.0)
            || request.height_pct.is_some_and(|v| v <= 0.0)
            || request.page.is_some_and(|v| v < 0)
        {
            return Err(MessageError::Invalid("invalid annotation geometry"));
        }
        if request.page.is_none()
            && request.original_page.is_none()
            && request.original_index.is_none()
            && request.x_pct.is_none()
            && request.y_pct.is_none()
            && request.width_pct.is_none()
            && request.height_pct.is_none()
            && request.rotation.is_none()
            && request.allowable_edits.is_none()
            && request.was_edited.is_none()
            && request.was_deleted.is_none()
            && request.should_lock_on_save.is_none()
        {
            return Err(MessageError::Invalid(
                "at least one annotation field must be updated",
            ));
        }
        let access = self.capability(user, org, request.uuid, false).await?;
        self.repo.edit(access, input).await
    }

    /// Explicitly delete an annotation, including any attached discussion.
    pub async fn delete(
        &self,
        user: &MacroUserIdStr<'_>,
        org: Option<i64>,
        input: DeleteUnthreadedAnchorRequest,
    ) -> Result<DeleteUnthreadedAnchorResponse, MessageError> {
        let DeleteUnthreadedAnchorRequest::Pdf(
            model::annotations::delete::DeleteUnthreadedPdfAnchorRequest::Highlight(id),
        ) = input;
        let access = self.capability(user, org, id, true).await?;
        self.repo.delete(access, input).await
    }
}

fn authorize(
    receipt: EntityAccessReceipt<MessageWrite>,
    target: AnnotationTarget,
    deleting: bool,
) -> Result<AnnotationMutation, MessageError> {
    let EntityAccessAuth::Authenticated(user) = receipt.auth() else {
        return Err(MessageError::Forbidden);
    };
    if receipt.entity().entity_type != EntityType::Document
        || receipt.entity().entity_id != target.document_id
    {
        return Err(MessageError::Forbidden);
    }
    MessageParent::parse("document", &target.document_id).map_err(|_| MessageError::NotFound)?;
    let moderator = receipt.entity_permission().satisfies::<OwnerAccessLevel>();
    if !moderator
        && (target.owner != user.as_ref()
            || (deleting
                && target
                    .thread_owner
                    .as_ref()
                    .is_some_and(|owner| owner != user.as_ref())))
    {
        return Err(MessageError::Forbidden);
    }
    Ok(AnnotationMutation { target })
}

#[cfg(test)]
mod test;
