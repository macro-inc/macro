use super::*;
use crate::domain::{
    models::EmailErr,
    senders::{EmailSenderProvider, SendAsAddress, SendAsFuture},
};

#[derive(Clone, Default)]
struct Provider {
    requested: Arc<Mutex<Vec<Uuid>>>,
}

impl EmailSenderProvider for Provider {
    fn send_as<'a>(&'a self, link: &'a Link, _refresh: bool) -> SendAsFuture<'a> {
        Box::pin(async move {
            self.requested.lock().unwrap().push(link.id);
            Ok([true, false]
                .into_iter()
                .map(|verified| SendAsAddress {
                    email_address: EmailStr::try_from(
                        if verified {
                            "verified@example.com"
                        } else {
                            "pending@example.com"
                        }
                        .to_owned(),
                    )
                    .unwrap(),
                    display_name: None,
                    verified,
                })
                .collect())
        })
    }
}

#[tokio::test]
async fn inaccessible_inboxes_are_rejected_before_provider_access() {
    let provider = Provider::default();
    let service = service(FakeUserRepo::default()).with_sender_provider(provider.clone());
    assert!(matches!(
        service
            .get_user_email_senders(user_id(), Uuid::from_u128(99))
            .await,
        Err(EmailErr::InboxNotFound)
    ));
    assert!(provider.requested.lock().unwrap().is_empty());
}

#[tokio::test]
async fn delegated_inboxes_use_their_own_grant_and_hide_unverified_senders() {
    let provider = Provider::default();
    let inbox = link(Uuid::from_u128(2), "delegated-owner@example.com");
    let service = service(FakeUserRepo {
        inboxes: vec![inbox.clone()],
        ..Default::default()
    })
    .with_sender_provider(provider.clone());
    let senders = service
        .get_user_email_senders(user_id(), inbox.id)
        .await
        .unwrap();
    assert_eq!(senders.len(), 1);
    assert_eq!(senders[0].email_address.0.as_ref(), "verified@example.com");
    assert_eq!(*provider.requested.lock().unwrap(), vec![inbox.id]);
}

#[tokio::test]
async fn outlook_senders_use_the_primary_address_without_a_gmail_lookup() {
    let provider = Provider::default();
    let mut inbox = link(Uuid::from_u128(3), "viewer@outlook.com");
    inbox.provider = UserProvider::Outlook;
    let service = service(FakeUserRepo {
        inboxes: vec![inbox.clone()],
        ..Default::default()
    })
    .with_sender_provider(provider.clone());
    let senders = service
        .get_user_email_senders(user_id(), inbox.id)
        .await
        .unwrap();
    assert_eq!(senders.len(), 1);
    assert_eq!(senders[0].email_address.0.as_ref(), "viewer@outlook.com");
    assert!(senders[0].verified);
    assert!(provider.requested.lock().unwrap().is_empty());
}
