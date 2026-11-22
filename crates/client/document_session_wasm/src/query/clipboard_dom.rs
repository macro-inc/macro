//! Browser clipboard exports retain the native selection walk and DOM mutation order.
use super::*;
use lexical_html::{HtmlElement, HtmlNode};

pub(crate) fn clipboard_dom(
    state: &EditorState,
    namespace: &str,
    blocks: bool,
    flavor: ExportFlavor,
    theme: lexical_html::EditorTheme,
) -> Result<wire::ClipboardDomMsg, BoundaryError> {
    let expanded = blocks
        .then(|| expanded_clipboard_selection(state))
        .transpose()?;
    let selection = expanded.as_ref().or_else(|| state.selection());
    // Match the existing clipboard callback and error order: plain, internal, HTML.
    let plain = state
        .selection()
        .map(|selection| selection.text_content(state.view()))
        .transpose()?
        .unwrap_or_default();
    let lexical =
        lexical_rich_nodes::clipboard::get_lexical_content(state.view(), namespace, selection)?
            .unwrap_or_default();
    let registry = match flavor {
        ExportFlavor::Macro => macro_document_model::html::macro_export_registry(),
        ExportFlavor::Upstream => lexical_rich_nodes::html::register_rich_nodes_html(
            lexical_html::register_core(lexical_html::ExportRegistry::builder()),
        )
        .build(),
    };
    let nodes = if selection.is_some() {
        lexical_html::HtmlExporter::new(registry, theme)
            .generate_dom_from_nodes(state, selection)?
            .into_iter()
            .map(node_message)
            .collect()
    } else {
        Vec::new()
    };
    Ok(wire::ClipboardDomMsg {
        plain,
        lexical,
        nodes,
    })
}

fn node_message(node: HtmlNode) -> wire::HtmlNodeMsg {
    let mut message = wire::HtmlNodeMsg {
        kind: 0,
        tag: String::new(),
        text: String::new(),
        attributes: Vec::new(),
        children: Vec::new(),
    };
    match node {
        HtmlNode::Element(element) => element_message(element, &mut message),
        HtmlNode::Text(text) => {
            message.kind = 1;
            message.text = text;
        }
        HtmlNode::Fragment(children) => {
            message.kind = 2;
            message.children = children.into_iter().map(node_message).collect();
        }
        HtmlNode::Raw(text) => {
            message.kind = 3;
            message.text = text;
        }
    }
    message
}
fn element_message(element: HtmlElement, message: &mut wire::HtmlNodeMsg) {
    message.tag = element.tag.clone();
    message.attributes = element
        .dom_construction()
        .map(|(name, value, styles, property)| wire::HtmlAttributeMsg {
            name: name.to_owned(),
            value,
            property,
            styles: styles
                .iter()
                .map(|(name, value)| wire::HtmlStyleMsg {
                    name: name.clone(),
                    value: value.clone(),
                })
                .collect(),
        })
        .collect();
    message.children = element.children.into_iter().map(node_message).collect();
}

#[cfg(test)]
mod test;
