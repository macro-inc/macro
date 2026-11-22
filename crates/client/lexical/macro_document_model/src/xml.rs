//! Reader-oriented document XML and the ordered element tree used by composers.
use crate::{Error, Result};
use indexmap::IndexMap;
use lexical_model::{SerializedEditorState, js_string, js_truthy, to_js_json_string};
use serde_json::Value;
/// An ordered XML element or literal text child.
#[derive(Clone, Debug, PartialEq)]
pub enum XmlNode {
    /// An element with source-ordered attributes.
    Element {
        /// Element name.
        tag: String,
        /// Attribute insertion order.
        attributes: IndexMap<String, String>,
        /// Ordered children.
        children: Vec<XmlNode>,
    },
    /// Unescaped text; the builder escapes it once.
    Text(String),
}
/// Construct one element without attributes.
pub fn el(tag: impl Into<String>, children: Vec<XmlNode>) -> XmlNode {
    XmlNode::Element {
        tag: tag.into(),
        attributes: IndexMap::new(),
        children,
    }
}
/// Construct one text node.
pub fn text(value: impl Into<String>) -> XmlNode {
    XmlNode::Text(value.into())
}
impl XmlNode {
    /// Add or replace an attribute while retaining insertion order.
    pub fn attribute(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        if let Self::Element { attributes, .. } = &mut self {
            attributes.insert(name.into(), value.into());
        }
        self
    }
}
fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('\'', "&apos;")
        .replace('"', "&quot;")
}
fn render(node: &XmlNode, depth: usize, output: &mut String) {
    match node {
        XmlNode::Text(text) => output.push_str(&escape(text)),
        XmlNode::Element {
            tag,
            attributes,
            children,
        } => {
            output.push('\n');
            output.push_str(&"  ".repeat(depth));
            output.push('<');
            output.push_str(tag);
            for (name, value) in attributes {
                output.push(' ');
                output.push_str(name);
                output.push_str("=\"");
                output.push_str(&escape(value));
                output.push('"');
            }
            if children.is_empty()
                || children
                    .iter()
                    .all(|node| matches!(node,XmlNode::Text(text) if text.is_empty()))
            {
                output.push_str("/>");
                return;
            }
            output.push('>');
            for child in children {
                render(child, depth + 1, output);
            }
            if children
                .iter()
                .any(|node| matches!(node, XmlNode::Element { .. }))
            {
                output.push('\n');
                output.push_str(&"  ".repeat(depth));
            }
            output.push_str("</");
            output.push_str(tag);
            output.push('>');
        }
    }
}
/// Render with the same leading newline, indentation and empty-tag policy as source XML.
pub fn build_xml(nodes: &[XmlNode]) -> String {
    let mut output = String::new();
    for node in nodes {
        render(node, 0, &mut output);
    }
    output
}
fn string(node: &Value, key: &str) -> String {
    node.get(key)
        .map(js_string)
        .unwrap_or_else(|| "undefined".into())
}
fn truthy(node: &Value, key: &str) -> bool {
    node.get(key).is_some_and(js_truthy)
}
fn children(node: &Value) -> Result<Vec<XmlNode>> {
    node.get("children")
        .and_then(Value::as_array)
        .ok_or_else(|| Error::InvalidArgument("XML container requires children".into()))?
        .iter()
        .map(serialize_node)
        .collect()
}
fn with_id(mut element: XmlNode, node: &Value) -> XmlNode {
    if let Some(id) = node
        .get("$")
        .and_then(|state| state.get("id"))
        .filter(|id| js_truthy(id))
        && let XmlNode::Element { attributes, .. } = &mut element
    {
        attributes.insert("id".into(), js_string(id));
    }
    element
}
fn leaf(tag: &str, node: &Value) -> XmlNode {
    with_id(el(tag, vec![]), node)
}
fn container(tag: &str, node: &Value) -> Result<XmlNode> {
    Ok(with_id(el(tag, children(node)?), node))
}
fn leaf_text(tag: &str, node: &Value, value: &str) -> XmlNode {
    with_id(
        el(
            tag,
            if value.is_empty() {
                vec![]
            } else {
                vec![text(value)]
            },
        ),
        node,
    )
}
fn maybe_attribute(mut element: XmlNode, node: &Value, key: &str, name: &str) -> XmlNode {
    if truthy(node, key) {
        element = element.attribute(name, string(node, key));
    }
    element
}
fn redacted_src(url: &str) -> String {
    if !url.starts_with("data:") {
        return url.into();
    }
    let prefix = url.find(',').and_then(|i| url.get(..=i)).unwrap_or("data:");
    format!("{prefix}...")
}
fn flatten_unknown(value: &Value, prefix: &str, output: &mut Vec<(String, Value)>) {
    match value {
        Value::Object(fields) if !fields.is_empty() => {
            for (key, value) in fields {
                let path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                flatten_unknown(value, &path, output);
            }
        }
        value => output.push((prefix.into(), value.clone())),
    }
}
fn unknown(node: &Value, ty: &str) -> Result<XmlNode> {
    let mut rest = node
        .as_object()
        .cloned()
        .ok_or_else(|| Error::InvalidArgument("XML node requires an object".into()))?;
    rest.shift_remove("type");
    rest.shift_remove("children");
    let mut flat = Vec::new();
    for (key, value) in rest {
        flatten_unknown(&value, &key, &mut flat);
    }
    let mut element = leaf(ty, node);
    for (key, value) in flat {
        if key.starts_with('$') || matches!(key.as_str(), "version" | "direction" | "indent") {
            continue;
        }
        if value.is_null() {
            element = element.attribute(key, "null");
        } else {
            let key = if key == "id" { "_id".into() } else { key };
            let value = if value.is_object() || value.is_array() {
                to_js_json_string(&value)
            } else {
                js_string(&value)
            };
            element = element.attribute(key, value);
        }
    }
    let child_nodes = match node.get("children") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(children)) => {
            children.iter().map(serialize_node).collect::<Result<_>>()?
        }
        _ => {
            return Err(Error::InvalidArgument(
                "unknown XML children require an array".into(),
            ));
        }
    };
    if let XmlNode::Element { children, .. } = &mut element {
        *children = child_nodes;
    }
    Ok(element)
}
fn table_cell(node: &Value, coordinates: Option<(usize, usize)>) -> Result<XmlNode> {
    let mut cell = container("td", node)?;
    if let Some((row, column)) = coordinates {
        cell = cell
            .attribute("row", row.to_string())
            .attribute("column", column.to_string());
    }
    for (key, default) in [("headerState", 0), ("colSpan", 1), ("rowSpan", 1)] {
        if node.get(key) != Some(&Value::from(default)) {
            cell = cell.attribute(key, string(node, key));
        }
    }
    Ok(maybe_attribute(
        cell,
        node,
        "backgroundColor",
        "backgroundColor",
    ))
}
fn table(node: &Value) -> Result<XmlNode> {
    let rows = node
        .get("children")
        .and_then(Value::as_array)
        .ok_or_else(|| Error::InvalidArgument("XML table requires children".into()))?;
    let mut children = Vec::new();
    let mut r = 0;
    for row in rows {
        if row.get("type").and_then(Value::as_str) != Some("tablerow") {
            children.push(serialize_node(row)?);
            continue;
        }
        let cells = row
            .get("children")
            .and_then(Value::as_array)
            .ok_or_else(|| Error::InvalidArgument("XML row requires children".into()))?;
        let mut row_children = Vec::new();
        let mut c = 0;
        for cell in cells {
            if cell.get("type").and_then(Value::as_str) == Some("tablecell") {
                row_children.push(table_cell(cell, Some((r, c)))?);
                c += 1;
            } else {
                row_children.push(serialize_node(cell)?);
            }
        }
        let mut element = with_id(el("tr", row_children), row);
        if row.get("height").is_some() {
            element = element.attribute("height", string(row, "height"));
        }
        children.push(element);
        r += 1;
    }
    let mut element = with_id(el("table", children), node);
    if let Some(widths) = node.get("colWidths").filter(|v| js_truthy(v)) {
        element = element.attribute("colWidths", js_string(widths));
    }
    if truthy(node, "rowStriping") {
        element = element.attribute("rowStriping", "true");
    }
    Ok(element)
}
/// Serialize one stored node, preserving unknown-node metadata through dotted attributes.
pub fn serialize_node(node: &Value) -> Result<XmlNode> {
    let ty = node
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| Error::InvalidArgument("XML node requires a type".into()))?;
    Ok(match ty {
        "text" => {
            let mut element = leaf_text(
                "t",
                node,
                node.get("text").and_then(Value::as_str).unwrap_or(""),
            );
            let format = node.get("format").and_then(Value::as_u64).unwrap_or(0);
            for (i, name) in [
                "bold",
                "italic",
                "strikethrough",
                "underline",
                "code",
                "subscript",
                "superscript",
            ]
            .iter()
            .enumerate()
            {
                if format & (1 << i) != 0 {
                    element = element.attribute(*name, "true");
                }
            }
            element = maybe_attribute(element, node, "style", "style");
            element = maybe_attribute(element, node, "detail", "detail");
            if truthy(node, "mode") && node.get("mode").and_then(Value::as_str) != Some("normal") {
                element = element.attribute("mode", string(node, "mode"));
            }
            element
        }
        "linebreak" => el("br", vec![]),
        "paragraph" => container("p", node)?,
        "heading" => container(&string(node, "tag"), node)?,
        "quote" => container("blockquote", node)?,
        "listitem" => {
            let mut element = container("li", node)?;
            if node.get("value") != Some(&Value::from(1)) {
                element = element.attribute("value", string(node, "value"));
            }
            if truthy(node, "checked") {
                element = element.attribute("checked", "true");
            }
            element
        }
        "list" | "task-list" => {
            let mut element = container(
                if node.get("listType").and_then(Value::as_str) == Some("number") {
                    "ol"
                } else {
                    "ul"
                },
                node,
            )?;
            if node.get("listType").and_then(Value::as_str) == Some("check") {
                element = element.attribute("listType", "check");
            }
            if node.get("start") != Some(&Value::from(1)) {
                element = element.attribute("start", string(node, "start"));
            }
            element
        }
        "table" => table(node)?,
        "tablerow" => {
            let mut element = container("tr", node)?;
            if node.get("height").is_some() {
                element = element.attribute("height", string(node, "height"));
            }
            element
        }
        "tablecell" => table_cell(node, None)?,
        "horizontalrule" => leaf("hr", node),
        "date-mention" => {
            let mut element = leaf("date-mention", node)
                .attribute("date", string(node, "date"))
                .attribute("displayFormat", string(node, "displayFormat"));
            if node.get("mentionUuid").is_some() {
                element = element.attribute("mentionUuid", string(node, "mentionUuid"));
            }
            element
        }
        "link" | "autolink" => {
            let mut element = container("a", node)?.attribute(
                "href",
                node.get("url")
                    .filter(|v| !v.is_null())
                    .map(js_string)
                    .unwrap_or_default(),
            );
            for key in ["rel", "target", "title"] {
                element = maybe_attribute(element, node, key, key);
            }
            element
        }
        "mark" => container("mark", node)?,
        "tab" => leaf("tab", node),
        "classed-block" => {
            let mut element =
                container("classed-block", node)?.attribute("tag", string(node, "tag"));
            if let Some(classes) = node
                .get("classes")
                .and_then(Value::as_array)
                .filter(|v| !v.is_empty())
            {
                element = element.attribute(
                    "classes",
                    classes.iter().map(js_string).collect::<Vec<_>>().join(" "),
                );
            }
            element
        }
        "custom-code" => {
            let children = node.get("children").and_then(Value::as_array);
            let code = children
                .into_iter()
                .flatten()
                .map(|child| {
                    if child.get("type").and_then(Value::as_str) == Some("linebreak") {
                        "\n".into()
                    } else {
                        child
                            .get("text")
                            .filter(|v| !v.is_null())
                            .map(js_string)
                            .unwrap_or_default()
                    }
                })
                .collect::<String>();
            maybe_attribute(leaf_text("code", node, &code), node, "language", "language")
        }
        "equation" => {
            let mut element = leaf_text(
                "equation",
                node,
                node.get("equation").and_then(Value::as_str).unwrap_or(""),
            );
            if truthy(node, "inline") {
                element = element.attribute("inline", "true");
            }
            element
        }
        "html-render" => leaf_text(
            "html-render",
            node,
            node.get("html").and_then(Value::as_str).unwrap_or(""),
        ),
        "image" | "video" => {
            let mut element = leaf(ty, node);
            if ty == "image" {
                element = maybe_attribute(element, node, "alt", "alt");
            }
            if let Some(url) = node
                .get("url")
                .and_then(Value::as_str)
                .filter(|url| !url.is_empty())
            {
                element = element.attribute("src", redacted_src(url));
            }
            if ty == "video" && truthy(node, "controls") {
                element = element.attribute("controls", "true");
            }
            element
        }
        "document-card" | "document-mention" => {
            let mut element = leaf(ty, node);
            for (key, name) in [
                ("documentId", "documentId"),
                ("documentName", "name"),
                ("blockName", "blockName"),
            ] {
                element = maybe_attribute(element, node, key, name);
            }
            if let Some(params) = node
                .get("blockParams")
                .and_then(Value::as_object)
                .filter(|v| !v.is_empty())
            {
                element = element.attribute(
                    "blockParams",
                    to_js_json_string(&Value::Object(params.clone())),
                );
            }
            element
        }
        "database-query" => {
            let mut element = leaf(ty, node).attribute("queryId", string(node, "queryId"));
            for key in ["databaseId", "tableId"] {
                element = maybe_attribute(element, node, key, key);
            }
            element = element.attribute("displayMode", string(node, "displayMode"));
            element = maybe_attribute(element, node, "title", "title");
            element = element.attribute("prompt", string(node, "prompt"));
            if let Some(chart) = node.get("chart").filter(|v| js_truthy(v)) {
                element = element.attribute("chart", to_js_json_string(chart));
            }
            if node.get("height").is_some() {
                element = element.attribute("height", string(node, "height"));
            }
            element
        }
        "user-mention" => {
            let mut element = leaf(ty, node);
            for (key, name) in [
                ("userId", "userId"),
                ("email", "email"),
                ("displayName", "name"),
            ] {
                element = maybe_attribute(element, node, key, name);
            }
            element
        }
        "contact-mention" => {
            let mut element = leaf(ty, node);
            for (key, name) in [
                ("contactId", "contactId"),
                ("name", "name"),
                ("emailOrDomain", "email"),
            ] {
                element = maybe_attribute(element, node, key, name);
            }
            if truthy(node, "isCompany") {
                element = element.attribute("isCompany", "true");
            }
            element
        }
        "group-mention" => maybe_attribute(leaf(ty, node), node, "groupAlias", "alias"),
        "agent-session-mention" => {
            let mut element = leaf(ty, node).attribute("sessionId", string(node, "id"));
            element = maybe_attribute(element, node, "label", "label");
            if truthy(node, "expanded") {
                element = element.attribute("expanded", "true");
            }
            element
        }
        "pr-mention" => {
            let mut element = leaf(ty, node);
            for (key, name) in [("id", "prId"), ("label", "label"), ("url", "url")] {
                element = maybe_attribute(element, node, key, name);
            }
            element
        }
        "booking-link-mention" => {
            let mut element = leaf(ty, node)
                .attribute("profileId", string(node, "profileId"))
                .attribute("url", string(node, "url"));
            for key in ["slug", "label"] {
                element = maybe_attribute(element, node, key, key);
            }
            element
        }
        "theme-mention" | "unknown-mention" => {
            maybe_attribute(leaf(ty, node), node, "name", "name")
        }
        "tag-mention" => {
            let mut element = leaf(ty, node);
            for key in ["optionId", "propertyDefinitionId", "scope", "name"] {
                element = element.attribute(key, string(node, key));
            }
            maybe_attribute(element, node, "color", "color")
        }
        _ => unknown(node, ty)?,
    })
}
/// Render a serialized document without loading or normalizing its node payloads.
pub fn to_xml(state: &SerializedEditorState) -> Result<String> {
    let root = Value::Object(state.root.clone());
    Ok(build_xml(&[el("doc", children(&root)?)]))
}
