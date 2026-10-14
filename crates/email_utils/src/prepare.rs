//! Reader preparation for email bodies: the server side of the web renderer's
//! `prepareEmailBody` (`packages/email-renderer/src/core/html.ts`).
//!
//! Preparation is pure: it reads only its input and options, never a theme,
//! origin, flag, clock or network. Output is HTML for the web renderer's
//! `mountEmailBody`, which trusts it: everything active is removed here.

mod css;
mod resource_policy;
#[cfg(test)]
mod test;

use ego_tree::NodeId;
use html5ever::{QualName, local_name, namespace_url, ns};
use scraper::node::{Element, Text};
use scraper::{ElementRef, Html, Node};

use css::{CssOptions, prepare_css};
pub use resource_policy::{ImagePolicy, RemoteImages};
use resource_policy::{image_url, is_js_whitespace, link_url};

/// Version of [`prepare_email_body`]'s output. Bump it when parsing,
/// sanitization, quote/signature handling or the image policy changes, so
/// clients asking for an older version fall back to preparing locally.
pub const PREPARE_VERSION: i32 = 1;

/// Elements removed with their content before anything is mounted.
const ACTIVE: &[&str] = &[
    "script", "iframe", "frame", "frameset", "object", "embed", "applet", "base", "meta", "link",
    "noscript", "template", "svg", "math", "form", "input", "button", "select", "textarea",
    "audio", "video", "source", "track",
];

/// Attributes removed from every element.
const DROPPED_ATTRIBUTES: &[&str] = &[
    "srcdoc",
    "srcset",
    "action",
    "formaction",
    "ping",
    "poster",
    "autofocus",
    "contenteditable",
    "is",
    "slot",
    // The editor interprets this legacy attribute as unsanitized HTML.
    "data-html",
];

/// Native HTML parsing bounds nesting at roughly 512 levels.
const MAX_DEPTH: usize = 512;

/// A message body's content fields, independent of any message type.
#[derive(Debug, Clone, Copy, Default)]
pub struct EmailBodyInput<'a> {
    /// Sanitized HTML body.
    pub html: Option<&'a str>,
    /// HTML with quoted history removed, when known.
    pub replyless_html: Option<&'a str>,
    /// Plaintext body.
    pub text: Option<&'a str>,
}

/// Which variant of a body to prepare.
#[derive(Debug, Clone)]
pub struct BodyOptions {
    /// Restore the original body, signature and trailing breaks.
    pub show_quoted_content: bool,
    /// Use the full body while still trimming the signature.
    pub show_full_content: bool,
    /// Image policy.
    pub images: ImagePolicy,
}

impl Default for BodyOptions {
    fn default() -> Self {
        Self {
            show_quoted_content: false,
            show_full_content: false,
            images: ImagePolicy::allow(),
        }
    }
}

/// How a prepared body is rendered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreparedKind {
    /// Sanitized HTML.
    Html,
    /// Escaped plaintext.
    Text,
}

/// Mountable output of [`prepare_email_body`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedEmailBody {
    /// HTML for the reader, head styles first.
    pub html: String,
    /// Whether the body came from HTML or plaintext.
    pub kind: PreparedKind,
    /// Whether the shown content contains a table.
    pub has_table: bool,
    /// Whether quoted history or a signature was hidden.
    pub has_hidden_content: bool,
}

#[derive(Debug, Clone, Copy, Default)]
struct ScrubOptions {
    strip_color_scheme: bool,
}

/// Prepares one message body for the reader.
pub fn prepare_email_body(input: &EmailBodyInput<'_>, options: &BodyOptions) -> PreparedEmailBody {
    let Some(html) = input.html.filter(|html| !html.is_empty()) else {
        let escaped = input
            .text
            .unwrap_or_default()
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        return PreparedEmailBody {
            html: format!(
                "<div style=\"white-space:pre-wrap;overflow-wrap:anywhere\">{escaped}</div>"
            ),
            kind: PreparedKind::Text,
            has_table: false,
            has_hidden_content: false,
        };
    };
    let images = &options.images;
    let mut parts = document_parts(html, &ImagePolicy::allow(), ScrubOptions::default());
    let quote = elements(&parts.document, parts.body)
        .into_iter()
        .find(|&id| has_class(&parts.document, id, "macro_quote"));
    if let Some(quote) = quote {
        detach(&mut parts.document, quote);
    }
    // Missing replyless data must still display a newly received/sent message.
    let replyless = match input
        .replyless_html
        .filter(|replyless| !replyless.is_empty())
    {
        Some(replyless) => replyless.to_owned(),
        None if quote.is_some() => parts.styles.clone() + &inner_html(&parts.document, parts.body),
        None => html.to_owned(),
    };
    let full = options.show_quoted_content || options.show_full_content;
    let shortened = parse_email_content(&replyless, images, false);
    let has_hidden_content = quote.is_some()
        || shortened.has_signature
        || without_js_whitespace(&replyless) != without_js_whitespace(html);
    let parsed = if full {
        parse_email_content(html, images, options.show_quoted_content)
    } else {
        shortened
    };
    PreparedEmailBody {
        html: parsed.main_content,
        kind: PreparedKind::Html,
        has_table: parsed.has_table,
        has_hidden_content,
    }
}

struct DocumentParts {
    document: Html,
    body: NodeId,
    styles: String,
}

struct EmailContent {
    main_content: String,
    has_signature: bool,
    has_table: bool,
}

fn parse_email_content(
    html: &str,
    images: &ImagePolicy,
    show_quoted_content: bool,
) -> EmailContent {
    let mut parts = document_parts(
        html,
        images,
        ScrubOptions {
            strip_color_scheme: true,
        },
    );
    let nodes = elements(&parts.document, parts.body);
    let has_table = nodes
        .iter()
        .any(|&id| tag_name(&parts.document, id) == Some("table"));
    let signature = nodes.iter().copied().find(|&id| {
        has_class(&parts.document, id, "gmail_signature")
            || has_class(&parts.document, id, "macro-email-signature")
    });
    if !show_quoted_content {
        if let Some(signature) = signature {
            detach(&mut parts.document, signature);
            let prefix = nodes
                .iter()
                .copied()
                .find(|&id| has_class(&parts.document, id, "gmail_signature_prefix"));
            if let Some(prefix) = prefix {
                detach(&mut parts.document, prefix);
            }
        }
        trim(&mut parts.document, parts.body);
    }
    let body = inner_html(&parts.document, parts.body);
    let separator = if parts.styles.is_empty() { "" } else { "\n" };
    EmailContent {
        main_content: format!("{}{separator}{body}", parts.styles),
        has_signature: signature.is_some(),
        has_table,
    }
}

fn document_parts(html: &str, images: &ImagePolicy, options: ScrubOptions) -> DocumentParts {
    let mut document = Html::parse_document(html);
    let root = document.tree.root().id();
    scrub(&mut document, root, images, options);
    bound_nesting(&mut document, root);
    let nodes = elements(&document, root);
    let body = match nodes
        .iter()
        .copied()
        .find(|&id| tag_name(&document, id) == Some("body"))
    {
        Some(body) => body,
        None => {
            // A frameset document has no body; active markup was removed above.
            let html_element = nodes
                .iter()
                .copied()
                .find(|&id| tag_name(&document, id) == Some("html"))
                .unwrap_or(root);
            let body = Node::Element(Element::new(
                QualName::new(None, ns!(html), local_name!("body")),
                Vec::new(),
            ));
            let mut parent = document.tree.get_mut(html_element).expect("live node");
            parent.append(body).id()
        }
    };
    let head = nodes
        .iter()
        .copied()
        .find(|&id| tag_name(&document, id) == Some("head"));
    let styles = head
        .map(|head| {
            elements(&document, head)
                .into_iter()
                .filter(|&id| tag_name(&document, id) == Some("style"))
                .map(|id| outer_html(&document, id))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    DocumentParts {
        document,
        body,
        styles,
    }
}

fn scrub(document: &mut Html, root: NodeId, images: &ImagePolicy, options: ScrubOptions) {
    let background_images = images.without_proxy();
    for id in elements(document, root) {
        let Some(Node::Element(element)) = document.tree.get(id).map(|node| node.value()) else {
            continue;
        };
        if ACTIVE.contains(&element.name.local.as_ref()) || element.name.ns != ns!(html) {
            detach(document, id);
            continue;
        }
        let in_head = document
            .tree
            .get(id)
            .and_then(|node| node.parent())
            .and_then(|parent| {
                parent
                    .value()
                    .as_element()
                    .map(|parent| parent.name.local.clone())
            })
            .is_some_and(|parent| parent == local_name!("head"));
        let Some(mut node) = document.tree.get_mut(id) else {
            continue;
        };
        let Node::Element(element) = node.value() else {
            continue;
        };
        let tag = element.name.local.clone();
        let attributes = std::mem::take(&mut element.attrs);
        element.attrs = attributes
            .into_iter()
            .filter_map(|(name, value)| {
                let value = scrub_attribute(&tag, &name, &value, images, &background_images)?;
                Some((name, value.into()))
            })
            .collect();
        if tag == local_name!("style") {
            let source = style_text(document, id);
            let prepared = prepare_css(
                &source,
                false,
                images,
                CssOptions {
                    strip_color_scheme: options.strip_color_scheme && in_head,
                },
            );
            replace_children_with_text(document, id, &prepared);
        }
    }
}

fn scrub_attribute(
    tag: &html5ever::LocalName,
    name: &QualName,
    value: &str,
    images: &ImagePolicy,
    background_images: &ImagePolicy,
) -> Option<String> {
    if !name.ns.is_empty() || name.prefix.is_some() {
        return None;
    }
    let local: String = name.local.as_ref().to_ascii_lowercase();
    if local.starts_with("on")
        || DROPPED_ATTRIBUTES.contains(&local.as_str())
        || local.starts_with("data-")
    {
        return None;
    }
    match local.as_str() {
        "href" => {
            if *tag == local_name!("a") || *tag == local_name!("area") {
                link_url(value)
            } else {
                None
            }
        }
        "src" => {
            if *tag == local_name!("img") {
                image_url(value, images)
            } else {
                None
            }
        }
        "background" => image_url(value, background_images),
        "style" => Some(prepare_css(value, true, images, CssOptions::default()))
            .filter(|css| !css.is_empty()),
        _ => Some(value.to_owned()),
    }
}

fn style_text(document: &Html, id: NodeId) -> String {
    document
        .tree
        .get(id)
        .map(|node| {
            node.children()
                .filter_map(|child| child.value().as_text().map(|text| text.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn replace_children_with_text(document: &mut Html, id: NodeId, text: &str) {
    let children: Vec<NodeId> = document
        .tree
        .get(id)
        .map(|node| node.children().map(|child| child.id()).collect())
        .unwrap_or_default();
    for child in children {
        detach(document, child);
    }
    if let Some(mut node) = document.tree.get_mut(id) {
        node.append(Node::Text(Text { text: text.into() }));
    }
}

/// Unwraps containers nested deeper than [`MAX_DEPTH`] after sanitization, so
/// readable content keeps its order without exposing removed markup.
fn bound_nesting(document: &mut Html, root: NodeId) {
    let mut pending = vec![(root, 0usize)];
    while let Some((id, depth)) = pending.pop() {
        let Some(node) = document.tree.get(id) else {
            continue;
        };
        if depth < MAX_DEPTH {
            pending.extend(
                node.children()
                    .filter(|child| child.value().is_element())
                    .map(|child| (child.id(), depth + 1)),
            );
            continue;
        }
        let mut flattened = Vec::new();
        let mut descendants: Vec<NodeId> = node.children().map(|child| child.id()).collect();
        descendants.reverse();
        while let Some(child) = descendants.pop() {
            let Some(child_node) = document.tree.get(child) else {
                continue;
            };
            if child_node.value().is_element()
                && child_node
                    .children()
                    .any(|grandchild| grandchild.value().is_element())
            {
                let mut grandchildren: Vec<NodeId> = child_node
                    .children()
                    .map(|grandchild| grandchild.id())
                    .collect();
                grandchildren.reverse();
                descendants.extend(grandchildren);
            } else {
                flattened.push(child);
            }
        }
        let current: Vec<NodeId> = node.children().map(|child| child.id()).collect();
        for child in current {
            detach(document, child);
        }
        if let Some(mut node) = document.tree.get_mut(id) {
            for child in flattened {
                node.append_id(child);
            }
        }
    }
}

/// Removes trailing whitespace, line breaks and empty wrappers.
fn trim(document: &mut Html, root: NodeId) {
    loop {
        let Some(last) = document.tree.get(root).and_then(|node| node.last_child()) else {
            return;
        };
        let last_id = last.id();
        match last.value() {
            Node::Text(text) => {
                if !text.trim_matches(is_js_whitespace).is_empty() {
                    return;
                }
            }
            Node::Element(element) => {
                if element.name.local == local_name!("img") {
                    return;
                }
                if element.name.local != local_name!("br") {
                    trim(document, last_id);
                    let emptied = document
                        .tree
                        .get(last_id)
                        .is_some_and(|node| node.first_child().is_none());
                    if !emptied {
                        return;
                    }
                }
            }
            _ => return,
        }
        detach(document, last_id);
    }
}

/// Element descendants of `root` in document order, excluding `root`.
fn elements(document: &Html, root: NodeId) -> Vec<NodeId> {
    document
        .tree
        .get(root)
        .map(|node| {
            node.descendants()
                .skip(1)
                .filter(|node| node.value().is_element())
                .map(|node| node.id())
                .collect()
        })
        .unwrap_or_default()
}

fn detach(document: &mut Html, id: NodeId) {
    if let Some(mut node) = document.tree.get_mut(id) {
        node.detach();
    }
}

fn tag_name(document: &Html, id: NodeId) -> Option<&str> {
    document
        .tree
        .get(id)
        .and_then(|node| node.value().as_element())
        .map(|element| element.name.local.as_ref())
}

/// Class membership split on HTML's ASCII whitespace only.
fn has_class(document: &Html, id: NodeId, name: &str) -> bool {
    document
        .tree
        .get(id)
        .and_then(|node| node.value().as_element())
        .and_then(|element| {
            element
                .attrs
                .iter()
                .find(|(attribute, _)| attribute.local.as_ref() == "class")
                .map(|(_, value)| {
                    value
                        .split(['\t', '\n', '\u{0C}', '\r', ' '])
                        .any(|class| class == name)
                })
        })
        .unwrap_or(false)
}

fn inner_html(document: &Html, id: NodeId) -> String {
    document
        .tree
        .get(id)
        .and_then(ElementRef::wrap)
        .map(|element| element.inner_html())
        .unwrap_or_default()
}

fn outer_html(document: &Html, id: NodeId) -> String {
    document
        .tree
        .get(id)
        .and_then(ElementRef::wrap)
        .map(|element| element.html())
        .unwrap_or_default()
}

fn without_js_whitespace(value: &str) -> String {
    value.chars().filter(|&c| !is_js_whitespace(c)).collect()
}
