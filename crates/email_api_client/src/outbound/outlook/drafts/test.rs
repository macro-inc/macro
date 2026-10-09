use super::*;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_partial_json, header, method, path, query_param},
};

async fn setup() -> (MockServer, OutlookApiClientRepository, AccessToken) {
    let server = MockServer::start().await;
    let api = OutlookApiClientRepository::for_test(&format!("{}/v1.0/", server.uri()));
    (server, api, AccessToken::new("secret-token"))
}

fn request() -> DraftRequest {
    DraftRequest {
        reply_to: None,
        correlation: Uuid::now_v7(),
        revision: 1,
        content: SendRequest {
            message: serde_json::from_value(json!({"link_id":Uuid::now_v7(),"subject":"Reply","body_html":"<b>Hello</b>","to":[{"email":"to@example.com"}]})).unwrap(),
            from: ContactInfo {email:"from@example.com".into(),name:None,photo_url:None},
            parent_message_id:Some("<parent@example.com>".into()), references:Some(vec!["<parent@example.com>".into()]),
        }
    }
}

fn draft() -> Value {
    json!({"id":"immutable","conversationId":"conversation","isDraft":true,"@odata.etag":"W/\"version\"","subject":"Reply","body":{"contentType":"html","content":"<b>Hello</b>"},"toRecipients":[],"ccRecipients":[],"bccRecipients":[]})
}

#[tokio::test]
async fn same_mailbox_replies_use_native_reply_creation_and_keep_the_correlation() {
    let (server, api, token) = setup().await;
    let mut request = request();
    request.reply_to = Some(ProviderId::new("parent").unwrap());
    Mock::given(method("POST")).and(path("/v1.0/me/messages/parent/createReply"))
        .and(body_partial_json(json!({"message":{"subject":"Reply","body":{"contentType":"HTML","content":"<b>Hello</b>"}}})))
        .respond_with(ResponseTemplate::new(201).set_body_json(draft())).expect(1).mount(&server).await;
    api.create_draft(&token, &request).await.unwrap();
    let sent: Value =
        serde_json::from_slice(&server.received_requests().await.unwrap()[0].body).unwrap();
    assert!(
        sent["message"]["singleValueExtendedProperties"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["id"] == CORRELATION_PROPERTY
                && p["value"] == request.correlation.to_string())
    );
}

#[test]
fn reply_headers_are_bracketed_and_cannot_inject_additional_headers() {
    assert_eq!(
        rfc_message_id("parent@example.com").unwrap(),
        "<parent@example.com>"
    );
    assert!(rfc_message_id("parent@example.com\r\nBcc: other@example.com").is_err());
}

#[tokio::test]
async fn creation_atomically_sets_correlation_and_rfc_reply_metadata() {
    let (server, api, token) = setup().await;
    let request = request();
    Mock::given(method("POST"))
        .and(path("/v1.0/me/messages"))
        .and(header("prefer", "IdType=\"ImmutableId\""))
        .and(body_partial_json(json!({"singleValueExtendedProperties":[
            {"id":CORRELATION_PROPERTY,"value":request.correlation.to_string()},
            {"id":REVISION_PROPERTY,"value":"1"},
            {"id":"String 0x1042","value":"<parent@example.com>"},
            {"id":"String 0x1039","value":"<parent@example.com>"}
        ]})))
        .respond_with(ResponseTemplate::new(201).set_body_json(draft()))
        .expect(1)
        .mount(&server)
        .await;
    let result = api.create_draft(&token, &request).await.unwrap();
    assert_eq!(result.id.as_str(), "immutable");
    assert_eq!(result.version.as_deref(), Some("W/\"version\""));
}

#[tokio::test]
async fn draft_update_requires_the_exact_observed_version_and_surfaces_conflicts() {
    let (server, api, token) = setup().await;
    Mock::given(method("PATCH"))
        .and(header("if-match", "W/\"prior\""))
        .respond_with(ResponseTemplate::new(412))
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        api.update_draft(
            &token,
            &ProviderId::new("draft").unwrap(),
            &request(),
            "W/\"prior\""
        )
        .await
        .unwrap_err(),
        EmailApiError::Conflict
    );
    assert_eq!(
        api.update_draft(&token, &ProviderId::new("draft").unwrap(), &request(), "")
            .await
            .unwrap_err(),
        EmailApiError::Conflict
    );
}

#[tokio::test]
async fn truncated_creation_response_is_uncertain_and_is_not_retried() {
    let (server, api, token) = setup().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(201).set_body_string("{\"id\":"))
        .expect(1)
        .mount(&server)
        .await;
    assert!(matches!(
        api.create_draft(&token, &request()).await,
        Err(EmailApiError::Transient { .. })
    ));
}

#[tokio::test]
async fn creation_recovery_search_includes_sent_messages() {
    let (server, api, token) = setup().await;
    let correlation = Uuid::now_v7();
    let mut sent = draft();
    sent["isDraft"] = json!(false);
    Mock::given(method("GET")).and(path("/v1.0/me/messages"))
        .and(query_param("$filter",format!("singleValueExtendedProperties/Any(ep: ep/id eq '{CORRELATION_PROPERTY}' and ep/value eq '{correlation}')")))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":[sent]}))).expect(1).mount(&server).await;
    let found = api.find_drafts(&token, correlation).await.unwrap();
    assert!(!found[0].is_draft);
}

#[tokio::test]
async fn upload_ranges_use_preauthorized_url_without_oauth_and_keep_checkpoint() {
    let (server, api, _) = setup().await;
    let url = UploadUrl::new(format!("{}/upload?token=secret", server.uri()));
    let bytes = vec![42; UPLOAD_BLOCK as usize];
    Mock::given(method("PUT")).and(path("/upload"))
        .and(header("content-range",format!("bytes 0-{}/{}",UPLOAD_BLOCK-1,2*UPLOAD_BLOCK)))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"expirationDateTime":"2099-01-01T00:00:00Z","nextExpectedRanges":[format!("{}-",UPLOAD_BLOCK)]})))
        .expect(1).mount(&server).await;
    let UploadProgress::Continue(checkpoint) = api
        .upload_range(&url, 0, 2 * UPLOAD_BLOCK, &bytes)
        .await
        .unwrap()
    else {
        panic!("not complete")
    };
    assert_eq!(checkpoint.next_offset, UPLOAD_BLOCK);
    assert_eq!(checkpoint.url.expose(), url.expose());
    assert!(
        !server.received_requests().await.unwrap()[0]
            .headers
            .contains_key("authorization")
    );
    assert!(!format!("{checkpoint:?}").contains("secret"));
}

#[tokio::test]
async fn upload_url_and_range_validation_prevents_unintended_requests() {
    let (server, api, _) = setup().await;
    for url in [
        "http://outlook.office.com/upload",
        "https://outlook.office.com.attacker.test/upload",
        "https://secret@outlook.office.com/upload",
        "https://outlook.office.com/upload#secret",
        "https://outlook.office.com:8443/upload",
    ] {
        assert!(matches!(
            api.inspect_upload(&UploadUrl::new(url.into())).await,
            Err(EmailApiError::Permanent { .. })
        ));
    }
    assert!(
        api.upload_range(
            &UploadUrl::new(format!("{}/upload", server.uri())),
            1,
            100,
            &[1]
        )
        .await
        .is_err()
    );
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn completed_range_does_not_require_response_json() {
    let (server, api, _) = setup().await;
    Mock::given(method("PUT"))
        .respond_with(ResponseTemplate::new(201))
        .expect(1)
        .mount(&server)
        .await;
    assert!(matches!(
        api.upload_range(
            &UploadUrl::new(format!("{}/upload", server.uri())),
            0,
            3,
            b"abc"
        )
        .await
        .unwrap(),
        UploadProgress::Complete
    ));
}

#[tokio::test]
async fn small_attachments_keep_content_id_for_lost_response_reconciliation() {
    let (server, api, token) = setup().await;
    Mock::given(method("POST")).and(body_partial_json(json!({"contentId":"stable","isInline":true,"contentBytes":"YWJj"})))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({"id":"attachment","name":"logo.png","size":3,"contentId":"stable","isInline":true})))
        .expect(1).mount(&server).await;
    let result = api
        .add_attachment(
            &token,
            &ProviderId::new("draft").unwrap(),
            AttachmentContent {
                name: "logo.png",
                content_type: "image/png",
                content_id: "stable",
                inline: true,
                data: b"abc",
            },
        )
        .await
        .unwrap();
    assert_eq!(result.content_id.as_deref(), Some("stable"));
}

#[test]
fn fingerprints_detect_content_edits_but_ignore_attachment_and_flag_changes() {
    let original = draft();
    let mut changed = original.clone();
    changed["hasAttachments"] = json!(true);
    changed["@odata.etag"] = json!("new-attachment-version");
    changed["isRead"] = json!(true);
    assert_eq!(
        content_fingerprint(original.as_object().unwrap()),
        content_fingerprint(changed.as_object().unwrap())
    );
    changed["body"]["content"] = json!("Changed in Outlook");
    assert_ne!(
        content_fingerprint(original.as_object().unwrap()),
        content_fingerprint(changed.as_object().unwrap())
    );
    changed.as_object_mut().unwrap().remove("body");
    assert!(content_fingerprint(changed.as_object().unwrap()).is_none());
}

#[tokio::test]
async fn draft_attachment_metadata_selects_derived_content_id_without_downloading_bytes() {
    let (server, api, token) = setup().await;
    Mock::given(method("GET")).and(path("/v1.0/me/messages/draft/attachments"))
        .and(query_param("$select","id,name,size,microsoft.graph.fileAttachment/contentId,isInline"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":[{"id":"a","name":"logo.png","size":3,"contentId":"cid","isInline":true}]})))
        .expect(1).mount(&server).await;
    let files = api
        .draft_attachments(&token, &ProviderId::new("draft").unwrap())
        .await
        .unwrap();
    assert_eq!(files[0].content_id.as_deref(), Some("cid"));
    assert!(files[0].inline);
}
