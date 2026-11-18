use super::*;
use crate::domain::{
    company_metadata_resolver::{CompanyMetadataResolver, DomainResolution},
    email_policy_work::*,
    service::CrmServiceImpl,
};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

#[derive(Clone, Default)]
struct Resolver {
    calls: Arc<AtomicUsize>,
    gate: Option<Arc<Gate>>,
}
#[derive(Default)]
struct Gate {
    entered: tokio::sync::Notify,
    resume: tokio::sync::Notify,
}
impl CompanyMetadataResolver for Resolver {
    async fn resolve(&self, _: &str) -> DomainResolution {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if let Some(gate) = &self.gate {
            gate.entered.notify_one();
            gate.resume.notified().await;
        }
        DomainResolution::Unavailable
    }
}
type Service = CrmServiceImpl<CompaniesRepositoryImpl, Resolver>;

async fn scheduled(
    pool: &PgPool,
) -> anyhow::Result<(CompaniesRepositoryImpl, Service, EmailPolicyWorkRequest)> {
    let (team, link, repo) = setup(pool).await?;
    consent_to_mailbox(pool, team, link).await?;
    let mut tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: None,
            },
        )
        .await?
        .unwrap();
    let request = EmailPolicyWorkRequest {
        team_id: team,
        user_id: OWNER.into(),
        link_id: link,
        work_id: Uuid::now_v7(),
        generation: tx.state().generation,
    };
    tx.request_work(request.work_id, None).await?;
    tx.commit().await?;
    let service = Service::new(repo.clone(), Resolver::default());
    Ok((repo, service, request))
}

async fn stored(
    repo: &CompaniesRepositoryImpl,
    request: &EmailPolicyWorkRequest,
) -> anyhow::Result<Option<EmailPolicyHistoryWork>> {
    let mut tx = repo.open_history(request).await?.unwrap();
    let work = tx.history_work().await?;
    tx.commit().await?;
    Ok(work)
}

async fn selected(
    pool: &PgPool,
    request: &EmailPolicyWorkRequest,
    revision: i64,
) -> anyhow::Result<()> {
    sqlx::query!(r#"INSERT INTO crm_email_rule_revisions (team_id,user_id,revision,link_id,schema_version,definition)
        VALUES ($1,$2,$3,$4,1,'{"schema_version":1,"include":[]}'::jsonb)"#,
        request.team_id, request.user_id, revision, request.link_id).execute(pool).await?;
    sqlx::query!(
        "UPDATE crm_email_consent SET enabled=FALSE WHERE team_id=$1 AND user_id=$2",
        request.team_id,
        request.user_id
    )
    .execute(pool)
    .await?;
    sqlx::query!("UPDATE crm_email_consent SET mode='selected',selected_enabled=TRUE,active_rule_revision=$3 WHERE team_id=$1 AND user_id=$2", request.team_id, request.user_id, revision).execute(pool).await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bounded_raw_pages_keep_two_passes_and_duplicate_cursors_cannot_skip_history(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, service, request) = scheduled(&pool).await?;
    sqlx::query!("INSERT INTO email_contacts(id,link_id,email_address) SELECT gen_random_uuid(),$1,lpad(n::text,4,'0')||'@example.org' FROM generate_series(1,103)n", request.link_id).execute(&pool).await?;
    let first = service.history_page(&request).await?.unwrap();
    assert_eq!(first.contacts.len(), 100);
    assert!(!first.cursor.received_pass);
    service.finish_history_page(&request, &first).await?;
    let second = service.history_page(&request).await?.unwrap();
    assert_eq!(second.contacts.len(), 3);
    // A deleted cursor contact must not restart or lose the next raw page.
    sqlx::query!(
        "DELETE FROM email_contacts WHERE link_id=$1 AND email_address=$2",
        request.link_id,
        first.contacts.last().unwrap().address
    )
    .execute(&pool)
    .await?;
    service.finish_history_page(&request, &first).await?;
    assert_eq!(
        service.history_page(&request).await?.unwrap().cursor,
        second.cursor
    );
    service.finish_history_page(&request, &second).await?;
    let third = service.history_page(&request).await?.unwrap();
    assert!(third.cursor.received_pass);
    assert!(third.cursor.after_contact_address.is_none());
    assert_eq!(third.contacts.len(), 100);
    service.finish_history_page(&request, &third).await?;
    let fourth = service.history_page(&request).await?.unwrap();
    assert_eq!(fourth.contacts.len(), 2);
    service.finish_history_page(&request, &fourth).await?;
    assert!(stored(&repo, &request).await?.is_none());
    assert!(service.history_page(&request).await?.is_none());
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM crm_email_backfill_outbox")
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stale_version_restarts_unfinished_history_but_never_finishes_a_replacement(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, service, request) = scheduled(&pool).await?;
    let old_page = service.history_page(&request).await?.unwrap();
    selected(&pool, &request, 1).await?;
    assert!(service.history_page(&request).await?.is_none());
    let transferred = stored(&repo, &request).await?.unwrap();
    assert_eq!(
        transferred.request.generation.consent_incarnation,
        request.generation.consent_incarnation
    );
    assert!(transferred.request.generation.policy_version > request.generation.policy_version);
    assert_ne!(transferred.request.work_id, request.work_id);
    assert_eq!(transferred.cursor, EmailPolicyHistoryCursor::default());
    service.finish_history_page(&request, &old_page).await?;
    assert_eq!(
        stored(&repo, &request).await?.unwrap().request,
        transferred.request
    );
    let outbox=sqlx::query!("SELECT work_id,consent_incarnation,policy_version FROM crm_email_backfill_outbox WHERE team_id=$1 AND user_id=$2",request.team_id,request.user_id).fetch_one(&pool).await?;
    assert_eq!(outbox.work_id, Some(transferred.request.work_id));
    assert_eq!(
        outbox.policy_version,
        Some(transferred.request.generation.policy_version)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delayed_jobs_cannot_adopt_a_recreated_consent_even_when_versions_repeat(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, service, request) = scheduled(&pool).await?;
    let page = service.history_page(&request).await?.unwrap();
    sqlx::query!(
        "DELETE FROM crm_email_consent WHERE team_id=$1 AND user_id=$2",
        request.team_id,
        request.user_id
    )
    .execute(&pool)
    .await?;
    consent_to_mailbox(&pool, request.team_id, request.link_id).await?;
    let mut tx = repo
        .open_email_policy(
            request.team_id,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: None,
            },
        )
        .await?
        .unwrap();
    assert_ne!(
        tx.state().generation.consent_incarnation,
        request.generation.consent_incarnation
    );
    assert_eq!(
        tx.state().generation.policy_version,
        request.generation.policy_version
    );
    let replacement = Uuid::now_v7();
    tx.request_work(replacement, None).await?;
    tx.commit().await?;
    assert!(service.history_page(&request).await?.is_none());
    service.finish_history_page(&request, &page).await?;
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT work_id FROM crm_email_policy_work WHERE team_id=$1 AND user_id=$2",
            request.team_id,
            request.user_id
        )
        .fetch_one(&pool)
        .await?,
        replacement
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT work_id FROM crm_email_backfill_outbox WHERE team_id=$1 AND user_id=$2",
            request.team_id,
            request.user_id
        )
        .fetch_one(&pool)
        .await?,
        Some(replacement)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn historical_effects_reauthorize_before_enrichment_and_after_withdrawal_during_it(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, _, request) = scheduled(&pool).await?;
    insert_interaction(
        &pool,
        request.link_id,
        "person@sample.example.com",
        chrono::Utc::now(),
        true,
    )
    .await?;
    let resolver = Resolver::default();
    let service = Service::new(repo.clone(), resolver.clone());
    assert!(
        service
            .legacy_history_mailbox(request.team_id, OWNER)
            .await?
            .is_none()
    );
    service
        .populate_history_contact(
            request.team_id,
            request.link_id,
            "owner@example.com",
            "person@sample.example.com",
            None,
            EmailHistoryAuthority::Legacy,
            false,
        )
        .await?;
    let wrong = EmailPolicyGeneration {
        consent_incarnation: Uuid::now_v7(),
        ..request.generation
    };
    service
        .populate_history_contact(
            request.team_id,
            request.link_id,
            "owner@example.com",
            "person@sample.example.com",
            None,
            EmailHistoryAuthority::Policy(wrong),
            false,
        )
        .await?;
    assert_eq!(resolver.calls.load(Ordering::SeqCst), 0);
    let gate = Arc::new(Gate::default());
    let service = Service::new(
        repo.clone(),
        Resolver {
            gate: Some(gate.clone()),
            ..resolver
        },
    );
    let future = tokio::spawn(async move {
        service
            .populate_history_contact(
                request.team_id,
                request.link_id,
                "owner@example.com",
                "person@sample.example.com",
                None,
                EmailHistoryAuthority::Policy(request.generation),
                false,
            )
            .await
    });
    gate.entered.notified().await;
    repo.change_email_privacy(
        request.team_id,
        OWNER,
        EmailPrivacyChange::SetConsent {
            enabled: false,
            link_id: None,
        },
    )
    .await?;
    gate.resume.notify_one();
    future.await??;
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_contacts WHERE team_id=$1",
            request.team_id
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sent_pass_creates_companies_before_received_only_contacts_and_view_denial_is_irrelevant(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (_, service, request) = scheduled(&pool).await?;
    sqlx::query!(
        "UPDATE team_user SET crm_access=FALSE WHERE team_id=$1 AND user_id=$2",
        request.team_id,
        request.user_id
    )
    .execute(&pool)
    .await?;
    for (address, sent) in [
        ("a@sample.example.com", false),
        ("z@sample.example.com", true),
    ] {
        insert_interaction(&pool, request.link_id, address, chrono::Utc::now(), sent).await?;
    }
    for pass in [false, true] {
        let page = service.history_page(&request).await?.unwrap();
        assert_eq!(page.cursor.received_pass, pass);
        for contact in &page.contacts {
            service
                .populate_history_contact(
                    request.team_id,
                    request.link_id,
                    &page.mailbox.email_address,
                    &contact.address,
                    contact.name.as_deref(),
                    EmailHistoryAuthority::Policy(request.generation),
                    !pass,
                )
                .await?;
        }
        service.finish_history_page(&request, &page).await?;
    }
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_contacts WHERE team_id=$1",
            request.team_id
        )
        .fetch_one(&pool)
        .await?,
        Some(2)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn selected_history_shares_other_thread_participants_and_private_exceptions_veto_later_effects(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, service, old) = scheduled(&pool).await?;
    let thread = insert_interaction(
        &pool,
        old.link_id,
        "other@sample.example.com",
        chrono::Utc::now(),
        true,
    )
    .await?;
    let participant = Uuid::now_v7();
    sqlx::query!("INSERT INTO email_contacts(id,link_id,email_address) VALUES($1,$2,'chosen@elsewhere.example.com')",participant,old.link_id).execute(&pool).await?;
    sqlx::query!("INSERT INTO email_message_recipients(message_id,contact_id,recipient_type) SELECT id,$2,'CC' FROM email_messages WHERE thread_id=$1",thread,participant).execute(&pool).await?;
    selected(&pool, &old, 1).await?;
    sqlx::query!("INSERT INTO crm_email_rule_addresses(team_id,user_id,revision,address) VALUES($1,$2,1,'chosen@elsewhere.example.com')",old.team_id,old.user_id).execute(&pool).await?;
    service.history_page(&old).await?;
    let request = stored(&repo, &old).await?.unwrap().request;
    service
        .populate_history_contact(
            request.team_id,
            request.link_id,
            "owner@example.com",
            "other@sample.example.com",
            None,
            EmailHistoryAuthority::Policy(request.generation),
            false,
        )
        .await?;
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_contacts WHERE team_id=$1",
            request.team_id
        )
        .fetch_one(&pool)
        .await?,
        Some(1)
    );
    sqlx::query!("INSERT INTO crm_email_thread_exclusions(team_id,user_id,link_id,thread_id) VALUES($1,$2,$3,$4)",request.team_id,request.user_id,request.link_id,thread).execute(&pool).await?;
    service
        .populate_history_contact(
            request.team_id,
            request.link_id,
            "owner@example.com",
            "chosen@elsewhere.example.com",
            None,
            EmailHistoryAuthority::Policy(request.generation),
            false,
        )
        .await?;
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_contacts WHERE team_id=$1",
            request.team_id
        )
        .fetch_one(&pool)
        .await?,
        Some(1),
        "veto keeps records but prevents new population"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reverse_worker_bounds_inactive_revisions_and_replays_do_not_restart_completed_work(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, service, old) = scheduled(&pool).await?;
    selected(&pool, &old, 205).await?;
    let source = Uuid::now_v7();
    sqlx::query!(r#"INSERT INTO crm_email_rule_revisions(team_id,user_id,revision,link_id,schema_version,definition)
        SELECT $1,$2,n,$3,1,'{"schema_version":1,"include":[]}'::jsonb FROM generate_series(1,204)n"#,old.team_id,old.user_id,old.link_id).execute(&pool).await?;
    sqlx::query!("INSERT INTO crm_email_rule_contacts(team_id,user_id,revision,contact_id) SELECT $1,$2,n,$3 FROM generate_series(1,205)n",old.team_id,old.user_id,source).execute(&pool).await?;
    let event = EmailPolicySourceEvent {
        event_id: Uuid::now_v7(),
        team_id: old.team_id,
        source_kind: EmailPolicySourceKind::Contact,
        source_id: source,
        after: None,
        traceparent: None,
    };
    let mut tx = pool.begin().await?;
    CompaniesRepositoryImpl::record_email_policy_source_event(&mut tx, &event).await?;
    tx.commit().await?;
    for cursor in [100_i64, 200] {
        assert!(service.reconcile_source_page().await?);
        assert_eq!(
            sqlx::query_scalar!(
                "SELECT after_revision FROM crm_email_policy_source_events WHERE event_id=$1",
                event.event_id
            )
            .fetch_one(&pool)
            .await?,
            Some(cursor)
        );
        assert_eq!(
            stored(&repo, &old).await?.unwrap().request.work_id,
            old.work_id
        );
    }
    assert!(service.reconcile_source_page().await?);
    let request = stored(&repo, &old).await?.unwrap().request;
    assert_ne!(request.work_id, old.work_id);
    assert!(service.reconcile_source_page().await?);
    assert!(!service.reconcile_source_page().await?);
    for _ in 0..2 {
        let page = service.history_page(&request).await?.unwrap();
        service.finish_history_page(&request, &page).await?;
    }
    assert!(stored(&repo, &old).await?.is_none());
    let mut tx = pool.begin().await?;
    CompaniesRepositoryImpl::record_email_policy_source_event(&mut tx, &event).await?;
    tx.commit().await?;
    for _ in 0..4 {
        assert!(service.reconcile_source_page().await?);
    }
    assert!(
        stored(&repo, &old).await?.is_none(),
        "same event's retained receipt prevents resurrection"
    );
    let audit = sqlx::query!("SELECT action, actor_kind, details FROM crm_email_policy_audit WHERE team_id=$1 AND user_id=$2",old.team_id,old.user_id).fetch_all(&pool).await?;
    assert_eq!(
        audit.len(),
        1,
        "retry does not duplicate member-visible history"
    );
    assert_eq!(audit[0].action, "live_targets_changed");
    assert_eq!(audit[0].actor_kind, "system");
    assert_eq!(
        audit[0].details,
        serde_json::json!({"source_kind":"contact"})
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn raw_address_checkpoint_uses_the_page_collation_instead_of_rust_byte_order(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, service, request) = scheduled(&pool).await?;
    // ICU ordering puts the accented address before z, the reverse of Rust's
    // UTF-8 byte ordering. The production index and checkpoint must agree.
    sqlx::query(
        "ALTER TABLE email_contacts ALTER COLUMN email_address TYPE TEXT COLLATE \"en-US-x-icu\"",
    )
    .execute(&pool)
    .await?;
    sqlx::query("ALTER TABLE crm_email_policy_work ALTER COLUMN after_contact_address TYPE TEXT COLLATE \"en-US-x-icu\"").execute(&pool).await?;
    sqlx::query!("INSERT INTO email_contacts(id,link_id,email_address) SELECT gen_random_uuid(),$1,lpad(n::text,3,'0')||'@example.org' FROM generate_series(1,99)n",request.link_id).execute(&pool).await?;
    for address in ["ä@example.org", "z@example.org"] {
        sqlx::query!(
            "INSERT INTO email_contacts(id,link_id,email_address) VALUES($1,$2,$3)",
            Uuid::now_v7(),
            request.link_id,
            address
        )
        .execute(&pool)
        .await?;
    }
    let first = service.history_page(&request).await?.unwrap();
    assert_eq!(first.contacts.len(), 100);
    assert_eq!(first.contacts.last().unwrap().address, "ä@example.org");
    service.finish_history_page(&request, &first).await?;
    let second = service.history_page(&request).await?.unwrap();
    assert_eq!(second.contacts[0].address, "z@example.org");
    // Force another full page so the same-pass cursor exercises SQL ordering.
    let mut tx = repo.open_history(&request).await?.unwrap();
    assert!(
        tx.finish_history_page(
            &request,
            &second.cursor,
            Some(&EmailPolicyHistoryCursor {
                received_pass: false,
                after_contact_address: Some("z@example.org".into())
            })
        )
        .await?
    );
    tx.commit().await?;
    assert_eq!(
        service
            .history_page(&request)
            .await?
            .unwrap()
            .cursor
            .after_contact_address
            .as_deref(),
        Some("z@example.org")
    );
    Ok(())
}
