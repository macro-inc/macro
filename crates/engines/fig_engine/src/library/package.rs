//! A package of library assets for another file: the assets (a variant
//! brings its whole component set) and everything they use, on the
//! internal page of a copy written as [`crate::save::copy`] writes one.

use super::{dependencies, local_assets, set_of};
use crate::document::{Document, NodeIdx};
use crate::error::{FigError, Result};
use crate::model::NodeType;
use crate::save::{Copied, write_copy};
use std::collections::HashSet;

fn subtree(doc: &Document, i: NodeIdx, out: &mut Vec<NodeIdx>) {
    out.push(i);
    for &c in &doc.node(i).children {
        if !doc.node(c).removed {
            subtree(doc, c, out);
        }
    }
}

/// Adds asset `r` (with its layers) to the package unless it is in;
/// returns the layers added.
fn add_root(
    doc: &Document,
    r: NodeIdx,
    included: &mut HashSet<NodeIdx>,
    roots: &mut Vec<NodeIdx>,
    nodes: &mut Vec<NodeIdx>,
) -> Vec<NodeIdx> {
    if included.contains(&r) {
        return Vec::new();
    }
    let mut list = Vec::new();
    subtree(doc, r, &mut list);
    included.extend(list.iter().copied());
    roots.push(r);
    nodes.extend(list.iter().copied());
    list
}

/// The assets named by `keys` (published or private) with what they use,
/// from `doc` opened from `original`.
pub fn package(doc: &Document, original: &[u8], keys: &[String]) -> Result<Copied> {
    let assets = local_assets(doc);
    let mut roots: Vec<NodeIdx> = Vec::new();
    let mut nodes: Vec<NodeIdx> = Vec::new();
    let mut included: HashSet<NodeIdx> = HashSet::new();
    let mut scan = Vec::new();
    for key in keys {
        let Some(&(i, _)) = assets
            .iter()
            .find(|(i, _)| doc.props(*i).key.as_deref() == Some(key.as_str()))
        else {
            continue;
        };
        let root = set_of(doc, i).unwrap_or(i);
        scan.extend(add_root(doc, root, &mut included, &mut roots, &mut nodes));
    }
    if roots.is_empty() {
        return Err(FigError::Unsupported(
            "the library has none of those assets".into(),
        ));
    }
    while !scan.is_empty() {
        let mut deps = Vec::new();
        for &n in &scan {
            dependencies(doc.props(n), &mut deps);
        }
        let mut next = Vec::new();
        for g in deps {
            let Some(d) = doc.find(crate::edit::guid_of(doc, g)) else {
                continue;
            };
            if doc.node(d).removed
                || included.contains(&d)
                || matches!(
                    doc.props(d).node_type(),
                    NodeType::Canvas | NodeType::Document
                )
            {
                continue;
            }
            // A variant brings its set.
            let root = set_of(doc, d).unwrap_or(d);
            next.extend(add_root(doc, root, &mut included, &mut roots, &mut nodes));
        }
        scan = next;
    }
    write_copy(doc, original, &[], &[], &roots, &nodes)
}
