//! A compact XML reader for WordprocessingML parts.
//!
//! Parts are parsed into a read-only tree that remembers where every element
//! came from in the source text, so any subtree can be copied out verbatim
//! (with the prefixes its producer chose). The document model keeps such
//! snippets for everything it does not interpret, which is what makes saving
//! lossless. Element and attribute names are resolved to [`Ns`] identifiers,
//! so lookups never depend on prefixes.

mod escape;
mod ns;

use crate::error::{Error, Result};
pub use escape::{escape_attr, escape_text};
pub use ns::Ns;
use std::ops::Range;

/// Index of a node in an [`XmlTree`].
pub type NodeId = u32;

/// One attribute of an element.
#[derive(Clone, Debug)]
pub struct Attr {
    /// Namespace (`Ns::NONE` for unprefixed attributes).
    pub ns: Ns,
    /// Local name.
    pub local: Box<str>,
    /// Qualified name as written.
    pub qname: Box<str>,
    /// Decoded value.
    pub value: Box<str>,
}

#[derive(Clone, Debug)]
enum Kind {
    Element {
        ns: Ns,
        local: Box<str>,
        qname: Box<str>,
        attrs: Vec<Attr>,
        children: Vec<NodeId>,
        /// Byte offset just past the start tag.
        start_tag_end: u32,
    },
    Text(String),
    /// Comments, processing instructions: kept only for spans.
    Other,
}

#[derive(Clone, Debug)]
struct Node {
    kind: Kind,
    parent: NodeId,
    /// Byte range of the node in the source.
    start: u32,
    end: u32,
}

/// A namespace declaration (`xmlns:prefix="uri"`; empty prefix = default).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Decl {
    /// Declared prefix (`""` for the default namespace).
    pub prefix: String,
    /// Namespace URI.
    pub uri: String,
}

/// A parsed XML part.
#[derive(Clone, Debug)]
pub struct XmlTree {
    src: String,
    nodes: Vec<Node>,
    root: NodeId,
    dynamic: Vec<String>,
    /// Declarations made on the root element, in order.
    root_decls: Vec<Decl>,
    /// Declarations made below the root: (element, declaration).
    inner_decls: Vec<(NodeId, Decl)>,
}

/// Deepest nesting accepted (real documents stay far below).
const MAX_DEPTH: usize = 512;
/// Sentinel parent of the root.
const NO_PARENT: NodeId = NodeId::MAX;

fn decode_source(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    let utf16 = |le: bool, body: &[u8]| -> String {
        let units = body.chunks_exact(2).map(|c| {
            if le {
                u16::from_le_bytes([c[0], c[1]])
            } else {
                u16::from_be_bytes([c[0], c[1]])
            }
        });
        char::decode_utf16(units)
            .map(|r| r.unwrap_or('\u{FFFD}'))
            .collect()
    };
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return utf16(true, rest);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return utf16(false, rest);
    }
    if bytes.starts_with(&[b'<', 0]) {
        return utf16(true, bytes);
    }
    if bytes.starts_with(&[0, b'<']) {
        return utf16(false, bytes);
    }
    String::from_utf8_lossy(bytes).into_owned()
}

struct Binding {
    prefix: Box<str>,
    ns: Ns,
}

struct Parser<'a> {
    s: &'a str,
    b: &'a [u8],
    pos: usize,
    part: &'a str,
    tree: XmlTree,
    scope: Vec<Binding>,
}

impl XmlTree {
    /// Parses `bytes` (UTF-8 or UTF-16 with a byte order mark).
    /// `part` names the source in error messages.
    pub fn parse(bytes: &[u8], part: &str) -> Result<Self> {
        Self::parse_str(decode_source(bytes), part)
    }

    /// Parses XML text.
    pub fn parse_str(src: String, part: &str) -> Result<Self> {
        let tree = XmlTree {
            src: String::new(),
            nodes: Vec::new(),
            root: 0,
            dynamic: Vec::new(),
            root_decls: Vec::new(),
            inner_decls: Vec::new(),
        };
        let mut p = Parser {
            s: &src,
            b: src.as_bytes(),
            pos: 0,
            part,
            tree,
            scope: Vec::new(),
        };
        p.skip_misc()?;
        if p.pos >= p.b.len() || p.b[p.pos] != b'<' {
            return Err(p.err("no root element"));
        }
        let root = p.element(NO_PARENT, 0)?;
        p.tree.root = root;
        let mut tree = p.tree;
        tree.src = src;
        Ok(tree)
    }

    /// Parses a standalone snippet, resolving prefixes it does not declare
    /// against `context` (normally the declarations of the part's root).
    pub fn parse_snippet(snippet: &str, context: &[Decl]) -> Result<Self> {
        SnippetContext::new(context).parse(snippet)
    }

    /// The root element.
    pub fn root(&self) -> NodeId {
        self.root
    }

    /// The full source text.
    pub fn source(&self) -> &str {
        &self.src
    }

    /// Declarations made on the root element.
    pub fn root_decls(&self) -> &[Decl] {
        &self.root_decls
    }

    fn node(&self, id: NodeId) -> &Node {
        &self.nodes[id as usize]
    }

    /// Whether the node is an element.
    pub fn is_element(&self, id: NodeId) -> bool {
        matches!(self.node(id).kind, Kind::Element { .. })
    }

    /// Text of a text node (`None` for elements).
    pub fn text_node(&self, id: NodeId) -> Option<&str> {
        match &self.node(id).kind {
            Kind::Text(t) => Some(t),
            _ => None,
        }
    }

    /// Namespace of an element (`Ns::NONE` for other nodes).
    pub fn ns(&self, id: NodeId) -> Ns {
        match &self.node(id).kind {
            Kind::Element { ns, .. } => *ns,
            _ => Ns::NONE,
        }
    }

    /// Local name of an element (empty for other nodes).
    pub fn local(&self, id: NodeId) -> &str {
        match &self.node(id).kind {
            Kind::Element { local, .. } => local,
            _ => "",
        }
    }

    /// Qualified name as written.
    pub fn qname(&self, id: NodeId) -> &str {
        match &self.node(id).kind {
            Kind::Element { qname, .. } => qname,
            _ => "",
        }
    }

    /// Whether `id` is the element `(ns, local)`.
    pub fn is(&self, id: NodeId, ns: Ns, local: &str) -> bool {
        match &self.node(id).kind {
            Kind::Element {
                ns: n, local: l, ..
            } => *n == ns && &**l == local,
            _ => false,
        }
    }

    /// Whether `id` is a WordprocessingML element named `local`.
    pub fn is_w(&self, id: NodeId, local: &str) -> bool {
        self.is(id, Ns::W, local)
    }

    /// Parent element (`None` for the root).
    pub fn parent(&self, id: NodeId) -> Option<NodeId> {
        let p = self.node(id).parent;
        (p != NO_PARENT).then_some(p)
    }

    /// All child nodes, including text.
    pub fn child_nodes(&self, id: NodeId) -> &[NodeId] {
        match &self.node(id).kind {
            Kind::Element { children, .. } => children,
            _ => &[],
        }
    }

    /// Child elements in document order.
    pub fn children(&self, id: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        self.child_nodes(id)
            .iter()
            .copied()
            .filter(|&c| self.is_element(c))
    }

    /// The first child element named `(ns, local)`.
    pub fn child(&self, id: NodeId, ns: Ns, local: &str) -> Option<NodeId> {
        self.children(id).find(|&c| self.is(c, ns, local))
    }

    /// The first `w:` child named `local`.
    pub fn w_child(&self, id: NodeId, local: &str) -> Option<NodeId> {
        self.child(id, Ns::W, local)
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

    /// Attributes of an element (namespace declarations excluded).
    pub fn attrs(&self, id: NodeId) -> &[Attr] {
        match &self.node(id).kind {
            Kind::Element { attrs, .. } => attrs,
            _ => &[],
        }
    }

    /// Value of attribute `(ns, local)`.
    pub fn attr(&self, id: NodeId, ns: Ns, local: &str) -> Option<&str> {
        self.attrs(id)
            .iter()
            .find(|a| a.ns == ns && &*a.local == local)
            .map(|a| &*a.value)
    }

    /// Value of the `w:` attribute `local` (falling back to an unprefixed one,
    /// which some producers write).
    pub fn w_attr(&self, id: NodeId, local: &str) -> Option<&str> {
        self.attr(id, Ns::W, local)
            .or_else(|| self.attr(id, Ns::NONE, local))
    }

    /// `w:val` of the element.
    pub fn val(&self, id: NodeId) -> Option<&str> {
        self.w_attr(id, "val")
    }

    /// `w:val` of the `w:` child `local`.
    pub fn child_val(&self, id: NodeId, local: &str) -> Option<&str> {
        self.w_child(id, local).and_then(|c| self.val(c))
    }

    /// Concatenated text of all descendant text nodes.
    pub fn text(&self, id: NodeId) -> String {
        let mut out = String::new();
        self.collect_text(id, &mut out);
        out
    }

    fn collect_text(&self, id: NodeId, out: &mut String) {
        match &self.node(id).kind {
            Kind::Text(t) => out.push_str(t),
            Kind::Element { children, .. } => {
                for &c in children {
                    self.collect_text(c, out);
                }
            }
            Kind::Other => {}
        }
    }

    /// Byte range of a node in the source.
    pub fn span(&self, id: NodeId) -> Range<usize> {
        let n = self.node(id);
        n.start as usize..n.end as usize
    }

    /// The node's exact source text.
    pub fn raw(&self, id: NodeId) -> &str {
        &self.src[self.span(id)]
    }

    /// The element's start tag as written (`<w:p w:rsidR="...">`).
    pub fn start_tag(&self, id: NodeId) -> &str {
        match &self.node(id).kind {
            Kind::Element { start_tag_end, .. } => {
                &self.src[self.node(id).start as usize..*start_tag_end as usize]
            }
            _ => "",
        }
    }

    /// The text between an element's name and the end of its start tag:
    /// its attributes as written, with a leading space (empty when none).
    pub fn raw_attrs(&self, id: NodeId) -> &str {
        let tag = self.start_tag(id);
        let qname = self.qname(id);
        let rest = &tag[1 + qname.len().min(tag.len().saturating_sub(1))..];
        let rest = rest.strip_suffix("/>").or_else(|| rest.strip_suffix('>'));
        rest.unwrap_or("").trim_end()
    }

    /// The element's source text, made standalone: declarations that an
    /// ancestor below the root made, and that the snippet relies on, are
    /// copied onto its start tag. Root declarations are left implicit (the
    /// snippet is always read back in the context of its part's root).
    pub fn snippet(&self, id: NodeId) -> String {
        let raw = self.raw(id);
        if self.inner_decls.is_empty() {
            return raw.to_owned();
        }
        let mut extra: Vec<&Decl> = Vec::new();
        let mut at = self.parent(id);
        while let Some(a) = at {
            if a == self.root {
                break;
            }
            for (owner, d) in &self.inner_decls {
                if *owner == a
                    && !extra.iter().any(|e| e.prefix == d.prefix)
                    && uses_prefix(raw, &d.prefix)
                    && !declares_prefix(self.start_tag(id), &d.prefix)
                {
                    extra.push(d);
                }
            }
            at = self.parent(a);
        }
        if extra.is_empty() {
            return raw.to_owned();
        }
        let qname_end = 1 + self.qname(id).len();
        let mut out = String::with_capacity(raw.len() + 80 * extra.len());
        out.push_str(&raw[..qname_end]);
        for d in extra {
            if d.prefix.is_empty() {
                out.push_str(" xmlns=\"");
            } else {
                out.push_str(" xmlns:");
                out.push_str(&d.prefix);
                out.push_str("=\"");
            }
            escape_attr(&mut out, &d.uri);
            out.push('"');
        }
        out.push_str(&raw[qname_end..]);
        out
    }

    /// The URI of a namespace identifier.
    pub fn ns_uri(&self, ns: Ns) -> Option<&str> {
        if ns.0 >= Ns::FIRST_DYNAMIC {
            return self
                .dynamic
                .get(usize::from(ns.0 - Ns::FIRST_DYNAMIC))
                .map(String::as_str);
        }
        ns::uri_of(ns)
    }

    /// Descendant elements in document order (pre-order, excluding `id`).
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

    /// The first descendant named `(ns, local)`.
    pub fn find(&self, id: NodeId, ns: Ns, local: &str) -> Option<NodeId> {
        let mut stack: Vec<NodeId> = self.children(id).collect();
        stack.reverse();
        while let Some(n) = stack.pop() {
            if self.is(n, ns, local) {
                return Some(n);
            }
            let before = stack.len();
            stack.extend(self.children(n));
            stack[before..].reverse();
        }
        None
    }

    fn intern(&mut self, uri: &str) -> Ns {
        if uri.is_empty() {
            return Ns::NONE;
        }
        if let Some(ns) = ns::known(uri) {
            return ns;
        }
        if let Some(i) = self.dynamic.iter().position(|u| u == uri) {
            return Ns(Ns::FIRST_DYNAMIC + i as u16);
        }
        self.dynamic.push(uri.to_owned());
        Ns(Ns::FIRST_DYNAMIC + (self.dynamic.len() - 1) as u16)
    }
}

/// Parses snippets in the context of a part's root declarations, reusing
/// the synthetic wrapper that carries them.
#[derive(Clone, Debug)]
pub struct SnippetContext {
    open: String,
    decls: Vec<Decl>,
}

impl SnippetContext {
    /// A context for `decls`.
    pub fn new(decls: &[Decl]) -> Self {
        let mut open = String::with_capacity(64 * decls.len() + 8);
        open.push_str("<_x");
        for d in decls {
            if d.prefix.is_empty() {
                open.push_str(" xmlns=\"");
            } else {
                open.push_str(" xmlns:");
                open.push_str(&d.prefix);
                open.push_str("=\"");
            }
            escape_attr(&mut open, &d.uri);
            open.push('"');
        }
        open.push('>');
        Self {
            open,
            decls: decls.to_vec(),
        }
    }

    /// Parses one snippet (a single element).
    pub fn parse(&self, snippet: &str) -> Result<XmlTree> {
        let mut wrapped = String::with_capacity(self.open.len() + snippet.len() + 6);
        wrapped.push_str(&self.open);
        wrapped.push_str(snippet);
        wrapped.push_str("</_x>");
        let mut tree = XmlTree::parse_str(wrapped, "snippet")?;
        let inner = tree.children(tree.root).next().ok_or_else(|| Error::Xml {
            part: "snippet".into(),
            message: "empty snippet".into(),
        })?;
        tree.root = inner;
        tree.root_decls = self.decls.clone();
        Ok(tree)
    }

    /// Parses a sequence of sibling elements; returns the tree and their ids.
    pub fn parse_many(&self, snippets: &str) -> Result<(XmlTree, Vec<NodeId>)> {
        let mut wrapped = String::with_capacity(self.open.len() + snippets.len() + 6);
        wrapped.push_str(&self.open);
        wrapped.push_str(snippets);
        wrapped.push_str("</_x>");
        let mut tree = XmlTree::parse_str(wrapped, "snippet")?;
        let kids: Vec<NodeId> = tree.children(tree.root).collect();
        tree.root_decls = self.decls.clone();
        Ok((tree, kids))
    }
}

fn uses_prefix(raw: &str, prefix: &str) -> bool {
    if prefix.is_empty() {
        return true;
    }
    let needle = format!("{prefix}:");
    raw.match_indices(&needle).any(|(i, _)| {
        i > 0 && {
            let before = raw.as_bytes()[i - 1];
            before == b'<' || before == b'/' || before.is_ascii_whitespace() || before == b'"'
        }
    })
}

fn declares_prefix(start_tag: &str, prefix: &str) -> bool {
    if prefix.is_empty() {
        start_tag.contains(" xmlns=")
    } else {
        start_tag.contains(&format!("xmlns:{prefix}="))
    }
}

fn is_name_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.' | b':') || c >= 0x80
}

impl Parser<'_> {
    fn err(&self, message: &str) -> Error {
        Error::Xml {
            part: self.part.to_owned(),
            message: format!("{message} at byte {}", self.pos),
        }
    }

    fn skip_ws(&mut self) {
        while self.pos < self.b.len() && self.b[self.pos].is_ascii_whitespace() {
            self.pos += 1;
        }
    }

    /// Skips the prolog: declaration, comments, PIs, doctype, whitespace.
    fn skip_misc(&mut self) -> Result<()> {
        loop {
            self.skip_ws();
            let rest = &self.s[self.pos..];
            if rest.starts_with("<?") {
                let end = rest.find("?>").ok_or_else(|| self.err("unterminated PI"))?;
                self.pos += end + 2;
            } else if let Some(comment) = rest.strip_prefix("<!--") {
                let end = comment
                    .find("-->")
                    .ok_or_else(|| self.err("unterminated comment"))?;
                self.pos += end + 7;
            } else if rest.starts_with("<!DOCTYPE") || rest.starts_with("<!doctype") {
                let mut depth = 0i32;
                let mut i = self.pos;
                while i < self.b.len() {
                    match self.b[i] {
                        b'[' => depth += 1,
                        b']' => depth -= 1,
                        b'>' if depth <= 0 => break,
                        _ => {}
                    }
                    i += 1;
                }
                self.pos = (i + 1).min(self.b.len());
            } else {
                return Ok(());
            }
        }
    }

    fn name(&mut self) -> Result<&str> {
        let start = self.pos;
        while self.pos < self.b.len() && is_name_char(self.b[self.pos]) {
            self.pos += 1;
        }
        if self.pos == start {
            return Err(self.err("expected a name"));
        }
        Ok(&self.s[start..self.pos])
    }

    fn resolve(&self, prefix: &str) -> Option<Ns> {
        self.scope
            .iter()
            .rev()
            .find(|b| &*b.prefix == prefix)
            .map(|b| b.ns)
    }

    fn push(&mut self, kind: Kind, parent: NodeId, start: usize, end: usize) -> NodeId {
        let id = self.tree.nodes.len() as NodeId;
        self.tree.nodes.push(Node {
            kind,
            parent,
            start: start as u32,
            end: end as u32,
        });
        id
    }

    fn element(&mut self, parent: NodeId, depth: usize) -> Result<NodeId> {
        if depth > MAX_DEPTH {
            return Err(self.err("elements nested too deeply"));
        }
        let start = self.pos;
        self.pos += 1; // '<'
        let qname: Box<str> = self.name()?.into();
        let scope_len = self.scope.len();
        let mut raw_attrs: Vec<(Box<str>, Box<str>)> = Vec::new();
        let self_closing;
        loop {
            self.skip_ws();
            match self.b.get(self.pos) {
                Some(b'/') => {
                    if self.b.get(self.pos + 1) != Some(&b'>') {
                        return Err(self.err("expected '/>'"));
                    }
                    self.pos += 2;
                    self_closing = true;
                    break;
                }
                Some(b'>') => {
                    self.pos += 1;
                    self_closing = false;
                    break;
                }
                Some(_) => {
                    let name: Box<str> = self.name()?.into();
                    self.skip_ws();
                    if self.b.get(self.pos) != Some(&b'=') {
                        return Err(self.err("expected '='"));
                    }
                    self.pos += 1;
                    self.skip_ws();
                    let quote = *self.b.get(self.pos).ok_or_else(|| self.err("eof"))?;
                    if quote != b'"' && quote != b'\'' {
                        return Err(self.err("expected a quoted value"));
                    }
                    self.pos += 1;
                    let vstart = self.pos;
                    while self.pos < self.b.len() && self.b[self.pos] != quote {
                        self.pos += 1;
                    }
                    if self.pos >= self.b.len() {
                        return Err(self.err("unterminated attribute value"));
                    }
                    let value = escape::unescape(&self.s[vstart..self.pos], true);
                    self.pos += 1;
                    raw_attrs.push((name, value.into()));
                }
                None => return Err(self.err("unterminated start tag")),
            }
        }
        let start_tag_end = self.pos;
        // Namespace declarations come into scope first.
        for (name, value) in &raw_attrs {
            let prefix = if &**name == "xmlns" {
                Some("")
            } else {
                name.strip_prefix("xmlns:")
            };
            if let Some(prefix) = prefix {
                let ns = self.tree.intern(value);
                self.scope.push(Binding {
                    prefix: prefix.into(),
                    ns,
                });
                let decl = Decl {
                    prefix: prefix.to_owned(),
                    uri: value.to_string(),
                };
                if parent == NO_PARENT {
                    self.tree.root_decls.push(decl);
                } else {
                    // The id this element will get.
                    let id = self.tree.nodes.len() as NodeId;
                    self.tree.inner_decls.push((id, decl));
                }
            }
        }
        let (prefix, local) = match qname.split_once(':') {
            Some((p, l)) => (p, l),
            None => ("", &*qname),
        };
        let ns = self.resolve(prefix).unwrap_or(Ns::NONE);
        let mut attrs = Vec::with_capacity(raw_attrs.len());
        for (name, value) in raw_attrs {
            if &*name == "xmlns" || name.starts_with("xmlns:") {
                continue;
            }
            let (ans, alocal) = match name.split_once(':') {
                Some(("xml", l)) => (Ns::XML, l),
                Some((p, l)) => (self.resolve(p).unwrap_or(Ns::NONE), l),
                None => (Ns::NONE, &*name),
            };
            attrs.push(Attr {
                ns: ans,
                local: alocal.into(),
                qname: name.clone(),
                value,
            });
        }
        let id = self.push(
            Kind::Element {
                ns,
                local: local.into(),
                qname: qname.clone(),
                attrs,
                children: Vec::new(),
                start_tag_end: start_tag_end as u32,
            },
            parent,
            start,
            start_tag_end,
        );
        // Re-key declarations recorded for this element (ids are now known).
        if !self_closing {
            let mut children = Vec::new();
            loop {
                if self.pos >= self.b.len() {
                    return Err(self.err(&format!("unterminated <{qname}>")));
                }
                if self.b[self.pos] == b'<' {
                    let rest = &self.s[self.pos..];
                    if rest.starts_with("</") {
                        self.pos += 2;
                        let close = self.name()?.to_owned();
                        if close != *qname {
                            return Err(
                                self.err(&format!("mismatched end tag </{close}> for <{qname}>"))
                            );
                        }
                        self.skip_ws();
                        if self.b.get(self.pos) != Some(&b'>') {
                            return Err(self.err("expected '>'"));
                        }
                        self.pos += 1;
                        break;
                    } else if let Some(comment) = rest.strip_prefix("<!--") {
                        let s = self.pos;
                        let end = comment
                            .find("-->")
                            .ok_or_else(|| self.err("unterminated comment"))?;
                        self.pos += end + 7;
                        let c = self.push(Kind::Other, id, s, self.pos);
                        children.push(c);
                    } else if let Some(cdata) = rest.strip_prefix("<![CDATA[") {
                        let s = self.pos;
                        let end = cdata
                            .find("]]>")
                            .ok_or_else(|| self.err("unterminated CDATA"))?;
                        let text = cdata[..end].to_owned();
                        self.pos += end + 12;
                        let c = self.push(Kind::Text(text), id, s, self.pos);
                        children.push(c);
                    } else if rest.starts_with("<?") {
                        let s = self.pos;
                        let end = rest.find("?>").ok_or_else(|| self.err("unterminated PI"))?;
                        self.pos += end + 2;
                        let c = self.push(Kind::Other, id, s, self.pos);
                        children.push(c);
                    } else {
                        let c = self.element(id, depth + 1)?;
                        children.push(c);
                    }
                } else {
                    let s = self.pos;
                    while self.pos < self.b.len() && self.b[self.pos] != b'<' {
                        self.pos += 1;
                    }
                    let text = escape::unescape(&self.s[s..self.pos], false);
                    let c = self.push(Kind::Text(text), id, s, self.pos);
                    children.push(c);
                }
            }
            if let Kind::Element { children: ch, .. } = &mut self.tree.nodes[id as usize].kind {
                *ch = children;
            }
        }
        self.tree.nodes[id as usize].end = self.pos as u32;
        self.scope.truncate(scope_len);
        Ok(id)
    }
}

/// Parses a decimal integer attribute value (tolerating `+`, whitespace and a
/// fractional part, which some producers write).
pub fn parse_int(v: &str) -> Option<i64> {
    let v = v.trim();
    let v = v.strip_prefix('+').unwrap_or(v);
    v.parse::<i64>().ok().or_else(|| {
        v.parse::<f64>()
            .ok()
            .filter(|f| f.is_finite())
            .map(|f| f.round() as i64)
    })
}

/// Parses an ST_OnOff value. A missing value means "on".
pub fn parse_on_off(v: Option<&str>) -> bool {
    !matches!(v.map(str::trim), Some("0" | "false" | "off" | "none"))
}

#[cfg(test)]
mod test;
