//! Response-path bindings compiled by the schema-aware read, never from IDs
//! guessed out of response JSON. Relationship changes require a fresh read.

use super::*;
use crate::engine::live_query::{LiveFieldPatch, ResponsePathSegment};
use std::collections::BTreeMap;

#[derive(Default)]
pub(crate) struct QueryProjection {
    pub records: BTreeMap<EntityKey<'static>, BTreeMap<String, FieldProjection>>,
}

pub(crate) struct FieldProjection {
    value: Option<CacheValue>,
    paths: Vec<Vec<ResponsePathSegment>>,
    structural: bool,
}

impl QueryProjection {
    // Conservative accounting includes tree/map/path allocations as well as data.
    pub(crate) fn retained_bytes(&self) -> usize {
        self.records
            .iter()
            .map(|(key, fields)| {
                key.as_ref().len()
                    + 128
                    + fields
                        .iter()
                        .map(|(field, binding)| {
                            field.len()
                                + 128
                                + binding.value.as_ref().map_or(0, value_bytes)
                                + binding
                                    .paths
                                    .iter()
                                    .map(|path| {
                                        32 + path
                                            .iter()
                                            .map(|part| {
                                                32 + match part {
                                                    ResponsePathSegment::Field(field) => {
                                                        field.len()
                                                    }
                                                    ResponsePathSegment::Index(_) => 0,
                                                }
                                            })
                                            .sum::<usize>()
                                    })
                                    .sum::<usize>()
                        })
                        .sum::<usize>()
            })
            .sum()
    }

    pub(super) fn record(&mut self, key: &EntityKey<'static>, record: &Record) {
        for field in [
            "__typename",
            crate::identity::DELETED_FIELD,
            crate::identity::ALIAS_FIELD,
        ] {
            self.field(key, field, record.fields.get(field), None);
        }
    }

    pub(super) fn field(
        &mut self,
        key: &EntityKey<'static>,
        field: &str,
        value: Option<&CacheValue>,
        path: Option<&[ResponsePath<'_>]>,
    ) {
        let binding = self
            .records
            .entry(key.clone())
            .or_default()
            .entry(field.to_owned())
            .or_insert_with(|| FieldProjection {
                value: value.cloned(),
                paths: Vec::new(),
                structural: false,
            });
        match path {
            None => binding.structural = true,
            Some(path) => binding.paths.push(
                path.iter()
                    .map(|part| match part {
                        ResponsePath::Field(field) => {
                            ResponsePathSegment::Field((*field).to_owned())
                        }
                        ResponsePath::Index(index) => ResponsePathSegment::Index(*index),
                    })
                    .collect(),
            ),
        }
    }

    /// Inspect only records touched since the last accepted revision. A missing
    /// field, identity change, or relationship edit invalidates the whole plan.
    /// No binding is changed until the entire update is known to be applicable.
    pub(crate) fn update(
        &mut self,
        records: &std::collections::HashMap<EntityKey<'static>, Option<Record>>,
    ) -> Option<(Vec<LiveFieldPatch>, isize)> {
        let mut patches = Vec::new();
        for (key, record) in records {
            let fields = self.records.get(key)?;
            let record = record.as_ref()?;
            for (field, binding) in fields {
                let value = record.fields.get(field);
                if value == binding.value.as_ref() {
                    continue;
                }
                if binding.structural {
                    return None;
                }
                let value = leaf_json(value?)?;
                patches.extend(binding.paths.iter().map(|path| LiveFieldPatch {
                    path: path.clone(),
                    value: value.clone(),
                }));
            }
        }
        let mut byte_delta = 0;
        for (key, record) in records {
            for (field, binding) in self.records.get_mut(key)? {
                let value = record.as_ref()?.fields.get(field);
                if value != binding.value.as_ref() {
                    byte_delta += value.map_or(0, value_bytes) as isize
                        - binding.value.as_ref().map_or(0, value_bytes) as isize;
                    binding.value = value.cloned();
                }
            }
        }
        Some((patches, byte_delta))
    }
}

fn leaf_json(value: &CacheValue) -> Option<Json> {
    Some(match value {
        CacheValue::Null => Json::Null,
        CacheValue::Bool(value) => Json::Bool(*value),
        CacheValue::Number(value) => Json::Number(value.to_json()),
        CacheValue::String(value) => Json::String(value.clone()),
        CacheValue::Opaque(value) => serde_json::from_str(value).ok()?,
        CacheValue::List(values) => {
            Json::Array(values.iter().map(leaf_json).collect::<Option<_>>()?)
        }
        CacheValue::Ref(_) | CacheValue::Object(_) => return None,
    })
}

fn value_bytes(value: &CacheValue) -> usize {
    64 + match value {
        CacheValue::String(value) | CacheValue::Opaque(value) => value.len(),
        CacheValue::Ref(key) => key.as_ref().len(),
        CacheValue::List(values) => values.iter().map(value_bytes).sum(),
        CacheValue::Object(fields) => fields
            .iter()
            .map(|(key, value)| key.len() + 64 + value_bytes(value))
            .sum(),
        _ => 0,
    }
}
