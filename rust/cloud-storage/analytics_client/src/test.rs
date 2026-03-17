use super::*;

#[tokio::test]
async fn test_noop_client() {
    let client = AnalyticsClient::noop();
    assert!(!client.posthog().is_configured());
    assert!(!client.google_analytics().is_configured());
    assert!(!client.meta().is_configured());
}

#[tokio::test]
async fn test_track_new_active_subscription() {
    let client = AnalyticsClient::noop();
    assert!(client
        .track_stripe_subscription("test@example.com", "sub_123", Some(1999), Some("USD"), "active", true)
        .await
        .is_ok());
}

#[tokio::test]
async fn test_track_new_trialing_subscription() {
    let client = AnalyticsClient::noop();
    assert!(client
        .track_stripe_subscription("test@example.com", "sub_123", Some(1999), Some("USD"), "trialing", true)
        .await
        .is_ok());
}

#[tokio::test]
async fn test_track_canceled_subscription() {
    let client = AnalyticsClient::noop();
    assert!(client
        .track_stripe_subscription("test@example.com", "sub_123", Some(1999), Some("USD"), "canceled", false)
        .await
        .is_ok());
}

#[tokio::test]
async fn test_track_updated_subscription_no_op() {
    let client = AnalyticsClient::noop();
    // Updated (not new) active subscription should be no-op
    assert!(client
        .track_stripe_subscription("test@example.com", "sub_123", Some(1999), Some("USD"), "active", false)
        .await
        .is_ok());
}

#[tokio::test]
async fn test_track_subscription_missing_value() {
    let client = AnalyticsClient::noop();
    // Missing value should be no-op
    assert!(client
        .track_stripe_subscription("test@example.com", "sub_123", None, Some("USD"), "active", true)
        .await
        .is_ok());
}

#[test]
fn test_client_with_all_providers() {
    let client = AnalyticsClient::new(AnalyticsClientConfig {
        posthog: Some(PostHogConfig {
            api_key: "test_key".to_string(),
            host: Some("https://custom.posthog.com".to_string()),
        }),
        google_analytics: Some(GoogleAnalyticsConfig {
            measurement_id: "G-XXXXXX".to_string(),
            api_secret: "secret".to_string(),
        }),
        meta: Some(MetaConfig {
            pixel_id: "123456".to_string(),
            access_token: "token".to_string(),
            test_event_code: Some("TEST123".to_string()),
        }),
    });

    assert!(client.posthog().is_configured());
    assert!(client.google_analytics().is_configured());
    assert!(client.meta().is_configured());
}
