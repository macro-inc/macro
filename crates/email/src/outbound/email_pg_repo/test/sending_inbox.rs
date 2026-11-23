//! Which inbox an AI-composed email goes out from, against the real repo.
//!
//! The resolution reads two tables (the caller's accessible inboxes, and the
//! message a reply answers), and the inbox it settles on decides whether the
//! reply can thread at all - so these run against Postgres rather than a fake.

use super::*;
use crate::domain::{
    models::{CreateDraftInput, EmailErr, SendingInboxRequest},
    ports::NoOpEnqueuer,
    service::EmailServiceImpl,
};
use crm::domain::service::NoOpCrmService;
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use macro_event_broker::NoopMacroEventBroker;

const PRIMARY_INBOX: Uuid = Uuid::from_u128(0xa1111111_1111_1111_1111_111111111111);
const ALT_INBOX: Uuid = Uuid::from_u128(0xa2222222_2222_2222_2222_222222222222);
const ALT_THREAD: Uuid = Uuid::from_u128(0xd2222222_0000_0000_0000_000000000002);
const MESSAGE_IN_PRIMARY: Uuid = Uuid::from_u128(0xe1111111_0000_0000_0000_000000000001);
const MESSAGE_IN_ALT: Uuid = Uuid::from_u128(0xe2222222_0000_0000_0000_000000000002);

fn service(
    pool: Pool<Postgres>,
) -> EmailServiceImpl<
    EmailPgRepo,
    FrecencyQueryServiceImpl<FrecencyPgStorage>,
    NoOpEnqueuer,
    NoOpCrmService,
    (),
> {
    EmailServiceImpl {
        email_repo: EmailPgRepo::new(pool.clone()),
        frecency_service: FrecencyQueryServiceImpl::new(FrecencyPgStorage::new(pool)),
        enqueuer: NoOpEnqueuer,
        crm_service: NoOpCrmService,
        entity_access_management_service: (),
        macro_event_broker: NoopMacroEventBroker,
        sent_undo_delay_secs: 0,
        sender_provider: std::sync::Arc::new(
            crate::domain::senders::UnavailableEmailSenderProvider,
        ),
        shared_thread_replies: std::sync::Arc::new(
            crate::domain::shared_thread_replies::NoSharedThreadReplies,
        ),
    }
}

fn caller() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap()
}

fn reply_to(replying_to_id: Uuid) -> SendingInboxRequest<'static> {
    SendingInboxRequest {
        requested_address: None,
        replying_to_id: Some(replying_to_id),
    }
}

fn reply_input(replying_to_id: Uuid) -> CreateDraftInput {
    CreateDraftInput {
        frozen_signature_html: None,
        draft_generation: 0,
        db_id: None,
        provider_id: None,
        replying_to_id: Some(replying_to_id),
        provider_thread_id: None,
        thread_db_id: None,
        subject: "Re: Hello alt".to_owned(),
        sender_email: None,
        to: vec![crate::domain::models::ContactInfo {
            email: "alice@example.com".to_owned(),
            name: None,
            photo_url: None,
        }],
        cc: vec![],
        bcc: vec![],
        body_text: Some("Thanks".to_owned()),
        body_html: None,
        body_macro: None,
        headers_json: None,
        send_time: None,
        include_signature: None,
        actor: Some(caller()),
        draft_client_binding: None,
        thread_client_binding: None,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_sending_inbox"))
)]
async fn a_reply_is_sent_from_the_inbox_that_received_it(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = service(pool);

    let resolved = service
        .resolve_sending_inbox_impl(caller(), reply_to(MESSAGE_IN_ALT))
        .await?;

    assert_eq!(
        resolved.link.id, ALT_INBOX,
        "the reply must go out from the inbox that received the message, not the primary one"
    );
    assert_eq!(
        resolved.accessible_inboxes.len(),
        2,
        "the whole accessible set comes back so the send can find a reply target in any inbox"
    );

    // Resolution is only useful if the send it feeds can then reach the
    // target: a reply handed the single sending inbox used to fail here with
    // "message not found" whenever the target lived in another inbox.
    let draft = service
        .create_draft_impl(
            &resolved.link,
            &resolved.accessible_inboxes,
            reply_input(MESSAGE_IN_ALT),
        )
        .await?;
    assert_eq!(draft.link_id, ALT_INBOX);
    assert_eq!(
        draft.thread_db_id, ALT_THREAD,
        "sent from the target's own inbox, the reply joins the target's thread"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_sending_inbox"))
)]
async fn a_new_email_is_sent_from_the_primary_inbox(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let resolved = service(pool)
        .resolve_sending_inbox_impl(caller(), SendingInboxRequest::default())
        .await?;

    assert_eq!(resolved.link.id, PRIMARY_INBOX);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_sending_inbox"))
)]
async fn an_explicit_sender_overrides_the_reply_target(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let resolved = service(pool)
        .resolve_sending_inbox_impl(
            caller(),
            SendingInboxRequest {
                // Deliberately the other case, since addresses compare
                // case-insensitively.
                requested_address: Some("User1@Test.com"),
                replying_to_id: Some(MESSAGE_IN_ALT),
            },
        )
        .await?;

    assert_eq!(resolved.link.id, PRIMARY_INBOX);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_sending_inbox"))
)]
async fn an_address_that_is_no_inbox_of_the_callers_is_refused(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // `expect_err` would need `ResolvedSendingInbox: Debug`, which would mean
    // a `Link` that prints a user's mailbox identity into test output.
    let Err(error) = service(pool)
        .resolve_sending_inbox_impl(
            caller(),
            SendingInboxRequest {
                requested_address: Some("someone@elsewhere.test"),
                replying_to_id: None,
            },
        )
        .await
    else {
        panic!("an inbox the caller cannot send from must be refused, never substituted")
    };

    // The message is what the model reads back, so it has to say what the
    // choices were.
    let message = error.to_string();
    assert!(message.contains("someone@elsewhere.test"), "{message}");
    assert!(message.contains("user1@test.com"), "{message}");
    assert!(message.contains("user1-alt@test.com"), "{message}");
    assert!(
        matches!(error, EmailErr::UnknownSendingInbox { .. }),
        "{message}"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_sending_inbox"))
)]
async fn a_reply_target_the_caller_cannot_reach_falls_back_to_the_default(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let resolved = service(pool)
        .resolve_sending_inbox_impl(caller(), reply_to(Uuid::from_u128(0xdead)))
        .await?;

    // Resolution does not double as an existence check: the send reports the
    // missing target, against the inbox it would have gone out from.
    assert_eq!(resolved.link.id, PRIMARY_INBOX);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_user_with_no_connected_inbox_cannot_send(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let Err(error) = service(pool)
        .resolve_sending_inbox_impl(caller(), SendingInboxRequest::default())
        .await
    else {
        panic!("there is no inbox to send from")
    };

    assert!(matches!(error, EmailErr::InboxNotFound), "{error}");

    Ok(())
}

/// The reported failure, pinned: a reply handed only its own sending inbox
/// cannot see a target living in another of the user's inboxes, and calls the
/// target missing. Deriving the sender from the target is what normally keeps
/// the two in the same inbox, but the accessible set still has to be passed
/// through for the case where the user switches the sender by hand.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_sending_inbox"))
)]
async fn a_reply_cannot_find_a_target_outside_the_inboxes_it_is_given(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = service(pool);
    let alt = service
        .resolve_sending_inbox_impl(caller(), reply_to(MESSAGE_IN_ALT))
        .await?;

    let Err(error) = service
        .create_draft_impl(
            &alt.link,
            std::slice::from_ref(&alt.link),
            reply_input(MESSAGE_IN_PRIMARY),
        )
        .await
    else {
        panic!("a target outside the given inboxes must be unreachable")
    };
    assert!(
        matches!(error, EmailErr::MessageNotFound(id) if id == MESSAGE_IN_PRIMARY),
        "{error}"
    );

    // Given every inbox the caller can reach, the same reply lands.
    service
        .create_draft_impl(
            &alt.link,
            &alt.accessible_inboxes,
            reply_input(MESSAGE_IN_PRIMARY),
        )
        .await?;

    Ok(())
}

/// A same-inbox reply is the ordinary case and must keep working: nothing
/// about deriving the sender changes where it threads.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_sending_inbox"))
)]
async fn a_reply_in_the_primary_inbox_still_resolves_to_it(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let resolved = service(pool)
        .resolve_sending_inbox_impl(caller(), reply_to(MESSAGE_IN_PRIMARY))
        .await?;

    assert_eq!(resolved.link.id, PRIMARY_INBOX);

    Ok(())
}

/// Gmail's send-as list for the fixture inboxes: the alternate inbox has a
/// verified alias and one still awaiting verification; the primary inbox's
/// list cannot be read.
struct AltInboxAliases;

impl crate::domain::senders::EmailSenderProvider for AltInboxAliases {
    fn send_as<'a>(
        &'a self,
        link: &'a crate::domain::models::Link,
        _refresh: bool,
    ) -> crate::domain::senders::SendAsFuture<'a> {
        Box::pin(async move {
            if link.id != ALT_INBOX {
                return Err(EmailErr::SendAsPermissionRequired);
            }
            let alias = |address: &str, display_name: &str, verified: bool| {
                crate::domain::senders::SendAsAddress {
                    email_address: EmailStr::try_from(address.to_owned()).unwrap(),
                    display_name: Some(display_name.to_owned()),
                    verified,
                }
            };
            Ok(vec![
                alias("support@example.com", "Support Team", true),
                alias("pending@example.com", "Pending", false),
            ])
        })
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_sending_inbox"))
)]
async fn a_verified_alias_sends_from_its_inbox_under_the_alias(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = service(pool.clone()).with_sender_provider(AltInboxAliases);

    let resolved = service
        .resolve_sending_inbox_impl(
            caller(),
            SendingInboxRequest {
                requested_address: Some("Support@Example.com"),
                replying_to_id: None,
            },
        )
        .await?;

    assert_eq!(resolved.link.id, ALT_INBOX);
    assert_eq!(
        resolved
            .sender_address
            .as_ref()
            .map(|alias| alias.0.as_ref()),
        Some("support@example.com"),
        "the alias as Gmail spells it, whatever case the caller used"
    );

    // What the delivery worker reads to build the MIME From header.
    let mut input = reply_input(MESSAGE_IN_ALT);
    input.sender_email = resolved.sender_address.clone();
    let draft = service
        .create_draft_impl(&resolved.link, &resolved.accessible_inboxes, input)
        .await?;
    let (_, sender) =
        email_db_client::messages::get::get_message_to_send(&pool, draft.db_id, ALT_INBOX).await?;
    assert_eq!(sender.email, "support@example.com");
    assert_eq!(sender.name.as_deref(), Some("Support Team"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_sending_inbox"))
)]
async fn an_unverified_alias_is_refused_naming_its_inbox(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let Err(error) = service(pool)
        .with_sender_provider(AltInboxAliases)
        .resolve_sending_inbox_impl(
            caller(),
            SendingInboxRequest {
                requested_address: Some("pending@example.com"),
                replying_to_id: None,
            },
        )
        .await
    else {
        panic!("an alias Gmail has not verified must not be sent from")
    };

    let message = error.to_string();
    assert!(
        matches!(
            &error,
            // The fixture's alternate inbox, which owns the alias.
            EmailErr::UnverifiedSendingAlias { inbox, .. } if inbox.starts_with("user1-alt@")
        ),
        "{message}"
    );
    assert!(message.contains("has not verified"), "{message}");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_sending_inbox"))
)]
async fn an_address_that_is_no_alias_is_unknown_even_when_a_lookup_fails(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // The primary inbox's sender list cannot be read; that inbox is skipped,
    // and the caller still hears which addresses they can use.
    let Err(error) = service(pool)
        .with_sender_provider(AltInboxAliases)
        .resolve_sending_inbox_impl(
            caller(),
            SendingInboxRequest {
                requested_address: Some("someone@elsewhere.test"),
                replying_to_id: None,
            },
        )
        .await
    else {
        panic!("an address that is no inbox or alias must be refused")
    };

    assert!(
        matches!(error, EmailErr::UnknownSendingInbox { .. }),
        "{error}"
    );

    Ok(())
}
