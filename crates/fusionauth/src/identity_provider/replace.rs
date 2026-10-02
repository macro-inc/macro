use crate::{
    FusionAuthClient,
    identity_provider::{IdentityProviderLink, LinkUserRequest},
};
use std::borrow::Cow;

/// Replaces the refresh token on an existing identity-provider link.
///
/// FusionAuth does not update a link when `link_user` reports that it already
/// exists, so reconnects must unlink and recreate it. The stale link is restored
/// if the replacement fails. Deactivated stub users are activated only for the
/// swap and then returned to their previous state.
#[tracing::instrument(skip(auth_client, display_name, fresh_refresh_token), err(Debug))]
pub(super) async fn replace_identity_provider_grant(
    auth_client: &FusionAuthClient,
    identity_provider_id: &str,
    link_owner_id: &str,
    display_name: &str,
    subject: Option<&str>,
    fresh_refresh_token: &str,
) -> crate::Result<()> {
    let server_error =
        |message: String| crate::error::FusionAuthClientError::from(anyhow::anyhow!(message));

    if fresh_refresh_token.is_empty() {
        tracing::info!(
            fusion_user_id = %link_owner_id,
            "identity-provider link already exists and no fresh refresh token was returned; leaving existing grant"
        );
        return Ok(());
    }

    let existing_links = auth_client
        .get_links(link_owner_id, Some(identity_provider_id.to_string()))
        .await
        .map_err(|error| server_error(format!("unable to read existing links {error}")))?;

    let Some(existing_link) = existing_links.into_iter().find(|link| match subject {
        Some(subject) => link.identity_provider_user_id == subject,
        None => link.display_name == display_name,
    }) else {
        tracing::warn!(
            fusion_user_id = %link_owner_id,
            "grant replacement found no matching link on the resolved owner"
        );
        // Legacy callers select by a mutable display name and historically leave
        // the existing grant untouched when it cannot be found. Only verified
        // subject selection can treat a missing match as a definite failure.
        if subject.is_none() {
            return Ok(());
        }
        return Err(server_error(
            "no matching identity-provider grant on its resolved owner".to_string(),
        ));
    };

    if existing_link.token == fresh_refresh_token {
        return Ok(());
    }

    let identity_provider_user_id = existing_link.identity_provider_user_id;
    let stale_refresh_token = existing_link.token;
    let was_active = auth_client
        .get_user_active(link_owner_id)
        .await
        .map_err(|error| server_error(format!("unable to read user active state {error}")))?;

    if !was_active {
        auth_client
            .reactivate_user(link_owner_id)
            .await
            .map_err(|error| {
                server_error(format!("unable to reactivate user for relink {error}"))
            })?;
    }

    let link_with_token = |refresh_token: &str| LinkUserRequest {
        identity_provider_link: IdentityProviderLink {
            display_name: Cow::Owned(display_name.to_string()),
            identity_provider_id: Cow::Borrowed(identity_provider_id),
            identity_provider_user_id: Cow::Borrowed(&identity_provider_user_id),
            user_id: Cow::Borrowed(link_owner_id),
            token: Cow::Owned(refresh_token.to_string()),
        },
    };

    let swap_result: crate::Result<()> = async {
        auth_client
            .unlink_user(
                link_owner_id,
                identity_provider_id,
                &identity_provider_user_id,
            )
            .await
            .map_err(|error| server_error(format!("unable to unlink stale grant {error}")))?;

        let link_result = auth_client
            .link_user(link_with_token(fresh_refresh_token))
            .await;

        if let Err(error) = &link_result {
            tracing::error!(error=?error, "failed to attach fresh grant; rolling back to stale token");
            if let Err(rollback_error) = auth_client
                .link_user(link_with_token(&stale_refresh_token))
                .await
            {
                tracing::error!(error=?rollback_error, "grant rollback also failed; identity-provider link is detached");
            }
        }

        link_result.map_err(|error| {
            server_error(format!("unable to attach fresh grant {error}"))
        })
    }
    .await;

    if !was_active && let Err(error) = auth_client.deactivate_user(link_owner_id).await {
        tracing::error!(
            error=?error,
            %link_owner_id,
            "failed to re-deactivate stub after grant replacement"
        );
    }

    swap_result
}
