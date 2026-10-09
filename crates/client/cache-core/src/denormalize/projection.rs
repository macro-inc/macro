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
    selections: Vec<(Vec<ResponsePathSegment>, ValueProjection)>,
    structural: bool,
}

/// A selected embedded value retains schema-resolved keys and response aliases.
/// Normalized links remain structural: changing one must rebuild dependencies.
pub(super) enum ValueProjection {
    Leaf,
    Object(Vec<EmbeddedField>),
    List(Vec<ValueProjection>),
    Structural,
}

pub(super) struct EmbeddedField {
    key: String,
    response_key: String,
    value: ValueProjection,
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
                                    .selections
                                    .iter()
                                    .map(|(path, selection)| {
                                        32 + selection.retained_bytes()
                                            + path
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
            self.guard(key, field, record.fields.get(field));
        }
    }

    pub(super) fn guard(
        &mut self,
        key: &EntityKey<'static>,
        field: &str,
        value: Option<&CacheValue>,
    ) {
        let binding = self
            .records
            .entry(key.clone())
            .or_default()
            .entry(field.to_owned())
            .or_insert_with(|| FieldProjection {
                value: value.cloned(),
                selections: Vec::new(),
                structural: false,
            });
        binding.structural = true;
    }

    pub(super) fn selected_field(
        &mut self,
        owner: &EntityKey<'static>,
        key: &str,
        value: Option<&CacheValue>,
        path: &[ResponsePath<'_>],
        selection: ValueProjection,
    ) {
        let binding = self
            .records
            .entry(owner.clone())
            .or_default()
            .entry(key.to_string())
            .or_insert_with(|| FieldProjection {
                value: value.cloned(),
                selections: Vec::new(),
                structural: false,
            });
        binding.selections.push((response_path(path), selection));
    }

    /// Follows list compaction: later items move up one position per removed
    /// item. A removed (deleted) record selects no fields, and its guard still
    /// detects a restore. `removed` uses pre-compaction positions; like
    /// compaction itself, later and deeper removals apply first.
    pub(super) fn compact(&mut self, removed: &BTreeSet<Vec<ResponsePath<'_>>>) {
        for binding in self.records.values_mut().flat_map(BTreeMap::values_mut) {
            binding.selections.retain_mut(|(path, _)| {
                removed.iter().rev().all(|item| follow_removal(path, item))
            });
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
                for (path, selection) in &binding.selections {
                    selection.update(
                        binding.value.as_ref()?,
                        value?,
                        &mut path.clone(),
                        &mut patches,
                    )?;
                }
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

/// Shifts `path` past one removed list item. Returns `false` for a path inside
/// the removed item, which can no longer be patched.
fn follow_removal(path: &mut [ResponsePathSegment], removed: &[ResponsePath<'_>]) -> bool {
    let Some((ResponsePath::Index(index), parent)) = removed.split_last() else {
        return true;
    };
    let within = path.len() > parent.len()
        && path.iter().zip(parent).all(|pair| match pair {
            (ResponsePathSegment::Field(name), ResponsePath::Field(field)) => name == field,
            (ResponsePathSegment::Index(at), ResponsePath::Index(index)) => at == index,
            _ => false,
        });
    if !within {
        return true;
    }
    match &mut path[parent.len()] {
        ResponsePathSegment::Index(position) if *position == *index => false,
        ResponsePathSegment::Index(position) if *position > *index => {
            *position -= 1;
            true
        }
        _ => true,
    }
}

fn response_path(path: &[ResponsePath<'_>]) -> Vec<ResponsePathSegment> {
    path.iter()
        .map(|part| match part {
            ResponsePath::Field(field) => ResponsePathSegment::Field((*field).to_owned()),
            ResponsePath::Index(index) => ResponsePathSegment::Index(*index),
        })
        .collect()
}

impl ValueProjection {
    pub(super) fn compile<'a>(
        schema: &'a crate::meta::Schema,
        value: Option<&CacheValue>,
        field: &'a FieldNode,
        ty: &meta::FieldType,
        variables: &serde_json::Map<String, Json>,
        resolvers: &EntityResolverLookup,
        plans: &mut ReadPlans<'a>,
    ) -> Result<Self, DenormalizeError> {
        if ty.kind != meta::FieldKind::Composite {
            return Ok(Self::Leaf);
        }
        Ok(match value {
            Some(CacheValue::Object(values)) => {
                let concrete = match values.get("__typename") {
                    Some(CacheValue::String(name)) => name.as_str(),
                    _ => ty.name,
                };
                let mut fields = Vec::new();
                for selected in plans
                    .fields(schema, &field.selection_set, concrete, variables, resolvers)?
                    .iter()
                {
                    match &selected.source {
                        FieldSource::Typename => {}
                        FieldSource::Stored { key, ty } => fields.push(EmbeddedField {
                            key: key.to_string(),
                            response_key: selected.node.response_key.clone(),
                            value: Self::compile(
                                schema,
                                values.get(key.as_ref()),
                                selected.node,
                                ty,
                                variables,
                                resolvers,
                                plans,
                            )?,
                        }),
                        _ => return Ok(Self::Structural),
                    }
                }
                Self::Object(fields)
            }
            Some(CacheValue::List(values)) => Self::List(
                values
                    .iter()
                    .map(|value| {
                        Self::compile(schema, Some(value), field, ty, variables, resolvers, plans)
                    })
                    .collect::<Result<_, _>>()?,
            ),
            _ => Self::Structural,
        })
    }

    fn update(
        &self,
        before: &CacheValue,
        after: &CacheValue,
        path: &mut Vec<ResponsePathSegment>,
        patches: &mut Vec<LiveFieldPatch>,
    ) -> Option<()> {
        if before == after {
            return Some(());
        }
        match (self, before, after) {
            (Self::Leaf, _, value) => patches.push(LiveFieldPatch {
                path: path.clone(),
                value: leaf_json(value)?,
            }),
            (Self::Object(fields), CacheValue::Object(before), CacheValue::Object(after))
                if before.get("__typename") == after.get("__typename") =>
            {
                for field in fields {
                    path.push(ResponsePathSegment::Field(field.response_key.clone()));
                    field.value.update(
                        before.get(&field.key)?,
                        after.get(&field.key)?,
                        path,
                        patches,
                    )?;
                    path.pop();
                }
            }
            (Self::List(items), CacheValue::List(before), CacheValue::List(after))
                if before.len() == after.len() && items.len() == after.len() =>
            {
                for (index, ((selection, before), after)) in
                    items.iter().zip(before).zip(after).enumerate()
                {
                    path.push(ResponsePathSegment::Index(index));
                    selection.update(before, after, path, patches)?;
                    path.pop();
                }
            }
            _ => return None,
        }
        Some(())
    }

    fn retained_bytes(&self) -> usize {
        32 + match self {
            Self::Object(fields) => fields
                .iter()
                .map(|field| {
                    64 + field.key.len() + field.response_key.len() + field.value.retained_bytes()
                })
                .sum(),
            Self::List(items) => items.iter().map(Self::retained_bytes).sum(),
            _ => 0,
        }
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
