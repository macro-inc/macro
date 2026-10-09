use super::*;
use email::domain::attachment_access::{AttachmentReadRecord, AttachmentReadRepository};
use email::domain::mailbox::MailboxError;
use futures::future::BoxFuture;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::sync::{Arc, Mutex};

struct Reader {
    db: PgPool,
    read: Arc<Mutex<Vec<Uuid>>>,
}
impl AuthorizedAttachmentBytes for Reader {
    fn read<'a>(
        &'a self,
        actor: &'a str,
        id: Uuid,
    ) -> BoxFuture<'a, Result<(AttachmentReadRecord, Vec<u8>), MailboxError>> {
        Box::pin(async move {
            assert_eq!(actor, "macro|gmail-native@example.com");
            self.read.lock().unwrap().push(id);
            let record = email::outbound::EmailPgRepo::new(self.db.clone())
                .attachment_read_record(id)
                .await
                .map_err(|_| MailboxError::Persistence)?
                .ok_or(MailboxError::Persistence)?;
            Ok((record, vec![1, 2, 3]))
        })
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn imported_gmail_draft_preserves_native_inline_files_and_honors_removal_and_upload_deduplication(
    db: PgPool,
) {
    let link = Uuid::now_v7();
    let thread = Uuid::now_v7();
    let draft = Uuid::now_v7();
    let upload = Uuid::now_v7();
    sqlx::query!("INSERT INTO email_links(id,macro_id,fusionauth_user_id,email_address,provider) VALUES($1,'macro|gmail-native@example.com','gmail-native','gmail-native@example.com','GMAIL')",link).execute(&db).await.unwrap();
    sqlx::query!(
        "INSERT INTO email_threads(id,link_id) VALUES($1,$2)",
        thread,
        link
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO email_messages(id,link_id,thread_id,provider_id,is_draft) VALUES($1,$2,$3,'gmail-draft',true)",draft,link,thread).execute(&db).await.unwrap();
    let inline = Uuid::now_v7();
    let removed = Uuid::now_v7();
    let duplicate = Uuid::now_v7();
    let removed_by_cid = Uuid::now_v7();
    for (id, provider, cid) in [
        (inline, "inline", "<logo@draft>".to_owned()),
        (removed, "removed", "removed@draft".to_owned()),
        (
            removed_by_cid,
            "removed-cid",
            "<forwarded@draft>".to_owned(),
        ),
        (
            duplicate,
            "uploaded",
            format!("<{upload}@attachments.macro.com>"),
        ),
    ] {
        sqlx::query!("INSERT INTO email_attachments(id,message_id,provider_attachment_id,content_id,filename,mime_type,size_bytes) VALUES($1,$2,$3,$4,'image.png','image/png',3)",id,draft,provider,cid).execute(&db).await.unwrap();
    }
    sqlx::query!("INSERT INTO email_draft_attachment_removals(id,message_id,provider_id) VALUES($1,$2,'removed')",Uuid::now_v7(),draft).execute(&db).await.unwrap();
    sqlx::query!("INSERT INTO email_draft_attachment_removals(id,message_id,content_id) VALUES($1,$2,'forwarded@draft')",Uuid::now_v7(),draft).execute(&db).await.unwrap();
    sqlx::query!("INSERT INTO email_attachments_drafts(id,draft_id,file_name,content_type,sha,size,s3_key) VALUES($1,$2,'uploaded.txt','text/plain','sha',3,'object')",upload,draft).execute(&db).await.unwrap();
    let link = email_db_client::links::get::fetch_link_by_id(&db, link)
        .await
        .unwrap()
        .unwrap();
    let reads = Arc::new(Mutex::new(vec![]));
    let reader = Reader {
        db: db.clone(),
        read: reads.clone(),
    };
    let mut message:message::MessageToSend=serde_json::from_value(serde_json::json!({"db_id":draft,"link_id":link.id,"subject":"Imported native draft","body_html":"<img src=\"cid:logo@draft\">"})).unwrap();
    fetch_and_attach_forwarded_attachments(
        &db,
        &reader,
        "macro|gmail-native@example.com",
        &link,
        &mut message,
    )
    .await
    .unwrap();
    assert_eq!(*reads.lock().unwrap(), vec![inline]);
    let files = message.attachments.unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].content_id.as_deref(), Some("logo@draft"));
    assert!(files[0].is_inline);
    assert_eq!(files[0].data, vec![1, 2, 3]);
}
