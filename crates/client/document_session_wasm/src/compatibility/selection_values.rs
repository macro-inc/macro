//! Owned foreign selections and their leases, independent of editor graphs.
use crate::{BoundaryError, compatibility_generated::owned as compat};
use lexical_model::{
    ForeignSelectionIdentity, KeyParts, NodeKey, NodeSelection, Point, RangeSelection, Selection,
    TableSelection, TextFormat,
};
use std::collections::{BTreeMap, BTreeSet, HashMap};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Origin {
    Frozen,
    Active { update: u32 },
    Detached { update: u32 },
}

pub(super) struct Scope {
    pub historical: bool,
    pub state_version: u64,
    pub update: u32,
    pub activate: bool,
}

pub(super) struct SelectionValue {
    pub value: Selection,
    pub identity: ForeignSelectionIdentity,
    pub cached_nodes: Option<Vec<compat::ForeignNodeRef>>,
    pub origin: Origin,
    pub reference: compat::ForeignSelectionRef,
}
impl SelectionValue {
    fn snapshot(&self) -> Self {
        Self {
            value: raw_copy(&self.value),
            identity: self.identity.clone(),
            cached_nodes: self.cached_nodes.clone(),
            origin: self.origin,
            reference: self.reference,
        }
    }
}
struct Entry {
    value: SelectionValue,
    leases: u32,
    graphs: BTreeSet<u64>,
}
pub(super) struct SelectionValues {
    editor: u32,
    next_id: u32,
    entries: BTreeMap<u32, Entry>,
    identities: HashMap<ForeignSelectionIdentity, u32>,
}
impl SelectionValues {
    pub fn new(editor: u32) -> Self {
        Self {
            editor,
            next_id: 1,
            entries: BTreeMap::new(),
            identities: HashMap::new(),
        }
    }

    pub fn capture(
        &mut self,
        value: &Selection,
        identity: ForeignSelectionIdentity,
        graph_version: u64,
        origin: Origin,
    ) -> Result<compat::CompatSelectionData, BoundaryError> {
        if matches!(origin, Origin::Detached { .. }) {
            return Err(BoundaryError::Invalid("selection capture origin"));
        }
        let id = if let Some(id) = self.identities.get(&identity).copied() {
            let entry = self
                .entries
                .get_mut(&id)
                .ok_or(BoundaryError::Invalid("selection identity"))?;
            if !same_kind(&entry.value.value, value) {
                return Err(BoundaryError::Invalid("selection kind"));
            }
            // The same JS object retains its raw caches and allocation reference.
            // A frozen object can never become writable through recapture.
            if entry.value.origin != Origin::Frozen {
                entry.value.value = raw_copy(value);
                entry.value.origin = origin;
            }
            entry.graphs.insert(graph_version);
            id
        } else {
            self.insert(raw_copy(value), identity, graph_version, origin, 0)?
        };
        let entry = self
            .entries
            .get(&id)
            .ok_or(BoundaryError::Invalid("selection identity"))?;
        Ok(encode(&entry.value))
    }

    pub fn allocate(
        &mut self,
        value: Selection,
        graph_version: u64,
        update: u32,
    ) -> Result<compat::ForeignSelectionRef, BoundaryError> {
        let id = self.insert(
            value,
            ForeignSelectionIdentity::default(),
            graph_version,
            Origin::Detached { update },
            0,
        )?;
        Ok(self
            .entries
            .get(&id)
            .ok_or(BoundaryError::Invalid("selection allocation"))?
            .value
            .reference)
    }

    fn insert(
        &mut self,
        value: Selection,
        identity: ForeignSelectionIdentity,
        version: u64,
        origin: Origin,
        leases: u32,
    ) -> Result<u32, BoundaryError> {
        if self.editor == 0 {
            return Err(BoundaryError::Invalid("selection editor"));
        }
        let id = self.next_id;
        let next = id
            .checked_add(1)
            .ok_or(BoundaryError::Invalid("selection allocation exhausted"))?;
        let reference = compat::ForeignSelectionRef {
            editor_id: self.editor,
            version,
            selection_id: id,
        };
        self.identities.insert(identity.clone(), id);
        self.entries.insert(
            id,
            Entry {
                value: SelectionValue {
                    value,
                    identity,
                    cached_nodes: None,
                    origin,
                    reference,
                },
                leases,
                graphs: [version].into(),
            },
        );
        self.next_id = next;
        Ok(id)
    }

    fn entry(&self, reference: compat::ForeignSelectionRef) -> Result<&Entry, BoundaryError> {
        let id = reference.selection_id;
        let entry = self
            .entries
            .get(&id)
            .ok_or(BoundaryError::Invalid("unknown selection reference"))?;
        if reference.editor_id != self.editor || reference != entry.value.reference || id == 0 {
            return Err(BoundaryError::Invalid("selection reference"));
        }
        Ok(entry)
    }

    pub fn get(
        &self,
        reference: compat::ForeignSelectionRef,
    ) -> Result<SelectionValue, BoundaryError> {
        Ok(self.entry(reference)?.value.snapshot())
    }

    pub fn patch(
        &mut self,
        reference: compat::ForeignSelectionRef,
        data: compat::CompatSelectionData,
        scope: Scope,
    ) -> Result<SelectionValue, BoundaryError> {
        let entry = self.entry(reference)?;
        match entry.value.origin {
            Origin::Frozen => return Err(BoundaryError::Invalid("frozen selection")),
            Origin::Active { update } if scope.historical || update != scope.update => {
                return Err(BoundaryError::Invalid("selection update"));
            }
            Origin::Detached { .. } if scope.historical && scope.activate => {
                return Err(BoundaryError::Invalid("historical selection activation"));
            }
            _ => {}
        }
        let (value, cached_nodes, supplied) = decode(data)?;
        if supplied != reference || !same_kind(&entry.value.value, &value) {
            return Err(BoundaryError::Invalid("selection patch identity"));
        }
        let id = reference.selection_id;
        let entry = self
            .entries
            .get_mut(&id)
            .ok_or(BoundaryError::Invalid("selection reference"))?;
        entry.value.value = value;
        entry.value.cached_nodes = cached_nodes;
        if scope.activate {
            entry.value.origin = Origin::Active {
                update: scope.update,
            };
        }
        // state_version chooses the graph pin; allocation version never does.
        entry.graphs.insert(scope.state_version);
        Ok(entry.value.snapshot())
    }

    pub fn retain(&mut self, reference: compat::ForeignSelectionRef) -> Result<(), BoundaryError> {
        let leases = self
            .entry(reference)?
            .leases
            .checked_add(1)
            .ok_or(BoundaryError::Invalid("selection lease exhausted"))?;
        let id = reference.selection_id;
        self.entries
            .get_mut(&id)
            .ok_or(BoundaryError::Invalid("selection reference"))?
            .leases = leases;
        Ok(())
    }

    pub fn release(&mut self, reference: compat::ForeignSelectionRef) -> Result<(), BoundaryError> {
        let leases = self
            .entry(reference)?
            .leases
            .checked_sub(1)
            .ok_or(BoundaryError::Invalid("selection lease underflow"))?;
        let id = reference.selection_id;
        self.entries
            .get_mut(&id)
            .ok_or(BoundaryError::Invalid("selection reference"))?
            .leases = leases;
        self.prune();
        Ok(())
    }

    pub fn release_graph(&mut self, version: u64) {
        for entry in self.entries.values_mut() {
            entry.graphs.remove(&version);
        }
        self.prune();
    }

    pub fn finish_update(&mut self, update: u32, published: bool) {
        for entry in self.entries.values_mut() {
            if entry.value.origin == (Origin::Active { update }) {
                entry.value.origin = if published {
                    Origin::Frozen
                } else {
                    Origin::Detached { update }
                };
            }
        }
        self.prune();
    }

    fn prune(&mut self) {
        self.entries.retain(|_, entry| {
            let keep = entry.leases > 0 || !entry.graphs.is_empty();
            if !keep {
                self.identities.remove(&entry.value.identity);
            }
            keep
        });
    }
}

fn raw_copy(value: &Selection) -> Selection {
    value.clone().with_foreign_value_metadata(
        value.is_dirty(),
        value
            .as_range()
            .and_then(RangeSelection::cached_is_backward),
    )
}
fn same_kind(a: &Selection, b: &Selection) -> bool {
    std::mem::discriminant(a) == std::mem::discriminant(b)
}
fn key(key: NodeKey) -> compat::ForeignKey {
    compat::ForeignKey {
        index: key.index(),
        generation: key.generation(),
    }
}
fn point(point: Point) -> compat::CompatPoint {
    compat::CompatPoint {
        key: key(point.key()),
        offset: point.offset(),
        kind: match point {
            Point::Text { .. } => compat::CompatPointKind::Text,
            Point::Element { .. } => compat::CompatPointKind::Element,
        },
    }
}
fn decode_key(key: compat::ForeignKey) -> Result<NodeKey, BoundaryError> {
    if key.index == 0 && key.generation != 0 {
        return Err(BoundaryError::Invalid("selection root key"));
    }
    Ok(NodeKey::from_parts(KeyParts {
        index: key.index,
        generation: key.generation,
    }))
}
fn decode_point(point: compat::CompatPoint) -> Result<Point, BoundaryError> {
    let key = decode_key(point.key)?;
    match point.kind {
        compat::CompatPointKind::Text => {
            Ok(Point::text(key, lexical_model::Utf16Offset(point.offset)))
        }
        compat::CompatPointKind::Element => {
            Ok(Point::element(key, lexical_model::ChildIndex(point.offset)))
        }
        compat::CompatPointKind::Unknown => Err(BoundaryError::Invalid("selection point kind")),
    }
}
fn cache(
    present: bool,
    nodes: Vec<compat::ForeignNodeRef>,
) -> Result<Option<Vec<compat::ForeignNodeRef>>, BoundaryError> {
    if !present && !nodes.is_empty() {
        return Err(BoundaryError::Invalid("selection node cache flag"));
    }
    Ok(present.then_some(nodes))
}
fn decode(
    data: compat::CompatSelectionData,
) -> Result<
    (
        Selection,
        Option<Vec<compat::ForeignNodeRef>>,
        compat::ForeignSelectionRef,
    ),
    BoundaryError,
> {
    match data {
        compat::CompatSelectionData::CompatRangeSelection {
            reference,
            anchor,
            focus,
            format,
            style,
            dirty,
            has_cached_backward,
            cached_backward,
            has_cached_nodes,
            cached_nodes,
        } => {
            if !has_cached_backward && cached_backward {
                return Err(BoundaryError::Invalid("selection direction cache flag"));
            }
            let mut range = RangeSelection::new(decode_point(anchor)?, decode_point(focus)?);
            range.format =
                TextFormat::from_bits(format).ok_or(BoundaryError::Invalid("selection format"))?;
            range.style = String::from_utf16(&style)
                .map_err(|_| BoundaryError::Invalid("selection style UTF-16"))?
                .into();
            Ok((
                Selection::Range(range).with_foreign_value_metadata(
                    dirty,
                    has_cached_backward.then_some(cached_backward),
                ),
                cache(has_cached_nodes, cached_nodes)?,
                reference,
            ))
        }
        compat::CompatSelectionData::CompatNodeSelection {
            reference,
            keys,
            dirty,
            has_cached_nodes,
            cached_nodes,
        } => {
            let mut selection = NodeSelection::new();
            for key in keys {
                let key = decode_key(key)?;
                if selection.has(key) {
                    return Err(BoundaryError::Invalid("duplicate selection key"));
                }
                selection.add(key);
            }
            Ok((
                Selection::Node(selection).with_foreign_value_metadata(dirty, None),
                cache(has_cached_nodes, cached_nodes)?,
                reference,
            ))
        }
        compat::CompatSelectionData::CompatTableSelection {
            reference,
            table_key,
            anchor,
            focus,
            dirty,
            has_cached_nodes,
            cached_nodes,
        } => {
            let anchor = decode_point(anchor)?;
            let focus = decode_point(focus)?;
            let mut table = TableSelection::new(decode_key(table_key)?, anchor.key(), focus.key());
            table.anchor = anchor;
            table.focus = focus;
            Ok((
                Selection::Table(table).with_foreign_value_metadata(dirty, None),
                cache(has_cached_nodes, cached_nodes)?,
                reference,
            ))
        }
        _ => Err(BoundaryError::Invalid("selection patch variant")),
    }
}
fn encode(value: &SelectionValue) -> compat::CompatSelectionData {
    let reference = value.reference;
    let dirty = value.value.is_dirty();
    let has_cached_nodes = value.cached_nodes.is_some();
    let cached_nodes = value.cached_nodes.clone().unwrap_or_default();
    match &value.value {
        Selection::Range(range) => compat::CompatSelectionData::CompatRangeSelection {
            reference,
            anchor: point(range.anchor),
            focus: point(range.focus),
            format: range.format.bits(),
            style: range.style.encode_utf16().collect(),
            dirty,
            has_cached_backward: range.cached_is_backward().is_some(),
            cached_backward: range.cached_is_backward().unwrap_or(false),
            has_cached_nodes,
            cached_nodes,
        },
        Selection::Node(nodes) => compat::CompatSelectionData::CompatNodeSelection {
            reference,
            keys: nodes.keys().map(key).collect(),
            dirty,
            has_cached_nodes,
            cached_nodes,
        },
        Selection::Table(table) => compat::CompatSelectionData::CompatTableSelection {
            reference,
            table_key: key(table.table),
            anchor: point(table.anchor),
            focus: point(table.focus),
            dirty,
            has_cached_nodes,
            cached_nodes,
        },
    }
}

#[cfg(test)]
mod test;
