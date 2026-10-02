use super::*;
use std::sync::Mutex;

struct Grants {
    existing: Option<Uuid>,
    collision: bool,
    refresh_fails: bool,
    refreshed: Mutex<Vec<Uuid>>,
}

impl GoogleGrantClient for Grants {
    async fn create(&self, _: &GoogleGrant<'_>) -> Result<CreateGrantOutcome, Report> {
        Ok(if self.collision {
            CreateGrantOutcome::AlreadyLinked
        } else {
            CreateGrantOutcome::Created
        })
    }
    async fn owner(&self, grant: &GoogleGrant<'_>) -> Result<Option<Uuid>, Report> {
        assert_eq!(grant.subject, "verified-google-subject");
        Ok(self.existing)
    }
    async fn refresh(&self, _: &GoogleGrant<'_>, owner: Uuid) -> Result<(), Report> {
        self.refreshed.lock().unwrap().push(owner);
        if self.refresh_fails {
            return Err(rootcause::report!("provider refresh failed"));
        }
        Ok(())
    }
}

fn grant(preferred_owner: Uuid) -> GoogleGrant<'static> {
    GoogleGrant {
        identity_provider_id: "google-gmail",
        subject: "verified-google-subject",
        email: "secondary@example.com",
        refresh_token: "fresh",
        preferred_owner,
    }
}

fn service(
    collision: bool,
    existing: Option<Uuid>,
    refresh_fails: bool,
) -> GoogleGrantService<Grants> {
    GoogleGrantService {
        client: Grants {
            collision,
            existing,
            refresh_fails,
            refreshed: Mutex::new(vec![]),
        },
    }
}

#[tokio::test]
async fn secondary_mailbox_keeps_existing_login_owner_and_refreshes_that_grant() {
    let requester = Uuid::now_v7();
    let old_account = Uuid::now_v7();
    let service = service(true, Some(old_account), false);
    assert_eq!(
        service.connect(grant(requester)).await.unwrap(),
        old_account
    );
    assert_eq!(*service.client.refreshed.lock().unwrap(), vec![old_account]);
}

#[tokio::test]
async fn fresh_identity_uses_the_selected_owner() {
    let requester = Uuid::now_v7();
    let service = service(false, None, false);
    assert_eq!(service.connect(grant(requester)).await.unwrap(), requester);
    assert!(service.client.refreshed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_unresolved_collision_is_not_a_successful_callback() {
    let service = service(true, None, false);
    assert!(service.connect(grant(Uuid::now_v7())).await.is_err());
    assert!(service.client.refreshed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_failed_refresh_is_not_a_successful_callback() {
    let service = service(true, Some(Uuid::now_v7()), true);
    assert!(service.connect(grant(Uuid::now_v7())).await.is_err());
}
