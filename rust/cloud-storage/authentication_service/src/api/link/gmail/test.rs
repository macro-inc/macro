use super::*;
use std::cell::Cell;

/// Stub for the existing-inbox check. Reports a fixed answer and records whether
/// the paywall actually invoked it, so tests can assert the db is only queried
/// when it should be.
struct InboxCheckSpy {
    has_inbox: bool,
    called: Cell<bool>,
}

impl InboxCheckSpy {
    fn returning(has_inbox: bool) -> Self {
        Self {
            has_inbox,
            called: Cell::new(false),
        }
    }

    async fn check(&self) -> anyhow::Result<bool> {
        self.called.set(true);
        Ok(self.has_inbox)
    }

    fn was_called(&self) -> bool {
        self.called.get()
    }
}

#[tokio::test]
async fn paywalls_additional_inbox_without_professional_features() {
    let inbox = InboxCheckSpy::returning(true);

    let result = enforce_inbox_paywall(false, || inbox.check()).await;

    assert!(
        inbox.was_called(),
        "non-professional users should be checked for an existing inbox"
    );
    assert!(matches!(result, Err(InitGmailLinkError::PaymentRequired)));
}

#[tokio::test]
async fn first_inbox_is_free_without_professional_features() {
    let inbox = InboxCheckSpy::returning(false);

    let result = enforce_inbox_paywall(false, || inbox.check()).await;

    assert!(
        inbox.was_called(),
        "non-professional users should be checked for an existing inbox"
    );
    assert!(result.is_ok());
}

#[tokio::test]
async fn professional_features_skip_existing_inbox_check() {
    let inbox = InboxCheckSpy::returning(true);

    let result = enforce_inbox_paywall(true, || inbox.check()).await;

    assert!(
        !inbox.was_called(),
        "professional users should never trigger the existing-inbox check"
    );
    assert!(result.is_ok());
}
