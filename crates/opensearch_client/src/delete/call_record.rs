use models_opensearch::SearchIndex;

use crate::{
    Result,
    error::OpensearchOperation,
    upsert::call_record::{CHILD_RELATION, PARENT_RELATION},
};

#[tracing::instrument(skip(client))]
pub async fn delete_call_record_by_id(
    client: &opensearch::OpenSearch,
    call_id: &str,
    index_override: Option<&str>,
) -> Result<()> {
    // Segments carry their own id in `entity_id`, so they are matched by
    // their parent; `parent_id` still finds them if a retry runs after the
    // call itself is gone.
    super::by_query::delete_matching(
        client,
        index_override.unwrap_or(SearchIndex::CallRecords.as_ref()),
        serde_json::json!({ "bool": { "should": [
            { "term": { "entity_id": call_id } },
            { "parent_id": { "type": CHILD_RELATION, "id": call_id } }
        ] } }),
        OpensearchOperation::DeleteCallRecordById,
    )
    .await
}

#[tracing::instrument(skip(client))]
pub async fn delete_call_records_by_channel_id(
    client: &opensearch::OpenSearch,
    channel_id: &str,
    index_override: Option<&str>,
) -> Result<()> {
    let index = index_override.unwrap_or(SearchIndex::CallRecords.as_ref());
    let in_channel = serde_json::json!({ "term": { "channel_id": channel_id } });
    // Segments carry no `channel_id`, so they are matched by their call's,
    // and go first: once a call is gone nothing finds its segments.
    super::by_query::delete_matching(
        client,
        index,
        serde_json::json!({ "has_parent": { "parent_type": PARENT_RELATION, "query": in_channel } }),
        OpensearchOperation::DeleteCallRecordsByChannelId,
    )
    .await?;
    super::by_query::delete_matching(
        client,
        index,
        in_channel,
        OpensearchOperation::DeleteCallRecordsByChannelId,
    )
    .await
}

#[cfg(test)]
mod test;
