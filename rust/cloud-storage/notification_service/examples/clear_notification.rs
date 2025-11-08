use std::collections::HashMap;

use anyhow::Context;
use aws_sdk_sns::types::MessageAttributeValue;
use model_notifications::{APNSPushNotification, PushNotificationData};

/// Sends a notification to the notification queue you have specified in your .env file
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region("us-east-1")
        .load()
        .await;

    let sns_client = sns_client::SNS::new(aws_sdk_sns::Client::new(&aws_config));

    let endpoint_arn = "arn:aws:sns:us-east-1:569036502058:endpoint/APNS/notification-apns-platform-dev/41c55ed7-8a4f-3f48-baf2-0c474b7e10ea";
    let collapse_key = "coll420";
    // send_first(&sns_client, endpoint_arn, collapse_key).await?;
    send_empty(&sns_client, endpoint_arn, collapse_key).await?;

    Ok(())
}

async fn send_first(
    sns_client: &sns_client::SNS,
    endpoint_arn: &str,
    collapse_key: &str,
) -> anyhow::Result<()> {
    let push_notification_data = PushNotificationData {
        notification_entity: model_notifications::NotificationEntity {
            event_item_id: "abc".to_string(),
            event_item_type: "document".parse().unwrap(),
        },
        open_route: "".to_string(),
        sender_id: None,
    };

    let notification_body = serde_json::json!({
        "title": "GO AWAY 2",
        "body": "THIS IS ME TESTING SEND",
    });

    let apns = APNSPushNotification {
        aps: serde_json::json!({
            "alert": notification_body
        }),
        push_notification_data: push_notification_data.clone(),
    };

    let message_json = serde_json::json!({
        "APNS": serde_json::to_string(&apns).unwrap_or_else(|_| serde_json::json!({
            "aps": apns.aps
        }).to_string()),
    });

    let message_attributes = Some(HashMap::from([
        (
            "AWS.SNS.MOBILE.APNS.TOPIC".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value("com.macro.app.dev")
                .build()
                .unwrap(),
        ),
        (
            "AWS.SNS.MOBILE.APNS.PUSH_TYPE".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value("alert")
                .build()
                .unwrap(),
        ),
        (
            "AWS.SNS.MOBILE.APNS.PRIORITY".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value("5") // 5 is normal, 10 is high
                .build()
                .unwrap(),
        ),
        (
            "AWS.SNS.MOBILE.APNS.COLLAPSE_ID".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value(collapse_key)
                .build()
                .unwrap(),
        ),
    ]));

    sns_client
        .push_notification(endpoint_arn, &message_json.to_string(), message_attributes)
        .await
        .context("unable to send push notification")?;

    Ok(())
}

async fn send_empty(
    sns_client: &sns_client::SNS,
    endpoint_arn: &str,
    collapse_key: &str,
) -> anyhow::Result<()> {
    let message_attributes = Some(HashMap::from([
        (
            "AWS.SNS.MOBILE.APNS.TOPIC".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value("com.macro.app.dev")
                .build()
                .unwrap(),
        ),
        (
            "AWS.SNS.MOBILE.APNS.PRIORITY".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value("5") // 5 is normal, 10 is high
                .build()
                .unwrap(),
        ),
        (
            "AWS.SNS.MOBILE.APNS.COLLAPSE_ID".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value(collapse_key)
                .build()
                .unwrap(),
        ),
        (
            "AWS.SNS.MOBILE.APNS.PUSH_TYPE".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value("background")
                .build()
                .unwrap(),
        ),
    ]));

    let apns = serde_json::json!({
        "aps": {
            "content-available": 1,
        },
        "identifier": collapse_key,
    });

    let message_json = serde_json::json!({
        "APNS": serde_json::to_string(&apns).context("could not convert apns to string")?,
    });

    sns_client
        .push_notification(endpoint_arn, &message_json.to_string(), message_attributes)
        .await
        .context("unable to send push notification")?;

    Ok(())
}
