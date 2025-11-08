use std::collections::HashMap;

use anyhow::Context;
use aws_sdk_sns::types::MessageAttributeValue;

/// Sends a notification to the notification queue you have specified in your .env file
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region("us-east-1")
        .load()
        .await;
    let sns_client = sns_client::SNS::new(aws_sdk_sns::Client::new(&aws_config));

    let message = r#"{"GCM": "{\"fcmV1Message\": {\"message\":{\"notification\":{\"title\":\"string\",\"body\":\"string\"},\"android\":{\"priority\":\"high\",\"notification\":{\"title\":\"string\",\"body\":\"string\"},\"data\":{\"customAndroidDataKey\":\"custom key value\"},\"ttl\":\"0s\"},\"apns\":{\"payload\":{\"aps\":{\"alert\":{\"title\":\"string\", \"body\":\"string\"},\"content-available\":1,\"badge\":5}}},\"webpush\":{\"notification\":{\"badge\":\"URL\",\"body\":\"Test\"},\"data\":{\"customWebpushDataKey\":\"priority message\"}},\"data\":{\"customGeneralDataKey\":\"priority message\"}}}}", "default": "{\"notification\": {\"title\": \"test\"}"}"#;

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
    ]));

    // Device endpoint
    // 'eNj_moR-S16rTRdA3I1fFk:APA91bGtw7lg5gvQaDwBr4ScJDZylMWMr-PKOc69JyH7067f3rJpfgoEJZwT6ofUPdi-4zi9z5TdUrGusXf1Boh0D3OlGGYBq7OwGodMge6M9MoS6efA2hs'
    // device token 'arn:aws:sns:us-east-1:569036502058:endpoint/GCM/notification-fcm-platform-dev/3642a753-6b55-3365-87b9-d324172a9a96'
    let result = sns_client.push_notification(
        "arn:aws:sns:us-east-1:569036502058:endpoint/GCM/notification-fcm-platform-dev/39d9a456-e881-3513-86ac-5f3e89011624",
            message,
        message_attributes,
    ).await.context("unable to send push notification")?;

    println!("{:?}", result);

    Ok(())
}
