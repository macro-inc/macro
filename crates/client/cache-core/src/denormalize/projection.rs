//! Response-path bindings compiled by the schema-aware read, never from IDs
//! guessed out of response JSON. Relationship changes require a fresh read.
//!
//! Bound paths share prefixes in one node tree and names are interned, so a
//! binding costs a few words rather than an owned path per field.

use super::*;
use crate::engine::live_query::{LiveFieldPatch, ResponsePathSegment};
use std::collections::HashMap;
use std::mem::size_of;

const NO_NODE: u32 = u32::MAX;
// Direct-mapped slots in front of the interning map; selections repeat per row.
const RECENT_NAMES: usize = 256;
// Conservative overhead of one bound record: its key twice, index and list.
const RECORD_BYTES: usize = 160;

#[derive(Default)]
pub(crate) struct QueryProjection {
    records: Vec<(EntityKey<'static>, Vec<Binding>)>,
    index: HashMap<EntityKey<'static>, u32>,
    nodes: Vec<Node>,
    names: Vec<Box<str>>,
    bytes: usize,
    compile: Option<Box<Compile>>,
    /// Child types of derived lists: any change to their records re-reads.
    relation_types: BTreeSet<String>,
}

/// State that only lives while the read builds the projection. Names are
/// keyed by address, which is stable only while the read borrows its document.
#[derive(Default)]
struct Compile {
    names: HashMap<(usize, usize), u32>,
    recent: Vec<(usize, usize, u32)>,
    /// Nodes of the previous binding's path, to share its prefix.
    cursor: Vec<(Step, u32)>,
    owner: Option<u32>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Step {
    Field(usize, usize),
    Index(usize),
}

#[derive(Clone, Copy)]
enum Segment {
    Field(u32),
    Index(u32),
    /// A tombstoned list item omitted from the response.
    Removed,
}

struct Node {
    parent: u32,
    segment: Segment,
}

/// One selected or guarded field of a record. Guards have no path: any change
/// to them is structural.
struct Binding {
    key: u32,
    node: u32,
    structural: bool,
    value: Option<CacheValue>,
    selection: ValueProjection,
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
    key: u32,
    response_key: u32,
    value: ValueProjection,
}

fn step(part: &ResponsePath<'_>) -> Step {
    match part {
        ResponsePath::Field(field) => Step::Field(field.as_ptr() as usize, field.len()),
        ResponsePath::Index(index) => Step::Index(*index),
    }
}

impl QueryProjection {
    /// Whether any field of `key` is bound or guarded.
    pub(crate) fn binds(&self, key: &EntityKey<'static>) -> bool {
        self.index.contains_key(key)
    }

    /// Whether a change to `key` can change a derived list this read used,
    /// including records it has never read (new members).
    pub(crate) fn derives_from(&self, key: &EntityKey<'static>) -> bool {
        !self.relation_types.is_empty()
            && key
                .typename()
                .is_some_and(|name| self.relation_types.contains(name))
    }

    pub(super) fn relation_type(&mut self, child_type: &str) {
        if !self.relation_types.contains(child_type) {
            self.bytes += child_type.len() + RECORD_BYTES;
            self.relation_types.insert(child_type.to_owned());
        }
    }

    // Conservative accounting includes tree, map and list allocations.
    pub(crate) fn retained_bytes(&self) -> usize {
        self.bytes
            + self.nodes.capacity() * size_of::<Node>()
            + self.names.iter().map(|name| name.len() + 16).sum::<usize>()
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
        owner: &EntityKey<'static>,
        field: &str,
        value: Option<&CacheValue>,
    ) {
        let key = self.intern(field);
        let bytes = size_of::<Binding>() + value.map_or(0, value_bytes);
        let bindings = self.bindings(owner);
        if bindings
            .iter()
            .any(|binding| binding.structural && binding.key == key)
        {
            return;
        }
        bindings.push(Binding {
            key,
            node: NO_NODE,
            structural: true,
            value: value.cloned(),
            selection: ValueProjection::Structural,
        });
        self.bytes += bytes;
    }

    pub(super) fn selected_field(
        &mut self,
        owner: &EntityKey<'static>,
        key: &str,
        value: Option<&CacheValue>,
        path: &[ResponsePath<'_>],
        selection: ValueProjection,
    ) {
        let node = self.node(path);
        let key = self.intern(key);
        self.bytes +=
            size_of::<Binding>() + value.map_or(0, value_bytes) + selection.retained_bytes();
        self.bindings(owner).push(Binding {
            key,
            node,
            structural: false,
            value: value.cloned(),
            selection,
        });
    }

    fn bindings(&mut self, owner: &EntityKey<'static>) -> &mut Vec<Binding> {
        let compile = self.compile.get_or_insert_with(Default::default);
        let slot = match compile.owner {
            Some(slot) if self.records[slot as usize].0 == *owner => slot,
            _ => {
                let slot = match self.index.get(owner) {
                    Some(slot) => *slot,
                    None => {
                        let slot = self.records.len() as u32;
                        self.records.push((owner.clone(), Vec::new()));
                        self.index.insert(owner.clone(), slot);
                        self.bytes += 2 * owner.as_ref().len() + RECORD_BYTES;
                        slot
                    }
                };
                compile.owner = Some(slot);
                slot
            }
        };
        &mut self.records[slot as usize].1
    }

    /// The node for `path`, sharing the prefix of the previous binding's path.
    fn node(&mut self, path: &[ResponsePath<'_>]) -> u32 {
        let compile = self.compile.get_or_insert_with(Default::default);
        let shared = compile
            .cursor
            .iter()
            .zip(path)
            .take_while(|((cursor, _), part)| *cursor == step(part))
            .count();
        compile.cursor.truncate(shared);
        let mut parent = compile.cursor.last().map_or(NO_NODE, |(_, node)| *node);
        for part in &path[shared..] {
            let segment = match part {
                ResponsePath::Field(field) => Segment::Field(self.intern(field)),
                ResponsePath::Index(index) => Segment::Index(*index as u32),
            };
            let node = self.nodes.len() as u32;
            self.nodes.push(Node { parent, segment });
            self.compile
                .get_or_insert_with(Default::default)
                .cursor
                .push((step(part), node));
            parent = node;
        }
        parent
    }

    fn intern(&mut self, name: &str) -> u32 {
        let compile = self.compile.get_or_insert_with(Default::default);
        if compile.recent.is_empty() {
            compile.recent = vec![(0, 0, 0); RECENT_NAMES];
        }
        let address = (name.as_ptr() as usize, name.len());
        let slot = (address.0 >> 3 ^ address.1) % RECENT_NAMES;
        let (cached, length, id) = compile.recent[slot];
        if (cached, length) == address {
            return id;
        }
        let id = *compile.names.entry(address).or_insert_with(|| {
            self.names.push(name.into());
            self.names.len() as u32 - 1
        });
        compile.recent[slot] = (address.0, address.1, id);
        id
    }

    /// Ends compilation: interned addresses are only valid during the read.
    pub(super) fn finish(&mut self) {
        self.compile = None;
        self.nodes.shrink_to_fit();
    }

    /// Follows list compaction: later items move up one position per removed
    /// item. A removed (deleted) record selects no fields, and its guard still
    /// detects a restore. `removed` uses pre-compaction positions; like
    /// compaction itself, later and deeper removals apply first.
    pub(super) fn compact(&mut self, removed: &BTreeSet<Vec<ResponsePath<'_>>>) {
        for item in removed.iter().rev() {
            let Some((ResponsePath::Index(index), parent)) = item.split_last() else {
                continue;
            };
            for node in 0..self.nodes.len() {
                let Segment::Index(position) = self.nodes[node].segment else {
                    continue;
                };
                if !self.is_path(self.nodes[node].parent, parent) {
                    continue;
                }
                self.nodes[node].segment = match (position as usize).cmp(index) {
                    std::cmp::Ordering::Equal => Segment::Removed,
                    std::cmp::Ordering::Greater => Segment::Index(position - 1),
                    std::cmp::Ordering::Less => continue,
                };
            }
        }
    }

    fn is_path(&self, mut node: u32, path: &[ResponsePath<'_>]) -> bool {
        for part in path.iter().rev() {
            let Some(current) = self.nodes.get(node as usize) else {
                return false;
            };
            let same = match (current.segment, part) {
                (Segment::Field(name), ResponsePath::Field(field)) => {
                    *self.names[name as usize] == **field
                }
                (Segment::Index(position), ResponsePath::Index(index)) => {
                    position as usize == *index
                }
                _ => false,
            };
            if !same {
                return false;
            }
            node = current.parent;
        }
        node == NO_NODE
    }

    /// The response path of `node`, or `None` inside a removed list item.
    fn path(&self, mut node: u32) -> Option<Vec<ResponsePathSegment>> {
        let mut path = Vec::new();
        while node != NO_NODE {
            let current = &self.nodes[node as usize];
            path.push(match current.segment {
                Segment::Field(name) => {
                    ResponsePathSegment::Field(self.names[name as usize].to_string())
                }
                Segment::Index(index) => ResponsePathSegment::Index(index as usize),
                Segment::Removed => return None,
            });
            node = current.parent;
        }
        path.reverse();
        Some(path)
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
            let (_, bindings) = &self.records[*self.index.get(key)? as usize];
            let record = record.as_ref()?;
            for binding in bindings {
                let value = record.fields.get(&*self.names[binding.key as usize]);
                if value == binding.value.as_ref() {
                    continue;
                }
                if binding.structural {
                    return None;
                }
                // A binding inside an omitted item has no visible output.
                let Some(mut path) = self.path(binding.node) else {
                    continue;
                };
                binding.selection.update(
                    &self.names,
                    binding.value.as_ref()?,
                    value?,
                    &mut path,
                    &mut patches,
                )?;
            }
        }
        let mut byte_delta = 0;
        for (key, record) in records {
            let slot = *self.index.get(key)? as usize;
            let record = record.as_ref()?;
            for binding in &mut self.records[slot].1 {
                let value = record.fields.get(&*self.names[binding.key as usize]);
                if value != binding.value.as_ref() {
                    byte_delta += value.map_or(0, value_bytes) as isize
                        - binding.value.as_ref().map_or(0, value_bytes) as isize;
                    binding.value = value.cloned();
                }
            }
        }
        self.bytes = self.bytes.saturating_add_signed(byte_delta);
        Some((patches, byte_delta))
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "explicit schema and read dependencies"
    )]
    pub(super) fn compile_value<'a>(
        &mut self,
        schema: &'a crate::meta::Schema,
        value: Option<&CacheValue>,
        field: &'a FieldNode,
        ty: &meta::FieldType,
        variables: &serde_json::Map<String, Json>,
        resolvers: &EntityResolverLookup,
        plans: &mut ReadPlans<'a>,
    ) -> Result<ValueProjection, DenormalizeError> {
        if ty.kind != meta::FieldKind::Composite {
            return Ok(ValueProjection::Leaf);
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
                        FieldSource::Stored { key, ty } => {
                            let value = self.compile_value(
                                schema,
                                values.get(key.as_ref()),
                                selected.node,
                                ty,
                                variables,
                                resolvers,
                                plans,
                            )?;
                            fields.push(EmbeddedField {
                                key: self.intern(key),
                                response_key: self.intern(&selected.node.response_key),
                                value,
                            });
                        }
                        _ => return Ok(ValueProjection::Structural),
                    }
                }
                ValueProjection::Object(fields)
            }
            Some(CacheValue::List(values)) => ValueProjection::List(
                values
                    .iter()
                    .map(|value| {
                        self.compile_value(
                            schema,
                            Some(value),
                            field,
                            ty,
                            variables,
                            resolvers,
                            plans,
                        )
                    })
                    .collect::<Result<_, _>>()?,
            ),
            _ => ValueProjection::Structural,
        })
    }
}

impl ValueProjection {
    fn update(
        &self,
        names: &[Box<str>],
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
                    let key = &*names[field.key as usize];
                    path.push(ResponsePathSegment::Field(
                        names[field.response_key as usize].to_string(),
                    ));
                    field
                        .value
                        .update(names, before.get(key)?, after.get(key)?, path, patches)?;
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
                    selection.update(names, before, after, path, patches)?;
                    path.pop();
                }
            }
            _ => return None,
        }
        Some(())
    }

    fn retained_bytes(&self) -> usize {
        match self {
            Self::Object(fields) => fields
                .iter()
                .map(|field| size_of::<EmbeddedField>() + field.value.retained_bytes())
                .sum(),
            Self::List(items) => items
                .iter()
                .map(|item| size_of::<Self>() + item.retained_bytes())
                .sum(),
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
