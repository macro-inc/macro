use super::*;

#[tokio::test]
async fn test_noop_client() {
    let client = AnalyticsClient::noop();
    assert!(!client.google_analytics().is_configured());
    assert!(!client.meta().is_configured());
}

#[tokio::test]
async fn test_track_new_active_subscription() {
    let client = AnalyticsClient::noop();
    assert!(client
        .track_stripe_subscription(Some("GA1.1.123456789.1234567890"), "test@example.com", "sub_123", Some(1999), Some("USD"), "active", true)
        .await
        .is_ok());
}

#[tokio::test]
async fn test_track_new_active_subscription_without_ga_client_id() {
    let client = AnalyticsClient::noop();
    assert!(client
        .track_stripe_subscription(None, "test@example.com", "sub_123", Some(1999), Some("USD"), "active", true)
        .await
        .is_ok());
}

#[tokio::test]
async fn test_track_new_trialing_subscription() {
    let client = AnalyticsClient::noop();
    assert!(client
        .track_stripe_subscription(Some("GA1.1.123456789.1234567890"), "test@example.com", "sub_123", Some(1999), Some("USD"), "trialing", true)
        .await
        .is_ok());
}

#[tokio::test]
async fn test_track_canceled_subscription() {
    let client = AnalyticsClient::noop();
    assert!(client
        .track_stripe_subscription(Some("GA1.1.123456789.1234567890"), "test@example.com", "sub_123", Some(1999), Some("USD"), "canceled", false)
        .await
        .is_ok());
}

#[tokio::test]
async fn test_track_updated_subscription_no_op() {
    let client = AnalyticsClient::noop();
    // Updated (not new) active subscription should be no-op
    assert!(client
        .track_stripe_subscription(Some("GA1.1.123456789.1234567890"), "test@example.com", "sub_123", Some(1999), Some("USD"), "active", false)
        .await
        .is_ok());
}

#[tokio::test]
async fn test_track_subscription_missing_value() {
    let client = AnalyticsClient::noop();
    // Missing value should be no-op
    assert!(client
        .track_stripe_subscription(Some("GA1.1.123456789.1234567890"), "test@example.com", "sub_123", None, Some("USD"), "active", true)
        .await
        .is_ok());
}

#[test]
fn test_client_with_all_providers() {
    let client = AnalyticsClient::new(AnalyticsClientConfig {
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

    assert!(client.google_analytics().is_configured());
    assert!(client.meta().is_configured());
}
