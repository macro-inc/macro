use super::*;
use axum::body::to_bytes;
use feature_flags::{FlagSnapshot, outbound::fake::FakeFeatureFlags};
use serde_json::{Value, json};

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|flags@example.com").unwrap()
}

async fn body(response: Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn returns_every_evaluated_flag_with_its_variant() {
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        user(),
        Ok(FlagSnapshot::new([
            ("enable-calendar-ui".into(), FlagValue::Boolean(true)),
            ("staff-only".into(), FlagValue::Boolean(false)),
            ("layout".into(), FlagValue::Variant("compact".into())),
        ])),
    );

    let response = respond(Some(&flags), &user()).await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        body(response).await,
        json!({"flags": {
            "enable-calendar-ui": true,
            "layout": "compact",
            "staff-only": false,
        }})
    );
}

#[tokio::test]
async fn a_failed_load_is_unavailable_not_every_flag_off() {
    let mut flags = FakeFeatureFlags::default();
    flags.set(user(), Err("PostHog timed out".into()));

    let response = respond(Some(&flags), &user()).await;

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn no_posthog_configuration_is_unavailable() {
    let response = respond::<FakeFeatureFlags>(None, &user()).await;

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}
