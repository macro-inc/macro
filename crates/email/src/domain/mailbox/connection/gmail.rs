use super::*;
use anyhow::Context;
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use models_email::service::link::{Link, UserProvider};

pub(super) async fn connect<L, T, P, G, I, B, N, O>(
    service: &InboxConnectionService<L, T, P, G, I, B, N, O>,
    request: &ConnectionRequest,
) -> Result<ConnectionOutcome, ConnectionError>
where
    L: ConnectionLinks,
    T: ConnectionTransactions,
    P: ConnectionProvider,
    G: ConnectionGrants,
    B: ConnectionBackfill,
    N: ConnectionIdentity,
{
    let link_id = request.attempt;
    tracing::info!(user_id = %request.actor_id, ?link_id, "Init called");
    let mut completed_google_grant = None;
    let link = if let Some(link_id) = link_id {
        let attempt = service
            .links
            .attempt(link_id)
            .await
            .map_err(|error| database(error, "Failed to fetch in_progress_user_link"))?;
        if attempt.provider != "GMAIL" {
            return Err(ConnectionError::InvalidAttemptProvider);
        }
        let completed_grant = CompletedGoogleGrant::from_attempt(&attempt);
        completed_google_grant = Some(completed_grant.clone());
        if attempt.owner.to_string() != request.actor_fusion_id {
            return Err(ConnectionError::AttemptOwnerMismatch);
        }
        let linked_email = attempt
            .email
            .ok_or(ConnectionError::AttemptAuthenticationIncomplete)?;
        let existing_owner = service
            .links
            .account_for_email(&linked_email)
            .await
            .map_err(|error| {
                database(
                    error,
                    "Failed to look up existing macro user by linked_email",
                )
            })?;
        if let Some(child_macro_id) = existing_owner.as_deref()
            && child_macro_id != request.actor_id
        {
            let child = service
                .links
                .link_for_email(&linked_email)
                .await
                .map_err(|error| {
                    database(error, "Failed to look up child link before delegation")
                })?;
            if let Some(child_link) = child {
                service
                    .transactions
                    .delegate(
                        &request.actor_id,
                        &linked_email,
                        child_macro_id,
                        child_link.id,
                    )
                    .await?;
                grants::apply_and_consume(
                    &service.grants,
                    child_link.id,
                    link_id,
                    &completed_grant,
                )
                .await?;
                return Ok(ConnectionOutcome {
                    link_id: child_link.id,
                    backfill_job_id: None,
                });
            }
            let child_macro_id_owned = MacroUserIdStr::try_from(child_macro_id.to_string())?;
            let child_fusion_id = service
                .links
                .account_fusion_id(&linked_email)
                .await
                .map_err(|error| {
                    database(
                        error,
                        "Failed to look up child's fusion id for self-link bootstrap",
                    )
                })?
                .context("child macro user disappeared before self-link bootstrap")?
                .to_string();
            let provisional =
                new_gmail_link(child_fusion_id, child_macro_id_owned, linked_email.clone())?;
            let cursor = service
                .provider
                .register_watch(&provisional)
                .await
                .map_err(classify_provider_init_error)?;
            service
                .transactions
                .bootstrap(
                    &request.actor_id,
                    &linked_email,
                    child_macro_id,
                    provisional,
                    &cursor,
                )
                .await?
        } else {
            if let Some(existing_link_id) = service
                .links
                .link_for_grant(&request.actor_fusion_id, &linked_email)
                .await
                .map_err(|error| database(error, "Failed to check existing link by email"))?
            {
                let applied = grants::apply_and_consume(
                    &service.grants,
                    existing_link_id,
                    link_id,
                    &completed_grant,
                )
                .await?;
                tracing::info!(
                    link_id = %existing_link_id,
                    grant_version = applied.grant_version,
                    changed = applied.changed,
                    calendar_jobs = applied.jobs.len(),
                    "Applied Google permission upgrade to existing inbox"
                );
                return Ok(ConnectionOutcome {
                    link_id: existing_link_id,
                    backfill_job_id: None,
                });
            }
            if existing_owner.is_none()
                && let Some(existing_link) = service
                    .links
                    .link_for_email(&linked_email)
                    .await
                    .map_err(|error| {
                        database(
                            error,
                            "Failed to look up existing link for shared-mailbox dedup",
                        )
                    })?
                && existing_link.macro_id.as_ref() != request.actor_id.as_str()
            {
                if !request.force_share {
                    return Err(ConnectionError::SharedInboxConflict {
                        email_address: linked_email.clone(),
                        existing_owner_email: existing_link.macro_id.email_str().to_string(),
                        existing_link_id: existing_link.id,
                    });
                }
                let organization = service
                    .links
                    .organization(existing_link.macro_id.as_ref())
                    .await
                    .map_err(|error| {
                        database(error, "Failed to fetch organization for shared-inbox owner")
                    })?;
                let promoted = service
                    .transactions
                    .promote(
                        &request.actor_id,
                        &linked_email,
                        &existing_link,
                        organization,
                    )
                    .await?;
                shared::relocate(
                    &service.links,
                    &service.provider,
                    &linked_email,
                    &existing_link,
                    &promoted,
                )
                .await;
                grants::apply_and_consume(
                    &service.grants,
                    promoted.link_id,
                    link_id,
                    &completed_grant,
                )
                .await?;
                return Ok(ConnectionOutcome {
                    link_id: promoted.link_id,
                    backfill_job_id: None,
                });
            }
            let provisional = new_gmail_link(
                request.actor_fusion_id.clone(),
                request.actor_macro_id.clone(),
                linked_email,
            )?;
            let cursor = service
                .provider
                .register_watch(&provisional)
                .await
                .map_err(classify_provider_init_error)?;
            service
                .transactions
                .create(&request.actor_id, provisional, &cursor)
                .await?
        }
    } else {
        let existing = service
            .links
            .link_for_identity(&request.actor_fusion_id, request.actor_macro_id.clone())
            .await
            .map_err(|error| database(error, "Failed to fetch existing link"))?;
        if existing.is_some() {
            return Err(ConnectionError::AlreadyInitialized);
        }
        let email = service.identity.login_email(&request.actor_id)?;
        let provisional = new_gmail_link(
            request.actor_fusion_id.clone(),
            request.actor_macro_id.clone(),
            email,
        )?;
        let cursor = service
            .provider
            .register_watch(&provisional)
            .await
            .map_err(classify_provider_init_error)?;
        service
            .transactions
            .create(&request.actor_id, provisional, &cursor)
            .await?
    };
    if let (Some(grant), Some(link_id)) = (completed_google_grant.as_ref(), link_id) {
        grants::apply_and_consume(&service.grants, link.id, link_id, grant).await?;
    } else if completed_google_grant.is_none() {
        grants::discover(&service.grants, &service.provider, &link).await;
    }
    let job = service.backfill.start(&link).await?;
    Ok(ConnectionOutcome {
        link_id: link.id,
        backfill_job_id: Some(job),
    })
}

fn new_gmail_link(
    fusion_user_id: String,
    macro_id: MacroUserIdStr<'static>,
    email_address: String,
) -> Result<Link, ConnectionError> {
    let email_address = EmailStr::try_from(email_address)?;
    let is_primary = Link::derive_is_primary(&macro_id, &email_address);
    Ok(Link {
        id: macro_uuid::generate_uuid_v7(),
        macro_id,
        fusionauth_user_id: fusion_user_id,
        email_address,
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    })
}
