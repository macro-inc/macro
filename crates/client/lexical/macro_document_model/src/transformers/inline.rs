//! Inline replacement callbacks, preserving source recursive-processing returns.
use super::*;
use crate::nodes::*;
use lexical_markdown::{Error, Result};
use lexical_model::*;
use lexical_rich_nodes::{link::*, mark::MarkNode};
use serde_json::{Value, json};
impl TextMatchTransformer for Callback {
    fn dependencies(&self) -> &[&'static str] {
        &self.entry.dependencies
    }
    fn reg_exp(&self) -> &dyn Matcher {
        &*self.pattern
    }
    fn import_reg_exp(&self) -> Option<&dyn Matcher> {
        self.import.as_deref()
    }
    fn trigger(&self) -> Option<char> {
        self.entry.trigger
    }
    fn has_replace(&self) -> bool {
        self.entry.has_replace
    }
    fn export(&self, cx: &mut ExportCx<'_>, node: NodeKey) -> Result<Option<String>> {
        let name = self.entry.name;
        if let Some(spec) = envelope::spec(name) {
            return envelope::export(&spec, cx, node);
        }
        match name {
            "UNKNOWN_MENTION" => Ok(cx.state().get::<UnknownMentionNode>(node).map(|n| {
                let name = n.name.as_deref().unwrap_or("undefined");
                format!("<{name}></{name}>")
            })),
            "E_INLINE_EQUATION_NODE" | "E_BLOCK_EQUATION_NODE" => Ok(cx
                .state()
                .get::<EquationNode>(node)
                .filter(|n| n.inline == (name == "E_INLINE_EQUATION_NODE"))
                .map(|n| {
                    let delim = if n.inline { "$" } else { "$$" };
                    format!(
                        "{delim}{}{delim}",
                        n.equation.as_deref().unwrap_or("undefined")
                    )
                })),
            "I_DATABASE_QUERY" => {
                let Some(data) = cx
                    .state()
                    .get::<DatabaseQueryNode>(node)
                    .filter(|n| n.data.display_mode == DatabaseQueryDisplayMode::Scalar)
                else {
                    return Ok(None);
                };
                Ok(Some(database_query_markdown(
                    &serde_json::to_value(&data.data).map_err(lexical_model::Error::from)?,
                )?))
            }
            "LINK_XML" | "UNLINKED_TEXT" => export_link(cx, node, name == "UNLINKED_TEXT"),
            "HTML_TEXT_FORMAT_EXPORTER" => export_html_format(cx, node),
            name if name.starts_with("LIST_ITEM_IMAGE_") => {
                super::block::export_list_image(cx, node, name)
            }
            _ => Ok(None),
        }
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        node: NodeKey,
        m: &Match,
    ) -> Result<Option<NodeKey>> {
        let name = self.entry.name;
        if let Some(spec) = envelope::spec(name) {
            let replacement = match envelope::create(tx, &spec, m.get(1).unwrap_or("")) {
                Ok(node) => node,
                Err(_) => envelope::unknown(tx, spec.unknown)?,
            };
            tx.replace(node, replacement, false)?;
            return Ok(None);
        }
        match name {
            "UNKNOWN_MENTION" => {
                let replacement = envelope::unknown(tx, m.get(1).unwrap_or(""))?;
                tx.replace(node, replacement, false)?;
            }
            "HTML_TEXT_FORMAT_IMPORTER_0"
            | "HTML_TEXT_FORMAT_IMPORTER_1"
            | "HTML_TEXT_FORMAT_IMPORTER_2" => {
                let format = match name {
                    "HTML_TEXT_FORMAT_IMPORTER_0" => TextFormatType::Underline,
                    "HTML_TEXT_FORMAT_IMPORTER_1" => TextFormatType::Superscript,
                    _ => TextFormatType::Subscript,
                };
                tx.text(node)?.set_text_content(m.get(1).unwrap_or(""))?;
                if !tx.text_data(node)?.format.contains(format.flag()) {
                    tx.text(node)?.toggle_format(format)?;
                }
                return Ok(Some(node));
            }
            "BR_TAG_TO_LINE_BREAK" => {
                let br = tx.create(LineBreak {})?;
                tx.replace(node, br, false)?;
            }
            "BR_TAG_TO_SPACE" => {
                let regex = RegexMatcher::new("<br\\s*/?>", "i")?;
                let text = tx.view().text_content(node).into_owned();
                let mut new = text.clone();
                for m in regex.find_all(&text).iter().rev() {
                    let start = byte_index(&text, m.index.get());
                    let end = byte_index(&text, m.end().get());
                    new.replace_range(start..end, " ");
                }
                tx.text(node)?.set_text_content(&new)?;
                return Ok(Some(node));
            }
            name if name.starts_with("HTML_ENTITY_") => {
                let value = match name {
                    "HTML_ENTITY_0" => "&",
                    "HTML_ENTITY_1" => "\u{a0}",
                    "HTML_ENTITY_2" => "<",
                    "HTML_ENTITY_3" => ">",
                    "HTML_ENTITY_4" => "\"",
                    "HTML_ENTITY_5" => "©",
                    "HTML_ENTITY_6" => "®",
                    "HTML_ENTITY_7" => "™",
                    _ => return Err(Error::InvalidArgument("unknown HTML entity")),
                };
                let text = tx.create_text(value)?;
                tx.replace(node, text, false)?;
            }
            "LINK_XML" | "UNLINKED_TEXT" => import_link(tx, node, m)?,
            "MARK_XML" | "SEARCH_MATCH" => {
                let mark = if name == "MARK_XML" {
                    tx.create(MarkNode::default())?.key()
                } else {
                    tx.create(SearchMatchNode::default())?.key()
                };
                let text = tx.create_text(m.get(1).unwrap_or(""))?;
                let format = tx.text_data(node)?.format;
                tx.text(text)?.set_format(format)?;
                tx.append(mark, &[text.key()])?;
                tx.replace(node, mark, false)?;
            }
            "AUTO_LINK" | "ESCAPED_AUTO_LINK" => {
                if tx
                    .find_matching_parent(node, |state, key| state.is::<LinkNode>(key))
                    .is_some()
                {
                    return Ok(None);
                }
                let format = tx.text_data(node)?.format;
                if name == "ESCAPED_AUTO_LINK" {
                    let text = tx.create(UnlinkedTextNode {})?;
                    tx.text(text)?
                        .set_text_content(m.get(1).unwrap_or(""))?
                        .set_format(format)?;
                    tx.replace(node, text, false)?;
                } else {
                    let link =
                        create_link_node(tx, m.get(1).unwrap_or(""), LinkAttributes::default())?;
                    let text = tx.create_text(m.get(2).unwrap_or(""))?;
                    tx.text(text)?.set_format(format)?;
                    tx.append(link, &[text.key()])?;
                    tx.replace(node, link, false)?;
                }
            }
            "E_INLINE_EQUATION_NODE" | "E_BLOCK_EQUATION_NODE" => {
                let inline = name == "E_INLINE_EQUATION_NODE" || shares_line(tx, node);
                let size = if name == "E_INLINE_EQUATION_NODE" {
                    1
                } else {
                    2
                };
                let equation = m
                    .full()
                    .get(size..m.full().len().saturating_sub(size))
                    .ok_or(Error::InvalidArgument("invalid equation match"))?;
                let eq = tx.create(EquationNode {
                    equation: Maybe::Value(equation.into()),
                    inline,
                })?;
                tx.replace(node, eq, false)?;
            }
            "I_DATABASE_QUERY" => {
                let key = if let Some(mut data) = parse_database_query_json(m.get(1).unwrap_or(""))
                {
                    data.display_mode = DatabaseQueryDisplayMode::Scalar;
                    tx.create(DatabaseQueryNode { data })?.key()
                } else {
                    envelope::unknown(tx, "Unavailable database question")?
                };
                tx.replace(node, key, false)?;
            }
            _ => {
                return Err(Error::InvalidArgument(
                    "Macro inline callback is not implemented",
                ));
            }
        }
        Ok(None)
    }
}
fn byte_index(text: &str, offset: u32) -> usize {
    let mut units = 0;
    for (i, c) in text.char_indices() {
        if units == offset {
            return i;
        }
        units += c.len_utf16() as u32;
    }
    text.len()
}
fn shares_line(tx: &Transaction<'_>, node: NodeKey) -> bool {
    for siblings in [
        tx.view().prev_siblings(node).collect::<Vec<_>>(),
        tx.view().next_siblings(node).collect(),
    ] {
        for sibling in siblings {
            if tx.view().is::<LineBreak>(sibling) {
                break;
            }
            if !tx.view().is_text(sibling) || !js_trim(&tx.view().text_content(sibling)).is_empty()
            {
                return true;
            }
        }
    }
    false
}
fn import_link(tx: &mut Transaction<'_>, node: NodeKey, m: &Match) -> Result<()> {
    let value = serde_json::from_str::<Value>(m.get(1).unwrap_or(""));
    let Some(data) = value
        .ok()
        .filter(|v| v.get("url").is_some() && v.get("text").is_some())
    else {
        let unknown = envelope::unknown(tx, "Unknown Link")?;
        tx.replace(node, unknown, false)?;
        return Ok(());
    };
    let text = data["text"]
        .as_str()
        .ok_or(Error::InvalidArgument("link text must be string"))?;
    let format = tx.text_data(node)?.format;
    if data.get("unlinked") == Some(&Value::Bool(true)) {
        let key = tx.create(UnlinkedTextNode {})?;
        let extra = data.get("format").and_then(Value::as_u64).unwrap_or(0) as u32;
        tx.text(key)?
            .set_text_content(text)?
            .set_format(format | TextFormat::from_bits_retain(extra))?;
        tx.replace(node, key, false)?;
    } else {
        let link = create_link_node(
            tx,
            data["url"]
                .as_str()
                .ok_or(Error::InvalidArgument("link URL must be string"))?,
            LinkAttributes {
                title: data.get("title").and_then(Value::as_str).map(str::to_owned),
                ..Default::default()
            },
        )?;
        let text = tx.create_text(text)?;
        tx.text(text)?.set_format(format)?;
        tx.append(link, &[text.key()])?;
        tx.replace(node, link, false)?;
    }
    Ok(())
}
fn export_link(cx: &mut ExportCx<'_>, node: NodeKey, external: bool) -> Result<Option<String>> {
    if cx.state().is::<UnlinkedTextNode>(node) {
        return Ok(Some(export_unlinked_text(cx, node, external)?));
    }
    if let Some(auto) = cx.state().get::<AutoLinkNode>(node)
        && auto.is_unlinked
    {
        let children = cx.state().children_keys(node)?;
        let mut out = String::new();
        for child in children {
            if cx.state().is_text(child) {
                out.push_str(&export_unlinked_text(cx, child, external)?);
            }
        }
        return Ok(Some(out));
    }
    if external {
        return Ok(None);
    }
    if let Some(link) = cx.state().get::<LinkNode>(node) {
        let data = json!({"url":link.url.replace('(',"%28").replace(')',"%29"),"text":cx.state().text_content(node),"title":link.title.as_deref().unwrap_or("")});
        return Ok(Some(format!(
            "<m-link>{}</m-link>",
            to_js_json_string(&data).replace('<', "\\u003c")
        )));
    }
    Ok(None)
}
fn export_unlinked_text(cx: &mut ExportCx<'_>, node: NodeKey, external: bool) -> Result<String> {
    let text = cx.state().text_content(node).into_owned();
    if external {
        return Ok(escape_unlinked(&cx.export_format(node, &text)?));
    }
    if let Some(link) =
        crate::links::find_next_auto_link_match(&text, crate::links::AutoLinkMode::CommonTlds)
    {
        let format = cx.state().text(node).map(|t| t.format.bits()).unwrap_or(0);
        let data = json!({"url":link.url,"text":text,"title":"","unlinked":true,"format":format});
        return Ok(format!(
            "<m-link>{}</m-link>",
            to_js_json_string(&data).replace('<', "\\u003c")
        ));
    }
    cx.export_format(node, &text)
}
fn escape_unlinked(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars() {
        if matches!(c, ':' | '.' | '@' | '/') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}
fn export_html_format(cx: &mut ExportCx<'_>, node: NodeKey) -> Result<Option<String>> {
    let Some(data) = cx.state().text(node) else {
        return Ok(None);
    };
    let tags = [
        (TextFormat::UNDERLINE, "u"),
        (TextFormat::SUPERSCRIPT, "sup"),
        (TextFormat::SUBSCRIPT, "sub"),
    ];
    let tags: Vec<_> = tags
        .into_iter()
        .filter(|(bit, _)| data.format.contains(*bit))
        .map(|(_, tag)| tag)
        .collect();
    if tags.is_empty() {
        return Ok(None);
    }
    let text = cx.state().text_content(node).into_owned();
    let content = cx.export_format(node, &text)?;
    let mut inner = content.as_str();
    let mut prefix = String::new();
    let mut suffix = String::new();
    let delimiters = ["**", "__", "~~", "==", "*", "_", "`"];
    while !inner.is_empty() {
        let whitespace = inner.len() - inner.trim_start_matches(is_js_whitespace).len();
        let boundary = if whitespace > 0 {
            Some(&inner[..whitespace])
        } else {
            delimiters
                .iter()
                .find(|tag| inner.starts_with(**tag))
                .copied()
        };
        let Some(boundary) = boundary else { break };
        prefix.push_str(boundary);
        inner = &inner[boundary.len()..];
    }
    while !inner.is_empty() {
        let whitespace = inner.len() - inner.trim_end_matches(is_js_whitespace).len();
        let boundary = if whitespace > 0 {
            Some(&inner[inner.len() - whitespace..])
        } else {
            delimiters
                .iter()
                .find(|tag| inner.ends_with(**tag))
                .copied()
        };
        let Some(boundary) = boundary else { break };
        suffix.insert_str(0, boundary);
        inner = &inner[..inner.len() - boundary.len()];
    }
    let mut out = prefix;
    for tag in &tags {
        out.push_str(&format!("<{tag}>"));
    }
    out.push_str(inner);
    for tag in tags.iter().rev() {
        out.push_str(&format!("</{tag}>"));
    }
    out.push_str(&suffix);
    Ok(Some(out))
}
