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
        let canonical = self.canonical_string_from_row()?;
        let reparsed = Self::from_entity(&EntityKey(Cow::Borrowed(&canonical)))
            .map_err(|_| TursoStorageError::reset(PhysicalResetReason::Corruption))?;
        if reparsed != self {
            return Err(TursoStorageError::reset(PhysicalResetReason::Corruption));
        }
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

    fn canonical_string_from_row(&self) -> Result<String, TursoStorageError> {
        self.canonical_string()
            .map_err(|_| TursoStorageError::reset(PhysicalResetReason::Corruption))
    }
}

#[cfg(test)]
mod test;
