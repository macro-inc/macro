//! The page tree (ISO 32000-1 §7.7.3): pages in order with the attributes
//! they inherit. Cycles, broken `Kids`, and wrong `Count`s are tolerated;
//! a file whose tree yields no pages falls back to its `Page` objects.

use super::{Dict, Object, PageRef, Pdf};

/// Attributes pages inherit from their ancestors.
const INHERITED: [&str; 4] = ["Resources", "MediaBox", "CropBox", "Rotate"];

/// How many nodes a walk visits at most (a tree that is really a graph
/// with shared subtrees could otherwise explode).
const MAX_NODES: usize = 1 << 18;

/// How deep the tree may be.
const MAX_DEPTH: usize = 256;

/// Inheritable attributes, by [`INHERITED`] index.
#[derive(Clone, Default)]
struct Inherited([Option<Object>; 4]);

impl Inherited {
    /// These, overridden by what `node` sets.
    fn with(&self, node: &Dict) -> Inherited {
        let mut out = self.clone();
        for (slot, key) in out.0.iter_mut().zip(INHERITED) {
            if let Some(v) = node.get(key) {
                *slot = Some(v.clone());
            }
        }
        out
    }

    /// `page` with what it lacks filled in.
    fn apply(&self, mut page: Dict) -> Dict {
        for (slot, key) in self.0.iter().zip(INHERITED) {
            if let Some(v) = slot
                && !page.contains(key)
            {
                page.set(key, v.clone());
            }
        }
        page
    }
}

/// An intermediate node being walked.
struct Frame {
    num: Option<u32>,
    kids: Vec<Object>,
    next: usize,
    inherited: Inherited,
}

/// Whether a node has kids rather than being a page (untyped nodes go by
/// whether they have `Kids`).
fn is_tree_node(dict: &Dict) -> bool {
    dict.is("Type", "Pages") || (!dict.is("Type", "Page") && dict.contains("Kids"))
}

impl Pdf {
    /// The pages, in order.
    pub(super) fn page_tree(&self) -> Vec<PageRef> {
        let mut pages = Vec::new();
        if let Some(root) = self.catalog().and_then(|c| c.get("Pages").cloned()) {
            self.walk(root, &mut pages);
        }
        if pages.is_empty() {
            self.loose_pages(&mut pages);
        }
        pages
    }

    /// Depth first from `root`; a node that is its own ancestor is skipped.
    fn walk(&self, root: Object, out: &mut Vec<PageRef>) {
        let mut stack: Vec<Frame> = Vec::new();
        let mut visits = 0;
        let mut pending = Some((root, Inherited::default()));
        loop {
            if let Some((node, inherited)) = pending.take() {
                visits += 1;
                if visits > MAX_NODES {
                    break;
                }
                let num = node.as_ref().map(|r| r.num);
                if num.is_some_and(|n| stack.iter().any(|f| f.num == Some(n))) {
                    continue;
                }
                let Object::Dict(dict) = self.resolve(&node) else {
                    continue;
                };
                if is_tree_node(&dict) {
                    if stack.len() < MAX_DEPTH {
                        let kids = match dict.get("Kids").map(|k| self.resolve(k)) {
                            Some(Object::Array(kids)) => kids,
                            _ => Vec::new(),
                        };
                        stack.push(Frame {
                            num,
                            kids,
                            next: 0,
                            inherited: inherited.with(&dict),
                        });
                    }
                } else if let Some(obj) = node.as_ref() {
                    out.push(PageRef {
                        obj,
                        dict: inherited.apply(dict),
                    });
                }
                continue;
            }
            let Some(top) = stack.last_mut() else {
                break;
            };
            match top.kids.get(top.next) {
                Some(kid) => {
                    top.next += 1;
                    pending = Some((kid.clone(), top.inherited.clone()));
                }
                None => {
                    stack.pop();
                }
            }
        }
    }

    /// Every object typed `Page`, by number, inheriting through `Parent`.
    fn loose_pages(&self, out: &mut Vec<PageRef>) {
        for r in self.object_refs() {
            let Some(Object::Dict(mut dict)) = self.get(r) else {
                continue;
            };
            if !dict.is("Type", "Page") {
                continue;
            }
            let mut parent = dict.get("Parent").cloned();
            for _ in 0..MAX_DEPTH {
                let Some(Object::Dict(node)) = parent.map(|p| self.resolve(&p)) else {
                    break;
                };
                dict = Inherited::default().with(&node).apply(dict);
                parent = node.get("Parent").cloned();
            }
            out.push(PageRef { obj: r, dict });
        }
    }
}
