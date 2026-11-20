//! Parses an email body with a bound on what html5ever builds. Its memory
//! follows the nodes and attributes it builds, not the bytes it reads: it
//! rebuilds every formatting element still active (`<b>`, `<font>`) inside
//! each new paragraph, attributes and all, so a few kilobytes can build a
//! million nodes, and a serialization of the tree writes each copy out. Its
//! time follows nodes times depth, since most tags scan its stack of open
//! elements, and nested formatting elements, which it compares pairwise.
//!
//! Each limit below stops the parse where the next change would pass it.
//! Below every limit, the tree is the one [`Html::parse_document`] builds.

use ego_tree::NodeId;
use html5ever::driver::{self, Parser};
use html5ever::tendril::{StrTendril, TendrilSink};
use html5ever::tree_builder::TreeBuilderOpts;
use html5ever::tree_builder::{ElementFlags, NodeOrText, QuirksMode, TreeSink};
use html5ever::{Attribute, ExpandedName, LocalName, Namespace, ParseOpts, QualName};
use scraper::{Html, Node};
use std::borrow::Cow;
use std::collections::HashMap;
use std::hash::{BuildHasher, RandomState};

/// The most nodes (elements, runs of text and comments) a parse builds.
/// Attributes count too, [`ATTRIBUTES_PER_NODE`] to a node: the parser
/// copies an element's attributes into each formatting element it rebuilds.
pub const MAX_HTML_NODES: usize = 250_000;

/// About how many attributes take the memory of one node.
pub const ATTRIBUTES_PER_NODE: usize = 4;

/// The most bytes of text, attribute names and values, and comments a parse
/// builds, counted as a serialization writes them: rebuilt formatting
/// elements share their attributes in the tree but each copy is written out,
/// and an `&` is written as `&amp;`. This bounds the HTML the sanitizer hands
/// ammonia.
pub const MAX_HTML_TEXT_BYTES: usize = 16 << 20;

/// How many bytes html5ever's serializer writes for `text`, as text or as an
/// attribute value: it escapes `&` and no-break spaces, and `"` in a value
/// or `<` and `>` in text.
fn serialized_len(text: &str, in_attribute: bool) -> usize {
    let escapes: usize = text
        .chars()
        .map(|c| match c {
            '&' => "&amp;".len() - 1,
            '\u{a0}' => "&nbsp;".len() - '\u{a0}'.len_utf8(),
            '"' if in_attribute => "&quot;".len() - 1,
            '<' | '>' if !in_attribute => "&lt;".len() - 1,
            _ => 0,
        })
        .sum();
    text.len() + escapes
}

/// The most attributes one element may have. Serialized, they are one tag,
/// and html5ever checks each attribute name in a tag against every earlier
/// one; a repeated `<body>` adds its attributes to the one body element.
pub const MAX_ELEMENT_ATTRIBUTES: usize = 1_000;

/// The most formatting elements (`<b>`, `<font>`…) a parse nests inside one
/// another, counting at most [`IDENTICAL_FORMATTING_COPIES`] of any one tag.
/// The parser compares each new formatting element with every active one of
/// the same name, sorting both attribute lists, and ammonia's parse of the
/// serialization does it again for each rebuilt one.
pub const MAX_FORMATTING_DEPTH: usize = 32;

/// How many copies of one tag, name and attributes alike, html5ever keeps
/// among its active formatting elements; it drops older ones.
const IDENTICAL_FORMATTING_COPIES: usize = 3;

/// The elements html5ever keeps in its list of active formatting elements and
/// rebuilds.
fn is_formatting(name: &QualName) -> bool {
    &*name.ns == HTML_NAMESPACE
        && matches!(
            &*name.local,
            "a" | "b"
                | "big"
                | "code"
                | "em"
                | "font"
                | "i"
                | "nobr"
                | "s"
                | "small"
                | "strike"
                | "strong"
                | "tt"
                | "u"
        )
}

/// The elements that put a marker in html5ever's list of active formatting
/// elements: it compares and rebuilds only the entries after the last one.
fn starts_formatting_section(node: &Node) -> bool {
    let Node::Element(element) = node else {
        return false;
    };
    &*element.name.ns == HTML_NAMESPACE
        && matches!(
            &*element.name.local,
            "td" | "th" | "caption" | "applet" | "object" | "marquee" | "template"
        )
}

/// The deepest a parse nests a node.
pub const MAX_HTML_DEPTH: usize = 512;

const HTML_NAMESPACE: &str = "http://www.w3.org/1999/xhtml";

#[cfg(test)]
mod test;

/// A parsed body, and whether the parse stopped at a bound, leaving out
/// everything from there on.
pub struct BoundedHtml {
    /// What was parsed before the parse stopped, or all of it.
    pub html: Html,
    /// Whether the parse stopped at a bound, so `html` lacks the rest.
    pub clipped: bool,
}

/// Parses a document as [`Html::parse_document`] does, within the bounds.
pub fn parse_document(html: &str) -> BoundedHtml {
    feed(
        driver::parse_document(
            BoundedSink::new(Html::new_document(), MAX_HTML_NODES),
            Default::default(),
        ),
        html,
    )
}

/// Parses a document as html2text does, with scripting off so a `<noscript>`
/// holds markup rather than text, within the bounds and at most `max_nodes`
/// nodes.
pub(crate) fn parse_document_for_text(html: &str, max_nodes: usize) -> BoundedHtml {
    let opts = ParseOpts {
        tree_builder: TreeBuilderOpts {
            scripting_enabled: false,
            ..Default::default()
        },
        ..Default::default()
    };
    feed(
        driver::parse_document(BoundedSink::new(Html::new_document(), max_nodes), opts),
        html,
    )
}

/// Parses a fragment as [`Html::parse_fragment`] does, within the bounds.
pub fn parse_fragment(html: &str) -> BoundedHtml {
    let context = QualName::new(
        None,
        Namespace::from(HTML_NAMESPACE),
        LocalName::from("body"),
    );
    feed(
        driver::parse_fragment(
            BoundedSink::new(Html::new_fragment(), MAX_HTML_NODES),
            Default::default(),
            context,
            Vec::new(),
        ),
        html,
    )
}

/// Feeds the body a tag at a time, so the parse stops within a tag of a bound
/// instead of reading the rest.
fn feed(mut parser: Parser<BoundedSink>, html: &str) -> BoundedHtml {
    let mut start = 0;
    let tag_starts = html.match_indices('<').map(|(offset, _)| offset);
    for end in tag_starts.chain(std::iter::once(html.len())) {
        let Some(piece) = html.get(start..end).filter(|piece| !piece.is_empty()) else {
            continue;
        };
        parser.process(StrTendril::from_slice(piece));
        start = end;
        if parser.tokenizer.sink.sink.clipped {
            break;
        }
    }
    parser.finish()
}

/// Scraper's tree, refusing every change once one would pass a bound.
struct BoundedSink {
    html: Html,
    max_nodes: usize,
    nodes: usize,
    attributes: usize,
    text_bytes: usize,
    /// Each formatting element's tag, hashed without regard to attribute
    /// order, so identical tags are found without comparing attributes.
    formatting_tags: HashMap<NodeId, u64>,
    hasher: RandomState,
    clipped: bool,
}

impl BoundedSink {
    fn new(html: Html, max_nodes: usize) -> Self {
        Self {
            html,
            max_nodes,
            nodes: 0,
            attributes: 0,
            text_bytes: 0,
            formatting_tags: HashMap::new(),
            hasher: RandomState::new(),
            clipped: false,
        }
    }

    fn tag_hash(&self, name: &QualName, attrs: &[Attribute]) -> u64 {
        let attributes = attrs.iter().fold(0u64, |sum, attr| {
            sum.wrapping_add(self.hasher.hash_one((&attr.name, &*attr.value)))
        });
        self.hasher.hash_one((name, attrs.len(), attributes))
    }

    fn count_node(&mut self) {
        self.count_nodes(1);
    }

    fn count_nodes(&mut self, nodes: usize) {
        self.nodes += nodes;
        self.check_node_budget();
    }

    fn check_node_budget(&mut self) {
        if self.nodes + self.attributes / ATTRIBUTES_PER_NODE > self.max_nodes {
            self.clipped = true;
        }
    }

    fn count_text_bytes(&mut self, bytes: usize) {
        self.text_bytes += bytes;
        if self.text_bytes > MAX_HTML_TEXT_BYTES {
            self.clipped = true;
        }
    }

    /// Counts attributes added to an element that then has `total`.
    fn count_attributes(&mut self, added: &[Attribute], total: usize) {
        // Counted across elements, so four attributes cost a node whether
        // or not they share one.
        self.attributes += added.len();
        self.check_node_budget();
        self.count_text_bytes(
            added
                .iter()
                .map(|attr| attr.name.local.len() + serialized_len(&attr.value, true))
                .sum(),
        );
        if total > MAX_ELEMENT_ATTRIBUTES {
            self.clipped = true;
        }
    }

    /// Whether `child` can go into `parent`, after `previous`.
    fn admits(
        &mut self,
        parent: NodeId,
        previous: Option<NodeId>,
        child: &NodeOrText<NodeId>,
    ) -> bool {
        if !self.clipped {
            match child {
                // An element was counted when it was created.
                NodeOrText::AppendNode(child) => {
                    let too_deep = self.depth_of(parent) >= MAX_HTML_DEPTH;
                    let too_much_formatting =
                        self.formatting_tags.get(child).is_some_and(|&child| {
                            self.active_formatting_with(parent, child) > MAX_FORMATTING_DEPTH
                        });
                    if too_deep || too_much_formatting {
                        self.clipped = true;
                    }
                }
                // The tokenizer splits text at every line break and character
                // reference; scraper joins text that follows text.
                NodeOrText::AppendText(text) => {
                    let follows_text = previous
                        .and_then(|previous| self.html.tree.get(previous))
                        .is_some_and(|previous| previous.value().is_text());
                    if !follows_text {
                        self.count_node();
                    }
                    let written = if self.writes_text_raw(parent) {
                        text.len()
                    } else {
                        serialized_len(text, false)
                    };
                    self.count_text_bytes(written);
                }
            }
        }
        !self.clipped
    }

    /// How many nodes, `node` among them, hold a child of `node`, up to
    /// [`MAX_HTML_DEPTH`].
    fn depth_of(&self, node: NodeId) -> usize {
        self.html.tree.get(node).map_or(0, |node| {
            std::iter::once(node)
                .chain(node.ancestors())
                .take(MAX_HTML_DEPTH)
                .count()
        })
    }

    /// About how many elements html5ever's list of active formatting
    /// elements holds once a formatting element with tag hash `child` goes
    /// into `parent`: the formatting elements holding it inside the nearest
    /// table cell (or other element that starts a section of the list), with
    /// at most [`IDENTICAL_FORMATTING_COPIES`] of any one tag, as html5ever
    /// drops older copies of a tag it already holds that many of.
    fn active_formatting_with(&self, parent: NodeId, child: u64) -> usize {
        let Some(parent) = self.html.tree.get(parent) else {
            return 1;
        };
        let mut tags: Vec<(u64, usize)> = vec![(child, 1)];
        let holders = std::iter::once(parent)
            .chain(parent.ancestors())
            .take(MAX_HTML_DEPTH)
            .take_while(|holder| !starts_formatting_section(holder.value()));
        for tag in holders.filter_map(|holder| self.formatting_tags.get(&holder.id())) {
            let distinct = tags.len();
            match tags.iter_mut().find(|(seen, _)| seen == tag) {
                Some((_, copies)) => *copies += 1,
                // Past the bound already, however the rest count.
                None if distinct > MAX_FORMATTING_DEPTH => break,
                None => tags.push((*tag, 1)),
            }
        }
        tags.iter()
            .map(|(_, copies)| (*copies).min(IDENTICAL_FORMATTING_COPIES))
            .sum()
    }

    /// Whether html5ever's serializer writes text in `parent` unescaped, as
    /// it does in raw-text elements. Scraper serializes with scripting off,
    /// so `<noscript>` text is escaped.
    fn writes_text_raw(&self, parent: NodeId) -> bool {
        let Some(Node::Element(element)) = self.html.tree.get(parent).map(|node| node.value())
        else {
            return false;
        };
        &*element.name.ns == HTML_NAMESPACE
            && matches!(
                &*element.name.local,
                "style" | "script" | "xmp" | "iframe" | "noembed" | "noframes" | "plaintext"
            )
    }

    fn parent_of(&self, node: NodeId) -> Option<NodeId> {
        self.html
            .tree
            .get(node)
            .and_then(|node| node.parent())
            .map(|parent| parent.id())
    }

    fn last_child_of(&self, node: NodeId) -> Option<NodeId> {
        self.html
            .tree
            .get(node)
            .and_then(|node| node.last_child())
            .map(|child| child.id())
    }

    fn previous_sibling_of(&self, node: NodeId) -> Option<NodeId> {
        self.html
            .tree
            .get(node)
            .and_then(|node| node.prev_sibling())
            .map(|sibling| sibling.id())
    }
}

impl TreeSink for BoundedSink {
    type Handle = NodeId;
    type Output = BoundedHtml;

    fn finish(self) -> BoundedHtml {
        BoundedHtml {
            html: self.html,
            clipped: self.clipped,
        }
    }

    // Scraper keeps every parse error, and a NUL byte or a stray end tag
    // raises one without building anything; nothing here reads them.
    fn parse_error(&mut self, _msg: Cow<'static, str>) {}

    fn get_document(&mut self) -> NodeId {
        self.html.get_document()
    }

    fn elem_name<'a>(&'a self, target: &'a NodeId) -> ExpandedName<'a> {
        self.html.elem_name(target)
    }

    fn create_element(
        &mut self,
        name: QualName,
        attrs: Vec<Attribute>,
        flags: ElementFlags,
    ) -> NodeId {
        // Scraper gives a template a fragment node for its contents.
        let template = &*name.ns == HTML_NAMESPACE && &*name.local == "template";
        self.count_nodes(1 + usize::from(template));
        self.count_attributes(&attrs, attrs.len());
        let tag = is_formatting(&name).then(|| self.tag_hash(&name, &attrs));
        let element = self.html.create_element(name, attrs, flags);
        if let Some(tag) = tag {
            self.formatting_tags.insert(element, tag);
        }
        element
    }

    fn create_comment(&mut self, text: StrTendril) -> NodeId {
        self.count_node();
        self.count_text_bytes(text.len());
        self.html.create_comment(text)
    }

    fn create_pi(&mut self, target: StrTendril, data: StrTendril) -> NodeId {
        self.count_node();
        self.count_text_bytes(target.len() + data.len());
        self.html.create_pi(target, data)
    }

    fn append(&mut self, parent: &NodeId, child: NodeOrText<NodeId>) {
        let previous = self.last_child_of(*parent);
        if self.admits(*parent, previous, &child) {
            self.html.append(parent, child);
        }
    }

    fn append_based_on_parent_node(
        &mut self,
        element: &NodeId,
        prev_element: &NodeId,
        child: NodeOrText<NodeId>,
    ) {
        // Scraper inserts before `element` when it has a parent, else appends
        // to `prev_element`.
        let (parent, previous) = match self.parent_of(*element) {
            Some(parent) => (parent, self.previous_sibling_of(*element)),
            None => (*prev_element, self.last_child_of(*prev_element)),
        };
        if self.admits(parent, previous, &child) {
            self.html
                .append_based_on_parent_node(element, prev_element, child);
        }
    }

    fn append_doctype_to_document(
        &mut self,
        name: StrTendril,
        public_id: StrTendril,
        system_id: StrTendril,
    ) {
        if !self.clipped {
            self.html
                .append_doctype_to_document(name, public_id, system_id);
        }
    }

    fn mark_script_already_started(&mut self, node: &NodeId) {
        self.html.mark_script_already_started(node);
    }

    fn get_template_contents(&mut self, target: &NodeId) -> NodeId {
        self.html.get_template_contents(target)
    }

    fn same_node(&self, x: &NodeId, y: &NodeId) -> bool {
        self.html.same_node(x, y)
    }

    fn set_quirks_mode(&mut self, mode: QuirksMode) {
        self.html.set_quirks_mode(mode);
    }

    fn append_before_sibling(&mut self, sibling: &NodeId, new_node: NodeOrText<NodeId>) {
        // Without a parent the sibling takes nothing.
        let admitted = match self.parent_of(*sibling) {
            Some(parent) => {
                let previous = self.previous_sibling_of(*sibling);
                self.admits(parent, previous, &new_node)
            }
            None => !self.clipped,
        };
        if admitted {
            self.html.append_before_sibling(sibling, new_node);
        }
    }

    fn add_attrs_if_missing(&mut self, target: &NodeId, attrs: Vec<Attribute>) {
        if self.clipped {
            return;
        }
        // Only names the element lacks are added.
        let (existing, added) = match self.html.tree.get(*target).map(|node| node.value()) {
            Some(Node::Element(element)) => (
                element.attrs.len(),
                attrs
                    .into_iter()
                    .filter(|attr| !element.attrs.contains_key(&attr.name))
                    .collect::<Vec<_>>(),
            ),
            _ => (0, attrs),
        };
        self.count_attributes(&added, existing + added.len());
        if !self.clipped {
            self.html.add_attrs_if_missing(target, added);
        }
    }

    fn remove_from_parent(&mut self, target: &NodeId) {
        if !self.clipped {
            self.html.remove_from_parent(target);
        }
    }

    fn reparent_children(&mut self, node: &NodeId, new_parent: &NodeId) {
        if self.clipped {
            return;
        }
        // Scraper moves them with ego-tree's `reparent_from_id_append`, which
        // gives only the first and last child their new parent; a later move
        // of any other one dropped it from the tree, text and all
        // (`<b><div>a<p><div>lost</b>`). So move them one at a time.
        let children: Vec<NodeId> = self
            .html
            .tree
            .get(*node)
            .into_iter()
            .flat_map(|node| node.children())
            .map(|child| child.id())
            .collect();
        if let Some(mut new_parent) = self.html.tree.get_mut(*new_parent) {
            for child in children {
                new_parent.append_id(child);
            }
        }
    }
}
