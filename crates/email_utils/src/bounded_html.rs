//! Parses an email body with a bound on what html5ever builds. Its memory
//! follows the nodes it builds, about a kilobyte each, not the bytes it reads:
//! it rebuilds every formatting element still active (`<b>`, `<font>`) for
//! each new paragraph, so a few kilobytes can build a million nodes. Its time
//! follows nodes times depth, since most tags scan its stack of open elements.

use ego_tree::NodeId;
use html5ever::driver::{self, Parser};
use html5ever::tendril::{StrTendril, TendrilSink};
use html5ever::tree_builder::{ElementFlags, NodeOrText, QuirksMode, TreeSink};
use html5ever::{Attribute, ExpandedName, LocalName, Namespace, QualName};
use scraper::{Html, Node};
use std::borrow::Cow;

/// The most nodes (elements, runs of text and comments) a parse builds.
/// Attributes count too, [`ATTRIBUTES_PER_NODE`] to a node: the parser
/// copies an element's attributes into each formatting element it rebuilds.
pub const MAX_HTML_NODES: usize = 250_000;

/// About how many attributes take the memory of one node.
pub const ATTRIBUTES_PER_NODE: usize = 4;

/// The most bytes of text, attribute names and values, and comments a parse
/// builds. Rebuilt formatting elements share their attributes in the tree,
/// but a serialization writes each copy out, so each counts again; this
/// bounds the HTML the sanitizer hands ammonia.
pub const MAX_HTML_TEXT_BYTES: usize = 16 << 20;

/// The most attributes one element may have. Serialized, they are one tag,
/// and html5ever checks each attribute name in a tag against every earlier
/// one; a repeated `<body>` adds its attributes to the one body element.
pub const MAX_ELEMENT_ATTRIBUTES: usize = 1_000;

/// The deepest a parse nests a node.
pub const MAX_HTML_DEPTH: usize = 512;

const HTML_NAMESPACE: &str = "http://www.w3.org/1999/xhtml";

/// A parsed body, and whether the parse stopped at a bound, leaving out
/// everything from there on.
pub(crate) struct BoundedHtml {
    pub(crate) html: Html,
    pub(crate) clipped: bool,
}

/// Parses a document as [`Html::parse_document`] does, within the bounds.
pub(crate) fn parse_document(html: &str) -> BoundedHtml {
    feed(
        driver::parse_document(BoundedSink::new(Html::new_document()), Default::default()),
        html,
    )
}

/// Parses a fragment as [`Html::parse_fragment`] does, within the bounds.
pub(crate) fn parse_fragment(html: &str) -> BoundedHtml {
    let context = QualName::new(
        None,
        Namespace::from(HTML_NAMESPACE),
        LocalName::from("body"),
    );
    feed(
        driver::parse_fragment(
            BoundedSink::new(Html::new_fragment()),
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
    nodes: usize,
    text_bytes: usize,
    clipped: bool,
}

impl BoundedSink {
    fn new(html: Html) -> Self {
        Self {
            html,
            nodes: 0,
            text_bytes: 0,
            clipped: false,
        }
    }

    fn count_node(&mut self) {
        self.count_nodes(1);
    }

    fn count_nodes(&mut self, nodes: usize) {
        self.nodes += nodes;
        if self.nodes > MAX_HTML_NODES {
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
        self.count_nodes(added.len() / ATTRIBUTES_PER_NODE);
        self.count_text_bytes(
            added
                .iter()
                .map(|attr| attr.name.local.len() + attr.value.len())
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
                NodeOrText::AppendNode(_) => {
                    let depth = self.html.tree.get(parent).map_or(0, |parent| {
                        parent.ancestors().take(MAX_HTML_DEPTH).count() + 1
                    });
                    if depth >= MAX_HTML_DEPTH {
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
                    self.count_text_bytes(text.len());
                }
            }
        }
        !self.clipped
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

    fn parse_error(&mut self, msg: Cow<'static, str>) {
        self.html.parse_error(msg);
    }

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
        self.count_node();
        self.count_attributes(&attrs, attrs.len());
        self.html.create_element(name, attrs, flags)
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
        let existing = match self.html.tree.get(*target).map(|node| node.value()) {
            Some(Node::Element(element)) => element.attrs().count(),
            _ => 0,
        };
        self.count_attributes(&attrs, existing + attrs.len());
        if !self.clipped {
            self.html.add_attrs_if_missing(target, attrs);
        }
    }

    fn remove_from_parent(&mut self, target: &NodeId) {
        if !self.clipped {
            self.html.remove_from_parent(target);
        }
    }

    fn reparent_children(&mut self, node: &NodeId, new_parent: &NodeId) {
        if !self.clipped {
            self.html.reparent_children(node, new_parent);
        }
    }
}
