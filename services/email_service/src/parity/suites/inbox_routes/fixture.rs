use super::*;

pub(super) const OUTLOOK: Uuid = Uuid::from_u128(0x5800_0000_0000_0000_0000_0000_0000_0001);

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-specific runtime fixtures leave existing goldens unchanged"
)]
pub(super) async fn seed(lab: &mut Lab, _shard: u32) {
    lab.transcript.normalizer.symbol(OUTLOOK, "<link:outlook>");
    lab.stub
        .reply("POST", "/message/send/user/", 200, json!({"receipts":[]}));
    for (index, link) in lab.fixture.links.iter().enumerate() {
        sqlx::query("UPDATE email_links SET email_address=CASE WHEN $2 THEN substring(macro_id FROM 7) ELSE email_address END, created_at='2026-01-01'::timestamptz + $3 * interval '1 day' WHERE id=$1")
            .bind(link).bind(index != 2).bind(index as i32).execute(&lab.db).await.expect("primary and inbox order");
    }
    for link in lab.fixture.links {
        lab.seed_link_token(link).await;
    }
    sqlx::query("INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider,is_sync_active,created_at) VALUES ($1,$2,$3,'outlook@example.com','OUTLOOK',true,'2026-01-04')")
        .bind(OUTLOOK).bind(&lab.fixture.users[0]).bind(&lab.fixture.fusion[0]).execute(&lab.db).await.expect("Outlook inbox");
}

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local scheduled message fixture"
)]
pub(super) async fn scheduled(lab: &mut Lab, count: usize) {
    for index in 0..count {
        let id = Uuid::from_u128(0x5900_0000_0000_0000_0000_0000_0000_0000 + index as u128);
        lab.transcript
            .normalizer
            .symbol(id, format!("<scheduled:{index}>"));
        let link = lab.fixture.links[if index == count - 1 { 2 } else { 0 }];
        let thread: Uuid =
            sqlx::query_scalar("SELECT id FROM email_threads WHERE link_id=$1 ORDER BY id LIMIT 1")
                .bind(link)
                .fetch_one(&lab.db)
                .await
                .expect("fixture thread");
        sqlx::query("INSERT INTO email_messages (id,thread_id,link_id,subject,is_draft,is_sent,has_attachments,provider_id,body_text,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,true,$7,'Scheduled body','2026-03-01'::timestamptz + $8 * interval '1 minute','2026-03-02'::timestamptz)")
            .bind(id).bind(thread).bind(link).bind(format!("Scheduled {index}"))
            .bind(index != 2).bind(index == 3).bind(if index % 2 == 0 { Some(format!("provider-{index}")) } else { None })
            .bind(index as i32).execute(&lab.db).await.expect("scheduled message");
        sqlx::query("INSERT INTO email_scheduled_messages (link_id,message_id,send_time,sent,processing,actor_id) VALUES ($1,$2,'2027-01-01'::timestamptz + $3 * interval '1 minute',$4,$5,$6)")
            .bind(link).bind(id).bind((count-index) as i32).bind(index == 4).bind(index == 5).bind(&lab.fixture.users[0])
            .execute(&lab.db).await.expect("schedule row");
    }
    scheduled_content(lab).await;
}

#[expect(
    clippy::disallowed_methods,
    reason = "Rich scheduled content is confined to this suite"
)]
async fn scheduled_content(lab: &mut Lab) {
    let first = Uuid::from_u128(0x5900_0000_0000_0000_0000_0000_0000_0000);
    let draft = Uuid::from_u128(first.as_u128() + 1);
    for (index, name) in ["Zed", "Alpha"].into_iter().enumerate() {
        let contact = Uuid::from_u128(0x6200_0000_0000_0000_0000_0000_0000_0000 + index as u128);
        let attachment = Uuid::from_u128(0x6200_0000_0000_0000_0000_0000_0000_0010 + index as u128);
        let uploaded = Uuid::from_u128(0x6200_0000_0000_0000_0000_0000_0000_0020 + index as u128);
        lab.transcript
            .normalizer
            .symbol(contact, format!("<schedule-contact:{name}>"));
        lab.transcript
            .normalizer
            .symbol(attachment, format!("<schedule-attachment:{name}>"));
        lab.transcript
            .normalizer
            .symbol(uploaded, format!("<schedule-upload:{name}>"));
        sqlx::query(
            "INSERT INTO email_contacts (id,link_id,email_address,name) VALUES ($1,$2,$3,$4)",
        )
        .bind(contact)
        .bind(lab.fixture.links[0])
        .bind(format!("{}@example.com", name.to_lowercase()))
        .bind(name)
        .execute(&lab.db)
        .await
        .expect("scheduled contact");
        for role in ["TO", "CC", "BCC"] {
            sqlx::query("INSERT INTO email_message_recipients (message_id,contact_id,recipient_type) VALUES ($1,$2,$3::email_recipient_type)")
                .bind(first).bind(contact).bind(role).execute(&lab.db).await.expect("scheduled recipient");
        }
        sqlx::query("INSERT INTO email_attachments (id,message_id,provider_attachment_id,filename,mime_type,size_bytes,created_at) VALUES ($1,$2,$3,$4,'application/pdf',123,'2026-03-02')")
            .bind(attachment).bind(first).bind(name).bind(format!("{name}.pdf")).execute(&lab.db).await.expect("scheduled provider attachment");
        sqlx::query("INSERT INTO email_attachments_drafts (id,draft_id,file_name,content_type,sha,size,s3_key) VALUES ($1,$2,$3,'application/pdf','sha',123,$3)")
            .bind(uploaded).bind(draft).bind(format!("{name}.pdf")).execute(&lab.db).await.expect("scheduled upload");
        sqlx::query("INSERT INTO email_attachments_fwd (message_id,attachment_id) VALUES ($1,$2)")
            .bind(draft)
            .bind(attachment)
            .execute(&lab.db)
            .await
            .expect("scheduled forward");
    }
    for provider in ["INBOX", "Label_work"] {
        sqlx::query("INSERT INTO email_message_labels (message_id,label_id) VALUES ($1,$2)")
            .bind(first)
            .bind(lab.fixture.labels[&format!("A/{provider}")])
            .execute(&lab.db)
            .await
            .expect("scheduled labels");
    }
}

pub(super) fn gmail(lab: &Lab, aliases: Value) {
    lab.stub.reply(
        "GET",
        "/internal/google_access_token",
        200,
        json!({"access_token":"fake-access-token"}),
    );
    lab.gmail.lock().send_as = Some((200, aliases));
}

pub(super) fn image(lab: &Lab) -> String {
    // A real GIF header is enough for the production MIME classifier.
    lab.stub.reply_bytes(
        "GET",
        "/image.gif",
        200,
        b"GIF89a\x01\x00\x01\x00image".to_vec(),
        "image/gif",
    );
    lab.stub.reply("PUT", "/internal/file", 200, json!({"upload_url":format!("{}/upload/image",lab.stub.url),"file_location":"https://static-file-service.example.com/image.gif","id":"image"}));
    format!("{}/image.gif", lab.stub.url)
}
