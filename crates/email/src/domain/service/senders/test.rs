use std::sync::{Arc, Mutex};

use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;
use crate::domain::{
    models::UserProvider,
    senders::{EmailSenderProvider, SendAsFuture},
};

#[derive(Clone, Default)]
struct Provider {
    calls: Arc<Mutex<Vec<(Uuid, bool)>>>,
    fail: bool,
}

impl EmailSenderProvider for Provider {
    fn send_as<'a>(&'a self, link: &'a Link, refresh: bool) -> SendAsFuture<'a> {
        Box::pin(async move {
            self.calls.lock().unwrap().push((link.id, refresh));
            if self.fail {
                return Err(EmailErr::SendAsUnavailable);
            }
            Ok(vec![
                SendAsAddress {
                    email_address: address("resident@example.com"),
                    display_name: Some("Property manager".to_owned()),
                    verified: true,
                },
                SendAsAddress {
                    email_address: address("pending@example.com"),
                    display_name: None,
                    verified: false,
                },
            ])
        })
    }
}

fn address(raw: &str) -> EmailStr<'static> {
    EmailStr::try_from(raw.to_owned()).unwrap()
}

fn inbox() -> Link {
    Link {
        id: Uuid::from_u128(1),
        macro_id: MacroUserIdStr::try_from_email("base@example.com").unwrap(),
        fusionauth_user_id: "owner-grant".to_owned(),
        email_address: address("base@example.com"),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary: true,
        created_at: Default::default(),
        updated_at: Default::default(),
    }
}

fn service(provider: Provider) -> EmailServiceImpl<(), (), (), (), (), ()> {
    EmailServiceImpl {
        email_repo: (),
        frecency_service: (),
        enqueuer: (),
        crm_service: (),
        entity_access_management_service: (),
        macro_event_broker: (),
        sent_undo_delay_secs: 10,
        sender_provider: Arc::new(provider),
    }
}

#[tokio::test]
async fn primary_address_works_when_provider_is_down() {
    let provider = Provider {
        fail: true,
        ..Default::default()
    };
    let service = service(provider.clone());
    for requested in [None, Some(address("BASE@example.com"))] {
        assert_eq!(
            service
                .resolve_sender(&inbox(), requested.as_ref(), true)
                .await
                .unwrap()
                .email,
            "base@example.com"
        );
    }
    assert!(provider.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn aliases_are_case_insensitive_and_send_forces_fresh_validation() {
    let provider = Provider::default();
    let service = service(provider.clone());
    for refresh in [false, true] {
        let sender = service
            .resolve_sender(&inbox(), Some(&address("Resident@example.com")), refresh)
            .await
            .unwrap();
        assert_eq!(sender.email, "resident@example.com");
        assert_eq!(sender.name.as_deref(), Some("Property manager"));
    }
    assert_eq!(
        *provider.calls.lock().unwrap(),
        vec![(inbox().id, false), (inbox().id, true)]
    );
}

#[tokio::test]
async fn unknown_and_pending_aliases_never_fall_back_to_primary() {
    let service = service(Provider::default());
    for email in ["stranger@example.com", "pending@example.com"] {
        assert!(matches!(
            service
                .resolve_sender(&inbox(), Some(&address(email)), true)
                .await,
            Err(EmailErr::InvalidSender)
        ));
    }
}

#[tokio::test]
async fn provider_failure_does_not_authorize_an_alias() {
    let service = service(Provider {
        fail: true,
        ..Default::default()
    });
    assert!(matches!(
        service
            .resolve_sender(&inbox(), Some(&address("resident@example.com")), true)
            .await,
        Err(EmailErr::SendAsUnavailable)
    ));
}
