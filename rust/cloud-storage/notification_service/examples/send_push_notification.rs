use std::collections::HashMap;

use anyhow::Context;
use aws_sdk_sns::types::MessageAttributeValue;
use macro_entrypoint::MacroEntrypoint;
use model_notifications::{APNSPushNotification, PushNotificationData};

/// Sends a push notification to the provided ENDPOINT_ARN environment variable
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region("us-east-1")
        .load()
        .await;

    let sns_client = sns_client::SNS::new(aws_sdk_sns::Client::new(&aws_config));

    let endpoint_arn = std::env::var("ENDPOINT_ARN").context("missing ENDPOINT_ARN")?;
    let collapse_key = "collapse";

    // Sends the first push notification
    send_first(&sns_client, &endpoint_arn, collapse_key).await?;

    // Sends an empty push notification with the same collapse key.
    // this will remove the notification from the device.
    send_empty(&sns_client, &endpoint_arn, collapse_key).await?;

    Ok(())
}

fn message_attributes(collapse_key: &str) -> Option<HashMap<String, MessageAttributeValue>> {
    Some(HashMap::from([
        (
            "AWS.SNS.MOBILE.APNS.TOPIC".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value("com.macro.app.prod") // SAFETY: this is not a secret
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
    ]))
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

    sns_client
        .push_notification(
            endpoint_arn,
            &message_json.to_string(),
            message_attributes(collapse_key),
        )
        .await
        .context("unable to send push notification")?;

    Ok(())
}

async fn send_empty(
    sns_client: &sns_client::SNS,
    endpoint_arn: &str,
    collapse_key: &str,
) -> anyhow::Result<()> {
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
        .push_notification(
            endpoint_arn,
            &message_json.to_string(),
            message_attributes(collapse_key),
        )
        .await
        .context("unable to send push notification")?;

    Ok(())
}
