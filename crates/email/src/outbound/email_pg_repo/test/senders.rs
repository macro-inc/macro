use super::*;

mod durable;
mod send_window;
use crate::domain::{
    models::{ContactInfo, CreateDraftInput, EmailErr, Link},
    senders::{EmailSenderProvider, SendAsAddress, SendAsFuture},
};

struct Provider;
impl EmailSenderProvider for Provider {
    fn send_as<'a>(&'a self, link: &'a Link, _refresh: bool) -> SendAsFuture<'a> {
        Box::pin(async move {
            if link.id != inbox_id() {
                return Ok(vec![]);
            }
            Ok(vec![SendAsAddress {
                email_address: EmailStr::try_from("resident@test.com".to_owned()).unwrap(),
                display_name: Some("Property manager".to_owned()),
                verified: true,
            }])
        })
    }
}

fn inbox_id() -> Uuid {
    Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap()
}
fn actor() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap()
}

fn draft() -> CreateDraftInput {
    CreateDraftInput {
        sender_email: Some(EmailStr::try_from("resident@test.com".to_owned()).unwrap()),
        db_id: Some(macro_uuid::generate_uuid_v7()),
        provider_id: None,
        replying_to_id: None,
        provider_thread_id: None,
        thread_db_id: Some(macro_uuid::generate_uuid_v7()),
        subject: "Alias delivery".to_owned(),
        to: vec![ContactInfo {
            email: "alice@example.com".to_owned(),
            name: None,
            photo_url: None,
        }],
        cc: vec![],
        bcc: vec![],
        body_text: Some("Hello".to_owned()),
        body_html: None,
        body_macro: None,
        headers_json: None,
        send_time: None,
        include_signature: Some(false),
        actor: None,
        draft_client_binding: None,
        thread_client_binding: None,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn sender_survives_save_reopen_and_delivery_and_cannot_leak_to_another_inbox(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = super::thread_unread::service(pool.clone()).with_sender_provider(Provider);
    let input = draft();
    let saved = service
        .save_draft_for_user_impl(actor(), Some(inbox_id()), input.clone())
        .await?;
    assert_eq!(saved.sender.email, "resident@test.com");
    assert_eq!(saved.sender.name.as_deref(), Some("Property manager"));
    // The worker reads this same persisted contact when constructing MIME From.
    let (_, sender) =
        email_db_client::messages::get::get_message_to_send(&pool, saved.draft.db_id, inbox_id())
            .await?;
    assert_eq!(sender.email, "resident@test.com");

    let second_inbox = Uuid::parse_str("cccccccc-cccc-cccc-cccc-cccccccccccc")?;
    assert!(matches!(
        service
            .save_draft_for_user_impl(actor(), Some(second_inbox), input.clone())
            .await,
        Err(EmailErr::InvalidSender)
    ));
    // Rejected sender changes must not delete/move the original draft.
    let unchanged = service
        .email_repo
        .get_simple_message(saved.draft.db_id, &[inbox_id()])
        .await?
        .unwrap();
    assert_eq!(unchanged.link_id, inbox_id());

    let sent = service
        .send_message_for_user_impl(actor(), Some(inbox_id()), input.clone())
        .await?;
    assert_eq!(sent.db_id, saved.draft.db_id);
    assert_eq!(sent.thread_db_id, saved.draft.thread_db_id);
    let (_, sender) =
        email_db_client::messages::get::get_message_to_send(&pool, sent.db_id, inbox_id()).await?;
    assert_eq!(sender.email, "resident@test.com");
    assert!(
        service
            .send_message_for_user_impl(actor(), Some(inbox_id()), input)
            .await
            .is_err(),
        "replayed delivery must not enqueue a second message"
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn send_rejects_an_inaccessible_inbox(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let service = super::thread_unread::service(pool).with_sender_provider(Provider);
    let stranger = MacroUserIdStr::try_from_email("stranger@example.com")?;
    assert!(matches!(
        service
            .send_message_for_user_impl(stranger, Some(inbox_id()), draft())
            .await,
        Err(EmailErr::InboxNotFound)
    ));
    Ok(())
}
