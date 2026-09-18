use crate::context::{self};
use aws_lambda_events::eventbridge::EventBridgeEvent;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};
use models_email::service::pubsub::ScheduledPubsubMessage;
use sqlx::PgPool;

#[tracing::instrument(skip(ctx, _event))]
pub async fn handler(
    ctx: context::Context,
    _event: LambdaEvent<EventBridgeEvent>,
) -> Result<(), Error> {
    // grab all drafts with passed send_time that have not been sent already
    let notifications = fetch_pending_scheduled_messages(&ctx.db)
        .await
        .unwrap_or_else(|e| {
            tracing::error!(error=?e, "Error fetching scheduled messages");
            Vec::new()
        });

    if !notifications.is_empty() {
        tracing::info!(notifications = ?notifications, "Sending scheduled email pubsub messages");
    }

    for pending in notifications.into_iter() {
        let message_id = pending.message_id;
        let link_id = pending.link_id;

        // A stranded row means the send path committed the message but failed
        // to enqueue it and failed to revert it, so this sweep is the only
        // reason the mail goes out at all. Warn so the underlying failure is
        // visible instead of being quietly papered over.
        if pending.stranded {
            tracing::warn!(
                link_id = link_id.to_string(),
                message_id = message_id.to_string(),
                "Re-enqueueing a send whose original enqueue never landed",
            );
        }

        if let Err(e) = ctx
            .sqs_client
            .enqueue_email_scheduled_message(pending.into(), None)
            .await
        {
            tracing::error!(
                error = ?e,
                link_id = link_id.to_string(),
                message_id = message_id.to_string(),
                "Error enqueueing scheduled notification",
            );
        };
    }

    Ok(())
}

/// How long past its `send_time` a non-draft scheduled row must sit before the
/// sweep treats it as stranded rather than in flight.
///
/// The undo-window send path (`email`'s `send_message_impl`) inserts its
/// message as a non-draft and puts the queue message on a short delay, so such
/// a row is normally delivered seconds after its `send_time`. The grace period
/// has to clear that delay plus the scheduled queue's whole redelivery cycle
/// (five receives at a 30s visibility timeout) so a rescue can never race a
/// delivery that is still coming and double-send the message.
const STRANDED_SEND_GRACE_SECS: f64 = 300.0;

/// An overdue scheduled send, plus how it reached this sweep.
#[derive(Debug)]
pub struct PendingScheduledSend {
    pub link_id: sqlx::types::Uuid,
    pub message_id: sqlx::types::Uuid,
    /// `true` for an undo-window send this sweep is rescuing, `false` for an
    /// ordinary send-later draft whose delivery this sweep always owned.
    pub stranded: bool,
}

impl From<PendingScheduledSend> for ScheduledPubsubMessage {
    fn from(pending: PendingScheduledSend) -> Self {
        ScheduledPubsubMessage {
            link_id: pending.link_id,
            message_id: pending.message_id,
        }
    }
}

/// Fetches all scheduled messages that are ready to be sent.
///
/// Returns rows whose `send_time` has passed and that neither the scheduled
/// table (`esm.sent`) nor the message itself (`em.is_sent`) records as sent,
/// in two shapes:
/// - send-later drafts (`em.is_draft = TRUE`), for which this sweep is the
///   only thing that ever enqueues a delivery;
/// - undo-window sends (`em.is_draft = FALSE`), which enqueue their own
///   delivery at send time and so are only picked up once they are
///   [`STRANDED_SEND_GRACE_SECS`] overdue and unclaimed (`processing = FALSE`)
///   — the signature of a send whose enqueue never landed.
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_pending_scheduled_messages(
    pool: &PgPool,
) -> anyhow::Result<Vec<PendingScheduledSend>> {
    let messages = sqlx::query_as!(
        PendingScheduledSend,
        r#"
        SELECT
            esm.link_id,
            esm.message_id,
            NOT em.is_draft AS "stranded!"
        FROM email_scheduled_messages esm
        JOIN email_messages em ON em.id = esm.message_id
        WHERE
            esm.send_time < now()
            AND esm.sent = FALSE
            AND em.is_sent = FALSE
            AND (
                em.is_draft = TRUE
                OR (
                    esm.processing = FALSE
                    AND esm.send_time < now() - make_interval(secs => $1)
                )
            )
        "#,
        STRANDED_SEND_GRACE_SECS,
    )
    .fetch_all(pool)
    .await?;

    Ok(messages)
}
