use anyhow::Context;
use opensearch_client::{
    OpensearchClient, date_format::EpochSeconds, upsert::call_record::UpsertCallRecordSegmentArgs,
};
use sqlx::PgPool;
use sqs_client::search::call::{CallRecordMessage, RemoveCallRecord};
use uuid::Uuid;

#[tracing::instrument(skip(opensearch_client, db), err)]
pub async fn process_call_record(
    opensearch_client: &OpensearchClient,
    db: &PgPool,
    message: &CallRecordMessage,
) -> anyhow::Result<()> {
    let call_id: Uuid = message
        .call_id
        .parse()
        .context("failed to parse call_id as UUID")?;

    let Some(payload) =
        macro_db_client::call_record::get::get_call_record_search_payload(db, &call_id).await?
    else {
        tracing::debug!(call_id = %call_id, "call record no longer exists; skipping");
        return Ok(());
    };

    if payload.segments.is_empty() {
        tracing::debug!(call_id = %call_id, "call has no transcript segments to index");
        return Ok(());
    }

    let call_id_s = payload.call_id.to_string();
    let channel_id_s = payload.channel_id.to_string();

    let segments: Vec<UpsertCallRecordSegmentArgs> = payload
        .segments
        .into_iter()
        .map(|seg| {
            let ended_at_seconds = seg
                .ended_at
                .map(|dt| EpochSeconds::new(dt.timestamp()))
                .transpose()?;
            Ok::<_, anyhow::Error>(UpsertCallRecordSegmentArgs {
                call_id: call_id_s.clone(),
                transcript_id: seg.transcript_id.to_string(),
                channel_id: channel_id_s.clone(),
                participant_ids: payload.participant_ids.clone(),
                channel_name: payload.channel_name.clone(),
                speaker_id: seg.speaker_id,
                sequence_num: seg.sequence_num,
                content: seg.content,
                started_at_seconds: EpochSeconds::new(seg.started_at.timestamp())?,
                ended_at_seconds,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    let result = opensearch_client
        .bulk_upsert_call_record_segments(&segments, message.index_override.as_deref())
        .await
        .context("failed to bulk upsert call record segments")?;

    if result.failed > 0 {
        tracing::warn!(
            failed = result.failed,
            errors = ?result.errors,
            call_id = %call_id,
            "some call-record segments failed to upsert"
        );
    }

    Ok(())
}

#[tracing::instrument(skip(opensearch_client), err)]
pub async fn process_remove_call_record(
    opensearch_client: &OpensearchClient,
    message: &RemoveCallRecord,
) -> anyhow::Result<()> {
    let index_override = message.index_override.as_deref();
    if let Some(call_id) = &message.call_id {
        opensearch_client
            .delete_call_record(call_id, index_override)
            .await?;
    } else {
        opensearch_client
            .delete_call_records_by_channel(&message.channel_id, index_override)
            .await?;
    }
    Ok(())
}
