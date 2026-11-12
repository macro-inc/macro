use super::*;
use crate::domain::mailbox::credentials::{CredentialHealth, MailboxCredentialHealthRepository};
use email_api_client_core::models::{MailboxAccess, TokenError};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

struct Effects;
impl InboxLifecycleEffects for Effects {
    async fn apply(&self, _: Uuid, _: &InboxLifecycleEffect) -> Result<(), MailboxError> {
        Ok(())
    }
}

struct CountingRemovals {
    repo: PgMailboxSync,
    calls: Arc<AtomicUsize>,
}

impl InboxLifecycleRepository for CountingRemovals {
    async fn snapshot(&self, link: Uuid) -> Result<InboxLifecycleSnapshot, InboxLifecycleError> {
        self.repo.snapshot(link).await
    }

    async fn remove(
        &self,
        actor: &InboxActor,
        expected: &InboxLifecycleSnapshot,
        decision: &InboxRemoval,
        reason: DeletionReason,
    ) -> Result<(), InboxLifecycleError> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        self.repo.remove(actor, expected, decision, reason).await
    }

    async fn resync(
        &self,
        actor: &InboxActor,
        expected: &InboxLifecycleSnapshot,
    ) -> Result<InboxResync, InboxLifecycleError> {
        self.repo.resync(actor, expected).await
    }

    async fn bindings_for_deleted_user(
        &self,
        owner: &str,
    ) -> Result<Vec<DeletedUserBinding>, InboxLifecycleError> {
        self.repo.bindings_for_deleted_user(owner).await
    }

    async fn ready_for_delete(&self, link: Uuid) -> Result<bool, InboxLifecycleError> {
        self.repo.ready_for_delete(link).await
    }

    async fn claim_effect(&self, lease: Uuid) -> Result<Option<InboxLifecycleLease>, MailboxError> {
        self.repo.claim_effect(lease).await
    }

    async fn finish_effect(
        &self,
        lease: &InboxLifecycleLease,
        success: bool,
    ) -> Result<(), MailboxError> {
        self.repo.finish_effect(lease, success).await
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

async fn double_match(db: &PgPool) -> (PgMailboxSync, Uuid, Uuid) {
    let fixture = shared(db).await;
    sqlx::query!(
        "DELETE FROM promoted_shared_mailboxes WHERE macro_id = 'macro|shared@example.com'"
    )
    .execute(db)
    .await
    .unwrap();
    fixture
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleted_user_bindings_identify_custodian_and_owner_on_the_same_link(db: PgPool) {
    let (repo, link, _) = double_match(&db).await;

    let bindings = repo
        .bindings_for_deleted_user("leaving-owner")
        .await
        .unwrap();

    assert_eq!(bindings.len(), 2);
    assert!(bindings.iter().all(
        |binding| binding.link_id == link && binding.actor.credential_owner == "leaving-owner"
    ));
    assert!(
        bindings
            .iter()
            .any(|binding| binding.kind == DeletedUserBindingKind::Custodian
                && binding.actor.macro_id.as_ref() == "macro|leaving@example.com")
    );
    assert!(
        bindings
            .iter()
            .any(|binding| binding.kind == DeletedUserBindingKind::Owner
                && binding.actor.macro_id.as_ref() == "macro|shared@example.com")
    );
}

async fn assert_double_match_deleted_user(db: &PgPool, with_replacement: bool) {
    let (repo, link, replacement) = double_match(db).await;
    let original = sqlx::query_scalar!("SELECT grant_id FROM email_links WHERE id = $1", link)
        .fetch_one(db)
        .await
        .unwrap()
        .unwrap();
    if !with_replacement {
        sqlx::query!("DELETE FROM email_mailbox_custodians WHERE link_id = $1 AND actor_id = 'macro|remaining@example.com'",link)
            .execute(db).await.unwrap();
    }

    InboxLifecycleService::new(repo, Effects)
        .deleted_user("leaving-owner")
        .await
        .unwrap();

    let row = sqlx::query!(
        "SELECT macro_id,is_sync_active,disconnect_requested_at,needs_reauth,grant_id,grant_generation,sync_generation,fusionauth_user_id FROM email_links WHERE id = $1",
        link
    ).fetch_one(db).await.unwrap();
    assert_eq!(row.macro_id, "macro|shared@example.com");
    assert!(!row.is_sync_active);
    assert!(row.disconnect_requested_at.is_some());
    assert_eq!(row.needs_reauth, !with_replacement);
    assert_eq!(row.grant_id, with_replacement.then_some(replacement));
    assert_eq!(row.grant_generation, if with_replacement { 1 } else { 2 });
    assert_eq!(row.sync_generation, 3);
    assert_eq!(
        row.fusionauth_user_id,
        if with_replacement {
            "remaining-owner"
        } else {
            "leaving-owner"
        }
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM email_mailbox_custodians WHERE link_id = $1",
            link
        )
        .fetch_one(db)
        .await
        .unwrap(),
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT primary_macro_id FROM macro_user_links WHERE link_id = $1",
            link
        )
        .fetch_all(db)
        .await
        .unwrap(),
        vec!["macro|remaining@example.com"]
    );

    let projections = sqlx::query!(
        "SELECT generation,payload FROM email_projection_outbox WHERE link_id = $1",
        link
    )
    .fetch_all(db)
    .await
    .unwrap();
    assert_eq!(projections.len(), 1);
    assert_eq!(projections[0].generation, 2);
    let event: ProjectionEvent = serde_json::from_value(projections[0].payload.clone()).unwrap();
    if with_replacement {
        assert!(matches!(event, ProjectionEvent::LinkChanged));
    } else {
        assert!(matches!(event, ProjectionEvent::ReauthorizationRequired));
    }

    let effects = sqlx::query_scalar!(
        "SELECT payload FROM email_mailbox_lifecycle_outbox WHERE link_id = $1",
        link
    )
    .fetch_all(db)
    .await
    .unwrap()
    .into_iter()
    .map(|payload| serde_json::from_value::<InboxLifecycleEffect>(payload).unwrap())
    .collect::<Vec<_>>();
    assert_eq!(effects.len(), if with_replacement { 6 } else { 5 });
    for viewer in [
        "macro|leaving@example.com",
        "macro|shared@example.com",
        "macro|remaining@example.com",
    ] {
        assert_eq!(effects.iter().filter(|effect| matches!(effect, InboxLifecycleEffect::AccessRemoved { viewer: removed } if removed == viewer)).count(), 1);
    }
    assert_eq!(
        effects
            .iter()
            .filter(|effect| matches!(
                effect,
                InboxLifecycleEffect::DeleteMailbox {
                    reason: DeletionReason::UserDeleted
                }
            ))
            .count(),
        1
    );
    assert_eq!(effects.iter().filter(|effect| matches!(effect, InboxLifecycleEffect::RevokeMicrosoftGrant { grant_id, generation: 1, owner } if *grant_id == original && owner == "leaving-owner")).count(), 1);
    assert_eq!(effects.iter().filter(|effect| matches!(effect, InboxLifecycleEffect::RevokeMicrosoftGrant { grant_id, generation: 1, owner } if *grant_id == replacement && owner == "remaining-owner")).count(), usize::from(with_replacement));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleted_user_double_match_rebinds_before_owner_disconnect(db: PgPool) {
    assert_double_match_deleted_user(&db, true).await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleted_user_double_match_marks_reauthentication_before_owner_disconnect(db: PgPool) {
    assert_double_match_deleted_user(&db, false).await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleted_user_self_custodian_is_removed_once_with_unchanged_state(db: PgPool) {
    let (repo, link) = super::super::test::fixture(&db).await;
    user(&db, "self").await;
    let grant = Uuid::now_v7();
    sqlx::query!(
        "UPDATE email_links SET macro_id = 'macro|self@example.com',fusionauth_user_id = 'self-owner',grant_id = $2 WHERE id = $1",
        link,
        grant
    ).execute(&db).await.unwrap();
    sqlx::query!(
        "INSERT INTO email_mailbox_custodians(link_id,actor_id,fusionauth_user_id,grant_id,grant_generation,granted_scopes) VALUES ($1,'macro|self@example.com','self-owner',$2,1,'{}')",
        link,
        grant
    ).execute(&db).await.unwrap();
    let bindings = repo.bindings_for_deleted_user("self-owner").await.unwrap();
    assert_eq!(bindings.len(), 2);
    assert!(bindings.iter().all(|binding| binding.link_id == link
        && binding.actor.macro_id.as_ref() == "macro|self@example.com"));
    let mut kinds: Vec<_> = bindings.iter().map(|binding| binding.kind).collect();
    kinds.sort();
    assert_eq!(
        kinds,
        vec![
            DeletedUserBindingKind::Custodian,
            DeletedUserBindingKind::Owner
        ]
    );

    let mut expected = repo.snapshot(link).await.unwrap();
    expected.disconnecting = true;
    expected.sync_generation += 1;
    expected.custodians.clear();
    let calls = Arc::new(AtomicUsize::new(0));
    let service = InboxLifecycleService::new(
        CountingRemovals {
            repo: repo.clone(),
            calls: calls.clone(),
        },
        Effects,
    );

    service.deleted_user("self-owner").await.unwrap();

    assert_eq!(calls.load(Ordering::Relaxed), 1);
    assert_eq!(repo.snapshot(link).await.unwrap(), expected);
    let row = sqlx::query!(
        "SELECT is_sync_active,needs_reauth FROM email_links WHERE id = $1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(!row.is_sync_active);
    assert!(!row.needs_reauth);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM email_projection_outbox WHERE link_id = $1",
            link
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(0)
    );
    let effects: Vec<InboxLifecycleEffect> = sqlx::query_scalar!(
        "SELECT payload FROM email_mailbox_lifecycle_outbox WHERE link_id = $1",
        link
    )
    .fetch_all(&db)
    .await
    .unwrap()
    .into_iter()
    .map(|payload| serde_json::from_value(payload).unwrap())
    .collect();
    assert_eq!(effects.len(), 3);
    assert_eq!(effects.iter().filter(|effect| matches!(effect, InboxLifecycleEffect::AccessRemoved { viewer } if viewer == "macro|self@example.com")).count(), 1);
    assert_eq!(effects.iter().filter(|effect| matches!(effect, InboxLifecycleEffect::RevokeMicrosoftGrant { grant_id, generation: 1, owner } if *grant_id == grant && owner == "self-owner")).count(), 1);
    assert_eq!(
        effects
            .iter()
            .filter(|effect| matches!(
                effect,
                InboxLifecycleEffect::DeleteMailbox {
                    reason: DeletionReason::UserDeleted
                }
            ))
            .count(),
        1
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn leaving_shared_custodian_rebinds_work_and_rejects_old_health_even_with_equal_grant_numbers(
    db: PgPool,
) {
    let (repo, link, replacement) = shared(&db).await;
    sqlx::query!(
        "UPDATE email_sync_streams SET import_started_at = now() - interval '1 hour', import_completed_at = now() - interval '5 minutes' WHERE link_id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let command = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"INSERT INTO email_mailbox_commands(id,link_id,generation,actor_id,intent,status)
        VALUES ($1,$2,1,'macro|shared@example.com','{"kind":"read","value":true}','confirming')"#,
        command,
        link
    )
    .execute(&db)
    .await
    .unwrap();
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
    let rebound = sqlx::query!(
        "SELECT status,generation FROM email_mailbox_commands WHERE id = $1",
        command
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(
        (rebound.status.as_str(), rebound.generation),
        ("pending", 2),
        "a confirming command is never claimed, so it must resume as pending"
    );
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
    let rebound_stream = sqlx::query!(
        r#"SELECT import_started_at < now() - interval '30 minutes' AS "started_before!", import_completed_at IS NOT NULL AS "completed!"
        FROM email_sync_streams WHERE link_id = $1 AND generation = 2"#,
        link
    )
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(rebound_stream.len(), 1);
    assert!(
        rebound_stream[0].started_before && rebound_stream[0].completed,
        "the import run continues in the new generation, so it must not report completion again"
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
async fn outlook_resync_starts_a_new_import_run_once(db: PgPool) {
    let telemetry = crate::telemetry_capture::Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link, _) = shared(&db).await;
    sqlx::query!(
        r#"INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id,initial_complete,import_started_at,import_completed_at)
        VALUES ($1,$2,1,'folder_catalog','mail',true,now() - interval '1 day',now() - interval '23 hours')"#,
        macro_uuid::generate_uuid_v7(),
        link
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_sync_streams SET initial_complete = true WHERE link_id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let service = InboxLifecycleService::new(repo.clone(), Effects);

    service.resync(&actor("remaining"), link).await.unwrap();
    let again = service.resync(&actor("remaining"), link).await.unwrap();

    assert!(again.already_in_progress);
    let started = telemetry.events("outlook import started");
    let [(level, fields)] = started.as_slice() else {
        panic!("expected one start, got {started:?}");
    };
    assert_eq!(*level, tracing::Level::INFO);
    assert_eq!(fields["link_id"], link.to_string());
    assert_eq!(fields["sync_generation"], "1");
    let run = sqlx::query!(
        r#"SELECT import_started_at > now() - interval '1 minute' AS "restarted!", import_completed_at
        FROM email_sync_streams WHERE link_id = $1 AND kind = 'folder_catalog'"#,
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(run.restarted);
    assert!(run.import_completed_at.is_none());
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn effect_claims_take_due_mailbox_effects_before_gmail_history_and_skip_backed_off_rows(
    db: PgPool,
) {
    let (repo, link) = super::super::test::fixture(&db).await;
    let history = InboxLifecycleEffect::GmailHistory {
        work: crate::domain::mailbox::gmail_history::HistoryWork::Delete {
            provider_id: "history-due".into(),
        },
    };
    let later = InboxLifecycleEffect::AccessRemoved {
        viewer: "later".into(),
    };
    let due = InboxLifecycleEffect::AccessRemoved {
        viewer: "due".into(),
    };
    for (effect, delay) in [(later, 3600.0), (history, -120.0), (due, -60.0)] {
        sqlx::query!("INSERT INTO email_mailbox_lifecycle_outbox(id,link_id,payload,available_at) VALUES($1,$2,$3,now() + make_interval(secs => $4))",Uuid::now_v7(),link,serde_json::to_value(effect).unwrap(),delay).execute(&db).await.unwrap();
    }
    let mut claimed = Vec::new();
    while let Some(lease) = repo.claim_effect(Uuid::now_v7()).await.unwrap() {
        claimed.push(match lease.effect {
            InboxLifecycleEffect::AccessRemoved { viewer } => viewer,
            InboxLifecycleEffect::GmailHistory { .. } => "history".into(),
            other => panic!("unexpected effect {other:?}"),
        });
    }
    assert_eq!(claimed, ["due", "history"]);
}
