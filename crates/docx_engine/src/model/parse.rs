//! Reads story XML (the body, headers, notes...) into blocks.

use super::block::{Block, BlockId, BlockKind, IdGen, Story, initial_keys};
use super::content::{Attrs, Content, OBJECT_CHAR, Wrapper, encode_wrappers, key};
use crate::xml::{NodeId, Ns, XmlTree};

/// Elements that wrap runs inside a paragraph.
const RUN_WRAPPERS: &[&str] = &[
    "hyperlink",
    "smartTag",
    "customXml",
    "fldSimple",
    "ins",
    "del",
    "moveFrom",
    "moveTo",
    "dir",
    "bdo",
    "sdt",
];

/// Paragraph children dropped on reading: proofing marks Word regenerates.
const DROPPED: &[&str] = &["proofErr"];

/// Run run attributes that only record editing sessions.
const DROPPED_RUN_ATTRS: &[&str] = &["rsidR", "rsidRPr", "rsidDel"];

/// Builds blocks from parsed story XML.
pub struct StoryReader<'a> {
    tree: &'a XmlTree,
    ids: &'a mut IdGen,
    story: Story,
}

/// A story read from XML.
pub struct ReadStory {
    /// The blocks.
    pub story: Story,
    /// The body's last `w:sectPr` (the final section's properties), verbatim.
    pub final_sect_pr: Option<String>,
}

impl<'a> StoryReader<'a> {
    /// A reader over `tree`.
    pub fn new(tree: &'a XmlTree, ids: &'a mut IdGen) -> Self {
        Self {
            tree,
            ids,
            story: Story::new(),
        }
    }

    /// Reads the block-level children of `container` (`w:body`, `w:hdr`,
    /// `w:footnote`, `w:txbxContent`...).
    pub fn read(mut self, container: NodeId) -> ReadStory {
        let t = self.tree;
        let mut kids: Vec<NodeId> = t.children(container).collect();
        // The body's own sectPr belongs last, but producers sometimes put
        // content after it; the last one wherever it is describes the final section.
        let final_sect_pr = match kids.iter().rposition(|&k| t.is_w(k, "sectPr")) {
            Some(i) => {
                let n = kids.remove(i);
                Some(t.snippet(n))
            }
            None => None,
        };
        self.blocks(&kids, None);
        ReadStory {
            story: self.story,
            final_sect_pr,
        }
    }

    /// Adds blocks for `nodes` under `parent`, with evenly spread keys.
    fn blocks(&mut self, nodes: &[NodeId], parent: Option<&BlockId>) -> usize {
        let mut made: Vec<Block> = Vec::with_capacity(nodes.len());
        for &n in nodes {
            if let Some(b) = self.block(n, parent) {
                made.push(b);
            }
        }
        let count = made.len();
        let keys = initial_keys(count);
        for (mut b, k) in made.into_iter().zip(keys) {
            b.order = k;
            self.story.insert(b);
        }
        count
    }

    fn new_block(&mut self, kind: BlockKind, parent: Option<&BlockId>, node: NodeId) -> Block {
        let mut b = Block::new(self.ids.next_id(), kind, parent.cloned(), String::new());
        b.attrs = self.tree.raw_attrs(node).to_owned();
        b
    }

    fn block(&mut self, n: NodeId, parent: Option<&BlockId>) -> Option<Block> {
        let t = self.tree;
        if t.ns(n) == Ns::W {
            match t.local(n) {
                "p" => return Some(self.paragraph(n, parent)),
                "tbl" => return Some(self.table(n, parent)),
                "sdt" => {
                    let content = t.w_child(n, "sdtContent");
                    let mut open = t.start_tag(n).to_owned();
                    for c in t.children(n) {
                        if t.is_w(c, "sdtPr") || t.is_w(c, "sdtEndPr") {
                            open.push_str(&t.snippet(c));
                        }
                    }
                    let (content_open, content_close) = match content {
                        Some(c) => (t.start_tag(c).to_owned(), format!("</{}>", t.qname(c))),
                        None => (String::new(), String::new()),
                    };
                    open.push_str(&content_open);
                    let close = format!("{content_close}</{}>", t.qname(n));
                    let mut b = self.new_block(BlockKind::Container, parent, n);
                    b.attrs.clear();
                    b.props = serde_json::to_string(&(open, close)).unwrap_or_default();
                    let id = b.id.clone();
                    let kids: Vec<NodeId> =
                        content.map(|c| t.children(c).collect()).unwrap_or_default();
                    self.blocks(&kids, Some(&id));
                    return Some(b);
                }
                "customXml" => {
                    let mut open = t.start_tag(n).to_owned();
                    if let Some(pr) = t.w_child(n, "customXmlPr") {
                        open.push_str(&t.snippet(pr));
                    }
                    let close = format!("</{}>", t.qname(n));
                    let mut b = self.new_block(BlockKind::Container, parent, n);
                    b.attrs.clear();
                    b.props = serde_json::to_string(&(open, close)).unwrap_or_default();
                    let id = b.id.clone();
                    let kids: Vec<NodeId> = t
                        .children(n)
                        .filter(|&c| !t.is_w(c, "customXmlPr"))
                        .collect();
                    self.blocks(&kids, Some(&id));
                    return Some(b);
                }
                _ => {}
            }
        }
        let mut b = self.new_block(BlockKind::Opaque, parent, n);
        b.attrs.clear();
        b.props = t.snippet(n);
        Some(b)
    }

    fn paragraph(&mut self, p: NodeId, parent: Option<&BlockId>) -> Block {
        let t = self.tree;
        let mut b = self.new_block(BlockKind::Paragraph, parent, p);
        if let Some(ppr) = t.w_child(p, "pPr") {
            b.props = t.snippet(ppr);
        }
        let mut content = Content::new();
        let mut stack: Vec<Wrapper> = Vec::new();
        self.flatten(p, &mut stack, &mut content);
        b.content = content;
        b
    }

    fn wrap_attrs(stack: &[Wrapper]) -> Attrs {
        match encode_wrappers(stack) {
            Some(w) => Attrs::from_pairs([(key::WRAP, w)]),
            None => Attrs::empty(),
        }
    }

    /// Flattens the inline content of `node` (a paragraph or a wrapper).
    fn flatten(&mut self, node: NodeId, stack: &mut Vec<Wrapper>, out: &mut Content) {
        let t = self.tree;
        for &c in t.child_nodes(node) {
            if !t.is_element(c) || t.is_w(c, "pPr") || is_wrapper_prop(t, c) {
                continue;
            }
            self.flatten_one(c, stack, out);
        }
    }

    fn flatten_one(&mut self, c: NodeId, stack: &mut Vec<Wrapper>, out: &mut Content) {
        let t = self.tree;
        let local = t.local(c);
        if t.ns(c) == Ns::W {
            if DROPPED.contains(&local) {
                return;
            }
            if local == "r" {
                self.run(c, stack, out);
                return;
            }
            if RUN_WRAPPERS.contains(&local) && t.children(c).any(|_| true) {
                let (open, inner) = self.wrapper_open(c);
                stack.push(Wrapper {
                    open,
                    close: self.wrapper_close(c, inner),
                });
                self.flatten(inner.unwrap_or(c), stack, out);
                stack.pop();
                return;
            }
        }
        // Bookmarks, comment ranges, math, empty wrappers and anything
        // unknown: a marker that keeps the element.
        let attrs = Self::wrap_attrs(stack).with(key::MARK, Some(&t.snippet(c)));
        out.push(&OBJECT_CHAR.to_string(), attrs);
    }

    /// Opening markup of a wrapper and, for content controls, the element
    /// that holds its content.
    fn wrapper_open(&self, w: NodeId) -> (String, Option<NodeId>) {
        let t = self.tree;
        let mut open = t.start_tag(w).to_owned();
        let mut inner = None;
        for c in t.children(w) {
            if is_wrapper_prop(t, c) {
                open.push_str(&t.snippet(c));
            } else if t.is_w(c, "sdtContent") {
                open.push_str(t.start_tag(c));
                inner = Some(c);
            }
        }
        (open, inner)
    }

    fn wrapper_close(&self, w: NodeId, inner: Option<NodeId>) -> String {
        let t = self.tree;
        match inner {
            Some(i) => format!("</{}></{}>", t.qname(i), t.qname(w)),
            None => format!("</{}>", t.qname(w)),
        }
    }

    fn run(&mut self, r: NodeId, stack: &[Wrapper], out: &mut Content) {
        let t = self.tree;
        let mut pairs: Vec<(String, String)> = Vec::new();
        if let Some(wrap) = encode_wrappers(stack) {
            pairs.push((key::WRAP.to_owned(), wrap));
        }
        for a in t.attrs(r) {
            if a.ns == Ns::W && DROPPED_RUN_ATTRS.contains(&&*a.local) {
                continue;
            }
            pairs.push((format!("{}{}", key::RUN_ATTR, a.qname), a.value.to_string()));
        }
        if let Some(rpr) = t.w_child(r, "rPr") {
            for c in t.children(rpr) {
                pairs.push((format!("{}{}", key::RUN_PROP, t.qname(c)), t.snippet(c)));
            }
        }
        let attrs = Attrs::from_pairs(pairs);
        let mut instr_attrs: Option<Attrs> = None;
        for c in t.children(r) {
            let local = t.local(c);
            if t.ns(c) == Ns::W {
                match local {
                    "rPr" | "lastRenderedPageBreak" => continue,
                    "t" | "delText" => {
                        let text = t.text(c).replace(['\r', '\n'], " ");
                        out.push(&text, attrs.clone());
                        continue;
                    }
                    "instrText" | "delInstrText" => {
                        let ia =
                            instr_attrs.get_or_insert_with(|| attrs.with(key::INSTR, Some("1")));
                        let text = t.text(c).replace(['\r', '\n'], " ");
                        out.push(&text, ia.clone());
                        continue;
                    }
                    "tab" => {
                        out.push("\t", attrs.clone());
                        continue;
                    }
                    "br" if t
                        .attrs(c)
                        .iter()
                        .all(|a| &*a.local == "type" && &*a.value == "textWrapping") =>
                    {
                        out.push("\n", attrs.clone());
                        continue;
                    }
                    "cr" => {
                        out.push("\n", attrs.clone());
                        continue;
                    }
                    "noBreakHyphen" => {
                        out.push("\u{2011}", attrs.clone());
                        continue;
                    }
                    "softHyphen" => {
                        out.push("\u{00AD}", attrs.clone());
                        continue;
                    }
                    _ => {}
                }
            }
            let obj = attrs.with(key::OBJ, Some(&t.snippet(c)));
            out.push(&OBJECT_CHAR.to_string(), obj);
        }
    }

    fn table(&mut self, tbl: NodeId, parent: Option<&BlockId>) -> Block {
        let t = self.tree;
        let mut b = self.new_block(BlockKind::Table, parent, tbl);
        let mut props = String::new();
        for c in t.children(tbl) {
            if t.is_w(c, "tblPr") || t.is_w(c, "tblGrid") {
                props.push_str(&t.snippet(c));
            }
        }
        b.props = props;
        let id = b.id.clone();
        let mut rows: Vec<NodeId> = Vec::new();
        collect_unwrapped(t, tbl, "tr", &mut rows);
        let mut made = Vec::with_capacity(rows.len());
        for r in rows {
            made.push(self.row(r, &id));
        }
        let keys = initial_keys(made.len());
        for (mut row, k) in made.into_iter().zip(keys) {
            row.order = k;
            self.story.insert(row);
        }
        b
    }

    fn row(&mut self, tr: NodeId, table: &BlockId) -> Block {
        let t = self.tree;
        let mut b = self.new_block(BlockKind::Row, Some(table), tr);
        let mut props = String::new();
        for c in t.children(tr) {
            if t.is_w(c, "tblPrEx") || t.is_w(c, "trPr") {
                props.push_str(&t.snippet(c));
            }
        }
        b.props = props;
        let id = b.id.clone();
        let mut cells: Vec<NodeId> = Vec::new();
        collect_unwrapped(t, tr, "tc", &mut cells);
        let mut made = Vec::with_capacity(cells.len());
        for c in cells {
            made.push(self.cell(c, &id));
        }
        let keys = initial_keys(made.len());
        for (mut cell, k) in made.into_iter().zip(keys) {
            cell.order = k;
            self.story.insert(cell);
        }
        b
    }

    fn cell(&mut self, tc: NodeId, row: &BlockId) -> Block {
        let t = self.tree;
        let mut b = self.new_block(BlockKind::Cell, Some(row), tc);
        if let Some(pr) = t.w_child(tc, "tcPr") {
            b.props = t.snippet(pr);
        }
        let id = b.id.clone();
        let kids: Vec<NodeId> = t.children(tc).filter(|&c| !t.is_w(c, "tcPr")).collect();
        let made = self.blocks(&kids, Some(&id));
        let has_paragraph = self.story.children(Some(&id)).iter().any(|k| {
            self.story
                .get(k)
                .is_some_and(|x| x.kind == BlockKind::Paragraph)
        });
        if made == 0 || !has_paragraph {
            // A cell must end with a paragraph.
            let after = self.story.children(Some(&id)).last().cloned();
            let order = self.story.key_after(Some(&id), after.as_ref());
            let p = Block::new(
                self.ids.next_id(),
                BlockKind::Paragraph,
                Some(id.clone()),
                order,
            );
            self.story.insert(p);
        }
        b
    }
}

/// Property children of a run wrapper, kept in its opening markup.
fn is_wrapper_prop(t: &XmlTree, c: NodeId) -> bool {
    t.ns(c) == Ns::W
        && matches!(
            t.local(c),
            "sdtPr" | "sdtEndPr" | "smartTagPr" | "customXmlPr" | "fldData"
        )
}

/// Children named `w:{local}` of `node`, looking through content controls and
/// custom XML that wrap them (whose own markup is not kept).
fn collect_unwrapped(t: &XmlTree, node: NodeId, local: &str, out: &mut Vec<NodeId>) {
    for c in t.children(node) {
        if t.is_w(c, local) {
            out.push(c);
        } else if t.is_w(c, "sdt") {
            if let Some(content) = t.w_child(c, "sdtContent") {
                collect_unwrapped(t, content, local, out);
            }
        } else if t.is_w(c, "customXml") {
            collect_unwrapped(t, c, local, out);
        }
    }
}

#[cfg(test)]
mod test;
