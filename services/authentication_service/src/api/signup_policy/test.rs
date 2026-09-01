use axum::body::Body;
use axum::http::StatusCode;
use http_body_util::BodyExt;
use serde_json::{Value, json};

use super::*;
use authentication_service::service::signup_policy::{SignupPolicy, SignupPolicyDenial};

const ALLOWED_EMAIL: &str = "allowed@example.test";
const DENIED_EMAIL: &str = "denied@example.test";

#[test]
fn encodes_shared_mailbox_grant_marker() {
    assert_eq!(
        shared_mailbox_grant_user_data(),
        json!({
            "macro": {
                "userPurpose": "shared_mailbox_grant",
            },
        })
    );
}

#[test]
fn decodes_exact_shared_mailbox_grant_marker_as_trusted_origin() {
    let origin = signup_origin_from_fusionauth_user_data(
        DENIED_EMAIL,
        Some(&shared_mailbox_grant_user_data()),
    );

    assert_eq!(origin, SignupOrigin::SharedMailbox);
}

#[test]
fn treats_absent_user_data_as_public_origin() {
    let origin = signup_origin_from_fusionauth_user_data(DENIED_EMAIL, None);

    assert_eq!(
        origin,
        SignupOrigin::Public {
            email: DENIED_EMAIL.to_string(),
        }
    );
}

#[test]
fn treats_malformed_user_data_as_public_origin() {
    for data in [
        Value::Null,
        json!("shared_mailbox_grant"),
        json!(["shared_mailbox_grant"]),
        json!({"macro": "shared_mailbox_grant"}),
    ] {
        let origin = signup_origin_from_fusionauth_user_data(DENIED_EMAIL, Some(&data));

        assert_eq!(
            origin,
            SignupOrigin::Public {
                email: DENIED_EMAIL.to_string(),
            }
        );
    }
}

#[test]
fn treats_unknown_or_open_marker_values_as_public_origin() {
    for data in [
        json!({"macro": {"userPurpose": "other"}}),
        json!({"macro": {"userPurpose": "shared_mailbox_grant", "extra": true}}),
        json!({"macro": {"userPurpose": "shared_mailbox_grant"}, "extra": true}),
        json!({"userPurpose": "shared_mailbox_grant"}),
    ] {
        let origin = signup_origin_from_fusionauth_user_data(DENIED_EMAIL, Some(&data));

        assert_eq!(
            origin,
            SignupOrigin::Public {
                email: DENIED_EMAIL.to_string(),
            }
        );
    }
}

#[tokio::test]
async fn forbidden_response_is_generic_and_redacted() {
    let response = signup_forbidden_response();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    let body = response_body(response.into_body()).await;
    assert!(body.contains("signup is not allowed"));
    assert_redacted(&body);
}

#[test]
fn adapter_diagnostics_are_redacted_when_policy_denies_origin() {
    let policy = SignupPolicy::from_allowlist_json(&format!(r#"["{ALLOWED_EMAIL}"]"#)).unwrap();
    let data = json!({"macro": {"userPurpose": "unknown"}});
    let origin = signup_origin_from_fusionauth_user_data(DENIED_EMAIL, Some(&data));
    let denial = policy.authorize_origin(&origin).unwrap_err();

    assert_eq!(denial, SignupPolicyDenial::PublicEmailNotAllowed);
    assert_redacted(&format!("{origin:?}"));
    assert_redacted(&format!("{denial:?}"));
    assert_redacted(&denial.to_string());
}

async fn response_body(body: Body) -> String {
    let bytes = body.collect().await.unwrap().to_bytes();
    String::from_utf8(bytes.to_vec()).unwrap()
}

fn assert_redacted(diagnostic: &str) {
    assert!(!diagnostic.contains(ALLOWED_EMAIL));
    assert!(!diagnostic.contains(DENIED_EMAIL));
    assert!(!diagnostic.contains("example.test"));
}
