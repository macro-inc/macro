use channels::outbound::channel_name::batch_resolve_channel_names;
use indexmap::IndexMap;
use item_filters::CallStatus;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::{EntityReference, EntityType};
use models_search::call_record::{
    CallRecordMetadata, CallRecordSearchResponseItem, CallRecordSearchResponseItemWithMetadata,
    CallRecordSearchResult,
};
use models_soup::SoupProperty;
use opensearch_client::search::model::{SearchGotoContent, SearchHit};
use sqlx::types::Uuid;
use std::collections::HashMap;

use crate::api::context::SearchHandlerState;
use crate::api::search::simple::SearchError;

#[tracing::instrument(skip(ctx, results), err)]
pub(in crate::api::search) async fn enrich_call_records(
    ctx: &SearchHandlerState,
    user_id: &str,
    results: Vec<SearchHit>,
) -> Result<Vec<CallRecordSearchResponseItemWithMetadata>, SearchError> {
    let results: Vec<SearchHit> = results
        .into_iter()
        .filter(|r| r.entity_type == models_opensearch::SearchEntityType::CallRecords)
        .collect();

    if results.is_empty() {
        return Ok(vec![]);
    }

    // Dedup — many segments map to the same call.
    let mut seen: std::collections::HashSet<Uuid> = std::collections::HashSet::new();
    let call_ids: Vec<Uuid> = results
        .iter()
        .filter_map(|r| seen.insert(r.entity_id).then_some(r.entity_id))
        .collect();

    let metadata_rows =
        macro_db_client::call_record::get::get_call_records_metadata(&ctx.db, user_id, &call_ids)
            .await
            .map_err(SearchError::InternalError)?;

    let viewer_user_id = MacroUserIdStr::parse_from_str(user_id)
        .map_err(|_| SearchError::InvalidUserId(user_id.to_string()))?;
    let unique_channel_ids: Vec<Uuid> = {
        let mut seen: std::collections::HashSet<Uuid> = std::collections::HashSet::new();
        metadata_rows
            .iter()
            .filter_map(|r| seen.insert(r.channel_id).then_some(r.channel_id))
            .collect()
    };
    let channel_names_by_id =
        batch_resolve_channel_names(&ctx.db, &unique_channel_ids, viewer_user_id)
            .await
            .map_err(|e| SearchError::InternalError(e.into()))?;

    let mut custom_name_by_id: std::collections::HashMap<Uuid, Option<String>> =
        std::collections::HashMap::new();
    let metadata_by_id: std::collections::HashMap<Uuid, CallRecordMetadata> = metadata_rows
        .into_iter()
        .map(|row| {
            let status = parse_call_status(&row.status)?;
            custom_name_by_id.insert(row.call_id, row.custom_name);
            let channel_name = channel_names_by_id.get(&row.channel_id).cloned();
            Ok((
                row.call_id,
                CallRecordMetadata {
                    created_by: row.created_by,
                    started_at: row.started_at,
                    ended_at: row.ended_at,
                    duration_ms: row.duration_ms,
                    updated_at: row.ended_at,
                    channel_name,
                    status,
                    attended: row.attended,
                },
            ))
        })
        .collect::<Result<_, SearchError>>()?;

    let mut hits_by_call_id: IndexMap<Uuid, Vec<CallRecordSearchResult>> = IndexMap::new();
    let mut call_context: std::collections::HashMap<Uuid, (Uuid, Vec<String>)> =
        std::collections::HashMap::new();

    for hit in results {
        let goto = match hit.goto.clone() {
            Some(SearchGotoContent::CallRecords(goto)) => Some(goto),
            _ => None,
        };

        if let Some(g) = &goto {
            call_context
                .entry(hit.entity_id)
                .or_insert_with(|| (g.channel_id, g.participant_ids.clone()));
        }

        hits_by_call_id
            .entry(hit.entity_id)
            .or_default()
            .push(CallRecordSearchResult {
                transcript_id: goto.as_ref().map(|g| g.transcript_id),
                speaker_id: goto.as_ref().map(|g| g.speaker_id.clone()),
                sequence_num: goto.as_ref().map(|g| g.sequence_num),
                started_at: goto.as_ref().map(|g| g.started_at),
                ended_at: goto.as_ref().and_then(|g| g.ended_at),
                highlight: hit.highlight.into(),
                score: hit.score,
            });
    }

    // Fetch call properties (e.g. tags) so rows can render and re-check them,
    // mirroring the documents/emails/chats enrichment.
    let call_entity_refs: Vec<EntityReference> = call_ids
        .iter()
        .map(|id| EntityReference::new(id.to_string(), EntityType::CallRecord))
        .collect();
    let properties_map: HashMap<String, Vec<SoupProperty>> =
        properties::outbound::entity_properties_get_query::get_bulk_entity_properties_values(
            &ctx.db,
            &call_entity_refs,
        )
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to fetch call record properties"))
        .unwrap_or_default()
        .into_iter()
        .map(|(id, props)| {
            (
                id,
                props
                    .into_iter()
                    .map(SoupProperty::from)
                    .collect::<Vec<_>>(),
            )
        })
        .collect();

    let result = hits_by_call_id
        .into_iter()
        .map(|(call_id, mut hits)| {
            hits.sort_by_key(|h| h.sequence_num.unwrap_or(i32::MAX));

            let (channel_id, participant_ids) = call_context
                .get(&call_id)
                .cloned()
                .expect("CallRecords hit missing SearchGotoCallRecord");
            let metadata = metadata_by_id.get(&call_id).cloned();
            let properties = properties_map
                .get(&call_id.to_string())
                .cloned()
                .filter(|p| !p.is_empty());

            CallRecordSearchResponseItemWithMetadata {
                extra: CallRecordSearchResponseItem {
                    id: call_id,
                    name: custom_name_by_id.get(&call_id).cloned().flatten(),
                    owner_id: metadata
                        .as_ref()
                        .map(|m| m.created_by.clone())
                        .unwrap_or_default(),
                    call_id,
                    channel_id,
                    participant_ids,
                    call_search_results: hits,
                },
                metadata,
                properties,
            }
        })
        .collect();

    Ok(result)
}

fn parse_call_status(status: &str) -> Result<CallStatus, SearchError> {
    match status {
        "ATTENDED" => Ok(CallStatus::Attended),
        "MISSED" => Ok(CallStatus::Missed),
        "UNATTENDED" => Ok(CallStatus::Unattended),
        _ => Err(SearchError::InternalError(anyhow::anyhow!(
            "unexpected call status: {status}"
        ))),
    }
}
