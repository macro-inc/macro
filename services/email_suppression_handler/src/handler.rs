use anyhow::Context;
use aws_lambda_events::event::sns::SnsEvent;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};

use crate::domain::{
    models::{EmailNotification, NotificationType},
    ports::SuppressionService,
};
use std::sync::Arc;

#[tracing::instrument(skip(service, event))]
pub(crate) async fn handler<S: SuppressionService>(
    service: Arc<S>,
    event: LambdaEvent<SnsEvent>,
) -> Result<(), Error> {
    // NOTE: may need to parallelize but at the moment it seems like we only get 1 record per event
    for event in event.payload.records {
        let message = event.sns.message;
        tracing::trace!(message=?message, "processing message");
        if let Err(e) = handle_email_notification(service.as_ref(), &message).await {
            tracing::error!(error=?e, message=?message, "failed to handle email notification");
        }
    }

    Ok(())
}

/// Handles processing an email notification
#[tracing::instrument(skip(service, raw_notification))]
async fn handle_email_notification<S: SuppressionService>(
    service: &S,
    raw_notification: &str,
) -> anyhow::Result<()> {
    let notification: EmailNotification =
        serde_json::from_str(raw_notification).context("failed to deserialize message")?;

    match notification.notification_type {
        NotificationType::Complaint => {
            if let Some(complaint) = notification.complaint {
                service.handle_complaint_notification(&complaint).await
            } else {
                anyhow::bail!("expected complaint notification, got {:?}", notification)
            }
        }
        NotificationType::Bounce => {
            if let Some(bounce) = notification.bounce {
                service.handle_bounce_notification(&bounce).await
            } else {
                anyhow::bail!("expected bounce notification, got {:?}", notification)
            }
        }
    }
}
