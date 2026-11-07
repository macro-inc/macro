use super::*;
use calendar_events::domain::models::{AppliedGoogleGrant, CalendarGrantIntent};
use models_email::service::link::Link;
use uuid::Uuid;

pub(super) async fn apply_and_consume<G: ConnectionGrants>(
    grants: &G,
    link: Uuid,
    attempt: Uuid,
    grant: &CompletedGoogleGrant,
) -> Result<AppliedGoogleGrant, ConnectionError> {
    let applied = grants
        .apply(link, &grant.granted_scopes, grant.intent)
        .await?;
    grants.consume(attempt).await?;
    grants.clear_reauth(link).await;
    Ok(applied)
}

pub(super) async fn discover<G: ConnectionGrants, P: ConnectionProvider>(
    grants: &G,
    provider: &P,
    link: &Link,
) {
    if !grants.unrecorded(link.id).await {
        return;
    }
    let token = match provider.fresh_token(link.id).await {
        Ok(token) => token,
        Err(error) => {
            tracing::warn!(error = ?error, link_id = %link.id, "skipping grant discovery: no Google token");
            return;
        }
    };
    match provider.token_scopes(&token).await {
        Ok(scopes) => {
            grants.apply(link.id, &scopes, CalendarGrantIntent::Incidental).await
                .inspect_err(|error| {
                    tracing::warn!(error = ?error, link_id = %link.id, "failed to apply discovered Google grant");
                })
                .ok();
        }
        Err(error) => {
            tracing::warn!(error = ?error, link_id = %link.id, "failed to discover Google token scopes");
        }
    }
}
