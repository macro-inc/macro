use super::*;
use email::domain::models::UserProvider;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{PgPool, postgres::PgPoolOptions};
use uuid::Uuid;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{header, method, path},
};

#[tokio::test]
async fn an_imap_catalog_not_found_is_an_error_not_a_graph_mailbox_absence() {
    let server = MockServer::start().await;
    let mailbox = MailboxKey {
        link_id: Uuid::now_v7(),
        sync_generation: 3,
        grant_generation: 7,
    };
    Mock::given(method("POST"))
        .and(path(format!(
            "/internal/v1/accounts/{}/operations",
            mailbox.link_id
        )))
        .and(header("x-mailbox-binding", "3.7"))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(serde_json::json!({"code":"not_found"})),
        )
        .expect(1)
        .mount(&server)
        .await;
    // NotFound must neither report healthy credentials nor require a database write.
    let db = PgPoolOptions::new()
        .connect_lazy("postgres://unused:unused@localhost/unused")
        .unwrap();
    db.close().await;
    let gateway = ImapMailboxGateway {
        client: ImapServiceClient::new(server.uri(), "internal-test-key".into()).unwrap(),
        health: email::outbound::mailbox_pg::PgMailboxSync::new(db)
            .with_provider(UserProvider::Imap),
    };
    assert!(matches!(
        gateway.folders(mailbox).await,
        Err(EmailApiError::NotFound)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_empty_imap_catalog_is_success_without_graph_mailbox_classification(db: PgPool) {
    let server = MockServer::start().await;
    let link = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, grant_generation)
            VALUES ($1, 'macro|imap@example.com', 'imap-owner', 'imap@example.com', 'IMAP', 1)
        "#,
        link,
    ).execute(&db).await.unwrap();
    Mock::given(method("POST"))
        .and(path(format!("/internal/v1/accounts/{link}/operations")))
        .and(header("x-mailbox-binding", "1.1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
        .expect(1)
        .mount(&server)
        .await;
    let gateway = ImapMailboxGateway {
        client: ImapServiceClient::new(server.uri(), "internal-test-key".into()).unwrap(),
        health: email::outbound::mailbox_pg::PgMailboxSync::new(db)
            .with_provider(UserProvider::Imap),
    };
    let catalog = gateway
        .folders(MailboxKey {
            link_id: link,
            sync_generation: 1,
            grant_generation: 1,
        })
        .await
        .unwrap();
    assert!(matches!(catalog, MailFolderCatalog::Folders(folders) if folders.is_empty()));
}

#[tokio::test]
async fn typed_busy_and_size_failures_survive_the_private_client_without_health_writes() {
    for (status, code) in [(429, "account_busy"), (413, "message_too_large")] {
        let server = MockServer::start().await;
        let link = Uuid::now_v7();
        Mock::given(method("POST"))
            .and(path(format!("/internal/v1/accounts/{link}/operations")))
            .and(header("x-mailbox-binding", "1.1"))
            .respond_with(
                ResponseTemplate::new(status).set_body_json(serde_json::json!({"code": code})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let db = PgPool::connect_lazy("postgres://unused@127.0.0.1:1/unused").unwrap();
        db.close().await;
        let gateway = ImapMailboxGateway {
            client: ImapServiceClient::new(server.uri(), "internal-test-key".into()).unwrap(),
            health: email::outbound::mailbox_pg::PgMailboxSync::new(db)
                .with_provider(UserProvider::Imap),
        };
        let error = gateway
            .mime(
                MailboxKey {
                    link_id: link,
                    sync_generation: 1,
                    grant_generation: 1,
                },
                "m:source",
            )
            .await
            .unwrap_err();
        if status == 429 {
            assert!(
                matches!(error, EmailApiError::RateLimited { retry_after: Some(delay), origin: RateLimitOrigin::Local } if delay == std::time::Duration::from_secs(5))
            );
        } else {
            assert!(matches!(error, EmailApiError::Permanent { .. }));
            assert!(!error.is_transient());
        }
    }
}
