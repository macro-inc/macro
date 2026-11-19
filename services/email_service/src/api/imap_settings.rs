//! Settings for one authenticated owner, fenced to the current credential generation.
use super::{
    context::{ApiContext, AuthorizationService},
    imap::{ConnectionError, ImapConnectionErrorResponse},
};
use axum::{
    Json,
    extract::{Path, State},
};
use email::domain::mailbox::imap_settings::{AccountMailSettings, UpdateFolderSettings};
use macro_authorization::{AccountHolderOrInternal, MacroAuthorizationExtractor};
use uuid::Uuid;

#[utoipa::path(get,path="/email/links/{link_id}/imap/settings",params(("link_id"=Uuid,Path)),operation_id="get_imap_mailbox_settings",responses((status=200,body=AccountMailSettings),(status=404,body=ImapConnectionErrorResponse)))]
#[tracing::instrument(skip_all,fields(link_id=%link),err)]
pub(crate) async fn get_settings(
    State(ctx): State<ApiContext>,
    Path(link): Path<Uuid>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, AccountHolderOrInternal>,
) -> Result<Json<AccountMailSettings>, ConnectionError> {
    Ok(Json(
        ctx.imap_connections
            .mail_settings(&authorization.authorization.user.macro_user_id, link)
            .await?,
    ))
}

#[utoipa::path(patch,path="/email/links/{link_id}/imap/settings",params(("link_id"=Uuid,Path)),operation_id="update_imap_mailbox_settings",request_body=UpdateFolderSettings,responses((status=200,body=AccountMailSettings),(status=400,body=ImapConnectionErrorResponse),(status=404,body=ImapConnectionErrorResponse),(status=409,body=ImapConnectionErrorResponse)))]
#[tracing::instrument(skip_all,fields(link_id=%link),err)]
pub(crate) async fn update_settings(
    State(ctx): State<ApiContext>,
    Path(link): Path<Uuid>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, AccountHolderOrInternal>,
    Json(change): Json<UpdateFolderSettings>,
) -> Result<Json<AccountMailSettings>, ConnectionError> {
    Ok(Json(
        ctx.imap_connections
            .edit_mail_settings(
                &authorization.authorization.user.macro_user_id,
                link,
                &change,
            )
            .await?,
    ))
}
