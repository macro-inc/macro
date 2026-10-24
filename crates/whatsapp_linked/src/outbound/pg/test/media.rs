use super::*;
use crate::domain::{
    media::MediaService,
    ports::{DocumentImport, DocumentStore},
};
use sha2::{Digest, Sha256};
use std::sync::Mutex;

/// Records what would become documents; fails the first `fail` imports.
#[derive(Default)]
struct Documents {
    stored: Mutex<Vec<(Uuid, String, Vec<u8>)>>,
    fail: Mutex<u32>,
}

#[async_trait]
impl DocumentStore for Documents {
    async fn store(&self, import: &DocumentImport) -> LinkedResult<()> {
        let mut fail = self.fail.lock().unwrap();
        if *fail > 0 {
            *fail -= 1;
            return Err(LinkedError::Unavailable.into());
        }
        self.stored.lock().unwrap().push((
            import.document_id,
            import.owner.clone(),
            import.bytes.clone(),
        ));
        Ok(())
    }
}

fn photo(event: u128, sender: &str, source: &str, bytes: &[u8]) -> InboundEvent {
    let mut event = text(event, sender, source, "");
    if let InboundKind::Message(message) = &mut event.kind {
        message.media = vec![Media {
            mime: "image/jpeg".into(),
            filename: "receipt.jpg".into(),
            size: bytes.len() as u64,
            sha256: Sha256::digest(bytes).into(),
            locator: b"sealed locator".to_vec(),
            width: Some(800),
            height: Some(600),
            duration_seconds: None,
            presentation: None,
        }];
    }
    event
}

async fn content(pool: &PgPool, group_id: Uuid) -> Vec<String> {
    sqlx::query_scalar!(
        "SELECT body FROM whatsapp_group_message WHERE binding_id=$1 AND message_id IS NOT NULL ORDER BY source_at",
        group_id
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_inbound_photo_is_downloaded_once_and_becomes_a_private_document(pool: PgPool) {
    let (linked, session, repository, binding, alice, bob) = adopted(&pool).await;
    let bytes = b"jpeg bytes".to_vec();
    session
        .ingest_event(alice, &photo(1, CUSTOMER_JID, "3EB0PIC", &bytes))
        .await
        .unwrap();
    // Bob's observation of the same message adds no second message or claim.
    session
        .ingest_event(bob, &photo(2, CUSTOMER_JID, "3EB0PIC", &bytes))
        .await
        .unwrap();
    assert_eq!(content(&pool, binding.id).await, vec![""]);
    // The newest observer holds the locator and downloads it, once.
    assert!(
        session
            .claim_media_imports(alice, 8)
            .await
            .unwrap()
            .is_empty()
    );
    let claimed = session.claim_media_imports(bob, 8).await.unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].locator, b"sealed locator");
    assert!(
        session
            .claim_media_imports(bob, 8)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(matches!(
        session
            .complete_media_import(bob, &claimed[0].attachment, b"tampered")
            .await
            .unwrap_err()
            .current_context(),
        LinkedError::Invalid(_)
    ));
    assert_eq!(content(&pool, binding.id).await, vec![""]);
    let first = sqlx::query_scalar!(
        "SELECT id FROM whatsapp_group_message WHERE binding_id=$1 AND message_id IS NOT NULL",
        binding.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let states = linked
        .message_attachments(&receipt::<MessageView>(ALICE, binding.id), &[first])
        .await
        .unwrap();
    assert_eq!(
        states[0].linked_attachments[0].state,
        AttachmentState::Unavailable
    );
    assert_eq!(states[0].linked_attachments[0].file_name, "receipt.jpg");

    // A fresh message imports cleanly, surviving one failed document write.
    session
        .ingest_event(alice, &photo(3, CUSTOMER_JID, "3EB0PIC2", &bytes))
        .await
        .unwrap();
    let claimed = session.claim_media_imports(alice, 8).await.unwrap();
    session
        .complete_media_import(alice, &claimed[0].attachment, &bytes)
        .await
        .unwrap();
    let documents = Arc::new(Documents::default());
    *documents.fail.lock().unwrap() = 1;
    let media = MediaService::new(repository.clone(), documents.clone());
    assert_eq!(media.import_pending().await.unwrap(), 0);
    sqlx::query!(
        "UPDATE whatsapp_group_attachment SET retry_at = now() WHERE state = 'downloaded'"
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(media.import_pending().await.unwrap(), 1);
    assert_eq!(media.import_pending().await.unwrap(), 0);
    let stored = documents.stored.lock().unwrap().clone();
    assert_eq!(stored.len(), 1);
    assert_eq!(
        stored[0].1, binding.user_id,
        "the content owner owns imports"
    );
    assert_eq!(stored[0].2, bytes);
    let attached = sqlx::query_scalar!(
        "SELECT document_id FROM whatsapp_group_attachment WHERE state = 'ready'"
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(attached, vec![stored[0].0]);
    assert_eq!(
        content(&pool, binding.id).await[1],
        "",
        "attachment state does not rewrite the plain body"
    );
    let second = sqlx::query_scalar!(
        "SELECT message_id AS \"id!\" FROM whatsapp_group_message WHERE source_id = '3EB0PIC2'"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let states = linked
        .message_attachments(&receipt::<MessageView>(ALICE, binding.id), &[second])
        .await
        .unwrap();
    assert_eq!(
        states[0].linked_attachments[0],
        LinkedAttachment {
            ordinal: 0,
            state: AttachmentState::Ready,
            file_name: "receipt.jpg".into(),
            mime: "image/jpeg".into(),
            size: bytes.len() as u64,
            document_id: Some(stored[0].0),
            width: Some(800),
            height: Some(600),
            duration_seconds: None,
            presentation: None,
        }
    );
    // Imported documents inherit ordinary group shares dynamically.
    sqlx::query!(
        r#"INSERT INTO "Document" (id,name,owner) VALUES ($1,'receipt',$2)"#,
        stored[0].0.to_string(),
        ALICE
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut tx = pool.begin().await.unwrap();
    entity_access_db_utils::direct_share::set(
        &mut tx,
        &binding.id,
        EntityType::WhatsAppGroup,
        &CAROL.to_owned().try_into().unwrap(),
        Some(AccessLevel::View),
        false,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let access = entity_access::domain::service::EntityAccessServiceImpl::new(
        entity_access::outbound::PgAccessRepository::new(pool.clone()),
    );
    use entity_access::domain::ports::EntityAccessService;
    let viewer = macro_user_id::user_id::MacroUserIdStr::try_from(CAROL.to_owned()).unwrap();
    assert_eq!(
        access
            .get_access_level(
                Some(&viewer.0),
                &stored[0].0.to_string(),
                EntityType::Document
            )
            .await
            .unwrap(),
        Some(AccessLevel::View)
    );
    let mut tx = pool.begin().await.unwrap();
    entity_access_db_utils::direct_share::set(
        &mut tx,
        &binding.id,
        EntityType::WhatsAppGroup,
        &viewer,
        None,
        false,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(
        access
            .get_access_level(
                Some(&viewer.0),
                &stored[0].0.to_string(),
                EntityType::Document
            )
            .await
            .unwrap(),
        None
    );
    // A bot in team scope inherits the group's explicit team share, without
    // impersonating the adopter or receiving a separate document grant.
    let bot = entity_access::domain::models::BotId::new_from_uuid(Uuid::from_u128(0xb07));
    let team = sqlx::query_scalar!("SELECT team_id FROM team_user WHERE user_id = $1", ALICE)
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query!("INSERT INTO bots (id,kind,team_id,name,handle) VALUES ($1,'owned',$2,'Group reader','wa-reader')",
        bot.as_uuid(), team).execute(&pool).await.unwrap();
    let team_share = models_permissions::share_permission::UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: Some(Some(AccessLevel::View)),
        channel_share_permissions: None,
    };
    let owner = receipt::<MessageView>(ALICE, binding.id);
    linked
        .update_permissions(&owner, &team_share)
        .await
        .unwrap();
    use entity_access::domain::ports::AccessRepository;
    let permissions = entity_access::outbound::PgAccessRepository::new(pool.clone());
    assert_eq!(
        permissions
            .get_team_entity_access(bot, team, &stored[0].0.to_string(), EntityType::Document)
            .await
            .unwrap(),
        Some(AccessLevel::View)
    );
    linked
        .update_permissions(
            &owner,
            &models_permissions::share_permission::UpdateSharePermissionRequestV2 {
                team_share_access_level: Some(None),
                ..team_share
            },
        )
        .await
        .unwrap();
    assert_eq!(
        permissions
            .get_team_entity_access(bot, team, &stored[0].0.to_string(), EntityType::Document)
            .await
            .unwrap(),
        None
    );
    let blobs = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM whatsapp_media_blob"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(blobs, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_uploaded_attachment_is_sent_once_and_becomes_the_messages_document(pool: PgPool) {
    let (linked, session, repository, binding, alice, _) = adopted(&pool).await;
    let bytes = b"%PDF-1.7 quote".to_vec();
    let uploaded = linked
        .upload_attachment(
            &receipt::<MessageWrite>(ALICE, binding.id),
            "quote.pdf",
            "application/pdf",
            &bytes,
            SendAuthority::UserApiToken,
        )
        .await
        .unwrap();
    assert_eq!(uploaded.kind, MediaKind::Document);
    assert!(
        linked
            .upload_attachment(
                &receipt::<MessageWrite>(ALICE, binding.id),
                "tool.exe",
                "application/x-msdownload",
                &bytes,
                SendAuthority::UserApiToken,
            )
            .await
            .is_err()
    );
    // Bob cannot send Alice's upload.
    let media = |caption: Option<&str>| SendReply {
        idempotency_key: Uuid::now_v7(),
        message: ReplyContent::Media {
            upload_id: uploaded.upload_id,
            caption: caption.map(str::to_owned),
        },
        reply_to: None,
    };
    assert!(
        linked
            .send_reply(
                &receipt::<MessageWrite>(BOB, binding.id),
                &media(None),
                SendAuthority::UserApiToken
            )
            .await
            .is_err()
    );
    let progress = linked
        .send_reply(
            &receipt::<MessageWrite>(ALICE, binding.id),
            &media(Some("Signed quote")),
            SendAuthority::UserApiToken,
        )
        .await
        .unwrap();
    let claimed = session.claim_sends(alice, 8).await.unwrap();
    assert_eq!(
        claimed[0].content,
        OutgoingContent::Media {
            kind: MediaKind::Document,
            mime: "application/pdf".into(),
            filename: "quote.pdf".into(),
            caption: Some("Signed quote".into()),
            quote: None,
        }
    );
    let outbound = session.outbound_media(alice, progress.id).await.unwrap();
    assert_eq!(outbound.bytes, bytes);
    session
        .begin_dispatch(alice, progress.id, "3EB0DOC")
        .await
        .unwrap();
    session
        .record_send_outcome(
            alice,
            progress.id,
            SendOutcome::Accepted {
                server_at: Utc::now(),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        content(&pool, binding.id).await,
        vec!["Signed quote"],
        "attachment state is separate from the plain caption"
    );
    let documents = Arc::new(Documents::default());
    MediaService::new(repository, documents.clone())
        .import_pending()
        .await
        .unwrap();
    assert_eq!(content(&pool, binding.id).await, vec!["Signed quote"]);
    let stored = documents.stored.lock().unwrap().clone();
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].0, uploaded.upload_id);
    assert_eq!(stored[0].1, ALICE, "the uploader owns what they sent");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_passkey_assertion_is_forwarded_once(pool: PgPool) {
    workspace(&pool).await;
    let (linked, session, _) = services(&pool);
    let pairing = linked
        .connect(ALICE, false, SendAuthority::Human)
        .await
        .unwrap();
    let lease = session.begin_lease(pairing.account_id).await.unwrap();
    let assertion = serde_json::json!({ "id": "credential", "response": {} });
    assert!(
        linked
            .passkey(ALICE, pairing.id, &assertion, SendAuthority::Human)
            .await
            .is_err(),
        "only a transaction waiting on a passkey accepts one"
    );
    session
        .update_pairing(
            lease.scope,
            pairing.id,
            PairingUpdate::Passkey {
                challenge: serde_json::json!({ "challenge": "abc" }),
            },
        )
        .await
        .unwrap();
    let state = linked
        .pair_state(ALICE, pairing.id, SendAuthority::Human)
        .await
        .unwrap();
    assert_eq!(
        state.challenge,
        Some(serde_json::json!({ "challenge": "abc" }))
    );
    assert!(
        linked
            .passkey(BOB, pairing.id, &assertion, SendAuthority::Human)
            .await
            .is_err()
    );
    linked
        .passkey(ALICE, pairing.id, &assertion, SendAuthority::Human)
        .await
        .unwrap();
    assert_eq!(
        session
            .take_passkey_response(lease.scope, pairing.id)
            .await
            .unwrap(),
        Some(assertion)
    );
    assert_eq!(
        session
            .take_passkey_response(lease.scope, pairing.id)
            .await
            .unwrap(),
        None
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enqueued_events_survive_until_ingested_and_health_reports_them(pool: PgPool) {
    let (_, session, _, binding, alice, _) = adopted(&pool).await;
    let event = text(1, CUSTOMER_JID, "3EB0Q1", "queued");
    session.enqueue_inbound(alice, &event).await.unwrap();
    session.enqueue_inbound(alice, &event).await.unwrap();
    assert!(content(&pool, binding.id).await.is_empty());
    let health = session.fleet_health().await.unwrap();
    assert_eq!(health.accounts_running, 0);
    assert_eq!(health.accounts_unowned, 2);
    assert_eq!(session.discoverable_accounts(10).await.unwrap().len(), 2);
    assert_eq!(session.replay_deferred(alice).await.unwrap(), 1);
    assert_eq!(content(&pool, binding.id).await, vec!["queued"]);
    assert_eq!(session.replay_deferred(alice).await.unwrap(), 0);
    assert_eq!(
        session.account_state(alice.account_id).await.unwrap(),
        Some(AccountState::Connected)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failed_attachment_preserves_the_plain_caption(pool: PgPool) {
    let (_, session, _, binding, alice, _) = adopted(&pool).await;
    let mut event = photo(1, CUSTOMER_JID, "3EB0CAP", b"bytes");
    if let InboundKind::Message(message) = &mut event.kind {
        message.text = "Look at this".into();
    }
    session.ingest_event(alice, &event).await.unwrap();
    assert_eq!(content(&pool, binding.id).await, vec!["Look at this"]);
    let claimed = session.claim_media_imports(alice, 8).await.unwrap();
    session
        .fail_media_import(alice, &claimed[0].attachment, MediaFailure::Permanent)
        .await
        .unwrap();
    assert_eq!(content(&pool, binding.id).await, vec!["Look at this"]);
}
