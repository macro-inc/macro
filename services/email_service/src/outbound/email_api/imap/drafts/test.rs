use super::*;

#[tokio::test]
async fn only_typed_pre_data_failure_is_definite_not_a_generic_service_outage() {
    use email::domain::models::UserProvider;
    use sqlx::postgres::PgPoolOptions;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{header, method, path},
    };

    for (code, status, expected_reason) in [
        (
            "send_unavailable",
            503,
            Some(SendRejectionReason::ConnectionUnavailable),
        ),
        (
            "send_rejected",
            422,
            Some(SendRejectionReason::ProviderRejected),
        ),
        ("connection_unavailable", 503, None),
    ] {
        let server = MockServer::start().await;
        let mailbox = MailboxKey {
            link_id: Uuid::now_v7(),
            sync_generation: 1,
            grant_generation: 1,
        };
        Mock::given(method("POST"))
            .and(path(format!(
                "/internal/v1/accounts/{}/operations",
                mailbox.link_id
            )))
            .and(header("x-mailbox-binding", "1.1"))
            .respond_with(
                ResponseTemplate::new(status).set_body_json(serde_json::json!({"code":code})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let db = PgPoolOptions::new()
            .connect_lazy("postgres://unused:unused@localhost/unused")
            .unwrap();
        db.close().await;
        let gateway = ImapMailboxGateway {
            client: ImapServiceClient::new(server.uri(), "synthetic-internal-key".into()).unwrap(),
            health: email::outbound::mailbox_pg::PgMailboxSync::new(db)
                .with_provider(UserProvider::Imap),
        };
        let result = gateway
            .submit_draft(mailbox, &ProviderId::new("draft").unwrap())
            .await;
        if let Some(expected_reason) = expected_reason {
            assert!(
                matches!(result, Err(EmailApiError::SendRejected {reason, ..}) if reason == expected_reason)
            );
        } else {
            assert!(matches!(result, Err(EmailApiError::Transient { .. })));
        }
        server.verify().await;
    }
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn smtp_recipient_refusal_reaches_the_gateway_without_a_recipient_address(db: sqlx::PgPool) {
    use email::domain::models::UserProvider;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path},
    };
    let server = MockServer::start().await;
    let mailbox = MailboxKey {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    Mock::given(method("POST"))
        .and(path(format!(
            "/internal/v1/accounts/{}/operations",
            mailbox.link_id
        )))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            serde_json::json!({"rejected":{"refusal":{
                "phase":"recipient", "recipient_index":1, "reply_class":"permanent"
            }}}),
        ))
        .expect(1)
        .mount(&server)
        .await;
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, grant_generation)
            VALUES ($1, 'macro|imap@example.com', 'imap-owner', 'imap@example.com', 'IMAP', 1)
        "#,
        mailbox.link_id,
    ).execute(&db).await.unwrap();
    let gateway = ImapMailboxGateway {
        client: ImapServiceClient::new(server.uri(), "synthetic-internal-key".into()).unwrap(),
        health: email::outbound::mailbox_pg::PgMailboxSync::new(db)
            .with_provider(UserProvider::Imap),
    };
    let result = gateway
        .submit_draft(mailbox, &ProviderId::new("draft").unwrap())
        .await;
    assert!(matches!(
        result,
        Err(EmailApiError::SendRejected {
            reason: SendRejectionReason::ProviderRejected,
            refusal: Some(models::SubmissionRefusal {
                phase: models::SubmissionRefusalPhase::Recipient,
                recipient_index: Some(1),
                reply_class: Some(models::SubmissionRefusalClass::Permanent)
            }),
            ..
        })
    ));
    server.verify().await;
}

#[test]
fn uploads_cannot_cross_mailbox_bindings_or_become_http_targets() {
    let mailbox = MailboxKey {
        link_id: Uuid::from_u128(1),
        sync_generation: 1,
        grant_generation: 1,
    };
    let other = MailboxKey {
        link_id: Uuid::from_u128(2),
        sync_generation: 1,
        grant_generation: 1,
    };
    let session = upload(
        mailbox,
        models::UploadSession {
            id: Uuid::from_u128(3),
            expires_at: chrono::Utc::now(),
            next_offset: 0,
            attachment: None,
        },
    );
    assert_eq!(
        upload_id(mailbox, &session.url).unwrap(),
        Uuid::from_u128(3)
    );
    assert_eq!(
        upload_id(other, &session.url),
        Err(EmailApiError::Forbidden)
    );
    assert_eq!(
        upload_id(
            mailbox,
            &UploadUrl::new("https://169.254.169.254/latest/meta-data".into())
        ),
        Err(EmailApiError::Forbidden)
    );
}

#[tokio::test]
async fn mailbox_gateway_preserves_the_engine_retry_hint_and_the_short_local_busy_origin() {
    use email::domain::models::UserProvider;
    use sqlx::postgres::PgPoolOptions;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path},
    };
    for (code, seconds, local) in [("throttled", 7, false), ("account_busy", 5, true)] {
        let server = MockServer::start().await;
        let mailbox = MailboxKey {
            link_id: Uuid::now_v7(),
            sync_generation: 1,
            grant_generation: 1,
        };
        Mock::given(method("POST"))
            .and(path(format!(
                "/internal/v1/accounts/{}/operations",
                mailbox.link_id
            )))
            .respond_with(
                ResponseTemplate::new(429)
                    .insert_header("Retry-After", seconds.to_string())
                    .set_body_json(serde_json::json!({"code":code,"retryAfterSeconds":seconds})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let db = PgPoolOptions::new()
            .connect_lazy("postgres://unused:unused@localhost/unused")
            .unwrap();
        db.close().await;
        let gateway = ImapMailboxGateway {
            client: ImapServiceClient::new(server.uri(), "synthetic-internal-key".into()).unwrap(),
            health: email::outbound::mailbox_pg::PgMailboxSync::new(db)
                .with_provider(UserProvider::Imap),
        };
        let error = gateway.folders(mailbox).await.unwrap_err();
        assert!(
            matches!(error, EmailApiError::RateLimited { retry_after:Some(delay), origin } if delay.as_secs() == seconds && matches!(origin, RateLimitOrigin::Local) == local)
        );
        server.verify().await;
    }
}
