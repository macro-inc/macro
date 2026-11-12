use super::*;
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use models_email::service::{
    address::ContactInfoLegacy,
    link::{Link, UserProvider},
};
use std::sync::{Arc, Mutex};

const CALLER: &str = "macro|reader@example.com";
const OWNER: &str = "macro|owner@example.com";
const OWN: Uuid = Uuid::from_u128(1);
const SHARED: Uuid = Uuid::from_u128(2);

#[derive(Debug, thiserror::Error)]
#[error("test persistence failure")]
struct TestError;

#[derive(Clone, Debug, PartialEq, Eq)]
enum Call {
    Inboxes(String),
    Contacts(Uuid),
}

#[derive(Clone, Default)]
struct Fake {
    inboxes: Vec<Link>,
    fail: Option<&'static str>,
    calls: Arc<Mutex<Vec<Call>>>,
}

impl InboxAccessRepository for Fake {
    type Err = TestError;
    async fn inbox(&self, _: Uuid) -> Result<Option<Link>, TestError> {
        Ok(None)
    }
    async fn delegated(&self, _: &str, _: &str, _: Uuid) -> Result<bool, TestError> {
        Ok(false)
    }
    async fn accessible_inboxes(&self, caller: &str) -> Result<Vec<Link>, TestError> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::Inboxes(caller.into()));
        if self.fail == Some("inboxes") {
            return Err(TestError);
        }
        Ok(self.inboxes.clone())
    }
}

impl InboxContactsRepository for Fake {
    type Err = TestError;
    async fn contacts(&self, id: Uuid) -> Result<Vec<ContactInfoWithInteraction>, TestError> {
        self.calls.lock().unwrap().push(Call::Contacts(id));
        if self.fail == Some("contacts") {
            return Err(TestError);
        }
        Ok(vec![ContactInfoWithInteraction {
            extra: ContactInfoLegacy {
                name: Some(id.to_string()),
                ..Default::default()
            },
            last_interaction: chrono::DateTime::UNIX_EPOCH,
        }])
    }
}

fn link(id: Uuid, owner: &str) -> Link {
    Link {
        id,
        macro_id: MacroUserIdStr::try_from(owner.to_string()).unwrap(),
        fusionauth_user_id: "test-user".into(),
        email_address: EmailStr::try_from("inbox@example.com".to_string()).unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary: false,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: chrono::DateTime::UNIX_EPOCH,
        updated_at: chrono::DateTime::UNIX_EPOCH,
    }
}

fn service(fake: Fake) -> ContactListService<Fake, Fake> {
    ContactListService {
        catalog: Arc::new(InboxCatalogService(fake.clone())),
        repository: fake,
    }
}

#[tokio::test]
async fn contacts_include_owned_and_delegated_inboxes_in_repository_order() {
    let fake = Fake {
        inboxes: vec![link(SHARED, OWNER), link(OWN, CALLER)],
        ..Default::default()
    };
    let contacts = service(fake.clone()).list(CALLER).await.unwrap();
    assert_eq!(contacts.len(), 2);
    assert_eq!(contacts[&OWN][0].extra.name, Some(OWN.to_string()));
    assert_eq!(contacts[&SHARED][0].extra.name, Some(SHARED.to_string()));
    assert_eq!(
        *fake.calls.lock().unwrap(),
        vec![
            Call::Inboxes(CALLER.into()),
            Call::Contacts(SHARED),
            Call::Contacts(OWN)
        ]
    );
}

#[tokio::test]
async fn no_accessible_inboxes_returns_empty_contacts_without_contact_queries() {
    let fake = Fake::default();
    assert!(service(fake.clone()).list(CALLER).await.unwrap().is_empty());
    assert_eq!(
        *fake.calls.lock().unwrap(),
        vec![Call::Inboxes(CALLER.into())]
    );
}

#[tokio::test]
async fn contact_failures_stop_the_collection_without_partial_success() {
    for fail in ["inboxes", "contacts"] {
        let fake = Fake {
            inboxes: vec![link(OWN, CALLER), link(SHARED, OWNER)],
            fail: Some(fail),
            ..Default::default()
        };
        let result = service(fake.clone()).list(CALLER).await;
        if fail == "inboxes" {
            assert!(matches!(
                result,
                Err(InboxContactsError::Inboxes(TestError))
            ));
            assert_eq!(fake.calls.lock().unwrap().len(), 1);
        } else {
            assert!(matches!(
                result,
                Err(InboxContactsError::Contacts(TestError))
            ));
            assert_eq!(
                *fake.calls.lock().unwrap(),
                vec![Call::Inboxes(CALLER.into()), Call::Contacts(OWN)]
            );
        }
    }
}
