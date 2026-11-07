use schemars::Schema;

use super::Validate;
use crate::schema::error::ValidationError;

/// Rejects schemas containing `oneOf`, which is not supported by OpenAI
/// structured outputs.
pub struct ValidateNoOneOf;

impl Validate for ValidateNoOneOf {
    fn validate(&self, schema: &Schema) -> Result<(), ValidationError> {
        if schema.get("oneOf").is_some() {
            return Err(ValidationError::OneOf);
        }

        Ok(())
    }
}
