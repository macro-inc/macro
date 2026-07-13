use schemars::Schema;
use schemars::transform::{RecursiveTransform, Transform};

use super::Validate;
use crate::schema::error::ValidationError;

#[cfg(test)]
mod test;

/// Applies the contained [`Validate`] to a schema and all of its subschemas,
/// visiting each node before its children and returning the first error.
///
/// The counterpart of schemars' [`RecursiveTransform`] for validators.
/// Traversal is delegated to [`RecursiveTransform`] itself; validation stays
/// read-only — the internal clone exists only because [`Transform`] requires
/// `&mut` access.
pub struct RecursiveValidate<V>(pub V);

impl<V: Validate> Validate for RecursiveValidate<V> {
    fn validate(&self, schema: &Schema) -> Result<(), ValidationError> {
        let mut walker = RecursiveTransform(Walker {
            validator: &self.0,
            error: None,
        });
        walker.transform(&mut schema.clone());
        match walker.0.error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

// Adapts a read-only `Validate` to schemars' infallible `Transform` so
// `RecursiveTransform` can drive the traversal: the first error is stashed
// and every node after it is skipped.
struct Walker<'a, V: ?Sized> {
    validator: &'a V,
    error: Option<ValidationError>,
}

impl<V: Validate + ?Sized> Transform for Walker<'_, V> {
    fn transform(&mut self, schema: &mut Schema) {
        if self.error.is_some() {
            return;
        }
        if let Err(error) = self.validator.validate(schema) {
            self.error = Some(error);
        }
    }
}
