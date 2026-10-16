//! Response diffs a document subscriber can apply to its previous result.
//!
//! Unlike row diffs, a document patch must target a path that already exists in
//! the subscriber's base, and no two patches may overlap. Objects whose key set
//! changed (another fragment type) and lists whose identities moved are
//! replaced at their own path instead of being patched below it.

use crate::engine::live_query::{LiveFieldPatch, ResponsePathSegment};
use serde_json::Value as Json;

// Rough in-memory cost of one JSON value or object entry, beyond its text.
const JSON_NODE_BYTES: usize = 32;

#[derive(Clone, Copy)]
enum Segment<'a> {
    Field(&'a str),
    Index(usize),
}

/// Patches from `before` to `after`, with the change in retained bytes.
pub(super) struct ResponseDiff {
    pub patches: Vec<LiveFieldPatch>,
    pub byte_delta: isize,
    /// Retained bytes of replaced values still allowed before giving up.
    budget: usize,
}

/// Returns `None` when the root itself must be replaced, or when replaced
/// values exceed `budget` retained bytes: subscribers reconcile a complete
/// result faster than a patch that replaces most of it.
pub(super) fn diff_response(before: &Json, after: &Json, budget: usize) -> Option<ResponseDiff> {
    match (before, after) {
        (Json::Object(previous), Json::Object(next)) if same_keys(previous, next) => {}
        _ => return None,
    }
    let mut diff = ResponseDiff {
        patches: Vec::new(),
        byte_delta: 0,
        budget,
    };
    diff.visit(before, after, &mut Vec::new())?;
    Some(diff)
}

impl ResponseDiff {
    fn visit<'a>(
        &mut self,
        before: &Json,
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
            _ => {
                let replaced = json_bytes(after);
                self.budget = self.budget.checked_sub(replaced)?;
                self.byte_delta += replaced as isize - json_bytes(before) as isize;
                self.patches.push(LiveFieldPatch {
                    path: path
                        .iter()
                        .map(|segment| match segment {
                            Segment::Field(field) => {
                                ResponsePathSegment::Field((*field).to_owned())
                            }
                            Segment::Index(index) => ResponsePathSegment::Index(*index),
                        })
                        .collect(),
                    value: after.clone(),
                });
            }
        }
        Some(())
    }
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
