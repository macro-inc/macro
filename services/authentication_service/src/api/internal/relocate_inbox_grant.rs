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
    /// When set, the dedicated user is created with this id, keeping the FusionAuth id
    /// aligned with the mailbox's minted `macro_user.id`.
    #[serde(default)]
    pub desired_user_id: Option<String>,
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
///
/// The dedicated user ends up **deactivated**: it exists only to hold the grant (token
/// refresh reads the stored link directly and never authenticates the user), so leaving
/// it active would expose unintended sign-in paths — Google login, passwordless, and
/// password reset all resolve to it by email/identity. Links are only ever created while
/// the user is active, so an existing deactivated stub is reactivated for the duration
/// of the relink and deactivated again afterwards.
#[tracing::instrument(skip(ctx, _valid_access))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _valid_access: ValidInternalKey,
    extract::Json(RelocateInboxGrantRequest {
        email,
        owner_fusionauth_user_id,
        desired_user_id,
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
    // Stripe customer is provisioned. Freshly created users start active; they are
    // deactivated once the grant is in place.
    let shared_user_id = match auth.get_user_id_by_email(&email).await {
        Ok(id) => id,
        Err(fusionauth::error::FusionAuthClientError::UserDoesNotExist) => {
            let user = fusionauth::user::create::User {
                email: Cow::Borrowed(&email),
                password: Cow::Owned(uuid::Uuid::new_v4().to_string()),
                username: Some(Cow::Borrowed(&email)),
            };
            let created = match &desired_user_id {
                Some(id) => {
                    auth.create_user_with_id(id, user, true, IpAddr::V4(Ipv4Addr::LOCALHOST))
                        .await
                }
                None => {
                    auth.create_user(user, true, IpAddr::V4(Ipv4Addr::LOCALHOST))
                        .await
                }
            };
            created.map_err(|e| {
                tracing::error!(error=?e, "relocate_inbox_grant: failed to create shared mailbox user");
                server_error("unable to create shared mailbox user")
            })?
        }
        Err(e) => {
            tracing::error!(error=?e, "relocate_inbox_grant: failed to look up shared mailbox user");
            return Err(server_error("unable to look up shared mailbox user"));
        }
    };

    // Deliberately best-effort: by the time this runs the grant has already moved to the
    // stub, and the caller re-homes the link's fusionauth_user_id only on a success
    // response. Failing the request here would skip that re-home and break token
    // resolution for the inbox — a hard failure — whereas an active stub merely retains
    // the pre-deactivation security posture until the next relocation converges it.
    let ensure_deactivated = |user_id: String| async move {
        match auth.get_user_active(&user_id).await {
            Ok(false) => {}
            Ok(true) => {
                if let Err(e) = auth.deactivate_user(&user_id).await {
                    tracing::error!(error=?e, %user_id, "relocate_inbox_grant: failed to deactivate shared mailbox user");
                }
            }
            Err(e) => {
                tracing::error!(error=?e, %user_id, "relocate_inbox_grant: failed to read shared mailbox user state");
            }
        }
    };

    // Idempotent: if the grant already lives on the shared user, just converge it to the
    // deactivated end-state.
    let shared_links = auth
        .get_links(&shared_user_id, Some(idp_id.clone()))
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "relocate_inbox_grant: failed to read shared user links");
            server_error("unable to read shared user links")
        })?;
    if shared_links.iter().any(|l| l.display_name == email) {
        ensure_deactivated(shared_user_id.clone()).await;
        return Ok((
            StatusCode::OK,
            Json(RelocateInboxGrantResponse {
                shared_fusionauth_user_id: shared_user_id,
            }),
        )
            .into_response());
    }

    // Links are only created against active users; a pre-existing stub from an earlier
    // partial relocation may be deactivated, so reactivate it for the relink.
    match auth.get_user_active(&shared_user_id).await {
        Ok(true) => {}
        Ok(false) => {
            auth.reactivate_user(&shared_user_id).await.map_err(|e| {
                tracing::error!(error=?e, "relocate_inbox_grant: failed to reactivate shared mailbox user");
                server_error("unable to reactivate shared mailbox user")
            })?;
        }
        Err(e) => {
            tracing::error!(error=?e, "relocate_inbox_grant: failed to read shared mailbox user state");
            return Err(server_error("unable to read shared mailbox user state"));
        }
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
        // Don't leave an active, grant-less stub squatting the mailbox email.
        ensure_deactivated(shared_user_id).await;
        return Err(server_error("unable to link grant to shared user"));
    }

    ensure_deactivated(shared_user_id.clone()).await;

    Ok((
        StatusCode::OK,
        Json(RelocateInboxGrantResponse {
            shared_fusionauth_user_id: shared_user_id,
        }),
    )
        .into_response())
}
