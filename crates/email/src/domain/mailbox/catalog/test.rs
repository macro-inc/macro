use super::*;
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use models_email::service::link::{Link, UserProvider};
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
    Inbox(Uuid),
    Delegated(String, String, Uuid),
}

#[derive(Clone, Default)]
struct Fake {
    link: Option<Link>,
    delegated: bool,
    fail: Option<&'static str>,
    calls: Arc<Mutex<Vec<Call>>>,
}

impl InboxAccessRepository for Fake {
    type Err = TestError;
    async fn inbox(&self, id: Uuid) -> Result<Option<Link>, TestError> {
        self.calls.lock().unwrap().push(Call::Inbox(id));
        if self.fail == Some("inbox") {
            return Err(TestError);
        }
        Ok(self.link.clone())
    }
    async fn delegated(&self, caller: &str, owner: &str, id: Uuid) -> Result<bool, TestError> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::Delegated(caller.into(), owner.into(), id));
        if self.fail == Some("delegated") {
            return Err(TestError);
        }
        Ok(self.delegated)
    }
    async fn accessible_inboxes(&self, _: &str) -> Result<Vec<Link>, TestError> {
        Ok(Vec::new())
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

fn service(fake: Fake) -> InboxCatalogService<Fake> {
    InboxCatalogService(fake)
}

#[tokio::test]
async fn owner_access_does_not_query_delegation() {
    let fake = Fake {
        link: Some(link(OWN, CALLER)),
        ..Default::default()
    };
    let svc = service(fake.clone());
    let (resolved, access) = svc.authorize(CALLER, OWN).await.unwrap();
    assert_eq!(resolved.id, OWN);
    assert_eq!(access, InboxAccess::Own);
    assert_eq!(*fake.calls.lock().unwrap(), vec![Call::Inbox(OWN)]);
}

#[tokio::test]
async fn another_owner_requires_a_matching_delegation_edge() {
    for delegated in [false, true] {
        let fake = Fake {
            link: Some(link(SHARED, OWNER)),
            delegated,
            ..Default::default()
        };
        let result = service(fake.clone()).authorize(CALLER, SHARED).await;
        if delegated {
            assert_eq!(result.unwrap().1, InboxAccess::Delegated);
        } else {
            assert!(matches!(result, Err(InboxAccessError::Forbidden)));
        }
        assert_eq!(
            *fake.calls.lock().unwrap(),
            vec![
                Call::Inbox(SHARED),
                Call::Delegated(CALLER.into(), OWNER.into(), SHARED)
            ]
        );
    }
}

#[tokio::test]
async fn missing_inbox_and_failed_lookups_stop_authorization() {
    for fail in [None, Some("inbox"), Some("delegated")] {
        let fake = Fake {
            link: fail.map(|_| link(SHARED, OWNER)),
            fail,
            ..Default::default()
        };
        let result = service(fake.clone()).authorize(CALLER, SHARED).await;
        match fail {
            None => assert!(matches!(result, Err(InboxAccessError::NotFound))),
            Some(_) => assert!(matches!(result, Err(InboxAccessError::Query(TestError)))),
        }
        assert_eq!(
            fake.calls.lock().unwrap().len(),
            if fail == Some("delegated") { 2 } else { 1 }
        );
    }
}
