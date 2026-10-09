//! Declared list membership: which list fields the cache maintains itself.
//!
//! Every list field is `Opaque` unless declared here. An opaque list is the
//! server's answer, changed only by network writes and explicit link recipes.
//! A `Relation` list is derived when read: the server's evidence for that
//! exact field and arguments, adjusted by records that changed after the
//! evidence was written:
//!
//! - a child cached before the evidence and unchanged since keeps the
//!   evidence's decision; the server already ruled on it;
//! - a child whose effective state changed later (an optimistic layer, a
//!   committed response, a push, another tab) is evaluated locally: in means
//!   inserted at its ordered position, out or deleted means removed;
//! - a child that cannot be evaluated keeps the evidence and flags the read;
//! - dropping an optimistic layer changes effective records, so membership
//!   follows without callbacks.
//!
//! "Changed after" compares two durable sequence numbers from one engine
//! clock. Each base write that changes a child record stamps it with the
//! write's sequence ([`CHANGED_AT_FIELD`]). Each base write of an evidence list
//! stamps that list, even when it is unchanged, in a small per-owner record
//! ([`evidence_key`]) so the owner itself is not rewritten. Records in one
//! response share a sequence, so the children of a fetched list are never
//! newer than their own evidence. Optimistic layers are never stamped: a child
//! touched by a pending layer is always evaluated locally.
//! Invariant: a child's stamp exceeds a list's evidence stamp exactly when its
//! last durable change was not observed by that evidence.

use crate::meta::{FieldKind, Schema, TypeKind};
use crate::value::{CacheNumber, CacheValue, EntityKey, Record};
use serde_json::Value as Json;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, HashMap};

/// Durable sequence of the last base write that changed a relation child.
pub const CHANGED_AT_FIELD: &str = "__cacheMembershipChangedAt";
/// Type of the records holding evidence stamps, one per owner record. Their
/// fields are evidence storage keys; values are write sequences.
pub const EVIDENCE_TYPENAME: &str = "__cacheMembershipEvidence";
/// Storage key of the durable membership clock.
pub(crate) const CLOCK_KEY: &str = "__meta:membership-clock";
pub(crate) const CLOCK_FIELD: &str = "seq";

/// The record holding evidence stamps of `owner`'s relation lists.
pub fn evidence_key(owner: &EntityKey<'_>) -> EntityKey<'static> {
    EntityKey(format!("{EVIDENCE_TYPENAME}:{owner}").into())
}

/// Bookkeeping that is never part of a response or a field change.
pub fn is_internal_field(name: &str) -> bool {
    name == CHANGED_AT_FIELD
}

/// One field argument constraining a child field to any of its listed values.
/// A null, omitted or empty list constrains nothing.
#[derive(Debug, Clone, Copy)]
pub struct ArgumentFilter {
    /// Path from the field's arguments to the list of accepted values.
    pub argument: &'static [&'static str],
    /// Leaf field of the child compared with the accepted values.
    pub child_field: &'static str,
}

/// A list field whose membership the cache derives from child records.
#[derive(Debug, Clone, Copy)]
pub struct RelationDeclaration {
    /// Type owning the list field.
    pub parent_type: &'static str,
    /// List field name.
    pub field: &'static str,
    /// Entity type of the list's items.
    pub child_type: &'static str,
    /// Child fields that must equal the parent's `id`; empty for a root
    /// collection such as the viewer's favorites.
    pub parent_key_fields: &'static [&'static str],
    /// Exact filters derived from the field's arguments. Any other non-null
    /// argument makes membership unknown.
    pub arguments: &'static [ArgumentFilter],
    /// Ascending order fields; ties fall back to the child's key.
    pub order: &'static [&'static str],
}

/// Lists whose membership is derived. Everything else stays opaque.
pub const RELATIONS: &[RelationDeclaration] = &[RelationDeclaration {
    parent_type: "GraphqlUser",
    field: "favorites",
    child_type: "GraphqlFavorite",
    parent_key_fields: &[],
    arguments: &[
        ArgumentFilter {
            argument: &["filter", "entityTypes"],
            child_field: "entityType",
        },
        ArgumentFilter {
            argument: &["filter", "entityIds"],
            child_field: "entityId",
        },
    ],
    // The server lists favorites by sort order, then creation time.
    order: &["sortOrder", "createdAt"],
}];

/// Stable index of a compiled relation within one schema.
pub type RelationId = usize;

/// A declaration validated against the runtime schema.
#[derive(Debug, Clone)]
pub struct Relation {
    /// Type owning the list field.
    pub parent_type: String,
    /// List field name.
    pub field: String,
    /// Entity type of the list's items.
    pub child_type: String,
    parent_key_fields: Vec<String>,
    arguments: Vec<(Vec<String>, String)>,
    order: Vec<String>,
}

/// Compiled membership policies of one schema snapshot.
#[derive(Debug, Default)]
pub struct MembershipPolicies {
    relations: Vec<Relation>,
    /// Parent type, then field name.
    by_field: HashMap<String, HashMap<String, RelationId>>,
    child_types: BTreeSet<String>,
    diagnostics: Vec<String>,
}

impl MembershipPolicies {
    /// Validates declarations; an invalid one stays opaque, with a diagnostic.
    pub fn compile(schema: &Schema, declarations: &[RelationDeclaration]) -> Self {
        let mut policies = Self::default();
        for declaration in declarations {
            match validate(schema, declaration) {
                Ok(relation) => {
                    let id = policies.relations.len();
                    policies
                        .by_field
                        .entry(relation.parent_type.clone())
                        .or_default()
                        .insert(relation.field.clone(), id);
                    policies.child_types.insert(relation.child_type.clone());
                    policies.relations.push(relation);
                }
                Err(reason) => policies.diagnostics.push(format!(
                    "membership of {}.{} stays opaque: {reason}",
                    declaration.parent_type, declaration.field
                )),
            }
        }
        policies
    }

    /// The relation declared for a concrete parent type's field.
    pub fn relation(&self, parent_type: &str, field: &str) -> Option<RelationId> {
        self.by_field.get(parent_type)?.get(field).copied()
    }

    /// A compiled relation.
    pub fn get(&self, id: RelationId) -> &Relation {
        &self.relations[id]
    }

    /// Whether records of `typename` are children of a derived list.
    pub fn is_child_type(&self, typename: &str) -> bool {
        self.child_types.contains(typename)
    }

    /// Child types of derived lists.
    pub fn child_types(&self) -> impl Iterator<Item = &str> {
        self.child_types.iter().map(String::as_str)
    }

    /// Declarations that failed validation and therefore stay opaque.
    pub fn diagnostics(&self) -> &[String] {
        &self.diagnostics
    }

    /// Whether a base write of `updates` must be stamped.
    pub(crate) fn stamps(&self, updates: &crate::normalize::RecordUpdates) -> bool {
        !self.relations.is_empty()
            && updates.iter().any(|(key, record)| {
                key.typename().is_some_and(|name| self.is_child_type(name))
                    || self.declared_fields(key, record).next().is_some()
            })
    }

    /// Stored evidence fields of declared relations within `record`.
    fn declared_fields<'r>(
        &'r self,
        key: &'r EntityKey<'static>,
        record: &'r Record,
    ) -> impl Iterator<Item = &'r str> {
        let fields = record
            .typename()
            .or_else(|| key.typename())
            .and_then(|name| self.by_field.get(name));
        fields.into_iter().flat_map(move |declared| {
            record.fields.keys().filter_map(move |field| {
                let name = field
                    .split_once('(')
                    .map_or(field.as_str(), |(name, _)| name);
                declared.contains_key(name).then_some(field.as_str())
            })
        })
    }

    /// Marks every evidence list in `updates` as observed at `seq`.
    pub(crate) fn stamp_evidence(&self, updates: &mut crate::normalize::RecordUpdates, seq: u64) {
        let lists: Vec<(EntityKey<'static>, String)> = updates
            .iter()
            .flat_map(|(key, record)| {
                self.declared_fields(key, record)
                    .map(|field| (evidence_key(key), field.to_owned()))
            })
            .collect();
        for (key, field) in lists {
            updates
                .entry(key)
                .or_default()
                .fields
                .insert(field, stamp(seq));
        }
    }
}

fn stamp(seq: u64) -> CacheValue {
    CacheValue::Number(CacheNumber::PosInt(seq))
}

/// A record's stamp, if any.
pub(crate) fn stamp_of(record: &Record, field: &str) -> Option<u64> {
    match record.fields.get(field)? {
        CacheValue::Number(CacheNumber::PosInt(seq)) => Some(*seq),
        _ => None,
    }
}

/// Stamps a changed child record.
pub(crate) fn stamp_child(record: &mut Record, seq: u64) {
    record.fields.insert(CHANGED_AT_FIELD.into(), stamp(seq));
}

fn validate(schema: &Schema, declaration: &RelationDeclaration) -> Result<Relation, String> {
    let parent = schema
        .type_meta(declaration.parent_type)
        .ok_or("unknown parent type")?;
    if parent.kind != TypeKind::Object {
        return Err("parent is not an object type".into());
    }
    let field = schema
        .field_meta(declaration.parent_type, declaration.field)
        .ok_or("unknown field")?;
    if field.ty.kind != FieldKind::Composite || !field.ty.list {
        return Err("field is not a list of objects".into());
    }
    if field.ty.name != declaration.child_type {
        return Err(format!(
            "field lists {}, not {}",
            field.ty.name, declaration.child_type
        ));
    }
    let child = schema
        .type_meta(declaration.child_type)
        .ok_or("unknown child type")?;
    if child.kind != TypeKind::Object || child.key_fields.is_none() {
        return Err("child is not an entity object".into());
    }
    if !declaration.parent_key_fields.is_empty() && parent.key_fields.is_none() {
        return Err("a keyed relation needs an entity parent".into());
    }
    let leaf = |name: &str| {
        schema
            .field_meta(declaration.child_type, name)
            .filter(|field| field.ty.kind == FieldKind::Leaf && !field.ty.list)
            .map(|_| name.to_owned())
            .ok_or_else(|| format!("{}.{name} is not a scalar field", declaration.child_type))
    };
    Ok(Relation {
        parent_type: declaration.parent_type.into(),
        field: declaration.field.into(),
        child_type: declaration.child_type.into(),
        parent_key_fields: declaration
            .parent_key_fields
            .iter()
            .map(|name| leaf(name))
            .collect::<Result<_, _>>()?,
        arguments: declaration
            .arguments
            .iter()
            .map(|filter| {
                if filter.argument.is_empty() {
                    return Err("empty argument path".to_owned());
                }
                Ok((
                    filter
                        .argument
                        .iter()
                        .map(|part| (*part).to_owned())
                        .collect(),
                    leaf(filter.child_field)?,
                ))
            })
            .collect::<Result<_, _>>()?,
        order: declaration
            .order
            .iter()
            .map(|name| leaf(name))
            .collect::<Result<_, _>>()?,
    })
}

/// Exact membership test for one evaluated field instance.
#[derive(Debug)]
pub(crate) struct Filter {
    /// Child field and the values it may hold.
    any_of: Vec<(String, Vec<CacheValue>)>,
}

impl Relation {
    /// The filter for resolved field arguments, or `None` when an argument is
    /// not declared, so membership cannot be decided locally.
    pub(crate) fn filter(
        &self,
        owner: &EntityKey<'static>,
        arguments: &serde_json::Map<String, Json>,
    ) -> Option<Filter> {
        if !self.covers(&[], &Json::Object(arguments.clone())) {
            return None;
        }
        let mut any_of = Vec::new();
        for field in &self.parent_key_fields {
            any_of.push((
                field.clone(),
                vec![CacheValue::String(owner.id()?.to_owned())],
            ));
        }
        for (path, field) in &self.arguments {
            let value = path
                .iter()
                .try_fold(&Json::Object(arguments.clone()), |value, part| {
                    value
                        .as_object()
                        .map(|object| object.get(part).unwrap_or(&Json::Null))
                })
                .cloned()
                .unwrap_or(Json::Null);
            match value {
                Json::Null => {}
                Json::Array(values) if values.is_empty() => {}
                Json::Array(values) => any_of.push((
                    field.clone(),
                    values.iter().map(leaf_value).collect::<Option<_>>()?,
                )),
                _ => return None,
            }
        }
        Some(Filter { any_of })
    }

    /// Whether every non-null argument value lies on a declared path.
    fn covers(&self, path: &[&str], value: &Json) -> bool {
        if value.is_null() || self.arguments.iter().any(|(declared, _)| declared == path) {
            return true;
        }
        let Json::Object(fields) = value else {
            return false;
        };
        let below = |declared: &[String]| {
            declared.len() > path.len() && declared.iter().zip(path).all(|(a, b)| a == b)
        };
        if !self.arguments.iter().any(|(declared, _)| below(declared)) {
            return false;
        }
        fields.iter().all(|(name, value)| {
            let mut next = path.to_vec();
            next.push(name);
            self.covers(&next, value)
        })
    }

    /// Ascending order key; `None` when an order field is missing.
    fn order_key<'r>(&self, record: &'r Record) -> Option<Vec<&'r CacheValue>> {
        self.order
            .iter()
            .map(|field| {
                record
                    .fields
                    .get(field)
                    .filter(|value| leaf_order(value).is_some())
            })
            .collect()
    }
}

impl Filter {
    /// `None` when a constrained field is missing from the record.
    pub(crate) fn matches(&self, record: &Record) -> Option<bool> {
        for (field, values) in &self.any_of {
            let value = record.fields.get(field)?;
            if !values.contains(value) {
                return Some(false);
            }
        }
        Some(true)
    }
}

fn leaf_value(value: &Json) -> Option<CacheValue> {
    Some(match value {
        Json::String(text) => CacheValue::String(text.clone()),
        Json::Bool(value) => CacheValue::Bool(*value),
        Json::Number(number) => CacheValue::Number(number.into()),
        _ => return None,
    })
}

enum OrderValue<'a> {
    Number(f64),
    Text(&'a str),
    Bool(bool),
}

fn leaf_order(value: &CacheValue) -> Option<OrderValue<'_>> {
    Some(match value {
        CacheValue::Number(number) => OrderValue::Number(match number {
            CacheNumber::PosInt(value) => *value as f64,
            CacheNumber::NegInt(value) => *value as f64,
            CacheNumber::Float(value) => *value,
        }),
        CacheValue::String(text) => OrderValue::Text(text),
        CacheValue::Bool(value) => OrderValue::Bool(*value),
        _ => return None,
    })
}

fn compare_values(a: &CacheValue, b: &CacheValue) -> Ordering {
    match (leaf_order(a), leaf_order(b)) {
        (Some(OrderValue::Number(a)), Some(OrderValue::Number(b))) => a.total_cmp(&b),
        (Some(OrderValue::Text(a)), Some(OrderValue::Text(b))) => a.cmp(b),
        (Some(OrderValue::Bool(a)), Some(OrderValue::Bool(b))) => a.cmp(&b),
        _ => Ordering::Equal,
    }
}

fn compare_keys(
    a: (&[&CacheValue], &EntityKey<'static>),
    b: (&[&CacheValue], &EntityKey<'static>),
) -> Ordering {
    a.0.iter()
        .zip(b.0)
        .map(|(a, b)| compare_values(a, b))
        .find(|ordering| ordering.is_ne())
        .unwrap_or_else(|| a.1.cmp(b.1))
}

/// A derived list value and whether it fell back to the evidence.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Derivation {
    /// List of links to read in place of the stored evidence.
    pub value: CacheValue,
    /// Membership could not be decided; `value` is the evidence.
    pub unknown: bool,
}

/// What derivation knows about one child key.
pub(crate) struct Child<'r> {
    /// Key after following committed identity aliases.
    pub resolved: EntityKey<'static>,
    /// Effective record; `None` when absent or deleted.
    pub record: Option<&'r Record>,
}

/// Derives one list instance from its evidence and the children changed after
/// it. `children` resolves every evidence item and changed key.
pub(crate) fn derive<'r>(
    relation: &Relation,
    filter: &Filter,
    evidence: &[CacheValue],
    changed: &BTreeSet<EntityKey<'static>>,
    children: &dyn Fn(&EntityKey<'static>) -> Child<'r>,
) -> Derivation {
    let unknown = || Derivation {
        value: CacheValue::List(evidence.to_vec()),
        unknown: true,
    };
    let changed: BTreeMap<EntityKey<'static>, Option<&Record>> = changed
        .iter()
        .map(|key| {
            let child = children(key);
            (child.resolved, child.record)
        })
        .collect();
    let mut seen = BTreeSet::new();
    let mut members = Vec::with_capacity(evidence.len());
    for item in evidence {
        let CacheValue::Ref(key) = item else {
            return unknown();
        };
        let resolved = children(key).resolved;
        if changed.contains_key(&resolved) || !seen.insert(resolved.clone()) {
            continue;
        }
        members.push(resolved);
    }
    let mut inserted = Vec::new();
    for (key, record) in &changed {
        let Some(record) = record else {
            continue;
        };
        if record
            .typename()
            .is_some_and(|name| name != relation.child_type)
        {
            continue;
        }
        match filter.matches(record) {
            Some(true) => inserted.push((key.clone(), *record)),
            Some(false) => {}
            None => return unknown(),
        }
    }
    if !inserted.is_empty() {
        let mut keyed = Vec::with_capacity(inserted.len());
        for (key, record) in inserted {
            let Some(order) = relation.order_key(record) else {
                return unknown();
            };
            keyed.push((order, key));
        }
        keyed.sort_by(|a, b| compare_keys((&a.0, &a.1), (&b.0, &b.1)));
        let mut orders = Vec::with_capacity(members.len());
        for key in &members {
            let Some(order) = children(key)
                .record
                .and_then(|record| relation.order_key(record))
            else {
                return unknown();
            };
            orders.push(order);
        }
        // Evidence is in server order; each change goes before the first
        // member that sorts after it.
        let mut merged = Vec::with_capacity(members.len() + keyed.len());
        let mut next = keyed.into_iter().peekable();
        for (key, order) in members.into_iter().zip(orders) {
            while let Some(insert) = next.next_if(|(insert, insert_key)| {
                compare_keys((insert, insert_key), (&order, &key)).is_lt()
            }) {
                merged.push(insert.1);
            }
            merged.push(key);
        }
        merged.extend(next.map(|(_, key)| key));
        members = merged;
    }
    Derivation {
        value: CacheValue::List(members.into_iter().map(CacheValue::Ref).collect()),
        unknown: false,
    }
}

#[cfg(test)]
mod test;
