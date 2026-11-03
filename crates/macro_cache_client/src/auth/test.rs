use super::PendingPasswordlessSignup;
use crate::MacroCache;

fn cache() -> MacroCache {
    let url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
    MacroCache::new(&url)
}

#[tokio::test]
async fn pending_passwordless_signup_is_consumed_by_the_first_sign_in_only() {
    let cache = cache();
    let email = format!("Pending-{}@Example.com", uuid::Uuid::new_v4());

    cache
        .mark_passwordless_signup_pending(
            &email,
            &PendingPasswordlessSignup {
                referral_code: Some("REF123".to_string()),
            },
        )
        .await
        .unwrap();

    // Lookups are case-insensitive, as the webhook and callback lowercase emails.
    assert!(
        cache
            .is_passwordless_signup_pending(&email.to_lowercase())
            .await
            .unwrap()
    );
    assert_eq!(
        cache
            .take_passwordless_signup_pending(&email.to_lowercase())
            .await
            .unwrap(),
        Some(PendingPasswordlessSignup {
            referral_code: Some("REF123".to_string()),
        })
    );
    assert!(!cache.is_passwordless_signup_pending(&email).await.unwrap());
    assert_eq!(
        cache
            .take_passwordless_signup_pending(&email)
            .await
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn pending_passwordless_signup_without_referral_code_is_still_pending() {
    let cache = cache();
    let email = format!("pending-{}@example.com", uuid::Uuid::new_v4());

    cache
        .mark_passwordless_signup_pending(
            &email,
            &PendingPasswordlessSignup {
                referral_code: None,
            },
        )
        .await
        .unwrap();

    assert!(cache.is_passwordless_signup_pending(&email).await.unwrap());
    assert_eq!(
        cache
            .take_passwordless_signup_pending(&email)
            .await
            .unwrap(),
        Some(PendingPasswordlessSignup {
            referral_code: None,
        })
    );
}

#[tokio::test]
async fn address_without_passwordless_signup_is_not_pending() {
    let cache = cache();
    let email = format!("sso-{}@example.com", uuid::Uuid::new_v4());

    assert!(!cache.is_passwordless_signup_pending(&email).await.unwrap());
    assert_eq!(
        cache
            .take_passwordless_signup_pending(&email)
            .await
            .unwrap(),
        None
    );
}
