use super::*;
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use models_email::service::link::{Link, UserProvider};
use std::sync::{Arc, Mutex};

const CALLER: &str = "macro|reader@example.com";
const OWNER: &str = "macro|owner@example.com";
const OWN: Uuid = Uuid::from_u128(1);

#[derive(Debug, thiserror::Error)]
#[error("test persistence failure")]
struct TestError;

#[derive(Clone, Debug, PartialEq, Eq)]
enum Call {
    Inbox(Uuid),
    Delegated(String, String, Uuid),
    Disconnect(String, Uuid),
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

impl InboxCalendar for Fake {
    async fn disconnect(&self, caller: &str, id: Uuid) -> Result<(), CalendarMutationError> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::Disconnect(caller.into(), id));
        match self.fail {
            Some("calendar_missing") => Err(CalendarMutationError::NotFound),
            Some("calendar") => Err(CalendarMutationError::Retryable("unavailable".into())),
            _ => Ok(()),
        }
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

fn service(fake: Fake) -> CalendarDisconnectService<Fake, Fake> {
    CalendarDisconnectService {
        catalog: Arc::new(InboxCatalogService(fake.clone())),
        calendar: fake,
    }
}

#[tokio::test]
async fn calendar_disconnect_requires_ownership_even_with_delegation() {
    for owner in [CALLER, OWNER] {
        let fake = Fake {
            link: Some(link(OWN, owner)),
            delegated: true,
            ..Default::default()
        };
        let result = service(fake.clone()).disconnect(CALLER, OWN).await;
        if owner == CALLER {
            assert!(result.is_ok());
            assert_eq!(
                *fake.calls.lock().unwrap(),
                vec![Call::Inbox(OWN), Call::Disconnect(CALLER.into(), OWN)]
            );
        } else {
            assert!(matches!(
                result,
                Err(InboxCalendarError::Access(InboxAccessError::Forbidden))
            ));
            assert!(
                !fake
                    .calls
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|call| matches!(call, Call::Disconnect(..)))
            );
        }
    }
}

#[tokio::test]
async fn calendar_absence_after_authorization_and_other_failures_are_distinct() {
    for fail in ["calendar_missing", "calendar"] {
        let fake = Fake {
            link: Some(link(OWN, CALLER)),
            fail: Some(fail),
            ..Default::default()
        };
        let result = service(fake).disconnect(CALLER, OWN).await;
        match fail {
            "calendar_missing" => assert!(matches!(
                result,
                Err(InboxCalendarError::Access(InboxAccessError::NotFound))
            )),
            _ => assert!(matches!(
                result,
                Err(InboxCalendarError::Mutation(
                    CalendarMutationError::Retryable(_)
                ))
            )),
        }
    }
}
