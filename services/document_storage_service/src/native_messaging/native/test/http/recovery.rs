use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn partial_decode_is_durable_without_replaying_successful_siblings_after_reconnect(
    pool: PgPool,
) {
    let f = fixture(&pool, Provider::Whatsapp, None).await;
    let at = connected_time(&f.repo, f.c.id).await;
    let message = |id: &str| json!({"id":id,"from":"customer","type":"text","timestamp":at.timestamp(),"text":{"body":"Valid sibling"}});
    let payload = json!({"object":"whatsapp_business_account","entry":[{"id":"waba","changes":[{"field":"messages","value":{
        "metadata":{"phone_number_id":f.c.account_id},"messages":[message("before"),{"type":"text"},message("after")]
    }}]}]});
    assert_eq!(
        signed(&f.app, Provider::Whatsapp, payload, true).await,
        StatusCode::OK
    );
    let work = f.repo.claim_receipt().await.unwrap().unwrap();
    let batch = webhook::decode(work.provider, &work.payload).unwrap();
    assert_eq!(batch.invalid_items, 1);
    f.service
        .process_receipt_attempt(&work, batch)
        .await
        .unwrap();
    assert!(f.repo.message_target(f.c.id, "before").await.is_ok());
    assert!(f.repo.message_target(f.c.id, "after").await.is_ok());
    let row = sqlx::query!(
        "SELECT status,error_code,payload,decode_failures FROM meta_messaging_receipt WHERE id=$1",
        work.lease.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.status, "failed");
    assert_eq!(row.decode_failures, 1);
    assert_eq!(row.error_code.as_deref(), Some("invalid_provider_payload"));
    assert_eq!(row.payload, work.payload);
    f.repo.connect(&f.c, b"new", Some(f.c.id)).await.unwrap();
    assert!(f.repo.claim_receipt().await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn healthy_account_in_the_same_delivery_progresses_while_media_is_blocked(pool: PgPool) {
    let f = fixture(&pool, Provider::Whatsapp, None).await;
    let mut healthy = f.c.clone();
    healthy.id = Uuid::now_v7();
    healthy.account_id = "healthy-account".to_owned().try_into().unwrap();
    let healthy = f.repo.connect(&healthy, b"test", None).await.unwrap();
    let at = connected_time(&f.repo, healthy.id).await;
    let entry = |account: &ProviderId, message: Value| json!({"id":"waba","changes":[{"field":"messages","value":{"metadata":{"phone_number_id":account},"messages":[message]}}]});
    let payload = json!({"object":"whatsapp_business_account","entry":[
        entry(&f.c.account_id,json!({"id":"slow-message","from":"customer","type":"image","timestamp":at.timestamp(),"image":{"id":"slow-test-media"}})),
        entry(&healthy.account_id,json!({"id":"healthy-message","from":"customer","type":"text","timestamp":at.timestamp(),"text":{"body":"Progress while another account waits"}}))
    ]});
    assert_eq!(
        signed(&f.app, Provider::Whatsapp, payload, true).await,
        StatusCode::OK
    );
    let work = f.repo.claim_receipt().await.unwrap().unwrap();
    let batch = webhook::decode(work.provider, &work.payload).unwrap();
    let service = f.service.clone();
    let processing =
        tokio::spawn(async move { service.process_receipt_attempt(&work, batch).await });
    tokio::time::timeout(
        std::time::Duration::from_secs(3),
        f.remote.operation_entered.notified(),
    )
    .await
    .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            if f.repo
                .message_target(healthy.id, "healthy-message")
                .await
                .is_ok()
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("healthy sibling must commit without waiting on the slow media request");
    assert!(!processing.is_finished());
    f.remote.operation_release.notify_one();
    processing.await.unwrap().unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn replay_after_receipt_deletion_keeps_source_deduplication_and_unsend_tombstones(
    pool: PgPool,
) {
    let f = fixture(&pool, Provider::Instagram, None).await;
    let at = connected_time(&f.repo, f.c.id).await;
    let payload = |message: Value| {
        json!({"object":"instagram","entry":[{"id":f.c.account_id,"messaging":[{
            "sender":{"id":"customer"},"recipient":{"id":f.c.account_id},"timestamp":at.timestamp_millis(),"message":message
        }]}]})
    };
    let original = payload(json!({"mid":"retained-source","text":"Customer content"}));
    assert_eq!(
        signed(&f.app, Provider::Instagram, original.clone(), true).await,
        StatusCode::OK
    );
    drain(&f.service).await;
    let identity = f
        .repo
        .message_target(f.c.id, "retained-source")
        .await
        .unwrap();
    assert_eq!(
        signed(
            &f.app,
            Provider::Instagram,
            payload(json!({"mid":"retained-source","is_deleted":true})),
            true
        )
        .await,
        StatusCode::OK
    );
    drain(&f.service).await;
    sqlx::query!("UPDATE meta_messaging_receipt SET created_at=now()-interval '31 days',completed_at=now()-interval '8 days'").execute(&pool).await.unwrap();
    assert_eq!(f.repo.cleanup_receipts().await.unwrap().receipts_deleted, 2);
    assert_eq!(
        signed(&f.app, Provider::Instagram, original, true).await,
        StatusCode::OK
    );
    drain(&f.service).await;
    assert_eq!(
        f.repo
            .message_target(f.c.id, "retained-source")
            .await
            .unwrap(),
        identity
    );
    let row = PgMessageRepository::new(pool.clone())
        .get(&MessageParent::Channel(identity.0), identity.1)
        .await
        .unwrap()
        .unwrap();
    assert!(row.deleted_at.is_some());
    assert!(row.content.is_empty());
    assert!(row.attachments.is_empty());
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM meta_messaging_message WHERE connection_id=$1",
            f.c.id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(1)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn permanent_identity_conflict_stops_retrying_without_blocking_a_healthy_sibling(
    pool: PgPool,
) {
    let f = fixture(&pool, Provider::Whatsapp, None).await;
    let at = connected_time(&f.repo, f.c.id).await.timestamp();
    let message = |id: &str, user: &str| json!({"id":id,"from_user_id":user,"type":"text","timestamp":at,"text":{"body":"Hello"}});
    let envelope = |messages: Value| json!({"object":"whatsapp_business_account","entry":[{"id":"waba","changes":[{"field":"messages","value":{"metadata":{"phone_number_id":f.c.account_id},"messages":messages}}]}]});
    assert_eq!(
        signed(
            &f.app,
            Provider::Whatsapp,
            envelope(json!([{"id":"a","from_user_id":"US.A","from":"15550000001","type":"text","timestamp":at,"text":{"body":"Hello"}}])),
            true
        )
        .await,
        StatusCode::OK
    );
    drain(&f.service).await;
    let conflicting = json!({"id":"ambiguous","from":"15550000001","type":"text","timestamp":at,"text":{"body":"Legacy phone-only fact"}});
    assert_eq!(
        signed(
            &f.app,
            Provider::Whatsapp,
            envelope(json!([conflicting, message("healthy", "US.C")])),
            true
        )
        .await,
        StatusCode::OK
    );
    let work = f.repo.claim_receipt().await.unwrap().unwrap();
    f.service
        .process_receipt_attempt(
            &work,
            webhook::decode(work.provider, &work.payload).unwrap(),
        )
        .await
        .unwrap();
    let row = sqlx::query!(
        "SELECT status,error_code FROM meta_messaging_receipt WHERE id=$1",
        work.lease.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.status, "failed");
    assert_eq!(row.error_code.as_deref(), Some("identity_conflict"));
    assert!(f.repo.claim_receipt().await.unwrap().is_none());
    assert!(f.repo.message_target(f.c.id, "healthy").await.is_ok());
    f.repo
        .connect(&f.c, b"renewed-credential", Some(f.c.id))
        .await
        .unwrap();
    assert!(f.repo.claim_receipt().await.unwrap().is_none());
}
