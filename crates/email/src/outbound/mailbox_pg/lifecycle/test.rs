use super::*;
use crate::domain::mailbox::credentials::{CredentialHealth, MailboxCredentialHealthRepository};
use email_api_client::domain::models::{MailboxAccess, TokenError};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;

struct Effects;
impl InboxLifecycleEffects for Effects {
    async fn apply(&self, _: Uuid, _: &InboxLifecycleEffect) -> Result<(), MailboxError> {
        Ok(())
    }
}
fn actor(name: &str) -> InboxActor {
    InboxActor {
        macro_id: MacroUserIdStr::try_from(format!("macro|{name}@example.com")).unwrap(),
        credential_owner: format!("{name}-owner"),
    }
}
async fn user(db: &PgPool, name: &str) {
    let id = macro_uuid::generate_uuid_v7();
    let actor = actor(name);
    sqlx::query!(
        "INSERT INTO macro_user(id,username,email,stripe_customer_id) VALUES ($1,$2,$3,$4)",
        id,
        name,
        format!("{name}@example.com"),
        format!("cus_{name}")
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User"(id,email,macro_user_id) VALUES ($1,$2,$3)"#,
        actor.macro_id.as_ref(),
        format!("{name}@example.com"),
        id
    )
    .execute(db)
    .await
    .unwrap();
}
async fn shared(db: &PgPool) -> (PgMailboxSync, Uuid, Uuid) {
    let (repo, link) = super::super::test::fixture(db).await;
    for name in ["shared", "leaving", "remaining"] {
        user(db, name).await;
    }
    let old = macro_uuid::generate_uuid_v7();
    let replacement = macro_uuid::generate_uuid_v7();
    sqlx::query!("UPDATE email_links SET macro_id = 'macro|shared@example.com',fusionauth_user_id = 'leaving-owner',grant_id = $2 WHERE id = $1",link,old).execute(db).await.unwrap();
    sqlx::query!(
        "INSERT INTO promoted_shared_mailboxes(macro_id) VALUES ('macro|shared@example.com')"
    )
    .execute(db)
    .await
    .unwrap();
    for (name, grant) in [("leaving", old), ("remaining", replacement)] {
        let actor = actor(name);
        sqlx::query!("INSERT INTO macro_user_links(primary_macro_id,child_macro_id,link_id) VALUES ($1,'macro|shared@example.com',$2)",actor.macro_id.as_ref(),link).execute(db).await.unwrap();
        sqlx::query!("INSERT INTO email_mailbox_custodians(link_id,actor_id,fusionauth_user_id,grant_id,grant_generation,granted_scopes) VALUES ($1,$2,$3,$4,1,'{User.Read,Mail.ReadWrite,Mail.Send}')",link,actor.macro_id.as_ref(),actor.credential_owner,grant).execute(db).await.unwrap();
    }
    (repo, link, replacement)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn leaving_shared_custodian_rebinds_work_and_rejects_old_health_even_with_equal_grant_numbers(
    db: PgPool,
) {
    let (repo, link, replacement) = shared(&db).await;
    let service = InboxLifecycleService::new(repo.clone(), Effects);
    service.remove(&actor("leaving"), link).await.unwrap();
    let row=sqlx::query!("SELECT macro_id,is_sync_active,needs_reauth,grant_id,grant_generation,sync_generation,fusionauth_user_id FROM email_links WHERE id = $1",link).fetch_one(&db).await.unwrap();
    assert_eq!(row.macro_id, "macro|shared@example.com");
    assert!(row.is_sync_active);
    assert!(!row.needs_reauth);
    assert_eq!(row.grant_id, Some(replacement));
    assert_eq!(row.grant_generation, 1);
    assert_eq!(row.sync_generation, 2);
    assert_eq!(row.fusionauth_user_id, "remaining-owner");
    assert!(matches!(
        repo.record(
            MailboxAccess {
                link_id: link,
                grant_generation: 1,
                sync_generation: 1
            },
            CredentialHealth::ReauthorizationRequired
        )
        .await,
        Err(TokenError::ReauthRequired)
    ));
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM email_sync_streams WHERE link_id = $1 AND generation = 2",
            link
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(1)
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT primary_macro_id FROM macro_user_links WHERE link_id = $1",
            link
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        "macro|remaining@example.com"
    );
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM email_mailbox_lifecycle_outbox WHERE link_id = $1 AND payload->>'kind' = 'delete_mailbox'",link).fetch_one(&db).await.unwrap(),Some(0));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn no_replacement_preserves_the_inbox_and_notifies_remaining_viewers_to_reconnect(
    db: PgPool,
) {
    let (repo, link, _) = shared(&db).await;
    sqlx::query!("DELETE FROM email_mailbox_custodians WHERE link_id = $1 AND actor_id = 'macro|remaining@example.com'",link).execute(&db).await.unwrap();
    InboxLifecycleService::new(repo, Effects)
        .remove(&actor("leaving"), link)
        .await
        .unwrap();
    let row = sqlx::query!(
        "SELECT is_sync_active,needs_reauth,grant_id FROM email_links WHERE id = $1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(row.is_sync_active && row.needs_reauth);
    assert_eq!(row.grant_id, None);
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM email_projection_outbox WHERE link_id = $1 AND payload->>'kind' = 'reauthorization_required'",link).fetch_one(&db).await.unwrap(),Some(1));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn final_shared_disconnect_freezes_ingestion_and_keeps_revocation_after_cascade(db: PgPool) {
    let (repo, link, _) = shared(&db).await;
    let service = InboxLifecycleService::new(repo.clone(), Effects);
    service.remove(&actor("remaining"), link).await.unwrap();
    service.remove(&actor("leaving"), link).await.unwrap();
    let row = sqlx::query!(
        "SELECT is_sync_active,disconnect_requested_at FROM email_links WHERE id = $1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(!row.is_sync_active);
    assert!(row.disconnect_requested_at.is_some());
    assert!(
        repo.claim_stream(macro_uuid::generate_uuid_v7())
            .await
            .unwrap()
            .is_none()
    );
    sqlx::query!("DELETE FROM email_links WHERE id = $1", link)
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM email_mailbox_lifecycle_outbox WHERE link_id = $1 AND payload->>'kind' = 'revoke_microsoft_grant'",link).fetch_one(&db).await.unwrap(),Some(2));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_macro_account_releases_only_its_shared_participation(db: PgPool) {
    let (repo, link, replacement) = shared(&db).await;
    // The authentication account deletion may already have cascaded its edge.
    sqlx::query!(r#"DELETE FROM "User" WHERE id = 'macro|leaving@example.com'"#)
        .execute(&db)
        .await
        .unwrap();
    InboxLifecycleService::new(repo, Effects)
        .deleted_user("leaving-owner")
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar!("SELECT grant_id FROM email_links WHERE id = $1", link)
            .fetch_one(&db)
            .await
            .unwrap(),
        Some(replacement)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn inaccessible_mailbox_cannot_be_removed_or_resynced(db: PgPool) {
    let (repo, link, _) = shared(&db).await;
    let service = InboxLifecycleService::new(repo, Effects);
    assert!(matches!(
        service.remove(&actor("outsider"), link).await,
        Err(InboxLifecycleError::Forbidden)
    ));
    assert!(matches!(
        service.resync(&actor("outsider"), link).await,
        Err(InboxLifecycleError::Forbidden)
    ));
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM email_mailbox_lifecycle_outbox WHERE link_id = $1",
            link
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn outlook_resync_fences_page_workers_and_never_creates_a_gmail_backfill(db: PgPool) {
    let (repo, link, _) = shared(&db).await;
    let old = repo
        .claim_stream(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    sqlx::query!(
        "UPDATE email_sync_streams SET initial_complete = true,attachments_rechecked=true WHERE link_id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let service = InboxLifecycleService::new(repo.clone(), Effects);
    let first = service.resync(&actor("remaining"), link).await.unwrap();
    assert!(!first.already_in_progress);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM email_sync_streams WHERE link_id=$1 AND attachments_rechecked",
            link
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(0)
    );
    let again = service.resync(&actor("remaining"), link).await.unwrap();
    assert!(again.already_in_progress);
    assert_eq!(first.run_id, again.run_id);
    assert!(matches!(
        repo.commit_page(&old, &super::super::test::page()).await,
        Err(MailboxError::Stale)
    ));
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM email_backfill_jobs WHERE link_id = $1",
            link
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn gmail_resync_commits_the_backfill_with_durable_publication(db: PgPool) {
    let (repo, link, _) = shared(&db).await;
    sqlx::query!(
        "UPDATE email_links SET provider = 'GMAIL' WHERE id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let service = InboxLifecycleService::new(repo, Effects);
    let first = service.resync(&actor("remaining"), link).await.unwrap();
    assert!(!first.already_in_progress);
    let again = service.resync(&actor("remaining"), link).await.unwrap();
    assert!(again.already_in_progress);
    assert_eq!(first.run_id, again.run_id);
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM email_mailbox_lifecycle_outbox WHERE link_id = $1 AND payload->>'kind' = 'gmail_backfill'",link).fetch_one(&db).await.unwrap(),Some(1));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn subscription_cleanup_precedes_revoke_and_delete_even_with_parallel_publishers(db: PgPool) {
    let (repo, link, _) = shared(&db).await;
    sqlx::query!("INSERT INTO email_provider_subscriptions(link_id,generation,provider_id,client_state_hash,expires_at) VALUES($1,1,'watch',decode('1234','hex'),now()+interval '3 days')",link).execute(&db).await.unwrap();
    InboxLifecycleService::new(repo.clone(), Effects)
        .remove(&actor("shared"), link)
        .await
        .unwrap();
    assert!(!repo.ready_for_delete(link).await.unwrap());
    let cleanup = loop {
        let lease = repo.claim_effect(Uuid::now_v7()).await.unwrap().unwrap();
        if matches!(
            lease.effect,
            InboxLifecycleEffect::CleanupMicrosoftWatches { .. }
        ) {
            break lease;
        }
        assert!(matches!(
            lease.effect,
            InboxLifecycleEffect::AccessRemoved { .. }
        ));
        repo.finish_effect(&lease, true).await.unwrap();
    };
    while let Some(lease) = repo.claim_effect(Uuid::now_v7()).await.unwrap() {
        assert!(matches!(
            lease.effect,
            InboxLifecycleEffect::AccessRemoved { .. }
        ));
        repo.finish_effect(&lease, true).await.unwrap();
    }
    repo.finish_effect(&cleanup, true).await.unwrap();
    while let Some(lease) = repo.claim_effect(Uuid::now_v7()).await.unwrap() {
        if matches!(lease.effect, InboxLifecycleEffect::DeleteMailbox { .. }) {
            assert!(repo.ready_for_delete(link).await.unwrap());
            return;
        }
        assert!(matches!(
            lease.effect,
            InboxLifecycleEffect::RevokeMicrosoftGrant { .. }
        ));
        assert!(!repo.ready_for_delete(link).await.unwrap());
        repo.finish_effect(&lease, true).await.unwrap();
    }
    panic!("disconnect must eventually publish deletion");
}
