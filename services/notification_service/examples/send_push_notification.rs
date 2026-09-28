use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;
use serde::Serialize;
use sns_client::{APNSPushNotification, Alert, AlertDictionary, Aps, MessageAttributes, SnsTarget};

/// Sends a push notification to the provided ENDPOINT_ARN environment variable
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let aws_config = macro_aws_config::get_macro_aws_config().await;

    let sns_client = sns_client::SNS::new(aws_sdk_sns::Client::new(&aws_config));

    let endpoint_arn = std::env::var("ENDPOINT_ARN").context("missing ENDPOINT_ARN")?;
    let collapse_key = "collapse";

    // Sends the first push notification
    send_first(&sns_client, &endpoint_arn, collapse_key.to_string()).await?;

    // Sends an empty push notification with the same collapse key.
    // this will remove the notification from the device.
    send_empty(&sns_client, &endpoint_arn, collapse_key.to_string()).await?;

    Ok(())
}

async fn send_first(
    sns_client: &sns_client::SNS,
    endpoint_arn: &str,
    collapse_key: String,
) -> anyhow::Result<()> {
    let apns = SnsTarget::Ios(Box::new(APNSPushNotification {
        aps: Aps {
            alert: Some(Alert::Dictionary(AlertDictionary {
                title: Some("GO AWAY 2".to_string()),
                body: Some("TESTING".to_string()),
                ..Default::default()
            })),
            ..Default::default()
        },
        push_notification_data: &(),
    }));

    sns_client
        .push_notification(
            endpoint_arn,
            &apns,
            MessageAttributes {
                push_type: sns_client::PushType::Alert,
                apns_bundle_id: "com.macro.app.prod",
                collapse_key,
            },
        )
        .await
        .context("unable to send push notification")?;

    Ok(())
}

async fn send_empty(
    sns_client: &sns_client::SNS,
    endpoint_arn: &str,
    collapse_key: String,
) -> anyhow::Result<()> {
    #[derive(Debug, Serialize)]
    struct ExtraData {
        identifier: String,
    }

    let apns = SnsTarget::Ios(Box::new(APNSPushNotification {
        aps: Aps {
            content_available: Some(1),
            ..Default::default()
        },
        push_notification_data: ExtraData {
            identifier: collapse_key.to_string(),
        },
    }));

    sns_client
        .push_notification(
            endpoint_arn,
            &apns,
            MessageAttributes {
                push_type: sns_client::PushType::Alert,
                apns_bundle_id: "com.macro.app.prod",
                collapse_key,
            },
        )
        .await
        .context("unable to send push notification")?;

    Ok(())
}
