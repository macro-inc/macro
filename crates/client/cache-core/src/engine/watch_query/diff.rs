//! Response diffs a document subscriber can apply to its previous result.
//!
//! Unlike row diffs, a document patch must target a path that already exists in
//! the subscriber's base, and no two value replacements may overlap. Objects
//! whose key set changed (another fragment type) are replaced at their own
//! path. A keyed list whose identities changed is either replaced at its own
//! path or, for subscribers that apply splices, edited in place: removals,
//! insertions and moves first, then field changes of surviving items at their
//! new positions.

use super::{ListSplice, QueryPatch, SpliceOp};
use crate::engine::live_query::{LiveFieldPatch, ResponsePathSegment};
use serde_json::Value as Json;

mod splice;

// Rough in-memory cost of one JSON value or object entry, beyond its text.
const JSON_NODE_BYTES: usize = 32;
// Wire cost charged to the budget for one removal or move.
const SPLICE_OP_BYTES: usize = 24;

#[derive(Clone, Copy)]
enum Segment<'a> {
    Field(&'a str),
    Index(usize),
}

/// Patches from `before` to `after`, with the change in retained bytes.
pub(super) struct ResponseDiff {
    pub patches: Vec<QueryPatch>,
    pub byte_delta: isize,
    /// Retained bytes of replaced values still allowed before giving up.
    budget: usize,
    /// Whether the subscriber applies keyed list splices.
    splices: bool,
}

/// Returns `None` when the root itself must be replaced, or when replaced
/// values exceed `budget` retained bytes: subscribers reconcile a complete
/// result faster than a patch that replaces most of it.
pub(super) fn diff_response(
    before: &Json,
    after: &Json,
    budget: usize,
    splices: bool,
) -> Option<ResponseDiff> {
    match (before, after) {
        (Json::Object(previous), Json::Object(next)) if same_keys(previous, next) => {}
        _ => return None,
    }
    let mut diff = ResponseDiff {
        patches: Vec::new(),
        byte_delta: 0,
        budget,
        splices,
    };
    diff.visit(before, after, &mut Vec::new())?;
    Some(diff)
}

impl ResponseDiff {
    fn visit<'a>(
        &mut self,
        before: &'a Json,
        after: &'a Json,
        path: &mut Vec<Segment<'a>>,
    ) -> Option<()> {
        match (before, after) {
            (Json::Object(previous), Json::Object(next)) if same_keys(previous, next) => {
                for ((_, previous), (key, value)) in previous.iter().zip(next) {
                    path.push(Segment::Field(key));
                    self.visit(previous, value, path)?;
                    path.pop();
                }
            }
            (Json::Array(previous), Json::Array(next))
                if previous.len() == next.len()
                    && previous.iter().zip(next).all(|(a, b)| same_item(a, b)) =>
            {
                for (index, (previous, value)) in previous.iter().zip(next).enumerate() {
                    path.push(Segment::Index(index));
                    self.visit(previous, value, path)?;
                    path.pop();
                }
            }
            _ if before == after => {}
            (Json::Array(previous), Json::Array(next))
                if self.splices && splice::keyed(previous) && splice::keyed(next) =>
            {
                self.splice(previous, next, splice::plan(previous, next), path)?;
            }
            _ => {
                let replaced = json_bytes(after);
                self.budget = self.budget.checked_sub(replaced)?;
                self.byte_delta += replaced as isize - json_bytes(before) as isize;
                self.patches.push(QueryPatch::Set(LiveFieldPatch {
                    path: response_path(path),
                    value: after.clone(),
                }));
            }
        }
        Some(())
    }

    /// Edits a keyed list in place, then diffs every surviving item at its new
    /// position. Inserted items carry their whole value.
    fn splice<'a>(
        &mut self,
        before: &'a [Json],
        after: &'a [Json],
        plan: splice::Plan,
        path: &mut Vec<Segment<'a>>,
    ) -> Option<()> {
        let mut ops = Vec::with_capacity(plan.ops.len());
        for op in plan.ops {
            ops.push(match op {
                splice::Op::Remove(index) => {
                    self.budget = self.budget.checked_sub(SPLICE_OP_BYTES)?;
                    self.byte_delta -= json_bytes(&before[index]) as isize;
                    SpliceOp::Remove { remove: index }
                }
                splice::Op::Move { from, to } => {
                    self.budget = self.budget.checked_sub(SPLICE_OP_BYTES)?;
                    SpliceOp::Move { from, to }
                }
                splice::Op::Insert { at, item } => {
                    let value = &after[item];
                    let bytes = json_bytes(value);
                    self.budget = self.budget.checked_sub(bytes)?;
                    self.byte_delta += bytes as isize;
                    SpliceOp::Insert {
                        insert: at,
                        value: value.clone(),
                    }
                }
            });
        }
        self.patches.push(QueryPatch::Splice(ListSplice {
            path: response_path(path),
            splice: ops,
        }));
        for (index, previous) in plan.sources.into_iter().enumerate() {
            let Some(previous) = previous else {
                continue;
            };
            path.push(Segment::Index(index));
            self.visit(&before[previous], &after[index], path)?;
            path.pop();
        }
        Some(())
    }
}

fn response_path(path: &[Segment<'_>]) -> Vec<ResponsePathSegment> {
    path.iter()
        .map(|segment| match segment {
            Segment::Field(field) => ResponsePathSegment::Field((*field).to_owned()),
            Segment::Index(index) => ResponsePathSegment::Index(*index),
        })
        .collect()
}

// Reads of one spec emit keys in a stable order, so comparing in order also
// pairs the values. A reordered map is merely replaced, never mispatched.
fn same_keys(
    before: &serde_json::Map<String, Json>,
    after: &serde_json::Map<String, Json>,
) -> bool {
    before.len() == after.len() && before.keys().eq(after.keys())
}

/// Objects keep their position while their selected identity is unchanged.
/// Other values are their own identity, so a changed scalar replaces its list.
fn same_item(before: &Json, after: &Json) -> bool {
    match (before, after) {
        (Json::Object(previous), Json::Object(next)) => {
            previous.get("id") == next.get("id")
                && previous.get("__typename") == next.get("__typename")
        }
        _ => before == after,
    }
}

/// Applies binding patches to the retained base so it stays the subscriber's
/// result. Returns the change in retained bytes, or `None` (leaving `data`
/// untouched) when a path is absent.
pub(super) fn apply_patches(data: &mut Json, patches: &[LiveFieldPatch]) -> Option<isize> {
    if !patches
        .iter()
        .all(|patch| slot(data, &patch.path).is_some())
    {
        return None;
    }
    let mut delta = 0;
    for patch in patches {
        let target = slot(data, &patch.path)?;
        delta += json_bytes(&patch.value) as isize - json_bytes(target) as isize;
        *target = patch.value.clone();
    }
    Some(delta)
}

fn slot<'a>(data: &'a mut Json, path: &[ResponsePathSegment]) -> Option<&'a mut Json> {
    path.iter().try_fold(data, |slot, segment| match segment {
        ResponsePathSegment::Field(field) => slot.as_object_mut()?.get_mut(field),
        ResponsePathSegment::Index(index) => slot.as_array_mut()?.get_mut(*index),
    })
}

/// Applies an ordered update the way subscribers do: value replacements at
/// existing paths and keyed splices whose indices refer to the list as edited
/// so far. Returns `None` for any inapplicable patch.
#[cfg(test)]
pub(super) fn apply_query_patches(data: &mut Json, patches: &[QueryPatch]) -> Option<()> {
    for patch in patches {
        match patch {
            QueryPatch::Set(patch) => *slot(data, &patch.path)? = patch.value.clone(),
            QueryPatch::Splice(splice) => {
                let items = slot(data, &splice.path)?.as_array_mut()?;
                for op in &splice.splice {
                    match op {
                        SpliceOp::Remove { remove } => {
                            (*remove < items.len()).then(|| items.remove(*remove))?;
                        }
                        SpliceOp::Insert { insert, value } => (*insert <= items.len())
                            .then(|| items.insert(*insert, value.clone()))?,
                        SpliceOp::Move { from, to } => {
                            (*from < items.len()).then_some(())?;
                            let item = items.remove(*from);
                            (*to <= items.len()).then(|| items.insert(*to, item))?;
                        }
                    }
                }
            }
        }
    }
    Some(())
}

/// Conservative retained size of a response value, for bounded watch retention.
pub(super) fn json_bytes(value: &Json) -> usize {
    JSON_NODE_BYTES
        + match value {
            Json::String(text) => text.len(),
            Json::Array(items) => items.iter().map(json_bytes).sum(),
            Json::Object(fields) => fields
                .iter()
                .map(|(key, value)| key.len() + JSON_NODE_BYTES + json_bytes(value))
                .sum(),
            _ => 0,
        }
}

#[cfg(test)]
mod test;
