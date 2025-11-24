use models_opensearch::SearchEntityType;

/// Update entity name message
/// Sent to SPS via a queue for processing to update the names index with the new name
/// of the entity
#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct EntityName {
    pub entity_id: uuid::Uuid,
    pub entity_type: SearchEntityType,
}
