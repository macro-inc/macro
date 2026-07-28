use macro_user_id::email::Email;
use model::authentication::webhooks::User as FusionAuthWebhookUser;

use super::{identity_provider_name, support_channel_name};

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
