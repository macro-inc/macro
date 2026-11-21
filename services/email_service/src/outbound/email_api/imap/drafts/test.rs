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
