use email_api_client::domain::models::EmailApiError;
use email_api_client::domain::ports::MailboxContactsClient;
use uuid::Uuid;

use super::*;
use crate::SeedContact;

fn contact(email: &str, name: &str) -> SeedContact {
    SeedContact {
        email: email.to_string(),
        name: Some(name.to_string()),
        photo_url: None,
    }
}

#[tokio::test]
async fn contacts_sync_incrementally_until_the_sync_token_expires() {
    let emulator = GmailEmulator::start(Seed {
        mailboxes: vec![SeedMailbox {
            name: Some("Ada Example".to_string()),
            contacts: vec![
                contact("grace@example.com", "Grace"),
                contact("alan@example.com", "Alan"),
            ],
            other_contacts: vec![contact("edsger@example.com", "Edsger")],
            ..SeedMailbox::new(ADA)
        }],
        ..Seed::default()
    })
    .await
    .unwrap();
    let client = client(&emulator);
    let ada = emulator.access_token(ADA).unwrap();

    let me = client.get_self_contact(&ada).await.unwrap();
    assert_eq!(me.names[0].display_name.as_deref(), Some("Ada Example"));
    assert_eq!(me.email_addresses[0].value.as_deref(), Some(ADA));

    let all = client.get_contacts_page(&ada, None, None).await.unwrap();
    assert_eq!(all.connections.len(), 2);
    let sync_token = all.next_sync_token.unwrap();
    let others = client
        .get_other_contacts_page(&ada, None, None)
        .await
        .unwrap();
    assert_eq!(
        others.other_contacts[0].email_addresses[0].value.as_deref(),
        Some("edsger@example.com")
    );

    emulator
        .upsert_contact(ADA, contact("barbara@example.com", "Barbara"), false)
        .unwrap();
    let changed = client
        .get_contacts_page(&ada, Some(&sync_token), None)
        .await
        .unwrap();
    assert_eq!(changed.connections.len(), 1);
    assert_eq!(
        changed.connections[0].names[0].display_name.as_deref(),
        Some("Barbara")
    );

    emulator.expire_contact_sync_tokens(ADA).unwrap();
    let expired = repository(&emulator)
        .list_contacts_page(
            &AccessToken::new(ada),
            Uuid::now_v7(),
            Some(&sync_token),
            None,
        )
        .await;
    assert_eq!(expired.unwrap_err(), EmailApiError::OutdatedCursor);
}

#[tokio::test]
async fn a_grant_without_the_contacts_scope_is_refused_contacts() {
    let emulator = GmailEmulator::start(Seed {
        mailboxes: vec![SeedMailbox {
            scopes: Some(vec![
                "https://www.googleapis.com/auth/gmail.modify".to_string(),
            ]),
            ..SeedMailbox::new(ADA)
        }],
        ..Seed::default()
    })
    .await
    .unwrap();
    let ada = emulator.access_token(ADA).unwrap();

    let refused = client(&emulator).get_contacts_page(&ada, None, None).await;
    assert_eq!(refused.unwrap_err().status().unwrap().as_u16(), 403);
    assert!(client(&emulator).get_profile(&ada).await.is_ok());
}
