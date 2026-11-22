use super::*;
use chrono::Utc;
use email::outbound::mailbox_pg::PgMailboxSync;
use imap_service_client::{self as models, ImapServiceClient};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_partial_json, method},
};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn keyword_deletion_reads_organization_even_when_the_full_message_is_too_large(db: PgPool) {
    let link = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, grant_generation)
            VALUES ($1, 'macro|imap@example.com', 'imap-owner', 'imap@example.com', 'IMAP', 1)
        "#,
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(body_partial_json(
            serde_json::json!({"operation":"folders"}),
        ))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(vec![models::Folder {
                sync_enabled: true,
                id: "inbox".into(),
                parent_id: None,
                name: "INBOX".into(),
                role: models::FolderRole::Inbox,
                has_children: false,
                total_items: Some(2),
            }]),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(body_partial_json(
            serde_json::json!({"operation":"changes"}),
        ))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(models::ChangePage {
                changed: vec!["oversized".into(), "unrelated".into()],
                removed: vec![],
                position: "complete".into(),
                has_more: false,
                reader_revision: 1,
            }),
        )
        .mount(&server)
        .await;
    for (id, tags) in [
        ("oversized", vec!["keep", "remove"]),
        ("unrelated", vec!["keep"]),
    ] {
        Mock::given(method("POST"))
            .and(body_partial_json(
                serde_json::json!({"operation":"organization","id":id}),
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(models::Message {
                id: id.into(),
                thread_id: "thread".into(),
                folder_id: "inbox".into(),
                flags: vec!["\\Seen".into()],
                tags: tags.into_iter().map(str::to_owned).collect(),
                version: "organization-version".into(),
                mime_base64: String::new(),
                source_complete: false,
                classification: None,
                received_at: Utc::now(),
                size: 100 * 1024 * 1024,
                is_sent: false,
                draft_correlation: None,
            }))
            .mount(&server)
            .await;
    }
    Mock::given(method("POST"))
        .and(body_partial_json(
            serde_json::json!({"operation":"message"}),
        ))
        .respond_with(
            ResponseTemplate::new(413)
                .set_body_json(serde_json::json!({"code":"message_too_large"})),
        )
        .mount(&server)
        .await;
    let gateway = super::super::email_api::imap::ImapMailboxGateway {
        client: ImapServiceClient::new(server.uri(), "internal-test-key".into()).unwrap(),
        health: PgMailboxSync::new(db).with_provider(email::domain::models::UserProvider::Imap),
    };
    let result = imap_category_messages(
        &gateway,
        email::domain::mailbox::MailboxKey {
            link_id: link,
            sync_generation: 1,
            grant_generation: 1,
        },
        "remove",
    )
    .await;
    let requests = server.received_requests().await.unwrap();
    assert!(
        requests.iter().all(|request| {
            request.body_json::<serde_json::Value>().unwrap()["operation"] != "message"
        }),
        "removing a keyword must never request full MIME"
    );
    let messages = result.unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].id.as_str(), "oversized");
    assert_eq!(messages[0].categories, ["keep", "remove"]);
    assert_eq!(messages[0].version.as_deref(), Some("organization-version"));
}
