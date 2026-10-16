//! Fragment-rooted relation recipes avoid discovering an entity through cached pages.

use super::{
    LinkPatchError, OptimisticLinkPatch, ResolvedTarget, resolve_from_record, validate_entity_key,
};
use crate::document::Document;
use crate::record_selection::RecordSelection;
use crate::value::{EntityKey, Record};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// A generated fragment applied to one explicit normalized entity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordRoot {
    /// Named fragment in the recipe's document.
    pub fragment_name: String,
    /// Exact parent identity; never inferred by enumerating cached queries.
    pub entity_key: EntityKey<'static>,
}

impl RecordRoot {
    pub(super) fn validate(
        &self,
        schema: &crate::meta::Schema,
        patch: &OptimisticLinkPatch,
    ) -> Result<(), LinkPatchError> {
        validate_entity_key(self.entity_key.borrowed())?;
        if patch.operation_name.is_some()
            || serde_json::from_str::<Value>(&patch.variables_json).map_err(invalid)?
                != Value::Object(serde_json::Map::new())
        {
            return Err(invalid(
                "record-rooted patches cannot bind operation variables",
            ));
        }
        let document = Document::parse(&patch.query).map_err(invalid)?;
        if !document.operations.is_empty() {
            return Err(invalid(
                "record-rooted patches require a fragment-only document",
            ));
        }
        let selection =
            RecordSelection::parse(schema, &patch.query, &self.fragment_name).map_err(invalid)?;
        if !selection
            .type_names()
            .iter()
            .any(|name| name == self.type_name())
        {
            return Err(invalid(
                "record key type does not match the selected fragment",
            ));
        }
        Ok(())
    }

    pub(super) fn resolve(
        &self,
        schema: &crate::meta::Schema,
        effective: &HashMap<EntityKey<'static>, Record>,
        patch: &OptimisticLinkPatch,
    ) -> Result<ResolvedTarget, LinkPatchError> {
        let selection =
            RecordSelection::parse(schema, &patch.query, &self.fragment_name).map_err(invalid)?;
        if let Some(typename) = effective.get(&self.entity_key).and_then(Record::typename)
            && typename != self.type_name()
        {
            return Err(invalid("cached record type does not match its key"));
        }
        resolve_from_record(
            schema,
            effective,
            &self.entity_key,
            self.type_name(),
            selection.selection_set(),
            &serde_json::Map::new(),
            &patch.path,
            &patch.operation,
        )
    }

    fn type_name(&self) -> &str {
        self.entity_key
            .as_ref()
            .split_once(':')
            .map_or("", |(name, _)| name)
    }
}

fn invalid(error: impl std::fmt::Display) -> LinkPatchError {
    LinkPatchError::InvalidEntrypoint(error.to_string())
}

#[cfg(test)]
mod test;
