use serde_json::json;
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::domain::models::LocalPart;

const ADMIN_KEY: &str = "dse_admin_test";
const SCOPED_KEY: &str = "dse_scoped_test";

async fn adapter() -> (MockServer, DeadSimple) {
    let server = MockServer::start().await;
    let adapter = DeadSimple::new(
        &server.uri(),
        Some(ProvisioningKey::new(ADMIN_KEY.to_owned())),
    )
    .unwrap();
    (server, adapter)
}

fn inbox_id() -> ProviderMailboxId {
    ProviderMailboxId("0193a1b2-0000-7000-8000-000000000001".to_owned())
}

fn create_request() -> CreateMailbox {
    CreateMailbox {
        idempotency_key: Uuid::from_u128(7),
        owner_tag: AgentMailboxId(Uuid::from_u128(9)),
        local_part: Some(LocalPart::parse("nova").unwrap()),
        display_name: Some("Nova".to_owned()),
    }
}

#[tokio::test]
async fn creates_an_inbox_with_the_provisioning_key_tag_and_idempotency_key() {
    let (server, adapter) = adapter().await;
    Mock::given(method("POST"))
        .and(path("/v1/inboxes"))
        .and(header(
            "authorization",
            format!("Bearer {ADMIN_KEY}").as_str(),
        ))
        .and(header(
            "idempotency-key",
            Uuid::from_u128(7).to_string().as_str(),
        ))
        .and(body_json(json!({
            "local_part": "nova",
            "display_name": "Nova",
            "tags": [format!("macro-agent-mailbox:{}", Uuid::from_u128(9))],
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "data": {"inbox_id": inbox_id().0, "email": "nova@example.net", "status": "active"}
        })))
        .expect(1)
        .mount(&server)
        .await;

    let created = adapter.create_mailbox(&create_request()).await.unwrap();

    assert_eq!(created.id, inbox_id());
    assert_eq!(created.address, "nova@example.net");
}

#[tokio::test]
async fn create_failures_map_to_what_provisioning_decides_on() {
    for (status, expected) in [
        // A conflict the provider does not name as the address is retried.
        (409, "provider unavailable"),
        (402, "provider credentials are missing or refused"),
        (401, "provider credentials are missing or refused"),
        (429, "provider throttled the request"),
        (503, "provider unavailable"),
        (400, "provider rejected the request"),
    ] {
        let (server, adapter) = adapter().await;
        Mock::given(method("POST"))
            .and(path("/v1/inboxes"))
            .respond_with(
                ResponseTemplate::new(status)
                    .set_body_json(json!({"error": {"code": "x", "message": "no"}})),
            )
            .mount(&server)
            .await;

        let error = adapter.create_mailbox(&create_request()).await.unwrap_err();

        assert_eq!(error.to_string(), expected, "status {status}");
    }
}

#[tokio::test]
async fn a_plan_limit_is_a_quota_failure() {
    let (server, adapter) = adapter().await;
    Mock::given(method("POST"))
        .and(path("/v1/inboxes"))
        .respond_with(
            ResponseTemplate::new(403).set_body_json(
                json!({"error": {"code": "inbox_limit_reached", "message": "upgrade"}}),
            ),
        )
        .mount(&server)
        .await;

    let error = adapter.create_mailbox(&create_request()).await.unwrap_err();

    assert!(matches!(error, ProviderError::QuotaExceeded));
}

#[tokio::test]
async fn sets_the_provider_send_cap() {
    let (server, adapter) = adapter().await;
    Mock::given(method("PUT"))
        .and(path(format!("/v1/inboxes/{}/guardrails", inbox_id().0)))
        .and(body_json(
            json!({"max_sends_per_hour": 10, "max_attachment_size_mb": 10}),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"data": {}})))
        .expect(1)
        .mount(&server)
        .await;

    adapter.apply_guardrails(&inbox_id(), 10).await.unwrap();
}

#[tokio::test]
async fn finds_a_lost_create_by_its_owner_tag() {
    let (server, adapter) = adapter().await;
    Mock::given(method("GET"))
        .and(path("/v1/inboxes"))
        .and(query_param("tag", format!("macro-agent-mailbox:{}", Uuid::from_u128(9))))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": {"inboxes": [{"inbox_id": inbox_id().0, "email": "nova@example.net", "tags": [format!("macro-agent-mailbox:{}", Uuid::from_u128(9))]}], "count": 1}
        })))
        .mount(&server)
        .await;

    let found = adapter
        .find_mailbox(AgentMailboxId(Uuid::from_u128(9)))
        .await
        .unwrap();

    assert_eq!(found.map(|mailbox| mailbox.id), Some(inbox_id()));
}

#[tokio::test]
async fn mints_a_key_scoped_to_one_inbox_with_read_and_send_only() {
    let (server, adapter) = adapter().await;
    Mock::given(method("POST"))
        .and(path("/v1/api-keys"))
        .and(header(
            "authorization",
            format!("Bearer {ADMIN_KEY}").as_str(),
        ))
        .and(header(
            "idempotency-key",
            Uuid::from_u128(9).to_string().as_str(),
        ))
        .and(body_json(json!({
            "name": format!("macro-agent-mailbox-{}", Uuid::from_u128(9)),
            "permissions": ["messages.read", "messages.send", "threads.read", "attachments.read"],
            "inbox_ids": [inbox_id().0],
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "data": {"key_id": "key-1", "key": SCOPED_KEY, "inbox_ids": [inbox_id().0]}
        })))
        .mount(&server)
        .await;

    let (grant, key) = adapter
        .grant_access(&inbox_id(), Uuid::from_u128(9))
        .await
        .unwrap();

    assert_eq!(grant, ProviderGrantId("key-1".to_owned()));
    assert_eq!(key.expose(), SCOPED_KEY);
    assert_eq!(format!("{key:?}"), "MailboxKey(redacted)");
}

#[tokio::test]
async fn revoking_and_deleting_what_is_already_gone_succeeds() {
    let (server, adapter) = adapter().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/api-keys/key-1"))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(json!({"error": {"code": "not_found"}})),
        )
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path(format!("/v1/inboxes/{}", inbox_id().0)))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    adapter
        .revoke_access(&ProviderGrantId("key-1".to_owned()))
        .await
        .unwrap();
    adapter.delete_mailbox(&inbox_id()).await.unwrap();
}

#[tokio::test]
async fn reads_with_the_mailbox_scoped_key_only() {
    let (server, adapter) = adapter().await;
    Mock::given(method("GET"))
        .and(path(format!("/v1/inboxes/{}/messages", inbox_id().0)))
        .and(header(
            "authorization",
            format!("Bearer {SCOPED_KEY}").as_str(),
        ))
        .and(query_param("limit", "5"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": {
                "messages": [{
                    "message_id": "m-1",
                    "inbox_id": inbox_id().0,
                    "thread_id": "t-1",
                    "direction": "inbound",
                    "from_email": "person@example.com",
                    "to": ["nova@example.net"],
                    "subject": "Hello",
                    "injection_risk": "high",
                    "created_at": "2026-11-20T10:00:00Z"
                }],
                "count": 1,
                "cursor": "next"
            }
        })))
        .mount(&server)
        .await;
    let key = MailboxKey::new(SCOPED_KEY.to_owned());

    let page = MessagePage {
        cursor: None,
        limit: Some(5),
    };
    let list = adapter
        .list_messages(&inbox_id(), &key, &page)
        .await
        .unwrap();

    assert_eq!(list.next_cursor.as_deref(), Some("next"));
    assert_eq!(list.messages.len(), 1);
    assert_eq!(list.messages[0].mailbox, inbox_id());
    assert_eq!(list.messages[0].direction, MessageDirection::Inbound);
}

#[tokio::test]
async fn sends_and_replies_with_idempotency_keys_and_maps_the_send_cap() {
    let (server, adapter) = adapter().await;
    Mock::given(method("POST"))
        .and(path(format!("/v1/inboxes/{}/messages", inbox_id().0)))
        .and(header(
            "idempotency-key",
            Uuid::from_u128(1).to_string().as_str(),
        ))
        .and(body_json(
            json!({"to": ["person@example.com"], "subject": "Hi", "text_body": "Hello"}),
        ))
        .respond_with(
            ResponseTemplate::new(201)
                .set_body_json(json!({"data": {"message_id": "sent-1", "status": "sent"}})),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!(
            "/v1/inboxes/{}/messages/m-1/reply",
            inbox_id().0
        )))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("retry-after", "60")
                .set_body_json(json!({"error": {"code": "rate_limited"}})),
        )
        .mount(&server)
        .await;
    let key = MailboxKey::new(SCOPED_KEY.to_owned());
    let message = OutgoingMessage {
        to: vec!["person@example.com".to_owned()],
        cc: vec![],
        subject: "Hi".to_owned(),
        text_body: "Hello".to_owned(),
    };

    let sent = adapter
        .send(&inbox_id(), &key, &message, Uuid::from_u128(1))
        .await
        .unwrap();
    let reply = adapter
        .reply(
            &inbox_id(),
            &key,
            &ProviderMessageId("m-1".to_owned()),
            &ReplyMessage {
                text_body: "Thanks".to_owned(),
            },
            Uuid::from_u128(2),
        )
        .await;

    assert_eq!(sent.id, ProviderMessageId("sent-1".to_owned()));
    assert!(matches!(reply, Err(ProviderError::SendLimit)));
}

#[test]
fn only_the_real_api_is_live() {
    assert_eq!(
        DeadSimple::vendor_mode("https://api.deadsimple.email"),
        VendorMode::Live
    );
    assert_eq!(
        DeadSimple::vendor_mode("https://api.deadsimple.email/"),
        VendorMode::Live
    );
    assert_eq!(
        DeadSimple::vendor_mode("http://agent-mailbox-fake-vendor:8080"),
        VendorMode::Fake
    );
}

#[tokio::test]
async fn without_a_provisioning_key_nothing_reaches_the_provider() {
    let server = MockServer::start().await;
    let adapter = DeadSimple::new(&server.uri(), None).unwrap();

    let error = adapter.create_mailbox(&create_request()).await.unwrap_err();

    assert!(matches!(error, ProviderError::NotConfigured));
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn revoking_all_access_revokes_only_keys_scoped_to_exactly_that_mailbox() {
    let (server, adapter) = adapter().await;
    Mock::given(method("GET"))
        .and(path("/v1/api-keys"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": {"api_keys": [
                {"key_id": "scoped", "inbox_ids": [inbox_id().0]},
                {"key_id": "account-wide", "inbox_ids": []},
                {"key_id": "other", "inbox_ids": ["other-inbox"]},
                {"key_id": "shared", "inbox_ids": [inbox_id().0, "other-inbox"]},
            ], "count": 4}
        })))
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/v1/api-keys/scoped"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    adapter.revoke_all_access(&inbox_id(), None).await.unwrap();

    let deletes = server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .filter(|request| request.method == wiremock::http::Method::DELETE)
        .count();
    assert_eq!(deletes, 1);
}

#[tokio::test]
async fn a_lost_create_is_never_matched_to_another_owners_inbox() {
    let (server, adapter) = adapter().await;
    // An API that ignores the tag filter and lists the whole account.
    Mock::given(method("GET"))
        .and(path("/v1/inboxes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": {"inboxes": [
                {"inbox_id": "someone-else", "email": "other@example.net", "tags": ["macro-agent-mailbox:00000000-0000-0000-0000-000000000001"]},
                {"inbox_id": "untagged", "email": "plain@example.net", "tags": []},
            ], "count": 2}
        })))
        .mount(&server)
        .await;

    let found = adapter
        .find_mailbox(AgentMailboxId(Uuid::from_u128(9)))
        .await;

    // Neither inbox is taken for it, and the unfiltered listing proves nothing.
    assert!(
        matches!(found, Err(ProviderError::Unavailable)),
        "{found:?}"
    );
}

#[tokio::test]
async fn two_inboxes_with_the_same_owner_tag_are_refused_rather_than_guessed() {
    let (server, adapter) = adapter().await;
    let tag = format!("macro-agent-mailbox:{}", Uuid::from_u128(9));
    Mock::given(method("GET"))
        .and(path("/v1/inboxes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": {"inboxes": [
                {"inbox_id": "first", "email": "a@example.net", "tags": [tag]},
                {"inbox_id": "second", "email": "b@example.net", "tags": [tag]},
            ], "count": 2}
        })))
        .mount(&server)
        .await;

    let found = adapter
        .find_mailbox(AgentMailboxId(Uuid::from_u128(9)))
        .await;

    assert!(matches!(found, Err(ProviderError::Unavailable)));
}

#[tokio::test]
async fn a_conflict_on_send_or_reply_is_retryable_not_a_rejection() {
    let (server, adapter) = adapter().await;
    Mock::given(method("POST"))
        .respond_with(
            ResponseTemplate::new(409)
                .set_body_json(json!({"error": {"code": "idempotency_in_progress"}})),
        )
        .mount(&server)
        .await;
    let key = MailboxKey::new(SCOPED_KEY.to_owned());
    let message = OutgoingMessage {
        to: vec!["person@example.com".to_owned()],
        cc: vec![],
        subject: "Hi".to_owned(),
        text_body: "Hello".to_owned(),
    };

    let sent = adapter
        .send(&inbox_id(), &key, &message, Uuid::from_u128(1))
        .await;
    let reply = adapter
        .reply(
            &inbox_id(),
            &key,
            &ProviderMessageId("m-1".to_owned()),
            &ReplyMessage {
                text_body: "Thanks".to_owned(),
            },
            Uuid::from_u128(2),
        )
        .await;

    assert!(matches!(sent, Err(ProviderError::Unavailable)), "{sent:?}");
    assert!(
        matches!(reply, Err(ProviderError::Unavailable)),
        "{reply:?}"
    );
}

#[tokio::test]
async fn a_create_conflict_is_a_taken_address_only_when_the_provider_says_so() {
    for (code, taken) in [
        ("address_taken", true),
        // Undocumented codes, however close they read, are retried under
        // the same key rather than guessed as a taken address.
        ("email_taken", false),
        ("local_part_unavailable", false),
        ("request_exists", false),
        ("temporarily_unavailable", false),
        ("idempotency_key_in_use", false),
        ("request_in_progress", false),
        ("conflict", false),
        ("", false),
    ] {
        let (server, adapter) = adapter().await;
        Mock::given(method("POST"))
            .and(path("/v1/inboxes"))
            .respond_with(
                ResponseTemplate::new(409).set_body_json(json!({"error": {"code": code}})),
            )
            .mount(&server)
            .await;

        let created = adapter.create_mailbox(&create_request()).await;

        if taken {
            assert!(
                matches!(created, Err(ProviderError::AddressTaken)),
                "{code}: {created:?}"
            );
        } else {
            assert!(
                matches!(created, Err(ProviderError::Unavailable)),
                "{code}: {created:?}"
            );
        }
    }
}

#[tokio::test]
async fn revoking_all_access_skips_the_credential_already_revoked() {
    let (server, adapter) = adapter().await;
    Mock::given(method("GET"))
        .and(path("/v1/api-keys"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": {"api_keys": [
                {"key_id": "stored", "inbox_ids": [inbox_id().0]},
                {"key_id": "minted-never-stored", "inbox_ids": [inbox_id().0]},
            ], "count": 2}
        })))
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/v1/api-keys/minted-never-stored"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/v1/api-keys/stored"))
        .respond_with(ResponseTemplate::new(204))
        .expect(0)
        .mount(&server)
        .await;

    adapter
        .revoke_all_access(&inbox_id(), Some(&ProviderGrantId("stored".to_owned())))
        .await
        .unwrap();
}

#[tokio::test]
async fn a_listing_with_no_inbox_under_the_tag_proves_nothing_and_is_retried() {
    let other_tag = format!("macro-agent-mailbox:{}", Uuid::from_u128(8));
    let (server, adapter) = adapter().await;
    Mock::given(method("GET"))
        .and(path("/v1/inboxes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": {"inboxes": [{"inbox_id": "someone-else", "email": "x@example.net", "tags": [other_tag]}], "count": 1}
        })))
        .mount(&server)
        .await;

    let found = adapter
        .find_mailbox(AgentMailboxId(Uuid::from_u128(9)))
        .await;

    assert!(
        matches!(found, Err(ProviderError::Unavailable)),
        "{found:?}"
    );
}

#[tokio::test]
async fn an_empty_filtered_listing_means_no_inbox_under_the_tag() {
    let (server, adapter) = adapter().await;
    Mock::given(method("GET"))
        .and(path("/v1/inboxes"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"data": {"inboxes": [], "count": 0}})),
        )
        .mount(&server)
        .await;

    let found = adapter
        .find_mailbox(AgentMailboxId(Uuid::from_u128(9)))
        .await
        .unwrap();

    assert!(found.is_none());
}
