use super::*;
use crate::domain::{
    media::MediaService,
    ports::{FileImport, FileStore, MediaRepository},
};
use sha2::{Digest, Sha256};
use std::sync::Mutex;

/// A stored static file: its id, the blob it came from, its owner and bytes.
#[derive(Clone)]
struct StoredFile {
    file_id: Uuid,
    blob_id: Uuid,
    owner: String,
    bytes: Vec<u8>,
}

/// Records the static files stored and deleted; fails the first `fail` stores.
#[derive(Default)]
struct Files {
    stored: Mutex<Vec<StoredFile>>,
    deleted: Mutex<Vec<Uuid>>,
    fail: Mutex<u32>,
}

#[async_trait]
impl FileStore for Files {
    async fn store(&self, import: &FileImport, bytes: Vec<u8>) -> LinkedResult<Uuid> {
        let mut fail = self.fail.lock().unwrap();
        if *fail > 0 {
            *fail -= 1;
            return Err(LinkedError::Unavailable.into());
        }
        let file_id = Uuid::now_v7();
        self.stored.lock().unwrap().push(StoredFile {
            file_id,
            blob_id: import.blob_id,
            owner: import.owner.clone(),
            bytes,
        });
        Ok(file_id)
    }

    async fn delete(&self, file_id: Uuid) -> LinkedResult<()> {
        self.deleted.lock().unwrap().push(file_id);
        Ok(())
    }
}

async fn released_files(pool: &PgPool) -> Vec<Uuid> {
    sqlx::query_scalar!("SELECT file_id FROM whatsapp_file_deletion ORDER BY file_id")
        .fetch_all(pool)
        .await
        .unwrap()
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
async fn an_inbound_photo_is_downloaded_once_and_becomes_a_static_file(pool: PgPool) {
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

    // A fresh message imports cleanly, surviving one failed file write.
    session
        .ingest_event(alice, &photo(3, CUSTOMER_JID, "3EB0PIC2", &bytes))
        .await
        .unwrap();
    let claimed = session.claim_media_imports(alice, 8).await.unwrap();
    session
        .complete_media_import(alice, &claimed[0].attachment, &bytes)
        .await
        .unwrap();
    let files = Arc::new(Files::default());
    *files.fail.lock().unwrap() = 1;
    let media = MediaService::new(repository.clone(), files.clone());
    assert_eq!(media.import_pending().await.unwrap(), 0);
    sqlx::query!(
        "UPDATE whatsapp_group_attachment SET retry_at = now() WHERE state = 'downloaded'"
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(media.import_pending().await.unwrap(), 1);
    assert_eq!(media.import_pending().await.unwrap(), 0);
    let stored = files.stored.lock().unwrap().clone();
    assert_eq!(stored.len(), 1);
    assert_eq!(
        stored[0].owner, binding.user_id,
        "the content owner owns imports"
    );
    assert_eq!(stored[0].bytes, bytes);
    let attached =
        sqlx::query_scalar!("SELECT file_id FROM whatsapp_group_attachment WHERE state = 'ready'")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(attached, vec![Some(stored[0].file_id)]);
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
            file_id: Some(stored[0].file_id),
            width: Some(800),
            height: Some(600),
            duration_seconds: None,
            presentation: None,
        }
    );
    let blobs = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM whatsapp_media_blob"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(blobs, 0);

    // Deleting the message in WhatsApp deletes its file.
    let mut delete = text(4, CUSTOMER_JID, "3EB0DEL", "");
    if let InboundKind::Message(message) = &mut delete.kind {
        message.kind = MessageKind::Delete;
        message.target = Some(Target {
            source_id: "3EB0PIC2".into(),
            sender_jid: CUSTOMER_JID.into(),
        });
    }
    session.ingest_event(alice, &delete).await.unwrap();
    assert_eq!(released_files(&pool).await, vec![stored[0].file_id]);
    assert_eq!(media.delete_released().await.unwrap(), 1);
    assert_eq!(*files.deleted.lock().unwrap(), vec![stored[0].file_id]);
    assert!(released_files(&pool).await.is_empty());
    assert_eq!(media.delete_released().await.unwrap(), 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_chats_owner_deletes_its_files(pool: PgPool) {
    let (_, session, repository, binding, alice, _) = adopted(&pool).await;
    let bytes = b"jpeg bytes".to_vec();
    session
        .ingest_event(alice, &photo(1, CUSTOMER_JID, "3EB0PIC", &bytes))
        .await
        .unwrap();
    let claimed = session.claim_media_imports(alice, 8).await.unwrap();
    session
        .complete_media_import(alice, &claimed[0].attachment, &bytes)
        .await
        .unwrap();
    let files = Arc::new(Files::default());
    let media = MediaService::new(repository, files.clone());
    assert_eq!(media.import_pending().await.unwrap(), 1);
    let file_id = files.stored.lock().unwrap()[0].file_id;
    assert!(released_files(&pool).await.is_empty());

    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, binding.user_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(released_files(&pool).await, vec![file_id]);
    assert_eq!(media.delete_released().await.unwrap(), 1);
    assert_eq!(*files.deleted.lock().unwrap(), vec![file_id]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_file_stored_after_its_message_was_deleted_is_deleted(pool: PgPool) {
    let (_, session, repository, _, alice, _) = adopted(&pool).await;
    let bytes = b"jpeg bytes".to_vec();
    session
        .ingest_event(alice, &photo(1, CUSTOMER_JID, "3EB0PIC", &bytes))
        .await
        .unwrap();
    let claimed = session.claim_media_imports(alice, 8).await.unwrap();
    session
        .complete_media_import(alice, &claimed[0].attachment, &bytes)
        .await
        .unwrap();
    let imports = repository.due_imports(8).await.unwrap();
    let mut delete = text(2, CUSTOMER_JID, "3EB0DEL", "");
    if let InboundKind::Message(message) = &mut delete.kind {
        message.kind = MessageKind::Delete;
        message.target = Some(Target {
            source_id: "3EB0PIC".into(),
            sender_jid: CUSTOMER_JID.into(),
        });
    }
    session.ingest_event(alice, &delete).await.unwrap();
    // The import was already under way: its file has no attachment to go to.
    let late = Uuid::now_v7();
    repository.import_stored(&imports[0], late).await.unwrap();
    assert_eq!(released_files(&pool).await, vec![late]);
    let ready = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM whatsapp_group_attachment WHERE file_id IS NOT NULL"#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(ready, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_uploaded_attachment_is_sent_once_and_becomes_the_messages_file(pool: PgPool) {
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
            shape: MediaShape::default(),
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
    let files = Arc::new(Files::default());
    MediaService::new(repository, files.clone())
        .import_pending()
        .await
        .unwrap();
    assert_eq!(content(&pool, binding.id).await, vec!["Signed quote"]);
    let stored = files.stored.lock().unwrap().clone();
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].blob_id, uploaded.upload_id);
    assert_eq!(stored[0].owner, ALICE, "the uploader owns what they sent");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_passkey_assertion_is_forwarded_once(pool: PgPool) {
    workspace(&pool).await;
    let (linked, session, _) = services(&pool);
    let pairing = linked
        .connect(&person(ALICE), false, SendAuthority::Human)
        .await
        .unwrap();
    let lease = session.begin_lease(pairing.account_id).await.unwrap();
    let assertion = serde_json::json!({ "id": "credential", "response": {} });
    assert!(
        linked
            .passkey(&person(ALICE), pairing.id, &assertion, SendAuthority::Human)
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
        .pair_state(&person(ALICE), pairing.id, SendAuthority::Human)
        .await
        .unwrap();
    assert_eq!(
        state.challenge,
        Some(serde_json::json!({ "challenge": "abc" }))
    );
    assert!(
        linked
            .passkey(&person(BOB), pairing.id, &assertion, SendAuthority::Human)
            .await
            .is_err()
    );
    linked
        .passkey(&person(ALICE), pairing.id, &assertion, SendAuthority::Human)
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sent_image_keeps_the_size_read_from_its_file(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    let mut png = Vec::new();
    image::RgbImage::new(64, 48)
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .unwrap();
    let uploaded = linked
        .upload_attachment(
            &receipt::<MessageWrite>(ALICE, binding.id),
            "plan.png",
            "image/png",
            &png,
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let progress = linked
        .send_reply(
            &receipt::<MessageWrite>(ALICE, binding.id),
            &SendReply {
                idempotency_key: Uuid::now_v7(),
                message: ReplyContent::Media {
                    upload_id: uploaded.upload_id,
                    caption: None,
                },
                reply_to: None,
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let claimed = session.claim_sends(alice, 8).await.unwrap();
    let OutgoingContent::Media { shape, .. } = &claimed[0].content else {
        panic!("a media send");
    };
    let size = MediaShape {
        width: Some(64),
        height: Some(48),
        duration_seconds: None,
    };
    assert_eq!(*shape, size, "the phone gets the size with the message");
    session
        .begin_dispatch(alice, progress.id, "3EB0PNG")
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
    let stored = sqlx::query!(
        "SELECT width, height, duration_seconds FROM whatsapp_group_attachment WHERE binding_id = $1 AND source_id = '3EB0PNG'",
        binding.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (stored.width, stored.height, stored.duration_seconds),
        (Some(64), Some(48), None),
        "the timeline reserves the space like for a received image"
    );
}
