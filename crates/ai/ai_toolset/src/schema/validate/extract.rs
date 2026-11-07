use super::ValidationError;
use schemars::Schema;
use serde_json::Value;

pub struct Extract {
    key: &'static str,
}

impl Extract {
    pub fn new(key: &'static str) -> Self {
        Self { key }
    }

    pub fn extract(&self, schema: &Schema) -> Result<String, ValidationError> {
        schema
            .get(self.key)
            .and_then(|v| match v {
                Value::String(s) => {
                    if s.is_empty() {
                        None
                    } else {
                        Some(s.to_owned())
                    }
                }
                _ => None,
            })
            .ok_or(ValidationError::MissingMetadata)
    }
}
