use super::*;
use imap_service_client::{Endpoint, Login, Secret, TlsMode};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

async fn owner(db: &PgPool) -> MacroUserIdStr<'static> {
    let macro_id = MacroUserIdStr::try_from("macro|owner@example.com").unwrap();
    let id = Uuid::from_u128(1);
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
            VALUES ($1, 'macro|owner@example.com', 'owner@example.com', 'cus_imap')
        "#,
        id,
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
            VALUES ('macro|owner@example.com', 'owner@example.com', $1)
        "#,
        id,
    )
    .execute(db)
    .await
    .unwrap();
    macro_id
}
fn input(id: u128) -> ImapConnectRequest {
    let login = Login {
        endpoint: Endpoint {
            host: "mail.example.com".into(),
            port: 993,
            tls: TlsMode::Implicit,
            username: "owner@example.com".into(),
        },
        password: Secret("secret".into()),
    };
    ImapConnectRequest {
        request_id: Uuid::from_u128(id),
        link_id: None,
        imap: login.clone(),
        smtp: login,
        confirmed_hosts: vec!["mail.example.com".into()],
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn promotion_is_inactive_until_activated_replayable_and_cannot_resurrect_disconnected_links(
    db: PgPool,
) {
    let actor = owner(&db).await;
    let repo = PgImapConnections(db.clone());
    let request = input(2);
    let verification = Verification {
        id: Uuid::from_u128(3),
        expires_at: chrono::Utc::now() + chrono::Duration::minutes(15),
    };
    let attempt = repo
        .reserve(&actor, "owner", &request, &verification)
        .await
        .unwrap();
    let active = sqlx::query_scalar!(
        r#"
        SELECT
            is_sync_active
        FROM
            email_links
        WHERE
            id = $1
        "#,
        attempt.binding.link_id,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(!active);
    assert!(
        repo.attempt(
            &MacroUserIdStr::try_from("macro|other@example.com").unwrap(),
            request.request_id
        )
        .await
        .unwrap()
        .is_none()
    );
    let attempt_lease = repo.lease(&attempt).await.unwrap();
    assert_eq!(
        repo.activate(&attempt_lease).await.unwrap(),
        attempt.binding.link_id
    );
    assert_eq!(
        repo.activate(&attempt_lease).await.unwrap(),
        attempt.binding.link_id
    );
    let streams = sqlx::query_scalar!(
        r#"
        SELECT
            count(*) AS "count!"
        FROM
            email_sync_streams
        WHERE
            link_id = $1
            AND kind = 'folder_catalog'
        "#,
        attempt.binding.link_id,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(streams, 1);
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            is_sync_active = false,
            sync_generation = sync_generation + 1,
            disconnect_requested_at = now()
        WHERE
            id = $1
        "#,
        attempt.binding.link_id,
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        repo.attempt(&actor, request.request_id).await,
        Err(ImapConnectionError::Changed)
    ));
    assert!(matches!(
        repo.preflight(&actor, Some(attempt.binding.link_id)).await,
        Err(ImapConnectionError::Changed)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reservation_serializes_provider_collisions_and_abandons_only_inactive_provisional_links(
    db: PgPool,
) {
    let actor = owner(&db).await;
    let repo = PgImapConnections(db.clone());
    let verification = Verification {
        id: Uuid::from_u128(3),
        expires_at: chrono::Utc::now() + chrono::Duration::minutes(15),
    };
    repo.preflight(&actor, None).await.unwrap();
    assert!(matches!(
        repo.preflight(&actor, Some(Uuid::now_v7())).await,
        Err(ImapConnectionError::Changed)
    ));
    let attempt = repo
        .reserve(&actor, "owner", &input(2), &verification)
        .await
        .unwrap();
    assert!(matches!(
        crate::outbound::mailbox_init::lock_gmail_connection(
            &mut *db.acquire().await.unwrap(),
            actor.as_ref(),
            actor.email_str()
        )
        .await,
        Err(email::domain::mailbox::initialization::InitializationError::IdentityConflict)
    ));
    let lease = repo.lease(&attempt).await.unwrap();
    repo.abandon(&lease).await.unwrap();
    let exists = sqlx::query_scalar!(
        r#"
        SELECT
            EXISTS (
                SELECT
                    1
                FROM
                    email_links
                WHERE
                    id = $1) AS "exists!"
        "#,
        attempt.binding.link_id,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(!exists);
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
            VALUES ($1, 'macro|owner@example.com', 'owner', 'owner@example.com', 'GMAIL')
        "#,
        Uuid::from_u128(4),
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        repo.preflight(&actor, None).await,
        Err(ImapConnectionError::ProviderConflict)
    ));
    assert!(matches!(
        repo.reserve(&actor, "owner", &input(5), &verification)
            .await,
        Err(ImapConnectionError::ProviderConflict)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn verified_reconnect_clears_old_health_without_replacing_the_link(db: PgPool) {
    let actor = owner(&db).await;
    let repo = PgImapConnections(db.clone());
    let verification = Verification {
        id: Uuid::from_u128(3),
        expires_at: chrono::Utc::now() + chrono::Duration::minutes(15),
    };
    let first = repo
        .reserve(&actor, "owner", &input(2), &verification)
        .await
        .unwrap();
    let first_lease = repo.lease(&first).await.unwrap();
    repo.activate(&first_lease).await.unwrap();
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            needs_reauth = true,
            mailbox_issue = 'credentials_unreadable',
            mailbox_retry_at = now() + interval '1 hour'
        WHERE
            id = $1
        "#,
        first.binding.link_id,
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        UPDATE email_sync_streams
        SET provider_retry_at = now() + interval '1 hour',
            next_run_at = now() + interval '1 hour'
        WHERE link_id = $1
        "#,
        first.binding.link_id,
    )
    .execute(&db)
    .await
    .unwrap();
    // Reconnect must also preserve a wait owned by a folder or its live pass,
    // rather than only the catalog created by the first activation.
    sqlx::query!(
        r#"
        INSERT INTO email_sync_streams (id, link_id, generation, kind, scope_id, provider_retry_at)
        VALUES ($1, $2, $3, $4, 'retry-folder', now() + interval '2 hours'),
               ($5, $2, $3, $6, 'retry-folder', now() + interval '3 hours')
        "#,
        macro_uuid::generate_uuid_v7(),
        first.binding.link_id,
        first.binding.sync_generation,
        email::domain::mailbox::live_pass::StreamKind::MailFolder.as_str(),
        macro_uuid::generate_uuid_v7(),
        email::domain::mailbox::live_pass::StreamKind::LivePass.as_str(),
    )
    .execute(&db)
    .await
    .unwrap();
    let floor = sqlx::query_scalar!(
        "SELECT max(provider_retry_at) FROM email_sync_streams WHERE link_id = $1",
        first.binding.link_id,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    let mut request = input(4);
    request.link_id = Some(first.binding.link_id);
    let attempt = repo
        .reserve(&actor, "owner", &request, &verification)
        .await
        .unwrap();
    let attempt_lease = repo.lease(&attempt).await.unwrap();
    assert_eq!(
        repo.activate(&attempt_lease).await.unwrap(),
        first.binding.link_id
    );
    let state = sqlx::query!(
        r#"
        SELECT
            needs_reauth,
            mailbox_issue,
            mailbox_retry_at,
            sync_generation,
            grant_generation
        FROM
            email_links
        WHERE
            id = $1
        "#,
        first.binding.link_id,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(!state.needs_reauth);
    assert!(state.mailbox_issue.is_none());
    assert!(state.mailbox_retry_at.is_none());
    assert_eq!(state.sync_generation, first.binding.sync_generation + 1);
    assert_eq!(state.grant_generation, first.binding.grant_generation + 1);
    let carried = sqlx::query_scalar!(
        "SELECT provider_retry_at FROM email_sync_streams WHERE link_id = $1 AND generation = $2 AND kind = 'folder_catalog'",
        first.binding.link_id,
        state.sync_generation,
    ).fetch_one(&db).await.unwrap();
    assert_eq!(
        carried, floor,
        "a new password must not reset provider pacing"
    );
}

mod recovery;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reconnect_during_unknown_submission_reconciles_without_another_submit(db: PgPool) {
    use crate::outbound::email_api::imap::ImapMailboxGateway;
    use axum::{Json, Router, extract::State, http::HeaderMap, routing::post};
    use email::{
        domain::{
            mailbox::{
                MailboxError,
                drafts::{
                    MailboxDraftService,
                    models::{
                        DraftCheckpoint, DraftClaimMode, DraftFile, DraftLease, DraftStage,
                        PreparedDraft,
                    },
                    ports::{DraftMaterializer, DraftRepository},
                },
            },
            models::{ResolvedDraftInput, UpsertedContacts, UserProvider},
            ports::EmailRepo,
        },
        outbound::{EmailPgRepo, mailbox_pg::PgMailboxSync},
    };
    use email_api_client::domain::models::ProviderId;
    use imap_service_client::{Draft, ImapServiceClient, Operation, SubmissionOutcome};
    use std::{
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
        time::Duration,
    };
    use tokio::sync::Notify;

    struct FrozenDraft;
    impl DraftMaterializer for FrozenDraft {
        async fn prepare_draft(&self, _: &DraftLease) -> Result<PreparedDraft, MailboxError> {
            panic!("the original frozen checkpoint must survive reconnect")
        }

        async fn draft_file_bytes(
            &self,
            _: &DraftLease,
            _: &DraftFile,
        ) -> Result<Vec<u8>, MailboxError> {
            panic!("this draft has no attachments")
        }
    }

    struct Transport {
        old_binding: String,
        started: Notify,
        release: Notify,
        submits: AtomicUsize,
    }
    async fn provider(
        State(transport): State<Arc<Transport>>,
        headers: HeaderMap,
        Json(operation): Json<Operation>,
    ) -> Json<serde_json::Value> {
        let old = headers["x-mailbox-binding"] == transport.old_binding.as_str();
        match operation {
            Operation::GetDraft { id } => Json(serde_json::json!(Draft {
                id,
                conversation_id: "conversation".into(),
                version: "v1".into(),
                is_draft: old,
                app_revision: 1,
                content_fingerprint: "frozen-content".into(),
            })),
            Operation::Submit { .. } => {
                transport.submits.fetch_add(1, Ordering::AcqRel);
                assert!(old, "replacement coordinator attempted to resubmit");
                transport.started.notify_one();
                transport.release.notified().await;
                Json(serde_json::json!(SubmissionOutcome::Unknown))
            }
            operation => panic!("unexpected mock operation: {operation:?}"),
        }
    }

    let actor = owner(&db).await;
    let repo = PgImapConnections(db.clone());
    let verification = Verification {
        id: Uuid::from_u128(3),
        expires_at: chrono::Utc::now() + chrono::Duration::minutes(15),
    };
    let initial = repo
        .reserve(&actor, "owner", &input(2), &verification)
        .await
        .unwrap();
    let link = repo
        .activate(&repo.lease(&initial).await.unwrap())
        .await
        .unwrap();
    let thread = Uuid::now_v7();
    let message = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_threads (id,link_id) VALUES ($1,$2)",
        thread,
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let draft: ResolvedDraftInput = serde_json::from_value(serde_json::json!({
        "db_id": message, "thread_db_id": thread, "subject": "Synthetic draft",
        "body_text": "Synthetic body", "to": [], "cc": [], "bcc": [], "actor_id": actor.as_ref()
    }))
    .unwrap();
    EmailPgRepo::new(db.clone())
        .insert_message(
            &draft,
            &UpsertedContacts {
                from_contact_id: None,
                recipients: vec![],
            },
            link,
            None,
            true,
        )
        .await
        .unwrap()
        .unwrap();

    let sync = PgMailboxSync::new(db.clone()).with_provider(UserProvider::Imap);
    let lease = sync
        .claim_draft(Uuid::now_v7(), DraftClaimMode::All)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    let prepared = serde_json::from_value(serde_json::json!({
        "request": {
            "message": { "db_id": message, "link_id": link, "subject": "Synthetic draft" },
            "from": { "email": "owner@example.com", "name": null, "photo_url": null }
        },
        "files": [], "removals": []
    }))
    .unwrap();
    let checkpoint = DraftCheckpoint {
        revision: lease.revision,
        actor_id: actor.as_ref().to_owned(),
        prepared,
        stage: DraftStage::Ready,
        stage_started_at: chrono::Utc::now(),
        submission_started: false,
        local_contention_retries: 0,
        send_rejection_reason: None,
        send_refusal: None,
        draft: Some(email_api_client::domain::models::ProviderDraft {
            id: ProviderId::new("a").unwrap(),
            conversation_id: ProviderId::new("conversation").unwrap(),
            version: Some("v1".into()),
            is_draft: true,
            app_revision: Some(1),
            content_fingerprint: Some("frozen-content".into()),
            field_digests: Default::default(),
        }),
        completed_files: 0,
        completed_removals: 0,
        transfer: None,
    };
    sync.checkpoint_draft(&lease, &checkpoint).await.unwrap();
    let owner = actor.as_ref();
    sqlx::query!("INSERT INTO email_scheduled_messages (link_id,message_id,send_time,actor_id) VALUES ($1,$2,now(),$3)",link,message,owner).execute(&db).await.unwrap();
    sync.release_draft(&lease, 0).await.unwrap();

    let transport = Arc::new(Transport {
        old_binding: format!(
            "{}.{}",
            initial.binding.sync_generation, initial.binding.grant_generation
        ),
        started: Notify::new(),
        release: Notify::new(),
        submits: AtomicUsize::new(0),
    });
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let addr = listener.local_addr().unwrap();
    let transport_clone = transport.clone();
    let http = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new()
                .route("/internal/v1/accounts/{id}/operations", post(provider))
                .with_state(transport_clone),
        )
        .await
        .unwrap();
    });

    let gateway = ImapMailboxGateway {
        client: ImapServiceClient::new(format!("http://{addr}"), "synthetic-key".into()).unwrap(),
        health: sync.clone(),
    };
    let old_worker = MailboxDraftService::new(sync.clone(), gateway.clone(), FrozenDraft);
    let running = tokio::spawn(async move { old_worker.execute_once().await });
    tokio::time::timeout(Duration::from_secs(10), transport.started.notified())
        .await
        .unwrap();

    let mut reconnect = input(4);
    reconnect.link_id = Some(link);
    let fresh = repo
        .reserve(&actor, "owner", &reconnect, &verification)
        .await
        .unwrap();
    repo.activate(&repo.lease(&fresh).await.unwrap())
        .await
        .unwrap();
    assert_ne!(
        initial.binding.sync_generation,
        fresh.binding.sync_generation
    );

    let replacement_worker = MailboxDraftService::new(sync, gateway, FrozenDraft);
    assert!(replacement_worker.execute_once().await.unwrap());
    let sent = sqlx::query_scalar!(
        "SELECT sent FROM email_scheduled_messages WHERE message_id = $1",
        message
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(sent);
    transport.release.notify_one();
    let _ = running.await.unwrap();
    assert_eq!(transport.submits.load(Ordering::Acquire), 1);
    http.abort();
}
