use super::*;
use crate::native_messaging::files::MessageFiles;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn provider_revision_requires_the_connector_to_remain_a_member(pool: PgPool) {
    let f = fixture(&pool, Provider::Instagram, None).await;
    let original = incoming(&f.c, "permissioned-revision");
    fixture_native(&pool)
        .await
        .ingest(&f.c, &original, vec![])
        .await
        .unwrap();
    f.repo
        .connect(
            &Connection {
                user_id: "macro|uninvited@native-messaging.test".into(),
                ..f.c.clone()
            },
            b"test-only",
            Some(f.c.id),
        )
        .await
        .unwrap();
    sqlx::query!(
        "DELETE FROM team_user WHERE team_id=$1 AND user_id<>$2",
        f.c.team_id,
        f.c.user_id
    )
    .execute(&pool)
    .await
    .unwrap();
    let at = connected_time(&f.repo, f.c.id).await;
    let payload = json!({"object":"instagram","entry":[{"id":f.c.account_id,"messaging":[{"sender":{"id":original.customer_id},"recipient":{"id":f.c.account_id},"timestamp":at.timestamp_millis(),"message":{"mid":original.message_id,"is_deleted":true}}]}]});
    assert_eq!(
        signed(&f.app, Provider::Instagram, payload, true).await,
        StatusCode::OK
    );
    let work = f.repo.claim_receipt().await.unwrap().unwrap();
    let error = f
        .service
        .process_receipt(
            &work,
            webhook::decode(work.provider, &work.payload).unwrap(),
        )
        .await
        .unwrap_err();
    assert!(matches!(error.current_context(), MessagingError::Forbidden));
    let (channel, id) = f
        .repo
        .message_target(f.c.id, original.message_id.as_str())
        .await
        .unwrap();
    let stored = PgMessageRepository::new(pool)
        .get(&MessageParent::Channel(channel), id)
        .await
        .unwrap()
        .unwrap();
    assert!(stored.deleted_at.is_none());
    assert_eq!(stored.content, original.content);
}

#[derive(Default)]
struct PartialFiles(std::sync::Mutex<Vec<Vec<bool>>>);

#[async_trait]
impl MessageFiles for PartialFiles {
    async fn upload(
        &self,
        user: &str,
        channel: Uuid,
        file: MediaBytes,
    ) -> PortResult<UploadedAttachment> {
        TextOnlyFiles.upload(user, channel, file).await
    }
    async fn read(&self, user: &str, channel: Uuid, document: Uuid) -> PortResult<MediaBytes> {
        TextOnlyFiles.read(user, channel, document).await
    }
    async fn prepare(
        &self,
        user: &str,
        channel: Uuid,
        document: Uuid,
        file: MediaBytes,
    ) -> PortResult<OutboundMedia> {
        TextOnlyFiles.prepare(user, channel, document, file).await
    }
    async fn attach_sent(
        &self,
        work: &SendWork,
        c: &Connection,
        id: &ProviderId,
    ) -> PortResult<()> {
        TextOnlyFiles.attach_sent(work, c, id).await
    }
    async fn receive(
        &self,
        _: &Connection,
        _: &IncomingMessage,
        files: Vec<Option<MediaBytes>>,
    ) -> PortResult<()> {
        self.0
            .lock()
            .unwrap()
            .push(files.iter().map(Option::is_some).collect());
        Ok(())
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_share_download_preserves_healthy_media_ordinal_text_and_later_events(pool: PgPool) {
    let files = Arc::new(PartialFiles::default());
    let Fixture {
        app,
        service,
        repo,
        c,
        ..
    } = fixture_with_files(&pool, Provider::Instagram, None, Some(files.clone())).await;
    let timestamp = connected_time(&repo, c.id).await;
    let payload = json!({"object":"instagram","entry":[{"id":c.account_id,"messaging":[
        {"sender":{"id":"customer"},"recipient":{"id":c.account_id},"timestamp":timestamp.timestamp_millis(),"message":{"mid":"mixed-share","text":"Keep this caption","attachments":[
            {"type":"ig_post","payload":{"url":"https://lookaside.fbsbx.com/ig_messaging_cdn/expired","ig_post_media_id":"unavailable-history-media","title":"Expired preview"}},
            {"type":"image","payload":{"url":"https://scontent.cdninstagram.com/healthy-test.png"}}
        ]}},
        {"sender":{"id":"customer"},"recipient":{"id":c.account_id},"timestamp":timestamp.timestamp_millis(),"message":{"mid":"later-healthy","text":"Still here"}}
    ]}]});
    assert_eq!(
        signed(&app, Provider::Instagram, payload.clone(), false).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        signed(&app, Provider::Instagram, payload, true).await,
        StatusCode::OK
    );
    let work = repo.claim_receipt().await.unwrap().unwrap();
    assert!(
        service
            .process_receipt(
                &work,
                webhook::decode(work.provider, &work.payload).unwrap()
            )
            .await
            .is_err()
    );
    assert_eq!(*files.0.lock().unwrap(), vec![vec![false, true]]);
    let (channel, message) = repo.message_target(c.id, "mixed-share").await.unwrap();
    let stored = PgMessageRepository::new(pool.clone())
        .get(&MessageParent::Channel(channel), message)
        .await
        .unwrap()
        .unwrap();
    assert!(stored.content.contains("Keep this caption"));
    assert!(stored.content.contains("Some attachments are unavailable"));
    assert!(repo.message_target(c.id, "later-healthy").await.is_ok());
    assert!(
        service
            .process_receipt(
                &work,
                webhook::decode(work.provider, &work.payload).unwrap()
            )
            .await
            .is_err()
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM meta_messaging_message")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(2)
    );
}
