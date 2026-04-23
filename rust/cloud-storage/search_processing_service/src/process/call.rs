use anyhow::Context;
use opensearch_client::{
    OpensearchClient, date_format::EpochSeconds, upsert::call_record::UpsertCallRecordSegmentArgs,
};
use sqlx::PgPool;
use sqs_client::search::call::{CallRecordMessage, RemoveCallRecord};
use uuid::Uuid;

/// Upserts a call record into OpenSearch by fanning out one doc per
/// transcript segment. All segments share the call id as `entity_id` so hits
/// can be grouped and access-scoped by call.
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

    // Clear any stale segment docs for this call so renamed/removed segments
    // don't linger after a re-index.
    opensearch_client
        .delete_call_record(&payload.call_id.to_string())
        .await
        .context("failed to clear stale call record segments before upsert")?;

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
        .bulk_upsert_call_record_segments(&segments)
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

/// Removes a call record (or every record for a channel) from OpenSearch.
/// Both paths delete every segment doc via `delete_by_query`.
#[tracing::instrument(skip(opensearch_client), err)]
pub async fn process_remove_call_record(
    opensearch_client: &OpensearchClient,
    message: &RemoveCallRecord,
) -> anyhow::Result<()> {
    if let Some(call_id) = &message.call_id {
        opensearch_client.delete_call_record(call_id).await?;
    } else {
        opensearch_client
            .delete_call_records_by_channel(&message.channel_id)
            .await?;
    }
    Ok(())
}
