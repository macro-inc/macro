//! Standalone fragments: a subtree serialized on its own and grafted back into
//! a document, keeping the prefixes it was written with.

use super::{Attr, Element, NodeId, NodeKind, Prefix, XmlDoc};

/// The prefix a namespace declaration binds (`None` = the default namespace).
fn declared_prefix(a: &Attr) -> Option<&str> {
    match &a.prefix {
        Prefix::Written(Some(_)) => Some(&a.local),
        _ => None,
    }
}

impl XmlDoc {
    /// The subtree at `id` as a document of its own, without a prolog.
    ///
    /// Prefixes stay as written. Every namespace binding in scope at `id` that
    /// the element does not declare itself is declared on the fragment's root,
    /// so the fragment parses alone and grafts back with the same meaning.
    pub fn fragment(&self, id: NodeId) -> XmlDoc {
        let mut out = XmlDoc {
            prolog: String::new(),
            nodes: Vec::new(),
            root: NodeId(0),
            dynamic_ns: Vec::new(),
        };
        let root = out.copy_verbatim(self, id);
        out.root = root;
        let mut declared: Vec<Option<String>> = self
            .element(id)
            .map(|e| {
                e.attrs
                    .iter()
                    .filter(|a| a.is_ns_decl())
                    .map(|a| declared_prefix(a).map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        let mut inherited = Vec::new();
        let mut ancestor = self.parent(id);
        while let Some(p) = ancestor {
            if let Some(e) = self.element(p) {
                for a in e.attrs.iter().filter(|a| a.is_ns_decl()) {
                    let prefix = declared_prefix(a).map(str::to_owned);
                    if !declared.contains(&prefix) {
                        declared.push(prefix);
                        inherited.push(a.clone());
                    }
                }
            }
            ancestor = self.parent(p);
        }
        if let Some(e) = out.element_mut(root) {
            inherited.extend(std::mem::take(&mut e.attrs));
            e.attrs = inherited;
        }
        out
    }

    /// Copies the subtree at `id` of `other` into this document (detached),
    /// keeping its prefixes and namespace declarations as written.
    pub fn import_verbatim(&mut self, other: &XmlDoc, id: NodeId) -> NodeId {
        self.copy_verbatim(other, id)
    }

    /// Removes namespace declarations on `id` that repeat a binding already in
    /// scope at its parent (left behind when a fragment is grafted back).
    pub fn drop_redundant_ns_decls(&mut self, id: NodeId) {
        let mut scope: Vec<(Option<String>, String)> = Vec::new();
        let mut ancestor = self.parent(id);
        while let Some(p) = ancestor {
            if let Some(e) = self.element(p) {
                for a in e.attrs.iter().filter(|a| a.is_ns_decl()) {
                    let prefix = declared_prefix(a).map(str::to_owned);
                    if !scope.iter().any(|(bound, _)| *bound == prefix) {
                        scope.push((prefix, a.value.clone()));
                    }
                }
            }
            ancestor = self.parent(p);
        }
        if let Some(e) = self.element_mut(id) {
            e.attrs.retain(|a| {
                !a.is_ns_decl()
                    || !scope.iter().any(|(prefix, uri)| {
                        prefix.as_deref() == declared_prefix(a) && *uri == a.value
                    })
            });
        }
    }

    fn copy_verbatim(&mut self, other: &XmlDoc, id: NodeId) -> NodeId {
        let kind = match other.kind(id) {
            NodeKind::Element(e) => {
                let ns = self.import_ns(other, e.ns);
                let attrs = e
                    .attrs
                    .iter()
                    .map(|a| Attr {
                        ns: self.import_ns(other, a.ns),
                        ..a.clone()
                    })
                    .collect();
                NodeKind::Element(Element {
                    prefix: e.prefix.clone(),
                    local: e.local.clone(),
                    ns,
                    attrs,
                    children: Vec::new(),
                })
            }
            other_kind => other_kind.clone(),
        };
        let copy = self.push_node(None, kind);
        for &c in other.child_nodes(id) {
            let cc = self.copy_verbatim(other, c);
            self.append_child(copy, cc);
        }
        copy
    }
}
