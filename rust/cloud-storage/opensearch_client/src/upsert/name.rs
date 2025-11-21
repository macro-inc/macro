//! This module handles the upserting of entity names into the opensearch index

use models_opensearch::{SearchEntityType, SearchIndex};

use crate::{Result, error::ResponseExt};

/// The arguments for upserting an entity name into the opensearch index
#[derive(Debug, serde::Serialize)]
pub struct UpsertEntityNameArgs {
    /// The entity id
    pub entity_id: String,
    /// The entity name
    pub name: String,
    /// The entity type
    pub entity_type: SearchEntityType,
}

#[tracing::instrument(skip(client), err)]
pub(crate) async fn upsert_entity_name(
    client: &opensearch::OpenSearch,
    args: &UpsertEntityNameArgs,
) -> Result<()> {
    client
        .index(opensearch::IndexParts::IndexId(
            SearchIndex::Names.as_ref(),
            &args.entity_id,
        ))
        .body(args)
        .send()
        .await
        .map_client_error()
        .await?;

    tracing::trace!(id=%args.entity_id, "entity name upserted successfully");

    Ok(())
}
