use crate::{Result, error::ResponseExt};
use models_opensearch::{SearchEntityType, SearchIndex};

/// Deletes all name documents with the specified entity_id and entity_type
#[tracing::instrument(skip(client))]
pub async fn delete_entity_name(
    client: &opensearch::OpenSearch,
    entity_id: &str,
    entity_type: &SearchEntityType,
) -> Result<()> {
    let query = serde_json::json!({
        "query": {
            "bool": {
                "must": [
                    {
                        "term": {
                            "entity_id": entity_id
                        }
                    },
                    {
                        "term": {
                            "entity_type": entity_type.as_ref()
                        }
                    }
                ]
            }
        }
    });

    client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[
            SearchIndex::Names.as_ref()
        ]))
        .body(query)
        .refresh(true) // Ensure the index reflects changes immediately
        .send()
        .await
        .map_client_error()
        .await?;

    Ok(())
}

