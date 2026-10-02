use super::*;
use crate::inbox_owner::InboxOwnerService;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::service::link::{Link, UserProvider};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = ".", scripts("fixture"))
)]
async fn secondary_grant_owner_bootstrap_delegates_only_the_authorized_mailbox(
    pool: PgPool,
) -> Result<(), rootcause::Report> {
    let old_owner = Uuid::parse_str("01900000-0000-7000-8000-000000000001")
        .map_err(|error| rootcause::report!("{error:?}"))?;
    let requester = Uuid::parse_str("01900000-0000-7000-8000-000000000002")
        .map_err(|error| rootcause::report!("{error:?}"))?;
    let service = InboxOwnerService {
        repo: PgInboxOwners(pool.clone()),
    };
    let pending = macro_db_client::in_progress_user_link::create_in_progress_google_link(
        &pool,
        &requester.to_string(),
        &[],
    )
    .await
    .map_err(|error| rootcause::report!("{error:?}"))?;
    macro_db_client::in_progress_user_link::set_linked_google_grant(
        &pool,
        &pending,
        "secondary@example.com",
        &[],
        old_owner,
    )
    .await
    .map_err(|error| rootcause::report!("{error:?}"))?;
    let grant = macro_db_client::in_progress_user_link::get_in_progress_user_link(&pool, &pending)
        .await
        .map_err(|error| rootcause::report!("{error:?}"))?;
    // Consent completion must not overwrite the caller who is allowed to consume this record.
    assert_eq!(grant.macro_user_id, requester);
    let owner = service
        .resolve(
            grant.linked_email.as_deref().unwrap(),
            grant.google_grant_owner_id,
            requester,
        )
        .await
        .map_err(|error| rootcause::report!("{error:?}"))?
        .unwrap();
    assert_eq!(owner.macro_id.as_ref(), "macro|older@example.com");
    assert_eq!(owner.fusionauth_id, old_owner);
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| rootcause::report!("{error:?}"))?;
    let link = email_db_client::links::insert::upsert_link(
        tx.as_mut(),
        Link {
            id: Uuid::now_v7(),
            macro_id: owner.macro_id.clone(),
            fusionauth_user_id: owner.fusionauth_id.to_string(),
            email_address: macro_user_id::email::EmailStr::try_from(
                "secondary@example.com".to_string(),
            )
            .map_err(|error| rootcause::report!("{error:?}"))?,
            provider: UserProvider::Gmail,
            is_sync_active: true,
            is_primary: false,
            needs_reauth: false,
            last_sync_error_at: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        },
    )
    .await
    .map_err(|error| rootcause::report!("{error:?}"))?;
    macro_db_client::macro_user_links::insert_edge(
        tx.as_mut(),
        "macro|requester@example.com",
        owner.macro_id.as_ref(),
        link.id,
    )
    .await
    .map_err(|error| rootcause::report!("{error:?}"))?;
    tx.commit()
        .await
        .map_err(|error| rootcause::report!("{error:?}"))?;
    let accessible = email_db_client::links::get::fetch_inboxes_for_macro_id(
        &pool,
        "macro|requester@example.com",
    )
    .await
    .map_err(|error| rootcause::report!("{error:?}"))?;
    // Retries and reconnects keep the same owner instead of prompting to promote
    // the mailbox into a shared account (which would move its Google sign-in).
    let retry_owner = service
        .resolve("secondary@example.com", Some(old_owner), requester)
        .await?
        .unwrap();
    assert_eq!(retry_owner.fusionauth_id, old_owner);
    assert_eq!(accessible.len(), 1);
    assert_eq!(accessible[0].id, link.id);
    assert_eq!(
        accessible[0].email_address.0.as_ref(),
        "secondary@example.com"
    );
    assert_eq!(accessible[0].fusionauth_user_id, old_owner.to_string());
    assert_eq!(
        email_db_client::links::get::fetch_inboxes_for_macro_id(&pool, "macro|older@example.com")
            .await
            .map_err(|error| rootcause::report!("{error:?}"))?
            .len(),
        2
    );

    // A separately confirmed shared-inbox promotion can commit before grant
    // relocation succeeds. Its profile changes, but its existing token owner
    // stays valid; reconnect must continue to resolve the shared profile.
    let mut tx = pool.begin().await?;
    let promoted = macro_db_client::shared_inbox::promote_link_to_shared(
        tx.as_mut(),
        link.id,
        owner.macro_id.as_ref(),
        "macro|requester@example.com",
        "secondary@example.com",
        None,
    )
    .await
    .map_err(|error| rootcause::report!("{error:?}"))?;
    tx.commit().await?;
    let shared_owner = service
        .resolve("secondary@example.com", Some(old_owner), requester)
        .await?
        .unwrap();
    assert_eq!(shared_owner.macro_id.as_ref(), promoted.mailbox_macro_id);
    assert_eq!(shared_owner.fusionauth_id, promoted.mailbox_fusion_id);
    assert_ne!(shared_owner.fusionauth_id, old_owner);
    assert!(
        service
            .repo
            .inbox_uses_grant("secondary@example.com", &shared_owner.macro_id, old_owner)
            .await?
    );
    // Neither a matching email alone nor an unrelated profile proves ownership.
    assert!(
        !service
            .repo
            .inbox_uses_grant("secondary@example.com", &shared_owner.macro_id, requester)
            .await?
    );
    assert!(
        !service
            .repo
            .inbox_uses_grant("secondary@example.com", &owner.macro_id, old_owner)
            .await?
    );
    assert!(
        service
            .resolve("secondary@example.com", Some(requester), requester)
            .await
            .is_err()
    );
    Ok(())
}
