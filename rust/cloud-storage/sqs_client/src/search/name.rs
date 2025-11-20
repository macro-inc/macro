/// Tells you the entity type that we are inserting the name for
/// These values map directly to the names of the opensearch indices
/// Projects is excluded because it handles names on its own
#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum NameEntityType {
    Channels,
    Chats,
    Documents,
    Emails,
}

/// Update entity name message
/// Sent to SPS via a queue for processing to update the names index with the new name
/// of the entity
#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct UpdateEntityName {
    pub entity_id: String,
    pub entity_type: NameEntityType,
}
