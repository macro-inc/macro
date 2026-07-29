use anyhow::Context;
use models_properties::EntityType;
use opensearch_client::{
    OpensearchClient, date_format::EpochMillis, upsert::call_record::UpsertCallRecordSegmentArgs,
};
use properties::outbound::entity_properties_get_query::get_entity_properties_for_index;
use sqlx::PgPool;
use uuid::Uuid;

use crate::process::properties::to_indexed_properties;

#[tracing::instrument(skip(opensearch_client, db), err)]
pub async fn process_call_record(
    opensearch_client: &OpensearchClient,
    db: &PgPool,
    call_id: Uuid,
    index_override: Option<&str>,
) -> anyhow::Result<()> {
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

    // The searchable call name is the caller-assigned custom name, falling
    // back to the owning channel's name.
    let name = payload
        .custom_name
        .clone()
        .or_else(|| payload.channel_name.clone());

    // The parent doc is a full overwrite, so its properties must ride every
    // write or values set by the property-update path get wiped. A fetch
    // failure propagates (retry) rather than being mistaken for "empty".
    let properties = to_indexed_properties(
        get_entity_properties_for_index(db, &call_id_s, EntityType::CallRecord)
            .await
            .context("failed to fetch call record properties for search index")?,
    );

    let segments: Vec<UpsertCallRecordSegmentArgs> = payload
        .segments
        .into_iter()
        .map(|seg| {
            let ended_at_millis = seg
                .ended_at
                .map(|dt| EpochMillis::new(dt.timestamp_millis()))
                .transpose()?;
            Ok::<_, anyhow::Error>(UpsertCallRecordSegmentArgs {
                call_id: call_id_s.clone(),
                transcript_id: seg.transcript_id.to_string(),
                channel_id: channel_id_s.clone(),
                participant_ids: payload.participant_ids.clone(),
                channel_name: payload.channel_name.clone(),
                name: name.clone(),
                speaker_id: seg.speaker_id,
                sequence_num: seg.sequence_num,
                content: seg.content,
                started_at_millis: EpochMillis::new(seg.started_at.timestamp_millis())?,
                ended_at_millis,
                properties: properties.clone(),
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    let result = opensearch_client
        .bulk_upsert_call_record_segments(&segments, index_override)
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
    channel_id: Uuid,
    call_id: Option<Uuid>,
    index_override: Option<&str>,
) -> anyhow::Result<()> {
    if let Some(call_id) = call_id {
        let call_id = call_id.to_string();
        opensearch_client
            .delete_call_record(&call_id, index_override)
            .await?;
    } else {
        let channel_id = channel_id.to_string();
        opensearch_client
            .delete_call_records_by_channel(&channel_id, index_override)
            .await?;
    }
    Ok(())
}
