//! The linkedom 0.18.13 text/html serializer, including reverse attribute order.
use crate::*;
const EMPTY_ATTRIBUTES: &[&str] = &[
    "allowfullscreen",
    "allowpaymentrequest",
    "async",
    "autofocus",
    "autoplay",
    "checked",
    "class",
    "contenteditable",
    "controls",
    "default",
    "defer",
    "disabled",
    "draggable",
    "formnovalidate",
    "hidden",
    "id",
    "ismap",
    "itemscope",
    "loop",
    "multiple",
    "muted",
    "nomodule",
    "novalidate",
    "open",
    "playsinline",
    "readonly",
    "required",
    "reversed",
    "selected",
    "style",
    "truespeed",
];
const VOID: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "keygen", "link", "menuitem",
    "meta", "param", "source", "track", "wbr",
];
/// Serialize a sequence as container.innerHTML.
pub fn inner_html(nodes: &[HtmlNode]) -> String {
    let mut output = String::new();
    for node in nodes {
        outer_html(node, &mut output);
    }
    output
}
/// Append one node's serialized markup.
pub fn outer_html(node: &HtmlNode, output: &mut String) {
    match node {
        HtmlNode::Element(element) => {
            output.push('<');
            output.push_str(&element.tag);
            for attr in element.attrs.iter().rev() {
                let value = attr.value.string();
                if value.is_empty() && ["id", "class", "style"].contains(&attr.name.as_str()) {
                    continue;
                }
                output.push(' ');
                output.push_str(&attr.name);
                if !value.is_empty() || !EMPTY_ATTRIBUTES.contains(&attr.name.as_str()) {
                    output.push_str("=\"");
                    output.push_str(&value.replace('"', "&quot;"));
                    output.push('"');
                }
            }
            output.push('>');
            if !element.children.is_empty()
                || !VOID.iter().any(|tag| element.tag.eq_ignore_ascii_case(tag))
            {
                for child in &element.children {
                    outer_html(child, output);
                }
                output.push_str("</");
                output.push_str(&element.tag);
                output.push('>');
            }
        }
        HtmlNode::Text(text) => {
            for ch in text.chars() {
                match ch {
                    '&' => output.push_str("&amp;"),
                    '<' => output.push_str("&lt;"),
                    '>' => output.push_str("&gt;"),
                    '\u{a0}' => output.push_str("&#160;"),
                    _ => output.push(ch),
                }
            }
        }
        HtmlNode::Fragment(children) => {
            for child in children {
                outer_html(child, output);
            }
        }
        HtmlNode::Raw(markup) => output.push_str(markup),
    }
}
#[cfg(test)]
mod test;
