//! A small, mutable, namespace-aware XML DOM.
//!
//! Parts are parsed into an arena of nodes. Everything in the source is kept
//! (unknown elements, extension lists, comments, attribute order, the prolog),
//! so a part the editor touches is re-serialized with only the edited nodes
//! changed. Elements and attributes carry resolved [`Ns`] identifiers, so
//! lookups never depend on the prefixes a producer chose.

mod ns;
mod parse;
mod write;

pub use ns::Ns;

/// Index of a node inside an [`XmlDoc`] arena.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct NodeId(u32);

/// How an element or attribute prefix is spelled on output.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Prefix {
    /// The prefix exactly as written in the source (`None` = unprefixed).
    Written(Option<Box<str>>),
    /// Created by the engine: resolved against in-scope declarations on output.
    Auto,
}

/// An attribute of an element.
#[derive(Clone, Debug)]
pub struct Attr {
    pub(crate) prefix: Prefix,
    pub(crate) local: Box<str>,
    pub(crate) ns: Ns,
    pub(crate) value: String,
}

impl Attr {
    /// Whether this attribute is a namespace declaration (`xmlns` / `xmlns:p`).
    pub fn is_ns_decl(&self) -> bool {
        match &self.prefix {
            Prefix::Written(Some(p)) => &**p == "xmlns",
            Prefix::Written(None) => &*self.local == "xmlns",
            Prefix::Auto => false,
        }
    }

    /// Local name of the attribute.
    pub fn local(&self) -> &str {
        &self.local
    }

    /// Namespace of the attribute.
    pub fn ns(&self) -> Ns {
        self.ns
    }

    /// Attribute value (entity references already decoded).
    pub fn value(&self) -> &str {
        &self.value
    }
}

/// An element node.
#[derive(Clone, Debug)]
pub struct Element {
    pub(crate) prefix: Prefix,
    pub(crate) local: Box<str>,
    pub(crate) ns: Ns,
    pub(crate) attrs: Vec<Attr>,
    pub(crate) children: Vec<NodeId>,
}

/// The payload of a node.
#[derive(Clone, Debug)]
pub enum NodeKind {
    /// An element.
    Element(Element),
    /// Character data (entity references decoded).
    Text(String),
    /// A CDATA section's raw content.
    CData(String),
    /// A comment's raw content.
    Comment(String),
    /// A processing instruction's raw content (between `<?` and `?>`).
    Pi(String),
}

#[derive(Clone, Debug)]
struct Node {
    parent: Option<NodeId>,
    kind: NodeKind,
}

/// A parsed XML document.
#[derive(Clone, Debug)]
pub struct XmlDoc {
    /// Everything before the root element, verbatim (declaration, comments).
    prolog: String,
    nodes: Vec<Node>,
    root: NodeId,
    /// URIs of namespaces outside the well-known table, by `Ns.0 - FIRST_DYNAMIC`.
    dynamic_ns: Vec<String>,
}

/// The XML declaration written for documents created from scratch.
pub const STANDARD_DECLARATION: &str =
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n";

impl XmlDoc {
    /// Parses `bytes` (UTF-8 or UTF-16 with a byte order mark).
    /// `part` names the source in error messages.
    pub fn parse(bytes: &[u8], part: &str) -> crate::Result<Self> {
        parse::parse(bytes, part)
    }

    /// Creates a document whose root element is `(ns, local)`, declaring
    /// the namespace with its canonical prefix.
    pub fn new_root(ns: Ns, local: &str) -> Self {
        let mut doc = Self {
            prolog: STANDARD_DECLARATION.to_owned(),
            nodes: Vec::new(),
            root: NodeId(0),
            dynamic_ns: Vec::new(),
        };
        let root = doc.create_element(ns, local);
        doc.root = root;
        doc
    }

    /// Serializes the document to UTF-8 bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        write::write(self)
    }

    /// The root element.
    pub fn root(&self) -> NodeId {
        self.root
    }

    fn node(&self, id: NodeId) -> &Node {
        &self.nodes[id.0 as usize]
    }

    fn node_mut(&mut self, id: NodeId) -> &mut Node {
        &mut self.nodes[id.0 as usize]
    }

    pub(crate) fn push_node(&mut self, parent: Option<NodeId>, kind: NodeKind) -> NodeId {
        let id = NodeId(u32::try_from(self.nodes.len()).expect("xml arena overflow"));
        self.nodes.push(Node { parent, kind });
        id
    }

    /// The payload of a node.
    pub fn kind(&self, id: NodeId) -> &NodeKind {
        &self.node(id).kind
    }

    /// The element payload of a node, if it is an element.
    pub fn element(&self, id: NodeId) -> Option<&Element> {
        match &self.node(id).kind {
            NodeKind::Element(e) => Some(e),
            _ => None,
        }
    }

    fn element_mut(&mut self, id: NodeId) -> Option<&mut Element> {
        match &mut self.node_mut(id).kind {
            NodeKind::Element(e) => Some(e),
            _ => None,
        }
    }

    /// Parent of a node (`None` for the root and detached nodes).
    pub fn parent(&self, id: NodeId) -> Option<NodeId> {
        self.node(id).parent
    }

    /// Namespace of an element (`Ns::NONE` for non-elements).
    pub fn ns(&self, id: NodeId) -> Ns {
        self.element(id).map_or(Ns::NONE, |e| e.ns)
    }

    /// Local name of an element (empty for non-elements).
    pub fn local(&self, id: NodeId) -> &str {
        self.element(id).map_or("", |e| &e.local)
    }

    /// Whether `id` is the element `(ns, local)`.
    pub fn is(&self, id: NodeId, ns: Ns, local: &str) -> bool {
        self.element(id).is_some_and(|e| e.ns == ns && &*e.local == local)
    }

    /// All child nodes (elements, text, comments...).
    pub fn child_nodes(&self, id: NodeId) -> &[NodeId] {
        self.element(id).map_or(&[], |e| &e.children)
    }

    /// Child elements, in document order.
    pub fn children(&self, id: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        self.child_nodes(id)
            .iter()
            .copied()
            .filter(|&c| matches!(self.node(c).kind, NodeKind::Element(_)))
    }

    /// Child elements named `(ns, local)`.
    pub fn children_named<'a>(
        &'a self,
        id: NodeId,
        ns: Ns,
        local: &'a str,
    ) -> impl Iterator<Item = NodeId> + 'a {
        self.children(id).filter(move |&c| self.is(c, ns, local))
    }

    /// The first child element named `(ns, local)`.
    pub fn child(&self, id: NodeId, ns: Ns, local: &str) -> Option<NodeId> {
        self.children(id).find(|&c| self.is(c, ns, local))
    }

    /// Follows a path of child element names in one namespace.
    pub fn path(&self, id: NodeId, ns: Ns, path: &[&str]) -> Option<NodeId> {
        path.iter().try_fold(id, |at, name| self.child(at, ns, name))
    }

    /// The first child element (of any name).
    pub fn first_child(&self, id: NodeId) -> Option<NodeId> {
        self.children(id).next()
    }

    /// Attributes of an element, excluding namespace declarations.
    pub fn attrs(&self, id: NodeId) -> impl Iterator<Item = &Attr> + '_ {
        self.element(id)
            .map(|e| e.attrs.as_slice())
            .unwrap_or(&[])
            .iter()
            .filter(|a| !a.is_ns_decl())
    }

    /// Value of the unprefixed attribute `name`.
    pub fn attr(&self, id: NodeId, name: &str) -> Option<&str> {
        self.attr_ns(id, Ns::NONE, name)
    }

    /// Value of the attribute `(ns, local)`.
    pub fn attr_ns(&self, id: NodeId, ns: Ns, local: &str) -> Option<&str> {
        self.attrs(id)
            .find(|a| a.ns == ns && &*a.local == local)
            .map(|a| a.value.as_str())
    }

    /// Parses an unprefixed attribute as an integer.
    pub fn attr_i64(&self, id: NodeId, name: &str) -> Option<i64> {
        self.attr(id, name).and_then(|v| parse_i64(v))
    }

    /// Parses an unprefixed attribute as a float.
    pub fn attr_f64(&self, id: NodeId, name: &str) -> Option<f64> {
        self.attr(id, name).and_then(|v| v.trim().parse::<f64>().ok())
    }

    /// Parses an unprefixed boolean attribute (`1`/`true`/`on` vs `0`/`false`/`off`).
    pub fn attr_bool(&self, id: NodeId, name: &str) -> Option<bool> {
        self.attr(id, name).and_then(parse_bool)
    }

    /// Concatenated text of all descendant text and CDATA nodes.
    pub fn text(&self, id: NodeId) -> String {
        let mut out = String::new();
        self.collect_text(id, &mut out);
        out
    }

    fn collect_text(&self, id: NodeId, out: &mut String) {
        match &self.node(id).kind {
            NodeKind::Text(t) | NodeKind::CData(t) => out.push_str(t),
            NodeKind::Element(e) => {
                for &c in &e.children {
                    self.collect_text(c, out);
                }
            }
            NodeKind::Comment(_) | NodeKind::Pi(_) => {}
        }
    }

    /// Descendant elements (pre-order, excluding `id` itself).
    pub fn descendants(&self, id: NodeId) -> Vec<NodeId> {
        let mut out = Vec::new();
        let mut stack: Vec<NodeId> = self.children(id).collect();
        stack.reverse();
        while let Some(n) = stack.pop() {
            out.push(n);
            let before = stack.len();
            stack.extend(self.children(n));
            stack[before..].reverse();
        }
        out
    }

    /// The URI of a namespace identifier.
    pub fn ns_uri(&self, ns: Ns) -> Option<&str> {
        if ns.0 >= Ns::FIRST_DYNAMIC {
            return self.dynamic_ns.get(usize::from(ns.0 - Ns::FIRST_DYNAMIC)).map(String::as_str);
        }
        ns::canonical(ns).map(|(uri, _)| uri)
    }

    pub(crate) fn intern_ns(&mut self, uri: &str) -> Ns {
        if uri.is_empty() {
            return Ns::NONE;
        }
        if let Some((_, id, _)) = ns::KNOWN.iter().find(|(u, _, _)| *u == uri) {
            return *id;
        }
        if let Some(i) = self.dynamic_ns.iter().position(|u| u == uri) {
            return Ns(Ns::FIRST_DYNAMIC + i as u16);
        }
        self.dynamic_ns.push(uri.to_owned());
        Ns(Ns::FIRST_DYNAMIC + (self.dynamic_ns.len() - 1) as u16)
    }

    // ---- mutation -------------------------------------------------------

    /// Creates a detached element `(ns, local)`; its prefix is chosen on output.
    pub fn create_element(&mut self, ns: Ns, local: &str) -> NodeId {
        self.push_node(
            None,
            NodeKind::Element(Element {
                prefix: Prefix::Auto,
                local: local.into(),
                ns,
                attrs: Vec::new(),
                children: Vec::new(),
            }),
        )
    }

    /// Creates a detached text node.
    pub fn create_text(&mut self, text: &str) -> NodeId {
        self.push_node(None, NodeKind::Text(text.to_owned()))
    }

    /// Sets (or adds) the unprefixed attribute `name`.
    pub fn set_attr(&mut self, id: NodeId, name: &str, value: &str) {
        self.set_attr_ns(id, Ns::NONE, name, value);
    }

    /// Sets (or adds) the attribute `(ns, local)`.
    pub fn set_attr_ns(&mut self, id: NodeId, ns: Ns, local: &str, value: &str) {
        let Some(e) = self.element_mut(id) else { return };
        if let Some(a) = e.attrs.iter_mut().find(|a| !a.is_ns_decl() && a.ns == ns && &*a.local == local) {
            value.clone_into(&mut a.value);
            return;
        }
        let prefix = if ns == Ns::NONE { Prefix::Written(None) } else { Prefix::Auto };
        e.attrs.push(Attr { prefix, local: local.into(), ns, value: value.to_owned() });
    }

    /// Renames an element in place, keeping its namespace, attributes, and children.
    pub fn rename(&mut self, id: NodeId, local: &str) {
        if let Some(e) = self.element_mut(id) {
            e.local = local.into();
        }
    }

    /// Removes the unprefixed attribute `name`, if present.
    pub fn remove_attr(&mut self, id: NodeId, name: &str) {
        self.remove_attr_ns(id, Ns::NONE, name);
    }

    /// Removes the attribute `(ns, local)`, if present.
    pub fn remove_attr_ns(&mut self, id: NodeId, ns: Ns, local: &str) {
        if let Some(e) = self.element_mut(id) {
            e.attrs.retain(|a| a.is_ns_decl() || a.ns != ns || &*a.local != local);
        }
    }

    /// Detaches a node from its parent. The node stays valid and can be re-attached.
    pub fn detach(&mut self, id: NodeId) {
        if let Some(parent) = self.node(id).parent {
            if let Some(e) = self.element_mut(parent) {
                e.children.retain(|&c| c != id);
            }
            self.node_mut(id).parent = None;
        }
    }

    /// Appends `child` (detaching it first) as the last child of `parent`.
    pub fn append_child(&mut self, parent: NodeId, child: NodeId) {
        let len = self.child_nodes(parent).len();
        self.insert_child(parent, len, child);
    }

    /// Inserts `child` at `index` among all child nodes of `parent`.
    pub fn insert_child(&mut self, parent: NodeId, index: usize, child: NodeId) {
        self.detach(child);
        let Some(e) = self.element_mut(parent) else { return };
        let index = index.min(e.children.len());
        e.children.insert(index, child);
        self.node_mut(child).parent = Some(parent);
    }

    /// Inserts `child` immediately before `reference` (a child of `parent`).
    pub fn insert_before(&mut self, reference: NodeId, child: NodeId) {
        let Some(parent) = self.parent(reference) else { return };
        let index = self.child_nodes(parent).iter().position(|&c| c == reference).unwrap_or(0);
        self.insert_child(parent, index, child);
    }

    /// Inserts `child` immediately after `reference` (a child of `parent`).
    pub fn insert_after(&mut self, reference: NodeId, child: NodeId) {
        let Some(parent) = self.parent(reference) else { return };
        let index = self
            .child_nodes(parent)
            .iter()
            .position(|&c| c == reference)
            .map_or(usize::MAX, |i| i + 1);
        self.insert_child(parent, index, child);
    }

    /// Position of `child` among all child nodes of its parent.
    pub fn index_in_parent(&self, child: NodeId) -> Option<usize> {
        let parent = self.parent(child)?;
        self.child_nodes(parent).iter().position(|&c| c == child)
    }

    /// Replaces all children of `id` with one text node.
    pub fn set_text(&mut self, id: NodeId, text: &str) {
        for c in self.child_nodes(id).to_vec() {
            self.detach(c);
        }
        if !text.is_empty() {
            let t = self.create_text(text);
            self.append_child(id, t);
        }
    }

    /// Returns the child `(ns, local)`, creating it with `create` placement if absent.
    ///
    /// `order` lists the schema order of `parent`'s children; the new element is
    /// inserted before the first existing sibling that comes later in that order,
    /// keeping the output schema-valid.
    pub fn ensure_child(&mut self, parent: NodeId, ns: Ns, local: &str, order: &[&str]) -> NodeId {
        if let Some(c) = self.child(parent, ns, local) {
            return c;
        }
        let new = self.create_element(ns, local);
        self.insert_in_order(parent, new, order);
        new
    }

    /// Inserts the element `child` into `parent` at the position dictated by `order`.
    pub fn insert_in_order(&mut self, parent: NodeId, child: NodeId, order: &[&str]) {
        let name = self.local(child).to_owned();
        let rank = order.iter().position(|n| *n == name);
        let before = rank.and_then(|rank| {
            self.children(parent).find(|&c| {
                order
                    .iter()
                    .position(|n| *n == self.local(c))
                    .is_some_and(|r| r > rank)
            })
        });
        match before {
            Some(b) => self.insert_before(b, child),
            None => self.append_child(parent, child),
        }
    }

    /// Removes every child element named `(ns, local)`.
    pub fn remove_children_named(&mut self, parent: NodeId, ns: Ns, local: &str) {
        let doomed: Vec<_> = self.children_named(parent, ns, local).collect();
        for d in doomed {
            self.detach(d);
        }
    }

    /// Deep-copies the subtree at `id` (detached copy in the same document).
    pub fn deep_clone(&mut self, id: NodeId) -> NodeId {
        let kind = match &self.node(id).kind {
            NodeKind::Element(e) => NodeKind::Element(Element { children: Vec::new(), ..e.clone() }),
            other => other.clone(),
        };
        let copy = self.push_node(None, kind);
        for c in self.child_nodes(id).to_vec() {
            let cc = self.deep_clone(c);
            self.append_child(copy, cc);
        }
        copy
    }

    /// Copies the subtree at `id` of `other` into this document (detached).
    ///
    /// Prefixes are re-resolved on output, so namespaces map correctly even if
    /// the two documents bind different prefixes.
    pub fn import(&mut self, other: &XmlDoc, id: NodeId) -> NodeId {
        let kind = match &other.node(id).kind {
            NodeKind::Element(e) => {
                let ns = self.import_ns(other, e.ns);
                let attrs = e
                    .attrs
                    .iter()
                    .filter(|a| !a.is_ns_decl())
                    .map(|a| {
                        let ans = self.import_ns(other, a.ns);
                        Attr {
                            prefix: if ans == Ns::NONE { Prefix::Written(None) } else { Prefix::Auto },
                            local: a.local.clone(),
                            ns: ans,
                            value: a.value.clone(),
                        }
                    })
                    .collect();
                NodeKind::Element(Element {
                    prefix: Prefix::Auto,
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
            let cc = self.import(other, c);
            self.append_child(copy, cc);
        }
        copy
    }

    fn import_ns(&mut self, other: &XmlDoc, ns: Ns) -> Ns {
        if ns.0 < Ns::FIRST_DYNAMIC {
            return ns;
        }
        match other.ns_uri(ns) {
            Some(uri) => {
                let uri = uri.to_owned();
                self.intern_ns(&uri)
            }
            None => Ns::NONE,
        }
    }
}

/// Parses an XML integer attribute (tolerating a leading `+` and whitespace).
pub fn parse_i64(v: &str) -> Option<i64> {
    let v = v.trim();
    let v = v.strip_prefix('+').unwrap_or(v);
    v.parse::<i64>().ok().or_else(|| v.parse::<f64>().ok().map(|f| f.round() as i64))
}

/// Parses an XML schema boolean.
pub fn parse_bool(v: &str) -> Option<bool> {
    match v.trim() {
        "1" | "true" | "on" | "t" => Some(true),
        "0" | "false" | "off" | "f" => Some(false),
        _ => None,
    }
}

#[cfg(test)]
mod test;
