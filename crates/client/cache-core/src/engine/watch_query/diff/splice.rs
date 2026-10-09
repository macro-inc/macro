//! Minimal keyed edit scripts between two lists of identified objects.
//!
//! Items keep their place when they belong to a longest run that already has
//! the target order. Every other surviving item moves once and every new item
//! is inserted once, each directly after its target predecessor. Removals come
//! first, from the end, so their indices never shift.

use serde_json::Value as Json;
use std::collections::{HashMap, HashSet};

/// One edit, using indices of the list as edited by the preceding operations.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Op {
    Remove(usize),
    /// Removes the item at `from`, then inserts it at `to`.
    Move {
        from: usize,
        to: usize,
    },
    /// Inserts `after[item]` at `at`.
    Insert {
        at: usize,
        item: usize,
    },
}

pub(super) struct Plan {
    pub ops: Vec<Op>,
    /// For each target position, the source position of a surviving item.
    pub sources: Vec<Option<usize>>,
}

type Key<'a> = (Option<&'a Json>, &'a Json);

fn key(item: &Json) -> Option<Key<'_>> {
    let object = item.as_object()?;
    let id = object.get("id").filter(|id| !id.is_null())?;
    Some((object.get("__typename"), id))
}

/// Whether every item is an object with a selected `id`, unique in the list.
pub(super) fn keyed(items: &[Json]) -> bool {
    let mut seen = HashSet::with_capacity(items.len());
    items
        .iter()
        .all(|item| key(item).is_some_and(|key| seen.insert(key)))
}

/// Plans the edit from `before` to `after`; both lists must be [`keyed`].
pub(super) fn plan(before: &[Json], after: &[Json]) -> Plan {
    let positions: HashMap<Key<'_>, usize> = before
        .iter()
        .enumerate()
        .filter_map(|(index, item)| Some((key(item)?, index)))
        .collect();
    let sources: Vec<Option<usize>> = after
        .iter()
        .map(|item| key(item).and_then(|key| positions.get(&key).copied()))
        .collect();
    let stable = longest_increasing(&sources);

    let retained: HashSet<usize> = sources.iter().flatten().copied().collect();
    let mut ops = Vec::new();
    // Identity of each current item: its source position, or its target
    // position once inserted. Disjoint ranges keep the two apart.
    let offset = before.len();
    let mut current: Vec<usize> = (0..before.len()).collect();
    for index in (0..before.len()).rev() {
        if !retained.contains(&index) {
            ops.push(Op::Remove(index));
            current.remove(index);
        }
    }
    let identity = |target: usize| sources[target].unwrap_or(offset + target);
    for (target, source) in sources.iter().enumerate() {
        if source.is_some_and(|source| stable.contains(&source)) {
            continue;
        }
        let at = match target.checked_sub(1) {
            Some(previous) => {
                let previous = identity(previous);
                current
                    .iter()
                    .position(|item| *item == previous)
                    .expect("predecessor is present")
                    + 1
            }
            None => 0,
        };
        match source {
            Some(source) => {
                let from = current
                    .iter()
                    .position(|item| item == source)
                    .expect("moved item is present");
                let to = if from < at { at - 1 } else { at };
                if from != to {
                    let item = current.remove(from);
                    current.insert(to, item);
                    ops.push(Op::Move { from, to });
                }
            }
            None => {
                current.insert(at, offset + target);
                ops.push(Op::Insert { at, item: target });
            }
        }
    }
    Plan { ops, sources }
}

/// Source positions forming a longest increasing subsequence, in O(n log n).
fn longest_increasing(sources: &[Option<usize>]) -> HashSet<usize> {
    // tails[k]: index into `sources` of the smallest tail of a run of length k+1.
    let mut tails: Vec<usize> = Vec::new();
    let mut previous = vec![None; sources.len()];
    for (index, source) in sources.iter().enumerate() {
        let Some(source) = *source else {
            continue;
        };
        let length = tails.partition_point(|tail| sources[*tail].is_some_and(|tail| tail < source));
        if length > 0 {
            previous[index] = Some(tails[length - 1]);
        }
        if length == tails.len() {
            tails.push(index);
        } else {
            tails[length] = index;
        }
    }
    let mut stable = HashSet::with_capacity(tails.len());
    let mut cursor = tails.last().copied();
    while let Some(index) = cursor {
        stable.insert(sources[index].expect("run items survive"));
        cursor = previous[index];
    }
    stable
}

#[cfg(test)]
mod test;
