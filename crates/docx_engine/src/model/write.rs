//! Writes blocks back to WordprocessingML.

use super::block::{Block, BlockId, BlockKind, Story};
use super::content::{Content, Span, Wrapper, key};
use crate::xml::{escape_attr, escape_text};

/// Schema order of run property elements (CT_RPr); unknown elements follow,
/// and `rPrChange` always comes last.
const RPR_ORDER: &[&str] = &[
    "rStyle",
    "rFonts",
    "b",
    "bCs",
    "i",
    "iCs",
    "caps",
    "smallCaps",
    "strike",
    "dstrike",
    "outline",
    "shadow",
    "emboss",
    "imprint",
    "noProof",
    "snapToGrid",
    "vanish",
    "webHidden",
    "color",
    "spacing",
    "w",
    "kern",
    "position",
    "sz",
    "szCs",
    "highlight",
    "u",
    "effect",
    "bdr",
    "shd",
    "fitText",
    "vertAlign",
    "rtl",
    "cs",
    "em",
    "lang",
    "eastAsianLayout",
    "specVanish",
    "oMath",
];

fn rpr_rank(qname: &str) -> usize {
    let (prefix, local) = qname.split_once(':').unwrap_or(("", qname));
    if local == "rPrChange" {
        return usize::MAX;
    }
    // Extension elements (w14:, w15:...) follow the base properties.
    let base = prefix.is_empty() || !prefix.starts_with('w') || prefix.len() == 1;
    match RPR_ORDER.iter().position(|n| *n == local) {
        Some(i) if base => i,
        _ => RPR_ORDER.len() + 1,
    }
}

/// Serializes stories with the document's WordprocessingML prefix.
pub struct Writer<'a> {
    /// Prefix bound to the WordprocessingML namespace (`w` in practice).
    pub w: &'a str,
}

impl Writer<'_> {
    fn tag(&self, local: &str) -> String {
        if self.w.is_empty() {
            local.to_owned()
        } else {
            format!("{}:{local}", self.w)
        }
    }

    /// The top-level blocks of a story, concatenated.
    pub fn story(&self, story: &Story) -> String {
        let mut out = String::new();
        for id in story.children(None) {
            self.block(story, id, &mut out);
        }
        out
    }

    /// One block and its descendants.
    pub fn block(&self, story: &Story, id: &BlockId, out: &mut String) {
        let Some(b) = story.get(id) else {
            return;
        };
        match b.kind {
            BlockKind::Paragraph => self.paragraph(b, out),
            BlockKind::Table => self.element(story, b, "tbl", out),
            BlockKind::Row => self.element(story, b, "tr", out),
            BlockKind::Cell => {
                let tag = self.tag("tc");
                out.push('<');
                out.push_str(&tag);
                out.push_str(&b.attrs);
                out.push('>');
                out.push_str(&b.props);
                let kids = story.children(Some(id));
                for k in kids {
                    self.block(story, k, out);
                }
                let ends_with_paragraph = kids
                    .last()
                    .and_then(|k| story.get(k))
                    .is_some_and(|k| k.kind == BlockKind::Paragraph);
                if !ends_with_paragraph {
                    out.push('<');
                    out.push_str(&self.tag("p"));
                    out.push_str("/>");
                }
                out.push_str("</");
                out.push_str(&tag);
                out.push('>');
            }
            BlockKind::Container => {
                let (open, close) = b.container_markup();
                out.push_str(&open);
                for k in story.children(Some(id)) {
                    self.block(story, k, out);
                }
                out.push_str(&close);
            }
            BlockKind::Opaque => out.push_str(&b.props),
        }
    }

    fn element(&self, story: &Story, b: &Block, local: &str, out: &mut String) {
        let tag = self.tag(local);
        out.push('<');
        out.push_str(&tag);
        out.push_str(&b.attrs);
        out.push('>');
        out.push_str(&b.props);
        for k in story.children(Some(&b.id)) {
            self.block(story, k, out);
        }
        out.push_str("</");
        out.push_str(&tag);
        out.push('>');
    }

    /// A paragraph.
    pub fn paragraph(&self, b: &Block, out: &mut String) {
        let tag = self.tag("p");
        out.push('<');
        out.push_str(&tag);
        out.push_str(&b.attrs);
        if b.props.is_empty() && b.content.is_empty() {
            out.push_str("/>");
            return;
        }
        out.push('>');
        out.push_str(&b.props);
        self.content(&b.content, out);
        out.push_str("</");
        out.push_str(&tag);
        out.push('>');
    }

    /// Paragraph content: runs inside their wrappers.
    pub fn content(&self, content: &Content, out: &mut String) {
        let mut open: Vec<Wrapper> = Vec::new();
        for span in content.spans() {
            let wrappers = span.attrs.wrappers();
            let common = open
                .iter()
                .zip(&wrappers)
                .take_while(|(a, b)| a == b)
                .count();
            while open.len() > common {
                if let Some(w) = open.pop() {
                    out.push_str(&w.close);
                }
            }
            for w in &wrappers[common..] {
                out.push_str(&w.open);
                open.push(w.clone());
            }
            let deleted = wrappers
                .iter()
                .any(|w| matches!(w.local(), "del" | "moveFrom"));
            self.span(span, deleted, out);
        }
        while let Some(w) = open.pop() {
            out.push_str(&w.close);
        }
    }

    fn run_open(&self, span: &Span, out: &mut String) {
        out.push('<');
        out.push_str(&self.tag("r"));
        for (k, v) in span.attrs.iter() {
            if let Some(name) = k.strip_prefix(key::RUN_ATTR) {
                out.push(' ');
                out.push_str(name);
                out.push_str("=\"");
                escape_attr(out, v);
                out.push('"');
            }
        }
        out.push('>');
        let mut props: Vec<(&str, &str)> = span.attrs.run_props().collect();
        if !props.is_empty() {
            props.sort_by_key(|(q, _)| rpr_rank(q));
            out.push('<');
            out.push_str(&self.tag("rPr"));
            out.push('>');
            for (_, xml) in props {
                out.push_str(xml);
            }
            out.push_str("</");
            out.push_str(&self.tag("rPr"));
            out.push('>');
        }
    }

    fn run_close(&self, out: &mut String) {
        out.push_str("</");
        out.push_str(&self.tag("r"));
        out.push('>');
    }

    fn span(&self, span: &Span, deleted: bool, out: &mut String) {
        if let Some(mark) = span.attrs.marker() {
            for _ in span.text.chars() {
                out.push_str(mark);
            }
            return;
        }
        self.run_open(span, out);
        if let Some(obj) = span.attrs.object() {
            for _ in span.text.chars() {
                out.push_str(obj);
            }
            self.run_close(out);
            return;
        }
        let text_tag = match (span.attrs.is_instr(), deleted) {
            (false, false) => "t",
            (false, true) => "delText",
            (true, false) => "instrText",
            (true, true) => "delInstrText",
        };
        let mut buf = String::new();
        let flush = |buf: &mut String, out: &mut String| {
            if buf.is_empty() {
                return;
            }
            let tag = self.tag(text_tag);
            out.push('<');
            out.push_str(&tag);
            if buf.starts_with(char::is_whitespace) || buf.ends_with(char::is_whitespace) {
                out.push_str(" xml:space=\"preserve\"");
            }
            out.push('>');
            escape_text(out, buf);
            out.push_str("</");
            out.push_str(&tag);
            out.push('>');
            buf.clear();
        };
        for c in span.text.chars() {
            let element = match c {
                '\t' => Some("tab"),
                '\n' => Some("br"),
                '\u{2011}' => Some("noBreakHyphen"),
                '\u{00AD}' => Some("softHyphen"),
                _ => None,
            };
            match element {
                Some(local) => {
                    flush(&mut buf, out);
                    out.push('<');
                    out.push_str(&self.tag(local));
                    out.push_str("/>");
                }
                None => buf.push(c),
            }
        }
        flush(&mut buf, out);
        self.run_close(out);
    }
}

/// Escapes text for element content (re-exported for callers building XML).
pub fn text_xml(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    escape_text(&mut out, s);
    out
}

#[cfg(test)]
mod test;
