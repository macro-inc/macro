use crate::api::context::{ApiContext, AuthorizationService, EmailSvc};
use axum::{
    Json,
    extract::{Path, State},
};
use axum_extra::extract::Cached;
use email::inbound::axum::{
    api_types::ApiAttachmentDraft, axum_impls::EmailLinkExtractor,
    thread_labels_router::UpdateThreadLabelError,
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// Reuse the same operation ID when retrying after a lost response.
#[derive(Deserialize, ToSchema)]
pub struct TransferDraftRequest {
    pub operation_id: Uuid,
    pub destination_link_id: Uuid,
}
/// A new identity prevents delayed writes from mutating the moved copy.
#[derive(Serialize, ToSchema)]
pub struct TransferDraftResponse {
    pub message_id: Uuid,
    pub thread_id: Uuid,
    pub source_id: Uuid,
    pub source_thread_id: Uuid,
    pub attachments: Vec<ApiAttachmentDraft>,
}
#[utoipa::path(post,tag="Drafts",path="/email/drafts/{id}/transfer",operation_id="transfer_draft",
    params(("id"=Uuid,Path)),request_body=TransferDraftRequest,
    responses((status=200,body=TransferDraftResponse),(status=403),(status=404),(status=409),(status=500)))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Cached(EmailLinkExtractor(link, _)): Cached<EmailLinkExtractor<EmailSvc, AuthorizationService>>,
    Path(source_id): Path<Uuid>,
    Json(request): Json<TransferDraftRequest>,
) -> Result<Json<TransferDraftResponse>, UpdateThreadLabelError> {
    let receipt = ctx
        .draft_transfers
        .transfer(
            authorization.authorization.user.macro_user_id,
            email::domain::draft_transfer::DraftTransferRequest {
                id: request.operation_id,
                source_id,
                source_link_id: link.id,
                destination_link_id: request.destination_link_id,
            },
        )
        .await?;
    Ok(Json(TransferDraftResponse {
        message_id: receipt.message_id,
        thread_id: receipt.thread_id,
        source_id: receipt.source_id,
        source_thread_id: receipt.source_thread_id,
        attachments: receipt.attachments.into_iter().map(Into::into).collect(),
    }))
}

/// A null result confirms that the move cannot commit, even if its request was delayed.
#[derive(Serialize, ToSchema)]
pub struct TransferRecoveryResponse {
    pub committed: Option<TransferDraftResponse>,
}
#[utoipa::path(post,tag="Drafts",path="/email/draft-transfers/{id}/recover",operation_id="recover_draft_transfer",
    params(("id"=Uuid,Path)),responses((status=200,body=TransferRecoveryResponse),(status=403),(status=500)))]
pub async fn recover(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Result<Json<TransferRecoveryResponse>, UpdateThreadLabelError> {
    let result = ctx
        .draft_transfers
        .recover(authorization.authorization.user.macro_user_id, id)
        .await?;
    Ok(Json(TransferRecoveryResponse {
        committed: result.map(|r| TransferDraftResponse {
            message_id: r.message_id,
            thread_id: r.thread_id,
            source_id: r.source_id,
            source_thread_id: r.source_thread_id,
            attachments: r.attachments.into_iter().map(Into::into).collect(),
        }),
    }))
}
