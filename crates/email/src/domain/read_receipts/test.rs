use super::*;
use std::sync::{Arc, Mutex};

const BASE: &str = "https://gateway.macro.com/email/";
const PREFIX: &str = "https://gateway.macro.com/email/opens/";

#[derive(Default)]
struct State {
    enabled: bool,
    fail: bool,
    stored: Option<ReadReceiptToken>,
    opens: Vec<(String, DateTime<Utc>, DateTime<Utc>)>,
    inboxes: Vec<Uuid>,
    thread_queries: Vec<(Uuid, Vec<Uuid>, i64)>,
}

#[derive(Clone, Default)]
struct Fake(Arc<Mutex<State>>);

impl Fake {
    fn enabled() -> Self {
        let fake = Self::default();
        fake.0.lock().unwrap().enabled = true;
        fake
    }
    fn service(&self) -> ReadReceiptService<Self> {
        ReadReceiptService::new(self.clone(), PixelUrlPrefix::new(BASE))
    }
}

impl ReadReceiptRepository for Fake {
    async fn tracking_enabled(&self, _: Uuid) -> Result<bool, Report> {
        let state = self.0.lock().unwrap();
        if state.fail {
            return Err(rootcause::report!("settings unavailable"));
        }
        Ok(state.enabled)
    }
    async fn message_token(
        &self,
        _: Uuid,
        candidate: &ReadReceiptToken,
    ) -> Result<ReadReceiptToken, Report> {
        let mut state = self.0.lock().unwrap();
        Ok(state
            .stored
            .get_or_insert_with(|| candidate.clone())
            .clone())
    }
    async fn record_open(
        &self,
        token: &ReadReceiptToken,
        at: DateTime<Utc>,
        debounce_after: DateTime<Utc>,
    ) -> Result<bool, Report> {
        self.0
            .lock()
            .unwrap()
            .opens
            .push((token.as_str().to_owned(), at, debounce_after));
        Ok(true)
    }
    async fn accessible_inboxes(&self, _: &MacroUserIdStr<'_>) -> Result<Vec<Uuid>, Report> {
        Ok(self.0.lock().unwrap().inboxes.clone())
    }
    async fn thread_receipts(
        &self,
        thread_id: Uuid,
        link_ids: &[Uuid],
        limit: i64,
    ) -> Result<Vec<MessageReadReceipt>, Report> {
        self.0
            .lock()
            .unwrap()
            .thread_queries
            .push((thread_id, link_ids.to_vec(), limit));
        Ok(Vec::new())
    }
}

fn pixel_count(html: &str) -> usize {
    html.matches(PREFIX).count()
}

#[test]
fn generated_tokens_parse_and_differ() {
    let token = ReadReceiptToken::generate();
    assert_eq!(token.as_str().len(), TOKEN_LEN);
    assert_eq!(ReadReceiptToken::parse(token.as_str()), Some(token.clone()));
    assert_ne!(ReadReceiptToken::generate(), token);
}

#[test]
fn malformed_tokens_are_rejected() {
    let valid = ReadReceiptToken::generate();
    assert!(ReadReceiptToken::parse("").is_none());
    assert!(ReadReceiptToken::parse(&valid.as_str()[1..]).is_none());
    assert!(ReadReceiptToken::parse(&format!("{}x", valid.as_str())).is_none());
    assert!(ReadReceiptToken::parse(&format!("{}/", &valid.as_str()[1..])).is_none());
}

#[test]
fn prefix_joins_base_without_double_slash() {
    assert_eq!(PixelUrlPrefix::new(BASE).as_str(), PREFIX);
    assert_eq!(
        PixelUrlPrefix::new("http://localhost:8087").as_str(),
        "http://localhost:8087/opens/"
    );
}

#[test]
fn pixel_goes_before_closing_body_or_at_end() {
    let in_body = append_pixel("<html><BODY><p>Hi</p></BODY></html>", "https://p/x");
    assert!(in_body.starts_with("<html><BODY><p>Hi</p><img src=\"https://p/x\""));
    assert!(in_body.ends_with("</BODY></html>"));

    let fragment = append_pixel("<p>Hi</p>", "https://p/x");
    assert!(fragment.starts_with("<p>Hi</p><img src=\"https://p/x\""));
}

#[test]
fn strip_removes_only_macro_pixels() {
    let prefix = PixelUrlPrefix::new(BASE);
    let html = format!(
        r#"<p>Hi</p><img src="https://cdn.example.com/logo.png"><blockquote><img src="{PREFIX}old" width="1"></blockquote>"#
    );
    let stripped = strip_pixels(&html, &prefix);
    assert_eq!(pixel_count(&stripped), 0);
    assert!(stripped.contains("https://cdn.example.com/logo.png"));
    assert!(stripped.contains("<blockquote></blockquote>"));

    let untouched = "<p>No pixels</p>";
    assert_eq!(strip_pixels(untouched, &prefix), untouched);
}

#[tokio::test]
async fn disabled_inbox_sends_without_pixel() {
    let fake = Fake::default();
    let html = fake
        .service()
        .tracked_html(Uuid::now_v7(), Uuid::now_v7(), Some("<p>Hi</p>"))
        .await
        .unwrap();
    assert_eq!(html, "<p>Hi</p>");
    assert!(fake.0.lock().unwrap().stored.is_none());
}

#[tokio::test]
async fn enabled_inbox_appends_its_stable_pixel() {
    let fake = Fake::enabled();
    let service = fake.service();
    let (link, message) = (Uuid::now_v7(), Uuid::now_v7());
    let first = service
        .tracked_html(link, message, Some("<p>Hi</p>"))
        .await
        .unwrap();
    let token = fake.0.lock().unwrap().stored.clone().unwrap();
    assert_eq!(pixel_count(&first), 1);
    assert!(first.contains(&format!("{PREFIX}{}", token.as_str())));

    let retried = service
        .tracked_html(link, message, Some(&first))
        .await
        .unwrap();
    assert_eq!(retried, first);
}

#[tokio::test]
async fn quoted_pixels_are_replaced_by_this_messages_pixel() {
    let fake = Fake::enabled();
    let quoted = format!(r#"<p>Reply</p><blockquote><img src="{PREFIX}ancestor"></blockquote>"#);
    let html = fake
        .service()
        .tracked_html(Uuid::now_v7(), Uuid::now_v7(), Some(&quoted))
        .await
        .unwrap();
    assert_eq!(pixel_count(&html), 1);
    assert!(!html.contains("ancestor"));
}

#[tokio::test]
async fn plain_text_messages_are_not_tracked() {
    let fake = Fake::enabled();
    let html = fake
        .service()
        .tracked_html(Uuid::now_v7(), Uuid::now_v7(), None)
        .await;
    assert!(html.is_none());
    assert!(fake.0.lock().unwrap().stored.is_none());
}

#[tokio::test]
async fn tracking_failure_still_delivers_untracked() {
    let fake = Fake::enabled();
    fake.0.lock().unwrap().fail = true;
    let quoted = format!(r#"<p>Hi</p><img src="{PREFIX}ancestor">"#);
    let html = fake
        .service()
        .tracked_html(Uuid::now_v7(), Uuid::now_v7(), Some(&quoted))
        .await
        .unwrap();
    assert_eq!(html, "<p>Hi</p>");
}

#[tokio::test]
async fn malformed_tokens_never_reach_storage() {
    let fake = Fake::default();
    fake.service().record_open("not-a-token").await.unwrap();
    assert!(fake.0.lock().unwrap().opens.is_empty());
}

#[tokio::test]
async fn opens_are_debounced_from_now() {
    let fake = Fake::default();
    let token = ReadReceiptToken::generate();
    fake.service().record_open(token.as_str()).await.unwrap();
    let opens = &fake.0.lock().unwrap().opens;
    let (stored, at, debounce_after) = &opens[0];
    assert_eq!(stored, token.as_str());
    assert_eq!(*at - *debounce_after, chrono::Duration::seconds(5));
}

fn thread_receipt(entity_type: EntityType) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
        "0198f0aa-0000-7000-8000-000000000001",
        entity_type,
    )
}

#[tokio::test]
async fn thread_receipts_are_scoped_to_the_viewers_inboxes() {
    let fake = Fake::default();
    let inbox = Uuid::now_v7();
    fake.0.lock().unwrap().inboxes = vec![inbox];
    fake.service()
        .thread_receipts(thread_receipt(EntityType::EmailThread))
        .await
        .unwrap();
    let queries = &fake.0.lock().unwrap().thread_queries;
    assert_eq!(
        queries.as_slice(),
        [(
            Uuid::parse_str("0198f0aa-0000-7000-8000-000000000001").unwrap(),
            vec![inbox],
            MAX_THREAD_RECEIPTS
        )]
    );
}

#[tokio::test]
async fn viewers_without_inbox_access_see_no_receipts() {
    let fake = Fake::default();
    let receipts = fake
        .service()
        .thread_receipts(thread_receipt(EntityType::EmailThread))
        .await
        .unwrap();
    assert!(receipts.is_empty());
    assert!(fake.0.lock().unwrap().thread_queries.is_empty());
}

#[tokio::test]
async fn non_user_and_non_thread_receipts_are_rejected() {
    let fake = Fake::default();
    let internal = EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_internal_user(
        "0198f0aa-0000-7000-8000-000000000001",
        EntityType::EmailThread,
    );
    assert!(matches!(
        fake.service().thread_receipts(internal).await,
        Err(ReadReceiptError::Unauthorized)
    ));
    assert!(matches!(
        fake.service()
            .thread_receipts(thread_receipt(EntityType::Document))
            .await,
        Err(ReadReceiptError::Unauthorized)
    ));
}

#[cfg(feature = "mailbox")]
mod outlook {
    use super::*;
    use crate::domain::mailbox::{
        MailboxError, MailboxKey,
        drafts::{
            models::{DraftFile, DraftLease, PreparedDraft},
            ports::DraftMaterializer,
        },
    };
    use email_api_client::domain::models::SendRequest;

    struct Content;

    impl DraftMaterializer for Content {
        async fn prepare_draft(&self, lease: &DraftLease) -> Result<PreparedDraft, MailboxError> {
            Ok(PreparedDraft {
                reply_to: None,
                request: SendRequest {
                    message_id: None,
                    message: serde_json::from_value(serde_json::json!({
                        "db_id": lease.message_id,
                        "link_id": lease.mailbox.link_id,
                        "subject": "Hello",
                        "body_html": format!(r#"<p>Hi</p><img src="{PREFIX}ancestor">"#),
                    }))
                    .unwrap(),
                    from: models_email::service::address::ContactInfo {
                        email: "owner@example.com".into(),
                        name: None,
                        photo_url: None,
                    },
                    parent_message_id: None,
                    references: None,
                },
                files: Vec::new(),
                removals: Vec::new(),
            })
        }
        async fn draft_file_bytes(
            &self,
            _: &DraftLease,
            _: &DraftFile,
        ) -> Result<Vec<u8>, MailboxError> {
            Ok(Vec::new())
        }
    }

    fn lease(send_time: Option<DateTime<Utc>>, delete_requested: bool) -> DraftLease {
        let message = Uuid::now_v7();
        DraftLease {
            message_id: message,
            lease_id: Uuid::now_v7(),
            mailbox: MailboxKey {
                link_id: Uuid::now_v7(),
                sync_generation: 1,
                grant_generation: 1,
            },
            revision: 1,
            actor_id: "macro|owner@example.com".into(),
            input: serde_json::from_value(serde_json::json!({
                "db_id": message,
                "thread_db_id": Uuid::now_v7(),
                "subject": "Hello",
                "to": [], "cc": [], "bcc": [],
                "actor_id": "macro|owner@example.com",
                "send_time": send_time,
            }))
            .unwrap(),
            attachments: Default::default(),
            provider_id: None,
            base_version: None,
            delete_requested,
            checkpoint: None,
        }
    }

    async fn body(lease: &DraftLease) -> String {
        ReadReceiptMaterializer::new(Content, Fake::enabled().service())
            .prepare_draft(lease)
            .await
            .unwrap()
            .request
            .message
            .body_html
            .unwrap()
    }

    #[tokio::test]
    async fn scheduled_drafts_carry_only_their_own_pixel() {
        let html = body(&lease(Some(Utc::now()), false)).await;
        assert_eq!(pixel_count(&html), 1);
        assert!(!html.contains("ancestor"));
    }

    #[tokio::test]
    async fn unsent_drafts_carry_no_pixel() {
        let html = body(&lease(None, false)).await;
        assert_eq!(html, "<p>Hi</p>");
    }

    #[tokio::test]
    async fn deletions_leave_content_untouched() {
        let html = body(&lease(Some(Utc::now()), true)).await;
        assert!(html.contains("ancestor"));
    }
}
