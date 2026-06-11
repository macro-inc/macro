use std::borrow::Cow;
use std::net::{IpAddr, Ipv4Addr};

use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use fusionauth::identity_provider::{IdentityProviderLink, LinkUserRequest};
use macro_middleware::auth::internal_access::ValidInternalKey;
use model::response::ErrorResponse;

use crate::api::context::ApiContext;

const GMAIL_IDP_NAME: &str = "google_gmail";

#[derive(serde::Deserialize, Debug)]
pub struct RelocateInboxGrantRequest {
    /// The shared mailbox address whose grant should move to a dedicated user.
    pub email: String,
    /// The connector whose FusionAuth user currently holds the mailbox's Google grant.
    pub owner_fusionauth_user_id: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, utoipa::ToSchema)]
pub struct RelocateInboxGrantResponse {
    /// The dedicated FusionAuth user that now holds the mailbox grant.
    pub shared_fusionauth_user_id: String,
}

/// Provisions a dedicated FusionAuth user for a shared mailbox and relocates the mailbox's
/// Google grant onto it, so the inbox keeps syncing no matter which connector stays.
///
/// A Google identity binds to exactly one FusionAuth user, so the grant is moved by
/// unlinking it from the owner and re-linking it to the shared user. If the re-link fails
/// the owner is re-linked (rollback) so the inbox keeps syncing on the original grant.
/// Idempotent: returns the shared user unchanged when the grant already lives there.
#[tracing::instrument(skip(ctx, _valid_access))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _valid_access: ValidInternalKey,
    extract::Json(RelocateInboxGrantRequest {
        email,
        owner_fusionauth_user_id,
    }): extract::Json<RelocateInboxGrantRequest>,
) -> Result<Response, Response> {
    let auth = &ctx.auth_client;
    let server_error = |message: &str| -> Response {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    };

    let idp_id = auth
        .get_identity_provider_id_by_name(GMAIL_IDP_NAME)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "relocate_inbox_grant: failed to get identity provider id");
            server_error("unable to get identity provider id")
        })?;

    // Get-or-create the dedicated mailbox user. The signup webhook no-ops here because the
    // verified MacroDB User for this mailbox already exists (created during promotion), so no
    // Stripe customer is provisioned.
    let shared_user_id = match auth.get_user_id_by_email(&email).await {
        Ok(id) => id,
        Err(fusionauth::error::FusionAuthClientError::UserDoesNotExist) => auth
            .create_user(
                fusionauth::user::create::User {
                    email: Cow::Borrowed(&email),
                    password: Cow::Owned(uuid::Uuid::new_v4().to_string()),
                    username: Some(Cow::Borrowed(&email)),
                },
                true,
                IpAddr::V4(Ipv4Addr::LOCALHOST),
            )
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "relocate_inbox_grant: failed to create shared mailbox user");
                server_error("unable to create shared mailbox user")
            })?,
        Err(e) => {
            tracing::error!(error=?e, "relocate_inbox_grant: failed to look up shared mailbox user");
            return Err(server_error("unable to look up shared mailbox user"));
        }
    };

    // Idempotent: if the grant already lives on the shared user, nothing to do.
    let shared_links = auth
        .get_links(&shared_user_id, Some(idp_id.clone()))
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "relocate_inbox_grant: failed to read shared user links");
            server_error("unable to read shared user links")
        })?;
    if shared_links.iter().any(|l| l.display_name == email) {
        return Ok((
            StatusCode::OK,
            Json(RelocateInboxGrantResponse {
                shared_fusionauth_user_id: shared_user_id,
            }),
        )
            .into_response());
    }

    // Capture the grant from the owner before moving it.
    let owner_links = auth
        .get_links(&owner_fusionauth_user_id, Some(idp_id.clone()))
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "relocate_inbox_grant: failed to read owner links");
            server_error("unable to read owner links")
        })?;
    let Some(owner_link) = owner_links.into_iter().find(|l| l.display_name == email) else {
        tracing::error!(
            email = %email,
            owner = %owner_fusionauth_user_id,
            "relocate_inbox_grant: owner holds no grant for mailbox"
        );
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "owner holds no grant for mailbox".into(),
            }),
        )
            .into_response());
    };
    let sub = owner_link.identity_provider_user_id;
    let token = owner_link.token;

    let link_to = |user_id: &str| LinkUserRequest {
        identity_provider_link: IdentityProviderLink {
            display_name: Cow::Owned(email.clone()),
            identity_provider_id: Cow::Owned(idp_id.clone()),
            identity_provider_user_id: Cow::Owned(sub.clone()),
            user_id: Cow::Owned(user_id.to_string()),
            token: Cow::Owned(token.clone()),
        },
    };

    auth.unlink_user(&owner_fusionauth_user_id, &idp_id, &sub)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "relocate_inbox_grant: failed to unlink owner grant");
            server_error("unable to unlink owner grant")
        })?;

    if let Err(e) = auth.link_user(link_to(&shared_user_id)).await {
        tracing::error!(error=?e, "relocate_inbox_grant: failed to link grant to shared user; rolling back to owner");
        // Roll back so the inbox keeps syncing on the owner's grant rather than ending up
        // with the grant attached to no one.
        if let Err(rollback) = auth.link_user(link_to(&owner_fusionauth_user_id)).await {
            tracing::error!(error=?rollback, "relocate_inbox_grant: rollback re-link to owner also failed; grant is detached");
        }
        return Err(server_error("unable to link grant to shared user"));
    }

    Ok((
        StatusCode::OK,
        Json(RelocateInboxGrantResponse {
            shared_fusionauth_user_id: shared_user_id,
        }),
    )
        .into_response())
}
