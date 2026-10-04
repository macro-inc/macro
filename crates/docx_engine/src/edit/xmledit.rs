//! Small edits to property elements kept as XML (`w:pPr`, `w:tcPr`,
//! `w:tblPr`...): replacing, inserting and removing children in schema
//! order, and changing attributes of empty children such as `w:spacing`.

use crate::xml::{Decl, SnippetContext, escape_attr};

/// Schema order of paragraph property children (CT_PPr).
pub(crate) const PPR_ORDER: &[&str] = &[
    "pStyle",
    "keepNext",
    "keepLines",
    "pageBreakBefore",
    "framePr",
    "widowControl",
    "numPr",
    "suppressLineNumbers",
    "pBdr",
    "shd",
    "tabs",
    "suppressAutoHyphens",
    "kinsoku",
    "wordWrap",
    "overflowPunct",
    "topLinePunct",
    "autoSpaceDE",
    "autoSpaceDN",
    "bidi",
    "adjustRightInd",
    "snapToGrid",
    "spacing",
    "ind",
    "contextualSpacing",
    "mirrorIndents",
    "suppressOverlap",
    "jc",
    "textDirection",
    "textAlignment",
    "textboxTightWrap",
    "outlineLvl",
    "divId",
    "cnfStyle",
    "rPr",
    "sectPr",
    "pPrChange",
];

/// Schema order of table cell property children (CT_TcPr).
pub(crate) const TCPR_ORDER: &[&str] = &[
    "cnfStyle",
    "tcW",
    "gridSpan",
    "hMerge",
    "vMerge",
    "tcBorders",
    "shd",
    "noWrap",
    "tcMar",
    "textDirection",
    "tcFitText",
    "vAlign",
    "hideMark",
    "headers",
    "cellIns",
    "cellDel",
    "cellMerge",
    "tcPrChange",
];

/// Schema order of table property children (CT_TblPr).
pub(crate) const TBLPR_ORDER: &[&str] = &[
    "tblStyle",
    "tblpPr",
    "tblOverlap",
    "bidiVisual",
    "tblStyleRowBandSize",
    "tblStyleColBandSize",
    "tblW",
    "jc",
    "tblCellSpacing",
    "tblInd",
    "tblBorders",
    "shd",
    "tblLayout",
    "tblCellMar",
    "tblLook",
    "tblCaption",
    "tblDescription",
    "tblPrChange",
];

/// Schema order of table row property children (CT_TrPr).
pub(crate) const TRPR_ORDER: &[&str] = &[
    "cnfStyle",
    "divId",
    "gridBefore",
    "gridAfter",
    "wBefore",
    "wAfter",
    "cantSplit",
    "trHeight",
    "tblHeader",
    "tblCellSpacing",
    "jc",
    "hidden",
    "ins",
    "del",
    "trPrChange",
];

/// One child element: its qualified name and markup.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Child {
    pub qname: String,
    pub xml: String,
}

impl Child {
    /// The local name.
    pub fn local(&self) -> &str {
        self.qname.rsplit(':').next().unwrap_or(&self.qname)
    }

    /// The prefix (empty when unprefixed).
    pub fn prefix(&self) -> &str {
        self.qname.rsplit_once(':').map_or("", |(p, _)| p)
    }
}

/// A property element opened for editing.
#[derive(Clone, Debug)]
pub(crate) struct Element {
    /// Prefix of the WordprocessingML namespace.
    w: String,
    /// The element's start tag without the closing `>` or `/>`.
    open: String,
    /// The element's qualified name.
    qname: String,
    /// Children, in order.
    pub children: Vec<Child>,
    /// Text between children is dropped; property elements hold none.
    order: &'static [&'static str],
}

fn qualify(w: &str, local: &str) -> String {
    if w.is_empty() {
        local.to_owned()
    } else {
        format!("{w}:{local}")
    }
}

impl Element {
    /// Opens `xml` (one element, or empty for a new `w:{local}` element).
    pub fn open(
        xml: &str,
        local: &str,
        w: &str,
        decls: &[Decl],
        order: &'static [&'static str],
    ) -> Self {
        let qname = qualify(w, local);
        let empty = Self {
            w: w.to_owned(),
            open: format!("<{qname}"),
            qname: qname.clone(),
            children: Vec::new(),
            order,
        };
        let xml = xml.trim();
        if xml.is_empty() {
            return empty;
        }
        let Ok(tree) = SnippetContext::new(decls).parse(xml) else {
            return empty;
        };
        let root = tree.root();
        let start = tree.start_tag(root);
        let open = start
            .trim_end_matches('>')
            .trim_end_matches('/')
            .trim_end()
            .to_owned();
        let children = tree
            .children(root)
            .map(|c| Child {
                qname: tree.qname(c).to_owned(),
                xml: tree.raw(c).to_owned(),
            })
            .collect();
        Self {
            w: w.to_owned(),
            open,
            qname: tree.qname(root).to_owned(),
            children,
            order,
        }
    }

    fn is_w(&self, c: &Child, local: &str) -> bool {
        c.local() == local && c.prefix() == self.w
    }

    /// The qualified name of a WordprocessingML child.
    pub fn q(&self, local: &str) -> String {
        qualify(&self.w, local)
    }

    /// The markup of child `w:{local}`.
    pub fn get(&self, local: &str) -> Option<&str> {
        self.children
            .iter()
            .find(|c| self.is_w(c, local))
            .map(|c| c.xml.as_str())
    }

    /// Whether child `w:{local}` exists.
    pub fn has(&self, local: &str) -> bool {
        self.get(local).is_some()
    }

    fn rank(&self, c: &Child) -> Option<usize> {
        if c.prefix() != self.w {
            return None;
        }
        self.order.iter().position(|n| *n == c.local())
    }

    /// Replaces child `w:{local}` with `xml`, inserts it in schema order, or
    /// removes it (`None`).
    pub fn set(&mut self, local: &str, xml: Option<String>) {
        let at = self.children.iter().position(|c| self.is_w(c, local));
        match (at, xml) {
            (Some(i), Some(xml)) => self.children[i].xml = xml,
            (Some(i), None) => {
                self.children.remove(i);
            }
            (None, Some(xml)) => {
                let rank = self.order.iter().position(|n| *n == local);
                let at = rank.map_or(self.children.len(), |r| {
                    self.children
                        .iter()
                        .position(|c| self.rank(c).is_some_and(|cr| cr > r))
                        .unwrap_or(self.children.len())
                });
                let qname = self.q(local);
                self.children.insert(at, Child { qname, xml });
            }
            (None, None) => {}
        }
    }

    /// Sets `w:{local}` to an empty element with a `w:val`.
    pub fn set_val(&mut self, local: &str, val: Option<&str>) {
        let xml = val.map(|v| {
            let mut s = format!("<{} {}=\"", self.q(local), self.q("val"));
            escape_attr(&mut s, v);
            s.push_str("\"/>");
            s
        });
        self.set(local, xml);
    }

    /// Sets an on/off property: present (`true`), `w:val="0"` (`false`) or
    /// absent (`None`).
    pub fn set_flag(&mut self, local: &str, on: Option<bool>) {
        match on {
            Some(true) => {
                let xml = format!("<{}/>", self.q(local));
                self.set(local, Some(xml));
            }
            Some(false) => self.set_val(local, Some("0")),
            None => self.set(local, None),
        }
    }

    /// Attributes of an empty child, as (qualified name, value).
    pub fn attrs_of(&self, local: &str, decls: &[Decl]) -> Vec<(String, String)> {
        let Some(xml) = self.get(local) else {
            return Vec::new();
        };
        let Ok(tree) = SnippetContext::new(decls).parse(xml) else {
            return Vec::new();
        };
        tree.attrs(tree.root())
            .iter()
            .map(|a| (a.qname.to_string(), a.value.to_string()))
            .collect()
    }

    /// Sets (or removes) attributes `w:{name}` of the empty child
    /// `w:{local}`, creating it when needed and removing it when no
    /// attributes are left.
    pub fn set_attrs(&mut self, local: &str, changes: &[(&str, Option<String>)], decls: &[Decl]) {
        let mut attrs = self.attrs_of(local, decls);
        for (name, value) in changes {
            let q = self.q(name);
            match value {
                Some(v) => match attrs.iter_mut().find(|(k, _)| *k == q) {
                    Some(slot) => slot.1 = v.clone(),
                    None => attrs.push((q, v.clone())),
                },
                None => attrs.retain(|(k, _)| *k != q),
            }
        }
        if attrs.is_empty() {
            self.set(local, None);
            return;
        }
        let mut xml = format!("<{}", self.q(local));
        for (k, v) in &attrs {
            xml.push(' ');
            xml.push_str(k);
            xml.push_str("=\"");
            escape_attr(&mut xml, v);
            xml.push('"');
        }
        xml.push_str("/>");
        self.set(local, Some(xml));
    }

    /// Whether the element has no children and no attributes (namespace
    /// declarations aside).
    pub fn is_empty(&self) -> bool {
        self.children.is_empty()
            && self.open[self.qname.len() + 1..]
                .split_whitespace()
                .all(|t| t.starts_with("xmlns"))
    }

    /// The element's markup (empty when it has nothing to say and `drop_empty`).
    pub fn finish(&self, drop_empty: bool) -> String {
        if drop_empty && self.is_empty() {
            return String::new();
        }
        if self.children.is_empty() {
            return format!("{}/>", self.open);
        }
        let mut out = String::with_capacity(
            self.open.len() + self.children.iter().map(|c| c.xml.len()).sum::<usize>() + 32,
        );
        out.push_str(&self.open);
        out.push('>');
        for c in &self.children {
            out.push_str(&c.xml);
        }
        out.push_str("</");
        out.push_str(&self.qname);
        out.push('>');
        out
    }
}

/// Splits concatenated sibling elements (a table's `w:tblPr` + `w:tblGrid`,
/// a row's `w:tblPrEx` + `w:trPr`) into (qualified name, markup) pairs.
pub(crate) fn split_siblings(xml: &str, decls: &[Decl]) -> Vec<Child> {
    if xml.trim().is_empty() {
        return Vec::new();
    }
    let Ok((tree, kids)) = SnippetContext::new(decls).parse_many(xml) else {
        return Vec::new();
    };
    kids.into_iter()
        .map(|k| Child {
            qname: tree.qname(k).to_owned(),
            xml: tree.raw(k).to_owned(),
        })
        .collect()
}

#[cfg(test)]
mod test {
    use super::*;

    fn decls() -> Vec<Decl> {
        vec![Decl {
            prefix: "w".into(),
            uri: "http://schemas.openxmlformats.org/wordprocessingml/2006/main".into(),
        }]
    }

    #[test]
    fn inserts_in_schema_order_and_edits_attributes() {
        let d = decls();
        let mut e = Element::open(
            r#"<w:pPr><w:pStyle w:val="Body"/><w:jc w:val="left"/></w:pPr>"#,
            "pPr",
            "w",
            &d,
            PPR_ORDER,
        );
        e.set_val("jc", Some("center"));
        e.set_attrs("spacing", &[("after", Some("120".into()))], &d);
        e.set_flag("keepNext", Some(true));
        assert_eq!(
            e.finish(true),
            r#"<w:pPr><w:pStyle w:val="Body"/><w:keepNext/><w:spacing w:after="120"/><w:jc w:val="center"/></w:pPr>"#
        );
        e.set_attrs("spacing", &[("after", None)], &d);
        e.set("pStyle", None);
        e.set("keepNext", None);
        e.set("jc", None);
        assert_eq!(e.finish(true), "");
    }

    #[test]
    fn opens_empty_and_self_closing() {
        let d = decls();
        let mut e = Element::open("", "pPr", "w", &d, PPR_ORDER);
        assert!(e.is_empty());
        e.set_val("pStyle", Some("Heading1"));
        assert_eq!(
            e.finish(true),
            r#"<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>"#
        );
        let e = Element::open(r#"<w:tcPr/>"#, "tcPr", "w", &d, TCPR_ORDER);
        assert!(e.children.is_empty());
        assert_eq!(e.finish(false), "<w:tcPr/>");
    }
}
