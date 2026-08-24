//! Schema-validated, read-only entity resolver descriptors.
//!
//! Transport adapters deserialize [`EntityResolver`] values and the engine
//! compiles them into a field lookup for one read. Output relation metadata is
//! validated against the generated schema. Input argument metadata is not
//! currently generated in Rust; a nonexistent or non-scalar runtime path is
//! therefore handled safely as a cache miss by denormalization.

use crate::meta::{self, FieldKind, TypeKind};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use thiserror::Error;

/// A singular entity relation derived from one resolved field-argument path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityResolver {
    /// Concrete object type that owns the configured field.
    pub parent_type: String,
    /// Schema field replaced by this resolver during reads.
    pub field_name: String,
    /// Concrete, `id: ID!` entity type addressed by the argument value.
    pub target_type: String,
    /// Path beginning with a GraphQL argument name.
    pub argument_path: Vec<String>,
}

/// Invalid untrusted entity resolver configuration.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum EntityResolverError {
    /// The configured parent is absent from generated schema metadata.
    #[error("unknown entity resolver parent type `{0}`")]
    UnknownParent(String),
    /// Resolver parents must be concrete output objects.
    #[error("entity resolver parent `{0}` is not a concrete object")]
    ParentNotObject(String),
    /// The configured field is absent from its parent object.
    #[error("unknown entity resolver field `{parent}.{field}`")]
    UnknownField { parent: String, field: String },
    /// Entity resolvers only replace singular composite relations.
    #[error("entity resolver field `{parent}.{field}` is not a singular composite relation")]
    NotSingularComposite { parent: String, field: String },
    /// The configured target is absent from generated schema metadata.
    #[error("unknown entity resolver target type `{0}`")]
    UnknownTarget(String),
    /// Resolver targets must be concrete output objects.
    #[error("entity resolver target `{0}` is not a concrete object")]
    TargetNotObject(String),
    /// Resolver targets use the cache's single `id: ID!` key convention.
    #[error("entity resolver target `{0}` is not keyed by `id: ID!`")]
    TargetNotKeyable(String),
    /// The concrete target cannot satisfy the field's declared return type.
    #[error(
        "entity resolver target `{target}` is incompatible with `{parent}.{field}` return type `{declared}`"
    )]
    IncompatibleTarget {
        parent: String,
        field: String,
        target: String,
        declared: String,
    },
    /// A resolver path must contain at least one non-empty segment.
    #[error("entity resolver argument path for `{parent}.{field}` must be non-empty")]
    EmptyArgumentPath { parent: String, field: String },
    /// At most one resolver can replace a parent field.
    #[error("duplicate entity resolver for `{parent}.{field}`")]
    Duplicate { parent: String, field: String },
}

/// Validated lookup used by the synchronous denormalization walk.
#[derive(Debug, Default)]
pub struct EntityResolverLookup {
    by_parent: BTreeMap<String, BTreeMap<String, EntityResolver>>,
}

impl EntityResolverLookup {
    /// Validates descriptors against generated output schema metadata.
    pub fn compile(resolvers: &[EntityResolver]) -> Result<Self, EntityResolverError> {
        let mut by_parent = BTreeMap::<String, BTreeMap<String, EntityResolver>>::new();
        for resolver in resolvers {
            let parent = meta::type_meta(&resolver.parent_type)
                .ok_or_else(|| EntityResolverError::UnknownParent(resolver.parent_type.clone()))?;
            if parent.kind != TypeKind::Object {
                return Err(EntityResolverError::ParentNotObject(
                    resolver.parent_type.clone(),
                ));
            }
            let field =
                meta::field_meta(&resolver.parent_type, &resolver.field_name).ok_or_else(|| {
                    EntityResolverError::UnknownField {
                        parent: resolver.parent_type.clone(),
                        field: resolver.field_name.clone(),
                    }
                })?;
            if field.ty.kind != FieldKind::Composite || field.ty.list {
                return Err(EntityResolverError::NotSingularComposite {
                    parent: resolver.parent_type.clone(),
                    field: resolver.field_name.clone(),
                });
            }

            let target = meta::type_meta(&resolver.target_type)
                .ok_or_else(|| EntityResolverError::UnknownTarget(resolver.target_type.clone()))?;
            if target.kind != TypeKind::Object {
                return Err(EntityResolverError::TargetNotObject(
                    resolver.target_type.clone(),
                ));
            }
            if target.key_fields != Some(&["id"][..]) {
                return Err(EntityResolverError::TargetNotKeyable(
                    resolver.target_type.clone(),
                ));
            }

            let declared = meta::type_meta(field.ty.name)
                .expect("generated composite field type has generated metadata");
            let compatible = match declared.kind {
                TypeKind::Object => declared.name == target.name,
                TypeKind::Interface | TypeKind::Union => {
                    declared.possible_types.contains(&target.name)
                }
            };
            if !compatible {
                return Err(EntityResolverError::IncompatibleTarget {
                    parent: resolver.parent_type.clone(),
                    field: resolver.field_name.clone(),
                    target: resolver.target_type.clone(),
                    declared: declared.name.to_string(),
                });
            }
            if resolver.argument_path.is_empty()
                || resolver.argument_path.iter().any(String::is_empty)
            {
                return Err(EntityResolverError::EmptyArgumentPath {
                    parent: resolver.parent_type.clone(),
                    field: resolver.field_name.clone(),
                });
            }

            let fields = by_parent.entry(resolver.parent_type.clone()).or_default();
            if fields
                .insert(resolver.field_name.clone(), resolver.clone())
                .is_some()
            {
                return Err(EntityResolverError::Duplicate {
                    parent: resolver.parent_type.clone(),
                    field: resolver.field_name.clone(),
                });
            }
        }
        Ok(Self { by_parent })
    }

    /// Returns the resolver replacing `parent_type.field_name`, if configured.
    pub(crate) fn get(&self, parent_type: &str, field_name: &str) -> Option<&EntityResolver> {
        self.by_parent.get(parent_type)?.get(field_name)
    }
}

impl EntityResolver {
    /// Resolves a string/number id from an already-resolved argument object.
    pub(crate) fn entity_key(
        &self,
        arguments: &serde_json::Map<String, serde_json::Value>,
    ) -> Option<crate::value::EntityKey<'static>> {
        let mut value = arguments.get(self.argument_path.first()?)?;
        for segment in &self.argument_path[1..] {
            value = value.as_object()?.get(segment)?;
        }
        let id = match value {
            serde_json::Value::String(value) => value.clone(),
            serde_json::Value::Number(value) => value.to_string(),
            _ => return None,
        };
        Some(crate::value::EntityKey::entity(&self.target_type, &[&id]))
    }
}
