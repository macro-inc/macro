use super::*;
use events::AnalyticsEvent;
use std::collections::HashMap;

#[tokio::test]
async fn test_noop_client() {
    let client = AnalyticsClient::noop();

    // All providers should be unconfigured
    assert!(!client.posthog().is_configured());
    assert!(!client.google_analytics().is_configured());
    assert!(!client.meta().is_configured());

    // Should succeed (no-op)
    let result = client
        .posthog()
        .track_raw("test@example.com", "test_event", HashMap::new())
        .await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_track_subscription_created_event() {
    let client = AnalyticsClient::noop();
    let event = SubscriptionCreatedEvent {
        subscription_id: "sub_123".to_string(),
        subscription_status: "active".to_string(),
        is_team_subscription: false,
        team_id: None,
        value: Some(1999),
        currency: Some("usd".to_string()),
    };
    let result = client
        .posthog()
        .track("test@example.com", "subscription_created", event)
        .await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_track_subscription_created_event_with_team() {
    let client = AnalyticsClient::noop();
    let team_id = uuid::Uuid::new_v4();
    let event = SubscriptionCreatedEvent {
        subscription_id: "sub_123".to_string(),
        subscription_status: "active".to_string(),
        is_team_subscription: true,
        team_id: Some(team_id),
        value: Some(4999),
        currency: Some("usd".to_string()),
    };
    let result = client
        .google_analytics()
        .track("test@example.com", "subscription_created", event)
        .await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_track_subscription_cancelled_event() {
    let client = AnalyticsClient::noop();
    let event = SubscriptionCancelledEvent {
        subscription_id: "sub_123".to_string(),
        is_team_subscription: false,
        team_id: None,
        value: Some(1999),
        currency: Some("usd".to_string()),
    };
    // Test via GA (generic property-bag API)
    let result = client
        .google_analytics()
        .track("test@example.com", "subscription_cancelled", event)
        .await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_meta_track_purchase() {
    let client = AnalyticsClient::noop();
    let event = MetaPurchaseEvent {
        value: 19.99,
        currency: "USD".to_string(),
        order_id: Some("sub_123".to_string()),
        content_name: Some("subscription".to_string()),
    };
    let result = client
        .meta()
        .track("test@example.com", "Purchase", event)
        .await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_meta_track_cancel_subscription() {
    let client = AnalyticsClient::noop();
    let event = MetaCancelSubscriptionEvent {
        subscription_id: "sub_123".to_string(),
        value: Some(19.99),
        currency: Some("USD".to_string()),
    };
    let result = client
        .meta()
        .track("test@example.com", "CancelSubscription", event)
        .await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_meta_track_lead() {
    let client = AnalyticsClient::noop();
    let event = MetaLeadEvent {
        value: None,
        currency: None,
        lead_type: Some("signup".to_string()),
    };
    let result = client
        .meta()
        .track("test@example.com", "Lead", event)
        .await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_track_all() {
    let client = AnalyticsClient::noop();
    let event = SubscriptionCreatedEvent {
        subscription_id: "sub_123".to_string(),
        subscription_status: "active".to_string(),
        is_team_subscription: false,
        team_id: None,
        value: Some(1999),
        currency: Some("usd".to_string()),
    };
    let result = client
        .track_all("test@example.com", "subscription_created", event)
        .await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_identify_all() {
    let client = AnalyticsClient::noop();
    let mut properties = HashMap::new();
    properties.insert(
        "name".to_string(),
        serde_json::Value::String("Test User".to_string()),
    );
    let result = client.identify_all("test@example.com", properties).await;
    assert!(result.is_ok());
}

#[test]
fn test_subscription_created_event_properties() {
    let team_id = uuid::Uuid::new_v4();
    let event = SubscriptionCreatedEvent {
        subscription_id: "sub_123".to_string(),
        subscription_status: "trialing".to_string(),
        is_team_subscription: true,
        team_id: Some(team_id),
        value: Some(1999),
        currency: Some("usd".to_string()),
    };
    let properties = event.into_properties();

    assert_eq!(
        properties.get("subscription_id"),
        Some(&serde_json::Value::String("sub_123".to_string()))
    );
    assert_eq!(
        properties.get("subscription_status"),
        Some(&serde_json::Value::String("trialing".to_string()))
    );
    assert_eq!(
        properties.get("is_team_subscription"),
        Some(&serde_json::Value::Bool(true))
    );
    assert_eq!(
        properties.get("team_id"),
        Some(&serde_json::Value::String(team_id.to_string()))
    );
    assert_eq!(
        properties.get("value"),
        Some(&serde_json::Value::Number(1999.into()))
    );
    assert_eq!(
        properties.get("currency"),
        Some(&serde_json::Value::String("usd".to_string()))
    );
}

#[test]
fn test_subscription_cancelled_event_properties() {
    let event = SubscriptionCancelledEvent {
        subscription_id: "sub_456".to_string(),
        is_team_subscription: false,
        team_id: None,
        value: None,
        currency: None,
    };
    let properties = event.into_properties();

    assert_eq!(
        properties.get("subscription_id"),
        Some(&serde_json::Value::String("sub_456".to_string()))
    );
    assert_eq!(
        properties.get("is_team_subscription"),
        Some(&serde_json::Value::Bool(false))
    );
    assert!(properties.get("team_id").is_none());
    assert!(properties.get("value").is_none());
    assert!(properties.get("currency").is_none());
}

#[test]
fn test_client_with_posthog_config() {
    let client = AnalyticsClient::new(AnalyticsClientConfig {
        posthog: Some(PostHogConfig {
            api_key: "test_key".to_string(),
            host: None,
        }),
        google_analytics: None,
        meta: None,
    });

    assert!(client.posthog().is_configured());
    assert!(!client.google_analytics().is_configured());
    assert!(!client.meta().is_configured());
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
