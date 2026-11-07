//! XML 1.0 parser producing an [`XmlDoc`].
//!
//! Supports what Office packages contain: a declaration, comments, processing
//! instructions, CDATA, the five predefined entities and character references,
//! and UTF-8/UTF-16 input. Document type declarations are skipped and their
//! entities are never expanded, so entity-expansion attacks cannot apply.

use super::{Attr, Element, NodeId, NodeKind, Ns, Prefix, XmlDoc};
use crate::error::{Error, Result};
use std::borrow::Cow;

/// Deepest element nesting accepted; real presentation parts stay far below.
const MAX_DEPTH: usize = 1024;

struct RawAttr<'a> {
    prefix: Option<&'a str>,
    local: &'a str,
    value: String,
}

struct Parser<'a> {
    s: &'a str,
    b: &'a [u8],
    pos: usize,
    part: &'a str,
}

fn decode(bytes: &[u8]) -> Result<(Cow<'_, str>, bool)> {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return Ok((String::from_utf8_lossy(rest), false));
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
        return Ok((Cow::Owned(utf16(true, rest)), true));
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return Ok((Cow::Owned(utf16(false, rest)), true));
    }
    if bytes.starts_with(&[b'<', 0]) {
        return Ok((Cow::Owned(utf16(true, bytes)), true));
    }
    if bytes.starts_with(&[0, b'<']) {
        return Ok((Cow::Owned(utf16(false, bytes)), true));
    }
    Ok((String::from_utf8_lossy(bytes), false))
}

pub(super) fn parse(bytes: &[u8], part: &str) -> Result<XmlDoc> {
    let (text, was_utf16) = decode(bytes)?;
    let mut p = Parser {
        s: &text,
        b: text.as_bytes(),
        pos: 0,
        part,
    };
    let mut doc = XmlDoc {
        prolog: String::new(),
        nodes: Vec::new(),
        root: NodeId(0),
        dynamic_ns: Vec::new(),
    };
    p.skip_prolog()?;
    doc.prolog = if was_utf16 {
        super::STANDARD_DECLARATION.to_owned()
    } else {
        p.s[..p.pos].to_owned()
    };
    p.parse_root(&mut doc)?;
    p.check_epilogue()?;
    Ok(doc)
}

impl<'a> Parser<'a> {
    fn err<T>(&self, message: impl Into<String>) -> Result<T> {
        Err(Error::Xml {
            part: self.part.to_owned(),
            message: message.into(),
            offset: self.pos,
        })
    }

    fn starts_with(&self, pat: &str) -> bool {
        self.b[self.pos..].starts_with(pat.as_bytes())
    }

    fn skip_ws(&mut self) {
        while self.pos < self.b.len() && matches!(self.b[self.pos], b' ' | b'\t' | b'\r' | b'\n') {
            self.pos += 1;
        }
    }

    /// Advances past the next occurrence of `pat`, returning the text before it.
    fn take_until(&mut self, pat: &str) -> Result<&'a str> {
        let start = self.pos;
        match self.s[start..].find(pat) {
            Some(i) => {
                self.pos = start + i + pat.len();
                Ok(&self.s[start..start + i])
            }
            None => self.err(format!("unterminated construct, expected `{pat}`")),
        }
    }

    fn skip_prolog(&mut self) -> Result<()> {
        loop {
            self.skip_ws();
            if self.pos >= self.b.len() {
                return self.err("document has no root element");
            }
            if self.starts_with("<?") {
                self.pos += 2;
                self.take_until("?>")?;
            } else if self.starts_with("<!--") {
                self.pos += 4;
                self.take_until("-->")?;
            } else if self.starts_with("<!DOCTYPE") {
                self.skip_doctype()?;
            } else if self.b[self.pos] == b'<' {
                return Ok(());
            } else {
                return self.err("unexpected content before the root element");
            }
        }
    }

    /// Only comments, processing instructions, and whitespace may follow the
    /// root element (trailing NUL padding from sloppy writers is tolerated).
    fn check_epilogue(&mut self) -> Result<()> {
        loop {
            while self.pos < self.b.len()
                && matches!(self.b[self.pos], b' ' | b'\t' | b'\r' | b'\n' | 0)
            {
                self.pos += 1;
            }
            if self.pos >= self.b.len() {
                return Ok(());
            }
            if self.starts_with("<!--") {
                self.pos += 4;
                self.take_until("-->")?;
            } else if self.starts_with("<?") {
                self.pos += 2;
                self.take_until("?>")?;
            } else {
                return self.err("unexpected content after the root element");
            }
        }
    }

    fn skip_doctype(&mut self) -> Result<()> {
        let mut depth = 0usize;
        while self.pos < self.b.len() {
            match self.b[self.pos] {
                b'[' => depth += 1,
                b']' => depth = depth.saturating_sub(1),
                b'>' if depth == 0 => {
                    self.pos += 1;
                    return Ok(());
                }
                _ => {}
            }
            self.pos += 1;
        }
        self.err("unterminated DOCTYPE")
    }

    fn name(&mut self) -> Result<&'a str> {
        let start = self.pos;
        while self.pos < self.b.len()
            && !matches!(
                self.b[self.pos],
                b' ' | b'\t' | b'\r' | b'\n' | b'/' | b'>' | b'='
            )
        {
            self.pos += 1;
        }
        if self.pos == start {
            return self.err("expected a name");
        }
        Ok(&self.s[start..self.pos])
    }

    fn parse_root(&mut self, doc: &mut XmlDoc) -> Result<()> {
        // Open elements and the namespace-binding count when each was opened.
        let mut stack: Vec<(NodeId, &'a str, usize)> = Vec::new();
        let mut bindings: Vec<(Option<&'a str>, Ns)> = Vec::new();
        let mut root: Option<NodeId> = None;
        loop {
            if self.pos >= self.b.len() {
                return self.err("unexpected end of document");
            }
            if self.b[self.pos] != b'<' {
                let start = self.pos;
                let end = self.s[start..]
                    .find('<')
                    .map_or(self.b.len(), |i| start + i);
                self.pos = end;
                let Some(&(parent, _, _)) = stack.last() else {
                    return self.err("text outside the root element");
                };
                let text = decode_entities(&self.s[start..end], false).map_err(|m| Error::Xml {
                    part: self.part.to_owned(),
                    message: m,
                    offset: start,
                })?;
                let id = doc.push_node(Some(parent), NodeKind::Text(text));
                push_child(doc, parent, id);
                continue;
            }
            if self.starts_with("</") {
                self.pos += 2;
                let name = self.name()?;
                self.skip_ws();
                if self.b.get(self.pos) != Some(&b'>') {
                    return self.err("malformed end tag");
                }
                self.pos += 1;
                let Some((_, open, scope)) = stack.pop() else {
                    return self.err("unbalanced end tag");
                };
                if open != name {
                    return self.err(format!("end tag `{name}` does not match `{open}`"));
                }
                bindings.truncate(scope);
                if stack.is_empty() {
                    return Ok(());
                }
                continue;
            }
            if self.starts_with("<!--") {
                self.pos += 4;
                let body = self.take_until("-->")?;
                if let Some(&(parent, _, _)) = stack.last() {
                    let id = doc.push_node(Some(parent), NodeKind::Comment(body.to_owned()));
                    push_child(doc, parent, id);
                }
                continue;
            }
            if self.starts_with("<![CDATA[") {
                self.pos += 9;
                let body = self.take_until("]]>")?;
                let Some(&(parent, _, _)) = stack.last() else {
                    return self.err("CDATA outside the root element");
                };
                let id = doc.push_node(Some(parent), NodeKind::CData(body.to_owned()));
                push_child(doc, parent, id);
                continue;
            }
            if self.starts_with("<?") {
                self.pos += 2;
                let body = self.take_until("?>")?;
                if let Some(&(parent, _, _)) = stack.last() {
                    let id = doc.push_node(Some(parent), NodeKind::Pi(body.to_owned()));
                    push_child(doc, parent, id);
                }
                continue;
            }
            if self.starts_with("<!") {
                return self.err("unexpected markup declaration");
            }
            // Start tag.
            self.pos += 1;
            let qname = self.name()?;
            let mut raw_attrs: Vec<RawAttr<'a>> = Vec::new();
            let self_closing = loop {
                self.skip_ws();
                match self.b.get(self.pos) {
                    Some(b'/') => {
                        if self.b.get(self.pos + 1) != Some(&b'>') {
                            return self.err("malformed empty-element tag");
                        }
                        self.pos += 2;
                        break true;
                    }
                    Some(b'>') => {
                        self.pos += 1;
                        break false;
                    }
                    Some(_) => {
                        let aname = self.name()?;
                        self.skip_ws();
                        if self.b.get(self.pos) != Some(&b'=') {
                            return self.err(format!("attribute `{aname}` has no value"));
                        }
                        self.pos += 1;
                        self.skip_ws();
                        let quote = match self.b.get(self.pos) {
                            Some(&q @ (b'"' | b'\'')) => q,
                            _ => return self.err("attribute value must be quoted"),
                        };
                        self.pos += 1;
                        let start = self.pos;
                        let end = self.b[start..]
                            .iter()
                            .position(|&c| c == quote)
                            .map(|i| start + i);
                        let Some(end) = end else {
                            return self.err("unterminated attribute value");
                        };
                        self.pos = end + 1;
                        let value =
                            decode_entities(&self.s[start..end], true).map_err(|m| Error::Xml {
                                part: self.part.to_owned(),
                                message: m,
                                offset: start,
                            })?;
                        let (prefix, local) = split_qname(aname);
                        if raw_attrs
                            .iter()
                            .any(|a| a.prefix == prefix && a.local == local)
                        {
                            return self.err(format!("duplicate attribute `{aname}`"));
                        }
                        raw_attrs.push(RawAttr {
                            prefix,
                            local,
                            value,
                        });
                    }
                    None => return self.err("unterminated start tag"),
                }
            };
            let scope = bindings.len();
            for a in &raw_attrs {
                match (a.prefix, a.local) {
                    (None, "xmlns") => bindings.push((None, doc.intern_ns(&a.value))),
                    (Some("xmlns"), p) => bindings.push((Some(p), doc.intern_ns(&a.value))),
                    _ => {}
                }
            }
            let (eprefix, elocal) = split_qname(qname);
            let ens = resolve(doc, &bindings, eprefix, true);
            let attrs = raw_attrs
                .into_iter()
                .map(|a| {
                    let is_decl =
                        matches!((a.prefix, a.local), (None, "xmlns") | (Some("xmlns"), _));
                    let ns = if is_decl || a.prefix.is_none() {
                        Ns::NONE
                    } else {
                        resolve(doc, &bindings, a.prefix, false)
                    };
                    Attr {
                        prefix: Prefix::Written(a.prefix.map(Into::into)),
                        local: a.local.into(),
                        ns,
                        value: a.value,
                    }
                })
                .collect();
            let parent = stack.last().map(|&(id, _, _)| id);
            if parent.is_none() && root.is_some() {
                return self.err("multiple root elements");
            }
            let id = doc.push_node(
                parent,
                NodeKind::Element(Element {
                    prefix: Prefix::Written(eprefix.map(Into::into)),
                    local: elocal.into(),
                    ns: ens,
                    attrs,
                    children: Vec::new(),
                }),
            );
            match parent {
                Some(parent) => push_child(doc, parent, id),
                None => {
                    root = Some(id);
                    doc.root = id;
                }
            }
            if self_closing {
                bindings.truncate(scope);
                if stack.is_empty() {
                    return Ok(());
                }
            } else {
                if stack.len() >= MAX_DEPTH {
                    return self.err("elements are nested too deeply");
                }
                stack.push((id, qname, scope));
            }
        }
    }
}

fn push_child(doc: &mut XmlDoc, parent: NodeId, child: NodeId) {
    if let NodeKind::Element(e) = &mut doc.nodes[parent.0 as usize].kind {
        e.children.push(child);
    }
}

fn split_qname(name: &str) -> (Option<&str>, &str) {
    match name.split_once(':') {
        Some((p, l)) => (Some(p), l),
        None => (None, name),
    }
}

fn resolve(
    doc: &mut XmlDoc,
    bindings: &[(Option<&str>, Ns)],
    prefix: Option<&str>,
    element: bool,
) -> Ns {
    if prefix == Some("xml") {
        return Ns::XML;
    }
    if prefix.is_none() && !element {
        return Ns::NONE;
    }
    match bindings.iter().rev().find(|(p, _)| *p == prefix) {
        Some(&(_, ns)) => ns,
        // Unbound prefixes occur in sloppy producers; keep them distinguishable.
        None => match prefix {
            Some(p) => doc.intern_ns(&format!("urn:unbound-prefix:{p}")),
            None => Ns::NONE,
        },
    }
}

/// Decodes entity and character references; normalizes line ends (and, for
/// attribute values, literal whitespace) as XML 1.0 requires.
fn decode_entities(raw: &str, attribute: bool) -> std::result::Result<String, String> {
    if !(raw.contains(['&', '\r']) || attribute && raw.contains(['\n', '\t'])) {
        return Ok(raw.to_owned());
    }
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(i) = rest.find(['&', '\r', '\n', '\t']) {
        out.push_str(&rest[..i]);
        let c = rest.as_bytes()[i];
        rest = &rest[i + 1..];
        match c {
            b'\r' => {
                rest = rest.strip_prefix('\n').unwrap_or(rest);
                out.push(if attribute { ' ' } else { '\n' });
            }
            b'\n' | b'\t' => out.push(if attribute { ' ' } else { c as char }),
            _ => {
                let Some(end) = rest.find(';') else {
                    return Err("unterminated entity reference".into());
                };
                let name = &rest[..end];
                rest = &rest[end + 1..];
                match name {
                    "lt" => out.push('<'),
                    "gt" => out.push('>'),
                    "amp" => out.push('&'),
                    "apos" => out.push('\''),
                    "quot" => out.push('"'),
                    _ => {
                        let code = if let Some(hex) =
                            name.strip_prefix("#x").or_else(|| name.strip_prefix("#X"))
                        {
                            u32::from_str_radix(hex, 16).ok()
                        } else if let Some(dec) = name.strip_prefix('#') {
                            dec.parse::<u32>().ok()
                        } else {
                            return Err(format!("unknown entity `&{name};`"));
                        };
                        out.push(code.and_then(char::from_u32).unwrap_or('\u{FFFD}'));
                    }
                }
            }
        }
    }
    out.push_str(rest);
    Ok(out)
}
