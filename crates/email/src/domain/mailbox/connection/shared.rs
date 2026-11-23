use super::*;
use models_email::service::link::Link;

pub(super) async fn relocate<L: ConnectionLinks, P: ConnectionProvider>(
    links: &L,
    provider: &P,
    linked_email: &str,
    existing_link: &Link,
    promoted: &SharedInboxPromotion,
) {
    match provider
        .relocate_grant(
            linked_email,
            &existing_link.fusionauth_user_id,
            &promoted.mailbox_fusion_id.to_string(),
        )
        .await
    {
        Ok(shared_fusionauth_user_id) => {
            const MAX_LINK_UPDATE_ATTEMPTS: u32 = 3;
            for attempt in 1..=MAX_LINK_UPDATE_ATTEMPTS {
                match links
                    .set_credential_owner(promoted.link_id, &shared_fusionauth_user_id)
                    .await
                {
                    Ok(()) => break,
                    Err(e) if attempt < MAX_LINK_UPDATE_ATTEMPTS => {
                        tracing::warn!(error=?e, attempt, "Retrying link fusionauth_user_id update after grant relocation");
                        tokio::time::sleep(std::time::Duration::from_millis(
                            200 * u64::from(attempt),
                        ))
                        .await;
                    }
                    Err(e) => {
                        tracing::error!(
                            error=?e,
                            link_id=%promoted.link_id,
                            shared_fusionauth_user_id=%shared_fusionauth_user_id,
                            "Failed to re-home link fusionauth_user_id after grant relocation; inbox token fetches will fail until the link is re-homed to the shared user"
                        );
                    }
                }
            }
        }
        Err(e) => {
            tracing::error!(error=?e, "Failed to relocate shared-inbox grant; inbox keeps syncing under the original owner's grant");
        }
    }
}
