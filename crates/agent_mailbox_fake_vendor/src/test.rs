use uuid::Uuid;

use super::*;
use agent_mailbox::domain::models::{
    AgentMailboxId, CreateMailbox, LocalPart, MessageDirection, MessagePage, OutgoingMessage,
    ProviderMessageId, ReplyMessage,
};
use agent_mailbox::domain::ports::{MailboxClient, MailboxProvisioner, ProviderError};
use agent_mailbox::outbound::deadsimple::{DeadSimple, ProvisioningKey};

const ADMIN_KEY: &str = "dse_fake_not_live";

/// The real adapter against the fake, served on a local port: the fake must
/// answer in the shapes the adapter reads.
async fn adapter_against_fake() -> DeadSimple {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(axum::serve(listener, FakeVendor::new(ADMIN_KEY).router()).into_future());
    DeadSimple::new(
        &format!("http://{address}"),
        Some(ProvisioningKey::new(ADMIN_KEY.to_owned())),
    )
    .unwrap()
}

fn create(local_part: &str, tag: u128) -> CreateMailbox {
    CreateMailbox {
        idempotency_key: Uuid::from_u128(tag),
        owner_tag: AgentMailboxId(Uuid::from_u128(tag)),
        local_part: Some(LocalPart::parse(local_part).unwrap()),
        display_name: None,
    }
}

#[tokio::test]
async fn two_agents_mail_each_other_and_cannot_read_each_others_mailboxes() {
    let adapter = adapter_against_fake().await;
    let ada = adapter.create_mailbox(&create("ada", 1)).await.unwrap();
    let ben = adapter.create_mailbox(&create("ben", 2)).await.unwrap();
    adapter.apply_guardrails(&ada.id, 10).await.unwrap();
    let (_, ada_key) = adapter
        .grant_access(&ada.id, Uuid::from_u128(101))
        .await
        .unwrap();
    let (_, ben_key) = adapter
        .grant_access(&ben.id, Uuid::from_u128(102))
        .await
        .unwrap();

    let message = OutgoingMessage {
        to: vec![ben.address.clone()],
        cc: vec![],
        subject: "Hello Ben".to_owned(),
        text_body: "From Ada".to_owned(),
    };
    adapter
        .send(&ada.id, &ada_key, &message, Uuid::from_u128(10))
        .await
        .unwrap();
    adapter
        .send(&ada.id, &ada_key, &message, Uuid::from_u128(10))
        .await
        .unwrap();

    let ben_inbox = adapter
        .list_messages(&ben.id, &ben_key, &MessagePage::default())
        .await
        .unwrap();
    assert_eq!(ben_inbox.messages.len(), 1, "a replayed send delivers once");
    let received = &ben_inbox.messages[0];
    assert_eq!(received.direction, MessageDirection::Inbound);
    assert_eq!(received.from, "ada@fake-vendor.invalid");

    let ben_reads_ada = adapter
        .list_messages(&ada.id, &ben_key, &MessagePage::default())
        .await;
    assert!(matches!(ben_reads_ada, Err(ProviderError::NotFound)));

    adapter
        .reply(
            &ben.id,
            &ben_key,
            &received.id,
            &ReplyMessage {
                text_body: "Hi Ada".to_owned(),
            },
            Uuid::from_u128(11),
        )
        .await
        .unwrap();
    let ada_inbox = adapter
        .list_messages(&ada.id, &ada_key, &MessagePage::default())
        .await
        .unwrap();
    let reply = ada_inbox
        .messages
        .iter()
        .find(|message| message.direction == MessageDirection::Inbound)
        .unwrap();
    assert_eq!(reply.subject, "Re: Hello Ben");
    assert_eq!(reply.thread_id, received.thread_id);
}

#[tokio::test]
async fn a_lost_create_is_found_by_tag_and_deleting_twice_succeeds() {
    let adapter = adapter_against_fake().await;
    let created = adapter.create_mailbox(&create("nova", 5)).await.unwrap();
    let replayed = adapter.create_mailbox(&create("nova", 5)).await.unwrap();
    let taken = adapter.create_mailbox(&create("nova", 6)).await;

    let found = adapter
        .find_mailbox(AgentMailboxId(Uuid::from_u128(5)))
        .await
        .unwrap();
    adapter.delete_mailbox(&created.id).await.unwrap();
    adapter.delete_mailbox(&created.id).await.unwrap();

    assert_eq!(created, replayed);
    assert!(matches!(taken, Err(ProviderError::AddressTaken)));
    assert_eq!(found, Some(created));
}

#[tokio::test]
async fn a_revoked_key_reads_nothing() {
    let adapter = adapter_against_fake().await;
    let mailbox = adapter.create_mailbox(&create("ada", 1)).await.unwrap();
    let (grant, key) = adapter
        .grant_access(&mailbox.id, Uuid::from_u128(101))
        .await
        .unwrap();

    adapter.revoke_access(&grant).await.unwrap();
    adapter.revoke_access(&grant).await.unwrap();
    let read = adapter
        .read_message(&mailbox.id, &key, &ProviderMessageId("msg-1".to_owned()))
        .await;

    assert!(matches!(read, Err(ProviderError::NotFound)));
}

#[tokio::test]
async fn revoking_all_access_finds_keys_by_their_scope() {
    let adapter = adapter_against_fake().await;
    let mailbox = adapter.create_mailbox(&create("ada", 1)).await.unwrap();
    let (_, first) = adapter
        .grant_access(&mailbox.id, Uuid::from_u128(101))
        .await
        .unwrap();
    let (_, second) = adapter
        .grant_access(&mailbox.id, Uuid::from_u128(102))
        .await
        .unwrap();

    adapter.revoke_all_access(&mailbox.id).await.unwrap();

    for key in [first, second] {
        let read = adapter
            .list_messages(&mailbox.id, &key, &MessagePage::default())
            .await;
        assert!(matches!(read, Err(ProviderError::NotFound)));
    }
}

#[tokio::test]
async fn a_key_reused_for_another_operation_is_refused() {
    let adapter = adapter_against_fake().await;
    let mailbox = adapter.create_mailbox(&create("ada", 1)).await.unwrap();

    let reused = adapter.grant_access(&mailbox.id, Uuid::from_u128(1)).await;

    assert!(matches!(reused, Err(ProviderError::Rejected)));
}

#[test]
fn ids_never_repeat_across_restarts_of_the_fake() {
    let mut first_run = VendorState::new();
    let mut second_run = VendorState::new();

    assert_ne!(first_run.id("inbox"), second_run.id("inbox"));
}
