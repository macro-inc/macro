//! What a cache keeps of its records when a build opens it with another
//! GraphQL schema.
//!
//! A cache stores the schema its records were written under. Opening it with
//! another one sorts the change into one of three tiers, by record type:
//!
//! - [`Tier::Compatible`]: additions, widenings, new union members, and
//!   removed fields or types no projection reads. Every stored value means
//!   what it did, so only the stored schema is rewritten.
//! - [`Tier::Types`]: some types changed shape or identity. Their records go,
//!   with every row derived from them, and the other types stay warm.
//! - [`Tier::Reset`]: the operation roots changed, or the stored schema cannot
//!   be read. Every record goes, but the queue and the cache's owner stay.
//!
//! The stored schema keeps the definitions the incoming one removed while
//! records may still hold their values, so a later build that adds a field
//! back with another shape drops the old values instead of reading them as
//! the new type.
//!
//! Not detectable from the schema: a removed enum value, and changed field
//! arguments or defaults. Those leave stale values, as a server change without
//! a schema change would.

use crate::document::Document;
use crate::link_patch::deduplicate_patches;
use crate::meta::{
    FieldKind, FieldType, OwnedFieldMeta, OwnedFieldType, Schema, SchemaArtifact, SchemaError,
    TypeKind, TypeMeta,
};
use crate::normalize::normalize;
use crate::queue::{MutationRequest, OptimisticSource};
use crate::value::ROOT_QUERY;
use serde_json::Value as Json;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

mod inputs;
pub use inputs::ProjectionInputs;

/// Largest schema artifact a stored copy may inflate to.
const STORED_SCHEMA_MAX_BYTES: usize = 16 * 1024 * 1024;

/// Output space a stored schema's inflate starts with; the bundled schema
/// inflates to about 1 MB.
const STORED_SCHEMA_INITIAL_BYTES: usize = 2 * 1024 * 1024;

/// Deflate level for a stored schema, written once per schema change.
const STORED_SCHEMA_DEFLATE_LEVEL: i32 = 6;

/// A stored schema this build cannot use.
#[derive(Debug, thiserror::Error)]
pub enum StoredSchemaError {
    /// The bytes do not decode as a schema artifact.
    #[error("stored cache schema is corrupt")]
    Corrupt,
    /// The artifact decodes but this build does not accept it.
    #[error(transparent)]
    Invalid(#[from] SchemaError),
}

/// The bytes a cache stores its schema as: the canonical artifact as a raw
/// deflate stream.
pub fn encode_stored_schema(schema: &Schema) -> Vec<u8> {
    // Serializing owned strings, vectors and enums cannot fail.
    let json = serde_json::to_vec(schema.artifact()).unwrap_or_default();
    // Room for the worst case, so the stream always finishes; one that did not
    // would be stored truncated and read back as corrupt.
    let mut output = vec![0; zlib_rs::compress_bound(json.len())];
    let mut stream = zlib_rs::Deflate::new(STORED_SCHEMA_DEFLATE_LEVEL, false, 15);
    let finished = matches!(
        stream.compress(&json, &mut output, zlib_rs::DeflateFlush::Finish),
        Ok(zlib_rs::Status::StreamEnd)
    );
    let length = usize::try_from(stream.total_out()).unwrap_or(0);
    output.truncate(if finished { length } else { 0 });
    output
}

/// A raw deflate stream inflated, or `None` when it is corrupt, truncated or
/// inflates past `limit`.
fn inflate_limited(bytes: &[u8], limit: usize) -> Option<Vec<u8>> {
    let mut output = vec![0; STORED_SCHEMA_INITIAL_BYTES.min(limit)];
    loop {
        let mut stream = zlib_rs::Inflate::new(false, 15);
        let status = stream.decompress(bytes, &mut output, zlib_rs::InflateFlush::Finish);
        let length = usize::try_from(stream.total_out()).ok()?;
        match status {
            Ok(zlib_rs::Status::StreamEnd) => {
                output.truncate(length);
                return Some(output);
            }
            // The stream stopped with the output full: inflate again into
            // twice the room.
            Ok(_) if length == output.len() && output.len() < limit => {
                let grown = output.len().saturating_mul(2).min(limit);
                output.resize(grown, 0);
            }
            _ => return None,
        }
    }
}

/// Decodes [`encode_stored_schema`] bytes. An artifact format or
/// compatibility epoch this build does not know is [`StoredSchemaError::Invalid`].
pub fn decode_stored_schema(bytes: &[u8]) -> Result<Arc<Schema>, StoredSchemaError> {
    let json = inflate_limited(bytes, STORED_SCHEMA_MAX_BYTES).ok_or(StoredSchemaError::Corrupt)?;
    let artifact: SchemaArtifact =
        serde_json::from_slice(&json).map_err(|_| StoredSchemaError::Corrupt)?;
    Ok(Schema::from_artifact(artifact)?)
}

/// [`encode_stored_schema`] of the schema the last builds before caches stored
/// one shipped (`static_assets/schema.graphql`). Every schema since
/// compatibility epoch 4 only widened and added to its predecessors, so it
/// describes every value those builds wrote.
const UNRECORDED_SCHEMA: &[u8] = include_bytes!("schema_change/unrecorded.schema");

/// The schema a cache that stores none was written under, or `None` once the
/// compatibility epoch has moved past it: an epoch change starts every cache
/// empty, so no cache without a stored schema survives one.
pub fn unrecorded_schema() -> Option<Arc<Schema>> {
    decode_stored_schema(UNRECORDED_SCHEMA).ok()
}

/// What opening a cache with another schema does to its stored records. Its
/// string form names the tier in telemetry.
#[derive(Debug, Clone, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "kebab-case")]
pub enum Tier {
    /// Every stored value means what it did: only the stored schema changes.
    Compatible,
    /// The records of these types, by record typename ([`ROOT_QUERY`] for the
    /// query root), no longer mean what they did. They go with every row
    /// derived from them, and their index documents are incomplete.
    Types {
        /// The record typenames whose records go.
        changed: BTreeSet<String>,
        /// A projection of any document read a changed type's values, so
        /// every document is incomplete.
        every_document: bool,
    },
    /// Every record goes.
    Reset(ResetReason),
}

/// Why a schema change drops every record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "kebab-case")]
pub enum ResetReason {
    /// The stored schema cannot be read, or is of another compatibility
    /// epoch or format; or the cache stores none, and the host's record of
    /// what wrote it cannot be read.
    Unreadable,
    /// An operation root type was renamed.
    Roots,
    /// The schema to store would not validate.
    Invalid,
    /// Applying the change's own tier failed, so every record went instead.
    Failed,
}

/// A schema change sorted into its tier, and the schema to store after it.
#[derive(Debug, Clone)]
pub struct SchemaChange {
    /// What happens to the stored records.
    pub tier: Tier,
    /// The incoming schema plus the stored definitions it removed that kept
    /// records may still hold values of.
    pub stored: Arc<Schema>,
}

impl SchemaChange {
    /// Sorts opening a cache stored under `stored` with `incoming`, whose
    /// index projections read `inputs`; `None` when the stored schema could
    /// not be read.
    #[must_use]
    pub fn classify(
        stored: Option<&Schema>,
        incoming: &Arc<Schema>,
        inputs: &ProjectionInputs,
    ) -> Self {
        let reset = |reason| Self {
            tier: Tier::Reset(reason),
            stored: Arc::clone(incoming),
        };
        let Some(stored) = stored else {
            return reset(ResetReason::Unreadable);
        };
        if stored.hash() == incoming.hash() {
            return Self {
                tier: Tier::Compatible,
                stored: Arc::clone(incoming),
            };
        }
        if stored.query_root() != incoming.query_root()
            || stored.mutation_root() != incoming.mutation_root()
            || stored.subscription_root() != incoming.subscription_root()
        {
            return reset(ResetReason::Roots);
        }
        let mut changed = changed_types(stored, incoming, inputs);
        loop {
            close_over_holders(stored, incoming, &mut changed);
            let (artifact, unkeepable) = keep_removed(stored, incoming, &changed);
            if !unkeepable.is_empty() {
                changed.extend(unkeepable);
                continue;
            }
            let Ok(schema) = Schema::from_artifact(artifact) else {
                return reset(ResetReason::Invalid);
            };
            let changed = changed
                .into_iter()
                .map(|name| record_typename(stored, &name).to_owned())
                .collect::<BTreeSet<_>>();
            let tier = if changed.is_empty() {
                Tier::Compatible
            } else {
                Tier::Types {
                    every_document: changed.iter().any(|name| inputs.nests(name)),
                    changed,
                }
            };
            return Self {
                tier,
                stored: schema,
            };
        }
    }
}

/// The typename `name`'s records are stored under.
fn record_typename<'a>(schema: &Schema, name: &'a str) -> &'a str {
    if name == schema.query_root() {
        ROOT_QUERY
    } else {
        name
    }
}

/// Stored types whose values the incoming schema reads differently, or that
/// lose a value a projection reads and the incoming build never refreshes.
fn changed_types(
    stored: &Schema,
    incoming: &Schema,
    inputs: &ProjectionInputs,
) -> BTreeSet<String> {
    let projected = projected_types(stored, inputs);
    let mut changed = BTreeSet::new();
    for old in &stored.artifact().types {
        let typename = record_typename(stored, &old.name);
        let read = projected.contains(&old.name);
        let differs = match incoming.type_meta(&old.name) {
            None => read || inputs.names(typename),
            Some(new) if new.kind != old.kind || new.key_fields != old.key_fields => true,
            Some(new) => {
                old.possible_types
                    .iter()
                    .any(|member| !new.possible_types.contains(member))
                    || old.fields.iter().any(|field| {
                        match incoming.field_meta(&new.name, &field.name) {
                            Some(meta) => field_changes(borrowed(&field.ty), meta.ty),
                            None => read || inputs.reads(typename, &field.name),
                        }
                    })
            }
        };
        if differs {
            changed.insert(old.name.clone());
        }
    }
    changed
}

/// Adds every stored type that holds a changed type's values inline: an
/// embedded object or an abstract type is stored inside its holder's record,
/// where a referenced entity is its own record.
fn close_over_holders(stored: &Schema, incoming: &Schema, changed: &mut BTreeSet<String>) {
    let inline = |name: &str| {
        [stored.type_meta(name), incoming.type_meta(name)]
            .into_iter()
            .flatten()
            .any(|ty| ty.kind != TypeKind::Object || ty.key_fields.is_none())
    };
    loop {
        let holders = stored
            .artifact()
            .types
            .iter()
            .filter(|ty| !changed.contains(&ty.name))
            .filter(|ty| {
                ty.fields.iter().any(|field| {
                    field.ty.kind == FieldKind::Composite
                        && changed.contains(&field.ty.name)
                        && inline(&field.ty.name)
                }) || ty
                    .possible_types
                    .iter()
                    .any(|member| changed.contains(member) && inline(member))
            })
            .map(|ty| ty.name.clone())
            .collect::<Vec<_>>();
        if holders.is_empty() {
            return;
        }
        changed.extend(holders);
    }
}

/// The incoming artifact plus the stored definitions it removed from types
/// that keep their records, and the types whose removed definitions cannot
/// be kept: one names a type that is gone, or a name an incoming field reads
/// as an enum or scalar is a removed type's, or a removed field reads as a
/// leaf a name that is now a type.
fn keep_removed(
    stored: &Schema,
    incoming: &Schema,
    changed: &BTreeSet<String>,
) -> (SchemaArtifact, BTreeSet<String>) {
    let mut types: BTreeMap<String, TypeMeta> = incoming
        .artifact()
        .types
        .iter()
        .map(|ty| (ty.name.clone(), ty.clone()))
        .collect();
    // The removed definitions each type keeps: all of a removed type's, or
    // the fields a surviving type lost.
    let mut kept: BTreeMap<String, Vec<OwnedFieldMeta>> = BTreeMap::new();
    for old in &stored.artifact().types {
        if changed.contains(&old.name) {
            continue;
        }
        let Some(new) = types.get_mut(&old.name) else {
            kept.insert(old.name.clone(), old.fields.clone());
            types.insert(old.name.clone(), old.clone());
            continue;
        };
        let removed = old
            .fields
            .iter()
            .filter(|field| !new.fields.iter().any(|f| f.name == field.name))
            .cloned()
            .collect::<Vec<_>>();
        if !removed.is_empty() {
            new.fields.extend(removed.iter().cloned());
            kept.insert(old.name.clone(), removed);
        }
    }
    // A field names a type exactly when it is composite; anything kept that
    // breaks that would not validate beside the incoming definitions.
    let leaves = incoming
        .artifact()
        .types
        .iter()
        .flat_map(|ty| &ty.fields)
        .filter(|field| field.ty.kind != FieldKind::Composite)
        .map(|field| field.ty.name.as_str())
        .collect::<BTreeSet<_>>();
    let unkeepable = kept
        .into_iter()
        .filter(|(owner, fields)| {
            leaves.contains(owner.as_str())
                || fields.iter().any(|field| {
                    (field.ty.kind == FieldKind::Composite) != types.contains_key(&field.ty.name)
                })
        })
        .map(|(owner, _)| owner)
        .collect();
    let objects = types
        .values()
        .filter(|ty| ty.kind == TypeKind::Object)
        .map(|ty| ty.name.clone())
        .collect::<BTreeSet<_>>();
    for ty in types.values_mut() {
        ty.possible_types.retain(|name| objects.contains(name));
    }
    let artifact = incoming.artifact();
    (
        SchemaArtifact {
            format_version: artifact.format_version,
            compatibility_epoch: artifact.compatibility_epoch,
            query_root: artifact.query_root.clone(),
            mutation_root: artifact.mutation_root.clone(),
            subscription_root: artifact.subscription_root.clone(),
            types: types.into_values().collect(),
        },
        unkeepable,
    )
}

/// Whether a value stored for a field typed `old` may not be a value of
/// `new`. Composite types are compared by name; a change to the named type
/// itself is found on that type.
fn field_changes(old: FieldType<'_>, new: FieldType<'_>) -> bool {
    let name_widens = match (old.kind, new.kind) {
        (FieldKind::OpaqueScalar, FieldKind::OpaqueScalar)
        | (FieldKind::Composite, FieldKind::Composite) => old.name == new.name,
        (FieldKind::Leaf, FieldKind::Leaf) => match (old.name, new.name) {
            (old, new) if old == new => true,
            ("Int", "Float") => true,
            // Text types: a stored string is a valid String or ID, but does
            // not say whether another enum has it.
            (old, "String" | "ID") => !matches!(old, "Int" | "Float" | "Boolean"),
            _ => false,
        },
        _ => false,
    };
    let shape_widens = old.list == new.list
        && (new.nullable || !old.nullable)
        && (!new.list || new.item_nullable || !old.item_nullable);
    !(name_widens && shape_widens)
}

fn borrowed(ty: &OwnedFieldType) -> FieldType<'_> {
    FieldType {
        name: &ty.name,
        kind: ty.kind,
        nullable: ty.nullable,
        list: ty.list,
        item_nullable: ty.item_nullable,
    }
}

/// Embedded types whose values an index projection may read: those a listed
/// field holds, and those embedded in them. A referenced entity is its own
/// record, with its own listed fields.
fn projected_types(schema: &Schema, inputs: &ProjectionInputs) -> BTreeSet<String> {
    let mut read = BTreeSet::new();
    let mut pending: Vec<String> = inputs
        .read_fields()
        .filter_map(|(typename, field)| {
            let owner = if typename == ROOT_QUERY {
                schema.query_root()
            } else {
                typename
            };
            schema
                .field_meta(owner, field)
                .filter(|meta| meta.ty.kind == FieldKind::Composite)
                .map(|meta| meta.ty.name.to_owned())
        })
        .collect();
    while let Some(name) = pending.pop() {
        let Some(ty) = schema.type_meta(&name) else {
            continue;
        };
        match ty.kind {
            TypeKind::Object if ty.key_fields.is_none() => {
                if read.insert(name) {
                    pending.extend(
                        ty.fields
                            .iter()
                            .filter(|field| field.ty.kind == FieldKind::Composite)
                            .map(|field| field.ty.name.clone()),
                    );
                }
            }
            TypeKind::Object => {}
            TypeKind::Union | TypeKind::Interface => {
                if read.insert(name) {
                    pending.extend(ty.possible_types.iter().cloned());
                }
            }
        }
    }
    read
}

/// Whether a queued mutation's optimistic response still fits `schema`, the
/// schema an engine rebuilds it under: it normalizes, its link recipes
/// validate, and it writes no record of a `changed` type, whose values its
/// author shaped for the stored schema. One that does not fit keeps its
/// mutation, which is still sent, and loses its overlay ([`retire_overlay`]).
#[must_use]
pub fn overlay_fits(
    schema: &Schema,
    changed: &BTreeSet<String>,
    request: &MutationRequest,
    source: &OptimisticSource,
) -> bool {
    if is_retired(source) {
        return true;
    }
    let Ok(Json::Object(variables)) = serde_json::from_str::<Json>(&request.variables_json) else {
        return false;
    };
    let Ok(document) = Document::parse(&request.query) else {
        return false;
    };
    let Ok(operation) = document.operation(request.operation_name.as_deref()) else {
        return false;
    };
    let Ok(updates) = normalize(schema, operation, &variables, &source.mutation_data) else {
        return false;
    };
    !updates
        .keys()
        .any(|key| changed.contains(key.typename().unwrap_or(ROOT_QUERY)))
        && deduplicate_patches(schema, &source.link_patches).is_ok()
}

/// Drops an optimistic response, its link recipes and its projections, so the
/// layer adds no records and no list entries: a projection describes a record
/// the overlay held. Its revalidations and identity bindings stay: they name
/// keys, not values a schema shapes.
pub fn retire_overlay(source: &mut OptimisticSource) {
    source.mutation_data = Json::Object(serde_json::Map::new());
    source.link_patches.clear();
    source.projection_mutations.clear();
}

/// Whether [`retire_overlay`] left `source` with nothing to normalize. An
/// engine rebuilds such a layer without its document, which may select a
/// field the schema it opens with removed.
#[must_use]
pub fn is_retired(source: &OptimisticSource) -> bool {
    source.link_patches.is_empty()
        && matches!(&source.mutation_data, Json::Object(fields) if fields.is_empty())
}

#[cfg(test)]
mod test;
