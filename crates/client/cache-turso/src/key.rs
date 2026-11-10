use crate::{PhysicalResetReason, TursoStorageError};
use cache_core::value::{EntityKey, ROOT_QUERY};
use std::borrow::Cow;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RecordKey {
    pub(crate) typename: String,
    pub(crate) id: String,
}

impl RecordKey {
    pub(crate) fn from_entity(key: &EntityKey<'_>) -> Result<Self, TursoStorageError> {
        let value = key.as_ref();
        let parsed = if value == ROOT_QUERY {
            Self {
                typename: ROOT_QUERY.to_owned(),
                id: String::new(),
            }
        } else {
            let (typename, id) = value
                .split_once(':')
                .ok_or(TursoStorageError::InvalidInput)?;
            if typename.is_empty() {
                return Err(TursoStorageError::InvalidInput);
            }
            Self {
                typename: typename.to_owned(),
                id: id.to_owned(),
            }
        };
        if parsed.canonical_string()? != value {
            return Err(TursoStorageError::InvalidInput);
        }
        Ok(parsed)
    }

    pub(crate) fn into_entity(self) -> Result<EntityKey<'static>, TursoStorageError> {
        let mut canonical = String::new();
        Self::borrow_entity(&self.typename, &self.id, &mut canonical)?;
        Ok(EntityKey(Cow::Owned(canonical)))
    }

    fn canonical_string(&self) -> Result<String, TursoStorageError> {
        if self.typename.is_empty() {
            return Err(TursoStorageError::InvalidInput);
        }
        if self.typename == ROOT_QUERY && self.id.is_empty() {
            Ok(ROOT_QUERY.to_owned())
        } else {
            Ok(format!("{}:{}", self.typename, self.id))
        }
    }

    /// Checks row components and reuses a caller-owned key buffer while scanning.
    pub(crate) fn borrow_entity<'a>(
        typename: &str,
        id: &str,
        buffer: &'a mut String,
    ) -> Result<EntityKey<'a>, TursoStorageError> {
        // A colon in the typename changes the first component on round-trip.
        if typename.is_empty() || typename.contains(':') {
            return Err(TursoStorageError::reset(PhysicalResetReason::Corruption));
        }
        buffer.clear();
        buffer.push_str(typename);
        if typename != ROOT_QUERY || !id.is_empty() {
            buffer.push(':');
            buffer.push_str(id);
        }
        Ok(EntityKey(Cow::Borrowed(buffer)))
    }
}

#[cfg(test)]
mod test;
