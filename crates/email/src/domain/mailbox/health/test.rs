use super::*;
use email_api_client::domain::models::RateLimitOrigin;
use macro_user_id::email::EmailStr;
use std::sync::{Arc, Mutex};

const LINK_ID: Uuid = Uuid::from_u128(1);

/// A link's stored health and the provider's scripted answers.
struct Mailbox {
    provider: UserProvider,
    needs_reauth: bool,
    acquire: Result<(), EmailApiError>,
    cached_watch: Result<(), EmailApiError>,
    fresh_watch: Result<(), EmailApiError>,
    /// Whether the token source persists `needs_reauth` when a fresh fetch finds the grant dead.
    persists_reauth: bool,
    contacts: Result<(), MailboxError>,
    watch_calls: Vec<TokenFreshness>,
    contact_syncs: u32,
    stream_wakes: u32,
}

impl Mailbox {
    fn gmail() -> Self {
        Self {
            provider: UserProvider::Gmail,
            needs_reauth: false,
            acquire: Ok(()),
            cached_watch: Ok(()),
            fresh_watch: Ok(()),
            persists_reauth: true,
            contacts: Ok(()),
            watch_calls: Vec::new(),
            contact_syncs: 0,
            stream_wakes: 0,
        }
    }
}

#[derive(Clone)]
struct Fake(Arc<Mutex<Mailbox>>);

impl InboxHealthRepository for Fake {
    async fn accessible(&self, _actor: &MacroUserIdStr<'_>) -> Result<Vec<Link>, MailboxError> {
        unreachable!("probes never list inboxes")
    }
    async fn binding(&self, link: Uuid) -> Result<Option<InboxHealthBinding>, MailboxError> {
        let mailbox = self.0.lock().unwrap();
        Ok(Some(InboxHealthBinding {
            link: Link {
                id: link,
                macro_id: MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
                fusionauth_user_id: "fa-user".to_string(),
                email_address: EmailStr::try_from("owner@example.com".to_string()).unwrap(),
                provider: mailbox.provider,
                is_sync_active: true,
                is_primary: true,
                needs_reauth: mailbox.needs_reauth,
                last_sync_error_at: None,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
            },
            grant_generation: 1,
            sync_generation: 1,
        }))
    }
    async fn begin_probe(&self, _link: Uuid) -> bool {
        unreachable!("probes never schedule probes")
    }
    async fn enqueue_probe(&self, _link: Uuid) -> Result<(), MailboxError> {
        unreachable!("probes never schedule probes")
    }
    async fn wake_streams(&self, _binding: &InboxHealthBinding) -> Result<(), MailboxError> {
        self.0.lock().unwrap().stream_wakes += 1;
        Ok(())
    }
}

impl InboxHealthGateway for Fake {
    async fn acquire(
        &self,
        _binding: &InboxHealthBinding,
        _freshness: TokenFreshness,
    ) -> Result<AccessToken, EmailApiError> {
        let mut mailbox = self.0.lock().unwrap();
        if mailbox.acquire == Err(EmailApiError::AuthRequired) && mailbox.persists_reauth {
            mailbox.needs_reauth = true;
        }
        mailbox.acquire.clone().map(|()| AccessToken::new("token"))
    }
    async fn renew_gmail_watch(
        &self,
        _link: &Link,
        freshness: TokenFreshness,
    ) -> Result<(), EmailApiError> {
        let mut mailbox = self.0.lock().unwrap();
        mailbox.watch_calls.push(freshness);
        match freshness {
            TokenFreshness::Cached => mailbox.cached_watch.clone(),
            TokenFreshness::Fresh => {
                if mailbox.fresh_watch == Err(EmailApiError::AuthRequired)
                    && mailbox.persists_reauth
                {
                    mailbox.needs_reauth = true;
                }
                mailbox.fresh_watch.clone()
            }
        }
    }
    async fn sync_gmail_contacts(&self, _link: &Link) -> Result<(), MailboxError> {
        let mut mailbox = self.0.lock().unwrap();
        mailbox.contact_syncs += 1;
        match &mailbox.contacts {
            Ok(()) => Ok(()),
            Err(_) => Err(MailboxError::Persistence),
        }
    }
}

async fn refresh(mailbox: Mailbox) -> (Result<(), MailboxError>, Fake) {
    let fake = Fake(Arc::new(Mutex::new(mailbox)));
    let service = InboxHealthService::new(fake.clone(), fake.clone());
    (service.probe(LINK_ID, true).await, fake)
}

fn provider_rate_limit() -> EmailApiError {
    EmailApiError::RateLimited {
        retry_after: None,
        origin: RateLimitOrigin::Provider { concurrency: false },
    }
}

#[tokio::test]
async fn revoked_grant_on_watch_marks_reauth_and_completes() {
    let (result, fake) = refresh(Mailbox {
        cached_watch: Err(EmailApiError::AuthRequired),
        fresh_watch: Err(EmailApiError::AuthRequired),
        ..Mailbox::gmail()
    })
    .await;

    assert!(result.is_ok());
    let mailbox = fake.0.lock().unwrap();
    assert!(mailbox.needs_reauth);
    assert_eq!(
        mailbox.watch_calls,
        [TokenFreshness::Cached, TokenFreshness::Fresh]
    );
    assert_eq!(mailbox.contact_syncs, 0);
}

#[tokio::test]
async fn stale_cached_token_on_watch_renews_with_a_fresh_one() {
    let (result, fake) = refresh(Mailbox {
        cached_watch: Err(EmailApiError::AuthRequired),
        ..Mailbox::gmail()
    })
    .await;

    assert!(result.is_ok());
    let mailbox = fake.0.lock().unwrap();
    assert!(!mailbox.needs_reauth);
    assert_eq!(mailbox.contact_syncs, 1);
}

#[tokio::test]
async fn auth_required_retries_while_reauth_is_not_persisted() {
    let (result, _) = refresh(Mailbox {
        cached_watch: Err(EmailApiError::AuthRequired),
        fresh_watch: Err(EmailApiError::AuthRequired),
        persists_reauth: false,
        ..Mailbox::gmail()
    })
    .await;

    assert!(matches!(result, Err(MailboxError::Persistence)));
}

#[tokio::test]
async fn revoked_grant_on_token_fetch_completes_once_reauth_is_persisted() {
    let (result, fake) = refresh(Mailbox {
        acquire: Err(EmailApiError::AuthRequired),
        ..Mailbox::gmail()
    })
    .await;

    assert!(result.is_ok());
    assert!(fake.0.lock().unwrap().watch_calls.is_empty());
}

#[tokio::test]
async fn rejected_watch_completes_and_still_syncs_contacts() {
    for rejection in [
        EmailApiError::Forbidden,
        EmailApiError::NotFound,
        EmailApiError::Permanent {
            message: "invalid topic".to_string(),
        },
    ] {
        let (result, fake) = refresh(Mailbox {
            cached_watch: Err(rejection.clone()),
            ..Mailbox::gmail()
        })
        .await;

        assert!(result.is_ok(), "{rejection:?} must not requeue the refresh");
        let mailbox = fake.0.lock().unwrap();
        assert_eq!(mailbox.watch_calls, [TokenFreshness::Cached]);
        assert_eq!(mailbox.contact_syncs, 1);
    }
}

#[tokio::test]
async fn transient_watch_failures_requeue_the_refresh() {
    for failure in [
        provider_rate_limit(),
        EmailApiError::Transient {
            message: "Gmail API returned 503".to_string(),
        },
    ] {
        let (result, fake) = refresh(Mailbox {
            cached_watch: Err(failure.clone()),
            ..Mailbox::gmail()
        })
        .await;

        assert!(
            matches!(result, Err(MailboxError::Provider(ref error)) if *error == failure),
            "{failure:?} must requeue the refresh"
        );
        assert_eq!(fake.0.lock().unwrap().contact_syncs, 0);
    }
}

#[tokio::test]
async fn transient_failure_on_the_fresh_watch_requeues_the_refresh() {
    let (result, _) = refresh(Mailbox {
        cached_watch: Err(EmailApiError::AuthRequired),
        fresh_watch: Err(provider_rate_limit()),
        ..Mailbox::gmail()
    })
    .await;

    assert!(matches!(
        result,
        Err(MailboxError::Provider(EmailApiError::RateLimited { .. }))
    ));
}

#[tokio::test]
async fn permanent_token_failures_complete_the_probe() {
    let (result, fake) = refresh(Mailbox {
        acquire: Err(EmailApiError::Permanent {
            message: "linked mailbox was not found".to_string(),
        }),
        ..Mailbox::gmail()
    })
    .await;

    assert!(result.is_ok());
    assert!(fake.0.lock().unwrap().watch_calls.is_empty());
}

#[tokio::test]
async fn transient_token_failures_requeue_the_probe() {
    let (result, _) = refresh(Mailbox {
        acquire: Err(EmailApiError::Transient {
            message: "auth service unavailable".to_string(),
        }),
        ..Mailbox::gmail()
    })
    .await;

    assert!(matches!(
        result,
        Err(MailboxError::Provider(EmailApiError::Transient { .. }))
    ));
}

#[tokio::test]
async fn contact_sync_failures_requeue_the_refresh() {
    let (result, _) = refresh(Mailbox {
        contacts: Err(MailboxError::Persistence),
        ..Mailbox::gmail()
    })
    .await;

    assert!(matches!(result, Err(MailboxError::Persistence)));
}

#[tokio::test]
async fn outlook_refresh_wakes_streams_without_a_gmail_watch() {
    let (result, fake) = refresh(Mailbox {
        provider: UserProvider::Outlook,
        ..Mailbox::gmail()
    })
    .await;

    assert!(result.is_ok());
    let mailbox = fake.0.lock().unwrap();
    assert_eq!(mailbox.stream_wakes, 1);
    assert!(mailbox.watch_calls.is_empty());
}
