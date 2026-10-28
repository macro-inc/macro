//! Serializes an [`XmlDoc`] back to UTF-8.
//!
//! Source prefixes and namespace declarations are written exactly as parsed.
//! Nodes created by the engine ([`Prefix::Auto`]) reuse an in-scope prefix
//! for their namespace, declaring one only when none is bound.

use super::{Element, NodeId, NodeKind, Ns, Prefix, XmlDoc, ns};

struct Binding {
    prefix: Option<String>,
    ns: Ns,
}

struct Writer<'a> {
    doc: &'a XmlDoc,
    out: String,
    scope: Vec<Binding>,
}

pub(super) fn write(doc: &XmlDoc) -> Vec<u8> {
    let mut w = Writer {
        doc,
        out: String::with_capacity(4096),
        scope: Vec::new(),
    };
    w.out.push_str(&doc.prolog);
    w.node(doc.root);
    w.out.into_bytes()
}

fn ns_of_uri(doc: &XmlDoc, uri: &str) -> Ns {
    if uri.is_empty() {
        return Ns::NONE;
    }
    if let Some((_, id, _)) = ns::KNOWN.iter().find(|(u, _, _)| *u == uri) {
        return *id;
    }
    doc.dynamic_ns
        .iter()
        .position(|u| u == uri)
        .map_or(Ns(u16::MAX), |i| Ns(Ns::FIRST_DYNAMIC + i as u16))
}

impl Writer<'_> {
    /// The innermost active prefix bound to `ns` (`Some(None)` = default namespace).
    fn lookup(&self, ns: Ns, allow_default: bool) -> Option<Option<String>> {
        let mut shadowed: Vec<&Option<String>> = Vec::new();
        for b in self.scope.iter().rev() {
            if shadowed.contains(&&b.prefix) {
                continue;
            }
            if b.ns == ns && (allow_default || b.prefix.is_some()) {
                return Some(b.prefix.clone());
            }
            shadowed.push(&b.prefix);
        }
        None
    }

    fn bound(&self, prefix: &str) -> Option<Ns> {
        self.scope
            .iter()
            .rev()
            .find(|b| b.prefix.as_deref() == Some(prefix))
            .map(|b| b.ns)
    }

    fn default_ns(&self) -> Ns {
        self.scope
            .iter()
            .rev()
            .find(|b| b.prefix.is_none())
            .map_or(Ns::NONE, |b| b.ns)
    }

    /// Picks a fresh prefix for `ns` and records the declaration to emit.
    fn declare(&mut self, ns: Ns, decls: &mut Vec<(String, String)>) -> String {
        let (uri, preferred) = match ns::canonical(ns) {
            Some((uri, p)) if !p.is_empty() => (uri.to_owned(), p.to_owned()),
            Some((uri, _)) => (uri.to_owned(), "ns".to_owned()),
            None => (
                self.doc.ns_uri(ns).unwrap_or_default().to_owned(),
                "ns".to_owned(),
            ),
        };
        let mut prefix = preferred.clone();
        let mut n = 1;
        while self.bound(&prefix).is_some_and(|b| b != ns) {
            prefix = format!("{preferred}{n}");
            n += 1;
        }
        self.scope.push(Binding {
            prefix: Some(prefix.clone()),
            ns,
        });
        decls.push((prefix.clone(), uri));
        prefix
    }

    fn node(&mut self, id: NodeId) {
        match self.doc.kind(id) {
            NodeKind::Element(e) => self.element(e),
            NodeKind::Text(t) => escape_text(&mut self.out, t),
            NodeKind::CData(t) => {
                self.out.push_str("<![CDATA[");
                self.out.push_str(t);
                self.out.push_str("]]>");
            }
            NodeKind::Comment(t) => {
                self.out.push_str("<!--");
                self.out.push_str(t);
                self.out.push_str("-->");
            }
            NodeKind::Pi(t) => {
                self.out.push_str("<?");
                self.out.push_str(t);
                self.out.push_str("?>");
            }
        }
    }

    fn element(&mut self, e: &Element) {
        let scope_len = self.scope.len();
        // Source declarations come into scope first.
        for a in e.attrs.iter().filter(|a| a.is_ns_decl()) {
            let prefix = match &a.prefix {
                Prefix::Written(Some(_)) => Some(a.local.to_string()),
                _ => None,
            };
            let ns = ns_of_uri(self.doc, &a.value);
            self.scope.push(Binding { prefix, ns });
        }
        let mut decls: Vec<(String, String)> = Vec::new();
        let mut default_reset = false;
        let qname = match &e.prefix {
            Prefix::Written(p) => qualified(p.as_deref(), &e.local),
            Prefix::Auto => {
                if e.ns == Ns::NONE {
                    if self.default_ns() != Ns::NONE {
                        default_reset = true;
                        self.scope.push(Binding {
                            prefix: None,
                            ns: Ns::NONE,
                        });
                    }
                    e.local.to_string()
                } else {
                    match self.lookup(e.ns, true) {
                        Some(p) => qualified(p.as_deref(), &e.local),
                        None => {
                            let p = self.declare(e.ns, &mut decls);
                            qualified(Some(&p), &e.local)
                        }
                    }
                }
            }
        };
        let mut attr_names: Vec<String> = Vec::with_capacity(e.attrs.len());
        for a in &e.attrs {
            let name = match &a.prefix {
                Prefix::Written(p) => qualified(p.as_deref(), &a.local),
                Prefix::Auto if a.ns == Ns::NONE => a.local.to_string(),
                Prefix::Auto => match self.lookup(a.ns, false) {
                    Some(p) => qualified(p.as_deref(), &a.local),
                    None => {
                        let p = self.declare(a.ns, &mut decls);
                        qualified(Some(&p), &a.local)
                    }
                },
            };
            attr_names.push(name);
        }
        self.out.push('<');
        self.out.push_str(&qname);
        if default_reset {
            self.out.push_str(" xmlns=\"\"");
        }
        for (prefix, uri) in &decls {
            self.out.push_str(" xmlns:");
            self.out.push_str(prefix);
            self.out.push_str("=\"");
            escape_attr(&mut self.out, uri);
            self.out.push('"');
        }
        for (a, name) in e.attrs.iter().zip(&attr_names) {
            self.out.push(' ');
            self.out.push_str(name);
            self.out.push_str("=\"");
            escape_attr(&mut self.out, &a.value);
            self.out.push('"');
        }
        if e.children.is_empty() {
            self.out.push_str("/>");
        } else {
            self.out.push('>');
            for &c in &e.children {
                self.node(c);
            }
            self.out.push_str("</");
            self.out.push_str(&qname);
            self.out.push('>');
        }
        self.scope.truncate(scope_len);
    }
}

fn qualified(prefix: Option<&str>, local: &str) -> String {
    match prefix {
        Some(p) => format!("{p}:{local}"),
        None => local.to_owned(),
    }
}

fn escape_text(out: &mut String, s: &str) {
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '\r' => out.push_str("&#13;"),
            _ => out.push(c),
        }
    }
}

fn escape_attr(out: &mut String, s: &str) {
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\t' => out.push_str("&#9;"),
            '\n' => out.push_str("&#10;"),
            '\r' => out.push_str("&#13;"),
            _ => out.push(c),
        }
    }
}
