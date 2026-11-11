//! Retryable publication of backfills requested by explicit CRM consent.

use email_types::email::service::backfill::{
    BackfillOperation, BackfillPubsubMessage, PopulateCrmForUserPayload,
};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use sqs_client::SQS;
use tracing::Instrument;

pub(super) async fn drain(db: &PgPool, sqs: &SQS) -> anyhow::Result<()> {
    for _ in 0..super::BATCH_SIZE {
        let mut tx = db.begin().await?;
        let Some(row) = sqlx::query!(
            r#"SELECT o.team_id, o.user_id, o.traceparent FROM crm_email_backfill_outbox o
               ORDER BY o.requested_at, o.team_id, o.user_id
               FOR UPDATE OF o SKIP LOCKED LIMIT 1"#
        )
        .fetch_optional(&mut *tx)
        .await?
        else {
            break;
        };
        let publish_span =
            tracing::info_span!("crm.email_backfill.publish", team_id = %row.team_id);
        traceparent::adopt(&publish_span, row.traceparent.as_deref());
        async {
        let enabled = sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM crm_email_consent c
               JOIN email_links l ON l.id = c.link_id AND l.macro_id = c.user_id AND l.is_primary AND l.deleting_at IS NULL
               WHERE c.team_id = $1 AND c.user_id = $2 AND c.enabled) AS "enabled!""#,
            row.team_id,
            row.user_id
        )
        .fetch_one(&mut *tx)
        .await?;
        if enabled {
            sqs.enqueue_email_backfill_message(BackfillPubsubMessage {
                backfill_operation: BackfillOperation::PopulateCrmForUser(
                    PopulateCrmForUserPayload {
                        macro_id: MacroUserIdStr::try_from(row.user_id.clone())?,
                    },
                ),
            })
            .await?;
        }
        sqlx::query!(
            "DELETE FROM crm_email_backfill_outbox WHERE team_id = $1 AND user_id = $2",
            row.team_id,
            row.user_id
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        anyhow::Ok(())
        }.instrument(publish_span).await?;
    }
    Ok(())
}

#[cfg(test)]
mod test;
