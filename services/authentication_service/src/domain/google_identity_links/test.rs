use super::*;
use std::sync::Mutex;

#[derive(Default)]
struct Attempts {
    due: Vec<DueAttempt>,
    needed: Vec<Uuid>,
    retrying: Vec<Uuid>,
    unfinishable: Vec<Uuid>,
    finished: Mutex<Vec<Uuid>>,
}

impl IdentityLinkAttempts for Attempts {
    type Err = &'static str;
    async fn due(&self, limit: i64) -> Result<Vec<DueAttempt>, Self::Err> {
        assert_eq!(limit, 100);
        Ok(self.due.clone())
    }
    async fn link_use(&self, attempt: &DueAttempt) -> Result<LinkUse, Self::Err> {
        Ok(if self.needed.contains(&attempt.id) {
            LinkUse::Backing
        } else if self.retrying.contains(&attempt.id) {
            LinkUse::Retrying
        } else {
            LinkUse::Unused
        })
    }
    async fn finish(&self, attempt: Uuid) -> Result<(), Self::Err> {
        if self.unfinishable.contains(&attempt) {
            return Err("synthetic finish failure");
        }
        self.finished.lock().unwrap().push(attempt);
        Ok(())
    }
}

#[derive(Default)]
struct Remover {
    failing: Vec<Uuid>,
    removed: Mutex<Vec<(Uuid, String)>>,
}

impl IdentityLinkRemover for Remover {
    type Err = &'static str;
    async fn remove(&self, fusionauth_user_id: Uuid, email: &str) -> Result<(), Self::Err> {
        if self.failing.contains(&fusionauth_user_id) {
            return Err("synthetic FusionAuth failure");
        }
        self.removed
            .lock()
            .unwrap()
            .push((fusionauth_user_id, email.to_string()));
        Ok(())
    }
}

fn attempt(id: u128, user: u128, email: &str) -> DueAttempt {
    DueAttempt {
        id: Uuid::from_u128(id),
        fusionauth_user_id: Uuid::from_u128(user),
        email: email.into(),
    }
}

#[tokio::test]
async fn only_unused_links_are_released_and_deferred_or_failed_attempts_stay_due() {
    let attempts = Attempts {
        due: vec![
            attempt(1, 11, "refused@example.com"),
            attempt(2, 12, "own-account@example.com"),
            attempt(3, 13, "fusionauth-down@example.com"),
            attempt(4, 14, "finish-fails@example.com"),
            attempt(5, 15, "retried@example.com"),
        ],
        needed: vec![Uuid::from_u128(2)],
        retrying: vec![Uuid::from_u128(5)],
        unfinishable: vec![Uuid::from_u128(4)],
        ..Attempts::default()
    };
    let remover = Remover {
        failing: vec![Uuid::from_u128(13)],
        ..Remover::default()
    };

    let round = release_identity_links(&attempts, &remover).await.unwrap();

    assert_eq!(
        round,
        ReleaseRound {
            released: 1,
            kept: 1,
            deferred: 1,
            failed: 2
        }
    );
    assert_eq!(
        *remover.removed.lock().unwrap(),
        [
            (Uuid::from_u128(11), "refused@example.com".to_string()),
            (Uuid::from_u128(14), "finish-fails@example.com".to_string())
        ],
        "a still-needed link, or one a retry may be using, is never removed"
    );
    assert_eq!(
        *attempts.finished.lock().unwrap(),
        [Uuid::from_u128(1), Uuid::from_u128(2)],
        "an attempt whose release failed or was deferred stays due"
    );
}
