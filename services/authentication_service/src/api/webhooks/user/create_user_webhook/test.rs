use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use authentication_service::service::signup_policy::SignupPolicy;
use axum::http::StatusCode;
use macro_user_id::email::Email;
use model::authentication::webhooks::{
    Event, EventInfo, FusionAuthUserWebhook, User as FusionAuthWebhookUser,
};
use serde_json::Value;

use super::{
    UserCreateWebhookError, dispatch_user_create_webhook, identity_provider_name,
    support_channel_name, user_create_webhook_error_response,
};

#[test]
fn support_channel_name_uses_email_local_part() {
    let email = Email::parse_from_str("new.user+trial@example.com").expect("valid email");

    assert_eq!(
        support_channel_name(&email),
        "Macro Support x new.user+trial"
    );
}

fn webhook_user(
    first_name: Option<&str>,
    last_name: Option<&str>,
    full_name: Option<&str>,
) -> FusionAuthWebhookUser {
    FusionAuthWebhookUser {
        id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0".to_string(),
        email: "new.user@example.com".to_string(),
        username: None,
        verified: true,
        first_name: first_name.map(str::to_string),
        last_name: last_name.map(str::to_string),
        full_name: full_name.map(str::to_string),
        data: None,
    }
}

fn user_create_webhook(email: &str, data: Option<Value>) -> FusionAuthUserWebhook {
    FusionAuthUserWebhook {
        event: Event {
            create_instant: 0,
            id: "event-id".to_string(),
            linked_object_id: "linked-object-id".to_string(),
            info: EventInfo {
                ip_address: "198.51.100.42".to_string(),
            },
            user: FusionAuthWebhookUser {
                email: email.to_string(),
                data,
                ..webhook_user(None, None, None)
            },
            event_type: "user.create".to_string(),
        },
    }
}

async fn dispatch_with_invocation_count(
    policy: &SignupPolicy,
    req: FusionAuthUserWebhook,
) -> (bool, usize) {
    let invocation_count = Arc::new(AtomicUsize::new(0));
    let spy_count = invocation_count.clone();

    let result = dispatch_user_create_webhook(policy, req, move |_| {
        spy_count.fetch_add(1, Ordering::SeqCst);
        async { Ok(()) }
    })
    .await;

    (result.is_ok(), invocation_count.load(Ordering::SeqCst))
}

#[tokio::test]
async fn allowed_develop_public_signup_invokes_onboarding() {
    let policy = SignupPolicy::from_allowlist_json(r#"["allowed@example.com"]"#).unwrap();
    let req = user_create_webhook("Allowed@Example.com", None);

    let (is_ok, invocation_count) = dispatch_with_invocation_count(&policy, req).await;

    assert!(is_ok);
    assert_eq!(invocation_count, 1);
}

#[tokio::test]
async fn denied_develop_public_signup_does_not_invoke_onboarding() {
    let policy = SignupPolicy::from_allowlist_json(r#"["allowed@example.com"]"#).unwrap();
    let req = user_create_webhook("denied@example.com", None);

    let (is_ok, invocation_count) = dispatch_with_invocation_count(&policy, req).await;

    assert!(!is_ok);
    assert_eq!(invocation_count, 0);
}

#[test]
fn denied_signup_maps_to_generic_forbidden_status() {
    let response = user_create_webhook_error_response(UserCreateWebhookError::Forbidden);

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn allow_all_environment_policy_invokes_onboarding() {
    let policy = SignupPolicy::allow_all();
    let req = user_create_webhook("anyone@example.com", None);

    let (is_ok, invocation_count) = dispatch_with_invocation_count(&policy, req).await;

    assert!(is_ok);
    assert_eq!(invocation_count, 1);
}

#[tokio::test]
async fn allowlisted_shared_mailbox_email_invokes_onboarding() {
    let policy = SignupPolicy::from_allowlist_json(r#"["shared-mailbox@example.com"]"#).unwrap();
    let req = user_create_webhook("shared-mailbox@example.com", None);

    let (is_ok, invocation_count) = dispatch_with_invocation_count(&policy, req).await;

    assert!(is_ok);
    assert_eq!(invocation_count, 1);
}

#[tokio::test]
async fn non_allowlisted_shared_mailbox_email_is_denied() {
    let policy = SignupPolicy::from_allowlist_json(r#"["allowed@example.com"]"#).unwrap();
    let req = user_create_webhook("shared-mailbox@example.com", None);

    let (is_ok, invocation_count) = dispatch_with_invocation_count(&policy, req).await;

    assert!(!is_ok);
    assert_eq!(invocation_count, 0);
}

#[tokio::test]
async fn complete_and_verified_events_do_not_use_user_create_dispatch() {
    for event_type in ["user.create.complete", "user.email.verified"] {
        let req = FusionAuthUserWebhook {
            event: Event {
                event_type: event_type.to_string(),
                ..user_create_webhook("denied@example.com", None).event
            },
        };

        assert_ne!(req.event.event_type, "user.create");
    }
}

#[test]
fn identity_provider_name_prefers_first_and_last_name() {
    let user = webhook_user(Some("Evan"), Some("Hutnik"), Some("Someone Else"));

    assert_eq!(
        identity_provider_name(&user),
        (Some("Evan".to_string()), Some("Hutnik".to_string()))
    );
}

#[test]
fn identity_provider_name_splits_full_name_at_first_space() {
    let user = webhook_user(None, None, Some("Ada Byron Lovelace"));

    assert_eq!(
        identity_provider_name(&user),
        (Some("Ada".to_string()), Some("Byron Lovelace".to_string()))
    );
}

#[test]
fn identity_provider_name_handles_single_word_full_name() {
    let user = webhook_user(None, None, Some("Prince"));

    assert_eq!(
        identity_provider_name(&user),
        (Some("Prince".to_string()), None)
    );
}

#[test]
fn identity_provider_name_ignores_blank_values() {
    let user = webhook_user(Some("  "), Some(""), Some("   "));

    assert_eq!(identity_provider_name(&user), (None, None));
}

#[test]
fn identity_provider_name_is_empty_for_passwordless_signup() {
    let user = webhook_user(None, None, None);

    assert_eq!(identity_provider_name(&user), (None, None));
}

#[test]
fn identity_provider_name_keeps_partial_name() {
    let user = webhook_user(Some("Evan"), None, None);

    assert_eq!(
        identity_provider_name(&user),
        (Some("Evan".to_string()), None)
    );
}
