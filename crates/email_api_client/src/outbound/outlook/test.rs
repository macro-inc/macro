use reqwest::Method;
use serde_json::json;
use uuid::Uuid;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{header, method, path, query_param},
};

use super::*;
use crate::domain::models::*;
use crate::domain::ports::{
    FolderChangeReader, MailboxActionWriter, MailboxContentReader, MailboxWatchClient,
};

pub(super) async fn setup() -> (MockServer, OutlookApiClientRepository, AccessToken) {
    let server = MockServer::start().await;
    let api = OutlookApiClientRepository::for_test(&format!("{}/v1.0/", server.uri()));
    (server, api, AccessToken::new("test-bearer"))
}

#[tokio::test]
async fn delta_preserves_removals_as_stream_events_and_keeps_opaque_continuations() {
    let (server, api, token) = setup().await;
    let next = format!(
        "{}/v1.0/me/mailFolders/folder/messages/delta?$skiptoken=A%2BB%2F%3D",
        server.uri()
    );
    Mock::given(method("GET"))
        .and(path("/v1.0/me/mailFolders/folder/messages/delta"))
        .and(header("authorization", "Bearer test-bearer"))
        .and(header("prefer", "IdType=\"ImmutableId\""))
        .and(query_param("$select", "id"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "value":[{"id":"m1"},{"id":"m2","@removed":{"reason":"deleted"}}],
            "@odata.nextLink":next
        })))
        .expect(1)
        .mount(&server)
        .await;
    let page = api
        .folder_changes(&token, &ProviderId::new("folder").unwrap(), None)
        .await
        .unwrap();
    assert_eq!(page.changed, vec![ProviderId::new("m1").unwrap()]);
    assert_eq!(page.removed, vec![ProviderId::new("m2").unwrap()]);
    assert_eq!(
        page.position,
        StreamPosition::Continue(StreamToken::new(next))
    );
}

#[tokio::test]
async fn unsafe_cursors_are_rejected_before_sending_credentials() {
    let (server, api, token) = setup().await;
    for unsafe_url in [
        "https://attacker.invalid/v1.0/me/messages/delta".to_owned(),
        format!("{}/v1.0evil/me/messages", server.uri()),
        format!("{}/v1.0/me/messages#fragment", server.uri()),
        format!("{}/v1.0/../outside", server.uri()),
    ] {
        let result = api
            .folder_changes(
                &token,
                &ProviderId::new("inbox").unwrap(),
                Some(&StreamToken::new(unsafe_url)),
            )
            .await;
        assert!(matches!(result, Err(EmailApiError::Permanent { .. })));
    }
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn redirects_are_not_followed_and_provider_error_content_is_not_leaked() {
    let (server, api, token) = setup().await;
    Mock::given(method("GET"))
        .respond_with(
            ResponseTemplate::new(302)
                .insert_header("Location", "https://attacker.invalid/")
                .set_body_json(json!({"error":{"message":"secret-mail-content"}})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let error = api
        .get::<serde_json::Value>(&token, api.endpoint(&["me"]).unwrap())
        .await
        .unwrap_err();
    assert!(matches!(error, EmailApiError::Permanent { .. }));
    assert!(!format!("{error:?}").contains("secret-mail-content"));
}

#[tokio::test]
async fn send_with_unknown_server_outcome_is_not_retried() {
    let (server, api, token) = setup().await;
    Mock::given(method("POST"))
        .and(path("/v1.0/me/messages/draft/send"))
        .respond_with(ResponseTemplate::new(503))
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        api.submit_draft(&token, &ProviderId::new("draft").unwrap())
            .await
            .unwrap(),
        SubmissionOutcome::Unknown
    );
}

#[tokio::test]
async fn accepted_send_does_not_require_a_response_body() {
    let (server, api, token) = setup().await;
    Mock::given(method("POST"))
        .and(path("/v1.0/me/messages/draft/send"))
        .respond_with(ResponseTemplate::new(202))
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        api.submit_draft(&token, &ProviderId::new("draft").unwrap())
            .await
            .unwrap(),
        SubmissionOutcome::Accepted
    );
}

#[tokio::test]
async fn throttling_respects_provider_retry_after() {
    let (server, api, token) = setup().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "17"))
        .expect(1)
        .mount(&server)
        .await;
    let error = api
        .request(&token, Method::GET, api.endpoint(&["me"]).unwrap(), None)
        .await
        .unwrap_err();
    assert_eq!(
        error,
        EmailApiError::RateLimited {
            retry_after: Some(Duration::from_secs(17)),
            origin: RateLimitOrigin::Provider
        }
    );
}

#[tokio::test]
async fn expired_cursor_is_recoverable_without_deleting_existing_mail() {
    let (server, api, token) = setup().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(410))
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        api.folder_changes(&token, &ProviderId::new("inbox").unwrap(), None)
            .await
            .unwrap_err(),
        EmailApiError::OutdatedCursor
    );
}

#[tokio::test]
async fn inline_attachments_are_loaded_even_when_has_attachments_is_false() {
    let (server, api, token) = setup().await;
    Mock::given(method("GET")).and(path("/v1.0/me/messages/m1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id":"m1", "conversationId":"conversation", "parentFolderId":"folder",
            "body":{"contentType":"html","content":"<p>Hello<img src=\"cid:logo\"></p><script>bad()</script>"},
            "hasAttachments":false, "isRead":true, "isDraft":false,
            "flag":{"flagStatus":"flagged"}, "inferenceClassification":"focused",
            "categories":["Accounts"], "internetMessageId":"<global@example.com>"
        }))).mount(&server).await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/messages/m1/attachments"))
        .and(query_param(
            "$select",
            "id,name,contentType,size,microsoft.graph.fileAttachment/contentId",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":[{
            "id":"a1", "name":"logo.png", "contentType":"image/png", "contentId":"logo", "size":12
        }]})))
        .expect(1)
        .mount(&server)
        .await;
    let folder = MailFolder {
        id: ProviderId::new("folder").unwrap(),
        parent_id: None,
        name: "Boîte de réception".into(),
        role: FolderRole::Inbox,
        has_children: false,
    };
    let message = api
        .message(
            &token,
            Uuid::now_v7(),
            &ProviderId::new("m1").unwrap(),
            &[folder],
        )
        .await
        .unwrap()
        .unwrap();
    assert!(message.state.in_inbox);
    assert!(message.state.is_flagged);
    assert_eq!(message.state.attention, Attention::Primary);
    assert_eq!(message.tags, vec!["Accounts"]);
    assert_eq!(message.content.message.attachments.len(), 1);
    assert_eq!(
        message.content.message.attachments[0].content_id.as_deref(),
        Some("logo")
    );
    assert!(
        !message
            .content
            .message
            .body_html_sanitized
            .unwrap()
            .contains("<script")
    );
}

#[tokio::test]
async fn moves_return_the_provider_identity_with_immutable_id_preference() {
    let (server, api, token) = setup().await;
    Mock::given(method("POST"))
        .and(path("/v1.0/me/messages/m1/move"))
        .and(header("prefer", "IdType=\"ImmutableId\""))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({"id":"m1"})))
        .expect(1)
        .mount(&server)
        .await;
    let id = ProviderId::new("m1").unwrap();
    assert_eq!(
        api.apply_message_action(
            &token,
            &id,
            &MessageAction::MoveToFolder(ProviderId::new("archive").unwrap()),
            None,
        )
        .await
        .unwrap()
        .id,
        id
    );
}

#[tokio::test]
async fn deleting_a_missing_subscription_is_idempotent() {
    let (server, api, token) = setup().await;
    Mock::given(method("DELETE"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    api.remove_watch(&token, &ProviderId::new("subscription").unwrap())
        .await
        .unwrap();
}

#[tokio::test]
async fn categories_use_assignment_names_and_never_become_folder_roles() {
    use crate::domain::ports::MailboxLabelClient;
    let (server, api, token) = setup().await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/outlook/masterCategories"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"value":[{"id":"opaque-catalog-id","displayName":"TRASH"}]})),
        )
        .mount(&server)
        .await;
    let labels = api.list_labels(&token, Uuid::now_v7()).await.unwrap();
    assert_eq!(labels[0].provider_label_id, "TRASH");
    assert!(matches!(
        labels[0].type_,
        Some(models_email::service::label::LabelType::User)
    ));
    Mock::given(method("DELETE"))
        .and(path("/v1.0/me/outlook/masterCategories/opaque-catalog-id"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    api.delete_label(&token, "TRASH").await.unwrap();
}

#[tokio::test]
async fn invitation_mime_parts_are_decoded_for_the_existing_calendar_parser() {
    use crate::domain::ports::MailboxCalendarClient;
    let (server, api, token) = setup().await;
    let mime = "MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=meeting\r\n\r\n--meeting\r\nContent-Type: text/plain\r\n\r\nMeeting\r\n--meeting\r\nContent-Type: text/calendar; method=REQUEST\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nBEGIN:VCALENDAR\r\nSUMMARY:Test=20meeting\r\nEND:VCALENDAR\r\n--meeting--\r\n";
    Mock::given(method("GET"))
        .and(path("/v1.0/me/messages/invitation/$value"))
        .respond_with(ResponseTemplate::new(200).set_body_string(mime))
        .expect(1)
        .mount(&server)
        .await;
    let parts = api.get_calendar_parts(&token, "invitation").await.unwrap();
    assert_eq!(parts.len(), 1);
    assert!(
        String::from_utf8(parts[0].inline_data.clone().unwrap())
            .unwrap()
            .contains("SUMMARY:Test meeting")
    );
}

#[tokio::test]
async fn read_authentication_retry_keeps_the_same_mailbox_generation() {
    use crate::domain::{
        ports::{AlwaysAllowRateLimiter, MailboxTokenSource},
        service::mailbox::MailboxApiService,
    };
    struct Tokens;
    impl MailboxTokenSource for Tokens {
        async fn access_token(
            &self,
            mailbox: MailboxAccess,
            freshness: TokenFreshness,
        ) -> Result<AccessToken, TokenError> {
            assert_eq!(mailbox.grant_generation, 7);
            Ok(AccessToken::new(match freshness {
                TokenFreshness::Cached => "expired",
                TokenFreshness::Fresh => "fresh",
            }))
        }
    }
    let (server, api, _) = setup().await;
    Mock::given(method("GET"))
        .and(header("authorization", "Bearer expired"))
        .respond_with(ResponseTemplate::new(401))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET")).and(header("authorization","Bearer fresh"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":[],"@odata.deltaLink":format!("{}/v1.0/me/mailFolders/folder/messages/delta?$deltatoken=opaque",server.uri())})))
        .expect(1).mount(&server).await;
    let service = MailboxApiService::new(api, Tokens, AlwaysAllowRateLimiter);
    service
        .changes(
            MailboxAccess {
                sync_generation: 1,
                link_id: Uuid::now_v7(),
                grant_generation: 7,
            },
            &ProviderId::new("folder").unwrap(),
            None,
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn request_gate_covers_nested_pages_and_receives_provider_retry_after() {
    use crate::domain::ports::{MailboxLabelClient, MailboxRequestGate, ScopedMailboxRepository};
    use std::{
        future::Future,
        pin::Pin,
        sync::{Arc, Mutex},
        time::Duration,
    };
    struct Gate {
        mailbox: MailboxAccess,
        finished: Mutex<Vec<Option<Duration>>>,
    }
    impl MailboxRequestGate for Gate {
        fn acquire(
            &self,
            mailbox: MailboxAccess,
        ) -> Pin<Box<dyn Future<Output = Result<Uuid, EmailApiError>> + Send + '_>> {
            assert_eq!(mailbox, self.mailbox);
            Box::pin(async { Ok(Uuid::now_v7()) })
        }
        fn finish(
            &self,
            mailbox: MailboxAccess,
            _: Uuid,
            retry_after: Option<Duration>,
        ) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
            assert_eq!(mailbox, self.mailbox);
            self.finished.lock().unwrap().push(retry_after);
            Box::pin(async {})
        }
    }
    let (server, mut api, token) = setup().await;
    let mailbox = MailboxAccess {
        sync_generation: 1,
        link_id: Uuid::now_v7(),
        grant_generation: 7,
    };
    let gate = Arc::new(Gate {
        mailbox,
        finished: Mutex::new(Vec::new()),
    });
    api.gate = Some(gate.clone());
    let api = api.for_mailbox(mailbox);
    Mock::given(method("GET")).and(path("/v1.0/me/outlook/masterCategories"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":[],"@odata.nextLink":format!("{}/v1.0/me/outlook/nextCategories",server.uri())})))
        .expect(1).mount(&server).await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/outlook/nextCategories"))
        .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "90"))
        .expect(1)
        .mount(&server)
        .await;
    assert!(matches!(
        api.list_labels(&token, mailbox.link_id).await,
        Err(EmailApiError::RateLimited { .. })
    ));
    assert_eq!(
        *gate.finished.lock().unwrap(),
        vec![None, Some(Duration::from_secs(90))]
    );
}

#[tokio::test]
async fn first_archive_provisions_a_marked_folder_then_recovers_it_on_retry() {
    use wiremock::matchers::body_partial_json;
    let (server, api, token) = setup().await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/mailFolders/archive"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    let listed = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = listed.clone();
    Mock::given(method("GET"))
        .and(path("/v1.0/me/mailFolders"))
        .respond_with(move |_: &wiremock::Request| {
            let value = if count.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 {
                json!([])
            } else {
                json!([{"id":"archive-created","displayName":"Macro Archive"}])
            };
            ResponseTemplate::new(200).set_body_json(json!({"value":value}))
        })
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("POST")).and(path("/v1.0/me/mailFolders"))
        .and(body_partial_json(json!({"singleValueExtendedProperties":[{"id":"String {81f532e3-7ace-4e0b-bae9-312ce0d50c8c} Name MacroFolderRole","value":"archive"}]})))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({"id":"archive-created","displayName":"Macro Archive"}))).expect(1).mount(&server).await;
    Mock::given(method("POST"))
        .and(path("/v1.0/me/messages/m1/move"))
        .and(body_partial_json(
            json!({"destinationId":"archive-created"}),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id":"m1"})))
        .expect(2)
        .mount(&server)
        .await;
    for _ in 0..2 {
        api.apply_message_action(
            &token,
            &ProviderId::new("m1").unwrap(),
            &MessageAction::Archive,
            None,
        )
        .await
        .unwrap();
    }
}

struct FreshToken;
impl crate::domain::ports::MailboxRejectedTokenRefresh for FreshToken {
    fn refresh(
        &self,
        _: MailboxAccess,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<AccessToken, EmailApiError>> + Send + '_>,
    > {
        Box::pin(async { Ok(AccessToken::new("fresh")) })
    }
}
#[tokio::test]
async fn rejected_token_retries_only_a_definitive_401_and_reuses_the_fresh_token() {
    let (server, api, token) = setup().await;
    let api = api
        .with_rejected_token_refresh(std::sync::Arc::new(FreshToken))
        .for_mailbox(MailboxAccess {
            link_id: Uuid::now_v7(),
            grant_generation: 1,
            sync_generation: 1,
        });
    Mock::given(method("PATCH"))
        .and(header("authorization", "Bearer test-bearer"))
        .respond_with(ResponseTemplate::new(401))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PATCH"))
        .and(header("authorization", "Bearer fresh"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id":"m1"})))
        .expect(2)
        .mount(&server)
        .await;
    for _ in 0..2 {
        api.apply_message_action(
            &token,
            &ProviderId::new("m1").unwrap(),
            &MessageAction::SetRead(true),
            None,
        )
        .await
        .unwrap();
    }
    server.reset().await;
    Mock::given(method("PATCH"))
        .respond_with(ResponseTemplate::new(503))
        .expect(1)
        .mount(&server)
        .await;
    assert!(
        api.apply_message_action(
            &token,
            &ProviderId::new("m1").unwrap(),
            &MessageAction::SetRead(true),
            None
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn organization_patch_returns_the_exact_conditional_response_version() {
    let (server, api, token) = setup().await;
    Mock::given(method("PATCH"))
        .and(path("/v1.0/me/messages/m1"))
        .and(header("if-match", "W/\"before\""))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"id":"m1","@odata.etag":"W/\"after\""})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let receipt = api
        .apply_message_action(
            &token,
            &ProviderId::new("m1").unwrap(),
            &MessageAction::SetFlagged(true),
            Some("W/\"before\""),
        )
        .await
        .unwrap();
    assert_eq!(receipt.id.as_str(), "m1");
    assert_eq!(receipt.version.as_deref(), Some("W/\"after\""));
}

#[test]
fn folder_subtrees_inherit_trash_without_becoming_move_destinations() {
    let folders = vec![
        MailFolder {
            id: ProviderId::new("trash").unwrap(),
            parent_id: None,
            name: "Trash".into(),
            role: FolderRole::Trash,
            has_children: true,
        },
        MailFolder {
            id: ProviderId::new("parent").unwrap(),
            parent_id: Some(ProviderId::new("trash").unwrap()),
            name: "Deleted project".into(),
            role: FolderRole::Other,
            has_children: true,
        },
        MailFolder {
            id: ProviderId::new("child").unwrap(),
            parent_id: Some(ProviderId::new("parent").unwrap()),
            name: "Invoices".into(),
            role: FolderRole::Other,
            has_children: false,
        },
    ];
    let source =
        serde_json::from_value(json!({"id":"m","conversationId":"c","parentFolderId":"child"}))
            .unwrap();
    let message = super::messages::normalize(source, Vec::new(), Uuid::new_v4(), &folders).unwrap();
    assert!(message.state.in_trash);
    assert_eq!(
        folders
            .iter()
            .filter(|folder| folder.role == FolderRole::Trash)
            .count(),
        1
    );
    let mut restored = folders;
    restored[1].parent_id = None;
    assert_eq!(
        MailFolder::effective_role(&restored, Some(&restored[2].id)),
        FolderRole::Other
    );
}

#[tokio::test]
async fn cloud_reference_attachments_preserve_provider_open_without_download_bytes() {
    let (server, api, token) = setup().await;
    Mock::given(method("GET")).and(path("/v1.0/me/messages/m1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id":"m1","conversationId":"c","webLink":"https://outlook.live.com/mail/0/deeplink/read/message"}))).expect(1).mount(&server).await;
    Mock::given(method("GET")).and(path("/v1.0/me/messages/m1/attachments"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":[{"@odata.type":"#microsoft.graph.referenceAttachment","id":"cloud","name":"shared.pdf","contentType":"application/pdf","size":0,"isInline":false}]}))).expect(1).mount(&server).await;
    let message = api
        .message(&token, Uuid::new_v4(), &ProviderId::new("m1").unwrap(), &[])
        .await
        .unwrap()
        .unwrap();
    let attachment = &message.content.message.attachments[0];
    assert_eq!(
        attachment.reference_url.as_deref(),
        Some("https://outlook.live.com/mail/0/deeplink/read/message")
    );
    assert_eq!(attachment.filename.as_deref(), Some("shared.pdf"));
    assert!(attachment.data_url.is_none());
    assert_eq!(server.received_requests().await.unwrap().len(), 2);
}
