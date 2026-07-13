use crate::domain::{StreamId, StreamServiceError};
use model_entity::EntityType;
use std::str::FromStr;

impl From<redis::RedisError> for StreamServiceError {
    fn from(value: redis::RedisError) -> Self {
        Self::StorageError(value.to_string())
    }
}

impl std::fmt::Display for StreamId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}:{}:{}",
            self.entity_type, self.entity_id, self.stream_id
        )
    }
}

impl TryFrom<String> for StreamId {
    type Error = StreamServiceError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        let err = || StreamServiceError::StorageError("Invalid key.".into());
        let (entity_type_str, rest) = value.split_once(':').ok_or_else(err)?;
        let last_colon = rest.rfind(':').ok_or_else(err)?;
        let (entity_id, stream_id) = rest.split_at(last_colon);
        let stream_id = stream_id.trim_start_matches(':');
        let entity_type = EntityType::from_str(entity_type_str).map_err(|_| err())?;
        Ok(StreamId {
            entity_type,
            entity_id: entity_id.to_string(),
            stream_id: stream_id.to_string(),
        })
    }
}
