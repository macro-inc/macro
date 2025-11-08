use crate::context::{self};
use aws_lambda_events::eventbridge::EventBridgeEvent;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};
use models_email::service::pubsub::ScheduledPubsubMessage;

#[tracing::instrument(skip(ctx, _event))]
pub async fn handler(
    ctx: context::Context,
    _event: LambdaEvent<EventBridgeEvent>,
) -> Result<(), Error> {
    // grab all messages with passed send_time that have not been sent already
    let notifications = sqlx::query_as!(
        ScheduledPubsubMessage,
        r#"
        SELECT
            link_id, message_id
        FROM email_scheduled_messages
        WHERE
            send_time < now()
            AND sent = FALSE
        "#,
    )
    .fetch_all(&ctx.db)
    .await
    .unwrap_or_else(|e| {
        tracing::error!("Error fetching scheduled messages: {}", e);
        Vec::new()
    });

    if !notifications.is_empty() {
        tracing::info!(notifications = ?notifications, "Sending scheduled email pubsub messages");
    }

    for notif in notifications.into_iter() {
        let message_id = notif.message_id;
        let link_id = notif.link_id;
        if let Err(e) = ctx.sqs_client.enqueue_email_scheduled_message(notif).await {
            tracing::error!(
                error = ?e,
                link_id = link_id.to_string(),
                message_id = message_id.to_string(),
                "Error enqueueing refresh notification",
            );
        };
    }

    Ok(())
}
