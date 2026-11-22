//! Notion block containers recurse through the same enhanced registry.
use super::*;
use lexical_rich_nodes::{quote::QuoteNode, table::*};
#[derive(Debug)]
pub(super) struct Element {
    pub kind: usize,
    pub pattern: RegexMatcher,
}
impl ElementTransformer for Element {
    fn dependencies(&self) -> &[&'static str] {
        &[]
    }
    fn export(&self, _: &mut ExportCx<'_>, _: NodeKey) -> Result<Option<String>> {
        Ok(None)
    }
    fn reg_exp(&self) -> &dyn Matcher {
        &self.pattern
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        _: &MarkdownOptions,
        parent: NodeKey,
        _: &[NodeKey],
        m: &Match,
        _: bool,
    ) -> Result<ReplaceResult> {
        match self.kind {
            0 => {}
            1 => {
                tx.remove(parent, false)?;
            }
            _ => {
                let data = attrs(m.get(1).unwrap_or(""));
                let url = data
                    .get("src")
                    .or_else(|| data.get("source"))
                    .or_else(|| data.get("url"))
                    .map_or("", String::as_str);
                let caption = without_tags(m.get(2).unwrap_or(""));
                if !web_url(url) {
                    tx.clear(parent)?;
                    let text = tx.create_text(&caption)?;
                    tx.append(parent, &[text.key()])?;
                } else {
                    let image = create_image_node(
                        tx,
                        CreateMedia {
                            src_type: "url".into(),
                            url: Some(url.into()),
                            ..Default::default()
                        },
                        Some(caption),
                    )?;
                    tx.replace(parent, image, false)?;
                }
            }
        }
        Ok(ReplaceResult::Handled)
    }
}
#[derive(Debug)]
pub(super) struct Container {
    pub pattern: RegexMatcher,
    pub links: NotionLinks,
    pub options: crate::transformers::MacroMarkdownOptions,
}
fn utf16_slice(text: &str, start: usize, end: usize) -> Result<String> {
    let units: Vec<_> = text.encode_utf16().collect();
    String::from_utf16(
        units
            .get(start..end)
            .ok_or(Error::InvalidArgument("container match offsets"))?,
    )
    .map_err(|_| Error::InvalidArgument("container match splits surrogate"))
}
fn dedent(lines: Vec<String>) -> String {
    lines
        .into_iter()
        .map(|line| {
            line.strip_prefix('\t')
                .or_else(|| line.strip_prefix("    "))
                .unwrap_or(&line)
                .to_owned()
        })
        .filter(|line| !js_trim(line).is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}
fn callout(
    tx: &mut Transaction<'_>,
    nodes: Vec<NodeKey>,
    icon: Option<&String>,
) -> Result<Vec<NodeKey>> {
    let mut output = Vec::new();
    let mut quote = None;
    let mut leading = icon
        .filter(|icon| !icon.is_empty() && !web_url(icon))
        .map(|icon| format!("{icon} "));
    for node in nodes {
        if !tx.is::<Paragraph>(node) {
            quote = None;
            output.push(node);
            continue;
        }
        let current = if let Some(quote) = quote {
            let br = tx.create(LineBreak {})?;
            tx.append(quote, &[br.key()])?;
            quote
        } else {
            let current = tx.create(QuoteNode {})?.key();
            quote = Some(current);
            output.push(current);
            current
        };
        if let Some(leading) = leading.take() {
            let text = tx.create_text(&leading)?;
            tx.append(current, &[text.key()])?;
        }
        let children = tx.children_keys(node)?;
        tx.append(current, &children)?;
    }
    Ok(output)
}
fn table(
    tx: &mut Transaction<'_>,
    content: &str,
    data: &BTreeMap<String, String>,
    links: &NotionLinks,
    options: &crate::transformers::MacroMarkdownOptions,
) -> Result<Vec<NodeKey>> {
    let rows = regex(r"<tr\b[^>]*>([\s\S]*?)</tr>")
        .find_all(content)
        .iter()
        .map(|row| {
            regex(r"<t[dh]\b[^>]*>([\s\S]*?)</t[dh]>")
                .find_all(row.get(1).unwrap_or(""))
                .iter()
                .map(|m| m.get(1).unwrap_or("").to_owned())
                .collect::<Vec<_>>()
        })
        .filter(|cells| !cells.is_empty())
        .collect::<Vec<_>>();
    let columns = rows.iter().map(Vec::len).max().unwrap_or(0);
    if columns == 0 {
        return Ok(Vec::new());
    }
    let table = tx.create(TableNode::default())?;
    for (r, cells) in rows.iter().enumerate() {
        let row = tx.create(TableRowNode::default())?;
        for column in 0..columns {
            let header =
                u8::from(r == 0 && data.get("header-row").is_some_and(|value| value == "true"))
                    | (u8::from(
                        column == 0
                            && data
                                .get("header-column")
                                .is_some_and(|value| value == "true"),
                    ) << 1);
            let cell = tx.create(TableCellNode {
                header_state: TableCellHeaderState::from_bits_retain(header),
                ..Default::default()
            })?;
            let source = cells.get(column).map_or("", String::as_str);
            let content =
                lexical_markdown::matcher::replace_all(&regex(r"<br\s*/?>"), source, |_| {
                    "\n".into()
                })
                .split('\n')
                .map(js_trim)
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            let mut children = if content.is_empty() {
                Vec::new()
            } else {
                import_nodes(tx, &content, links, options)?
            };
            if children.is_empty() {
                children.push(tx.create(Paragraph {})?.key());
            }
            tx.append(cell, &children)?;
            tx.append(row, &[cell.key()])?;
        }
        tx.append(table, &[row.key()])?;
    }
    Ok(vec![table.key()])
}
impl MultilineElementTransformer for Container {
    fn dependencies(&self) -> &[&'static str] {
        &["table", "tablerow", "tablecell", "linebreak"]
    }
    fn reg_exp_start(&self) -> &dyn Matcher {
        &self.pattern
    }
    fn handle_import_after_start_match(
        &self,
        tx: &mut Transaction<'_>,
        _: &MarkdownOptions,
        lines: &[String],
        root: NodeKey,
        start: usize,
        m: &Match,
    ) -> Result<AfterStartMatch> {
        let tag = m.get(1).unwrap_or("");
        let raw_attrs = m.get(2).unwrap_or("");
        if raw_attrs.ends_with('/') {
            return Ok(AfterStartMatch::Skip);
        }
        let tags = regex(&format!(r"<(/?){tag}\b[^>]*?(/?)>"));
        let mut depth = 1i32;
        let mut active_fence = None;
        let mut inner = Vec::new();
        let mut end = lines.len().saturating_sub(1);
        let mut after = String::new();
        'scan: for (index, original) in lines.iter().enumerate().skip(start) {
            let line = if index == start {
                utf16_slice(
                    original,
                    m.end().get() as usize,
                    original.encode_utf16().count(),
                )?
            } else {
                original.clone()
            };
            let marker = fence(&line);
            if let Some(active) = &active_fence {
                if marker
                    .as_ref()
                    .is_some_and(|marker| marker.starts_with(active))
                {
                    active_fence = None;
                }
            } else if marker.is_some() {
                active_fence = marker;
            } else {
                for found in tags.find_all(&line) {
                    if found.get(2).is_some_and(|slash| !slash.is_empty()) {
                        continue;
                    }
                    depth += if found.get(1) == Some("/") { -1 } else { 1 };
                    if depth == 0 {
                        inner.push(utf16_slice(&line, 0, found.index.get() as usize)?);
                        after = utf16_slice(
                            &line,
                            found.end().get() as usize,
                            line.encode_utf16().count(),
                        )?;
                        end = index;
                        break 'scan;
                    }
                }
            }
            inner.push(line);
        }
        let content = dedent(inner);
        let data = attrs(raw_attrs);
        let nodes = match tag {
            "ancestor-path" => Vec::new(),
            "table" => table(tx, &content, &data, &self.links, &self.options)?,
            "callout" => {
                let nodes = import_nodes(tx, &content, &self.links, &self.options)?;
                callout(tx, nodes, data.get("icon"))?
            }
            "details" => {
                if let Some(summary) = regex(r"^\s*<summary>([\s\S]*?)</summary>").exec(&content) {
                    let mut nodes = import_nodes(
                        tx,
                        &summary.get(1).unwrap_or("").replace('\n', " "),
                        &self.links,
                        &self.options,
                    )?;
                    let rest = utf16_slice(
                        &content,
                        summary.end().get() as usize,
                        content.encode_utf16().count(),
                    )?;
                    nodes.extend(import_nodes(
                        tx,
                        js_trim(&rest),
                        &self.links,
                        &self.options,
                    )?);
                    nodes
                } else {
                    import_nodes(tx, js_trim(&content), &self.links, &self.options)?
                }
            }
            _ => import_nodes(tx, &content, &self.links, &self.options)?,
        };
        tx.append(root, &nodes)?;
        if !js_trim(&after).is_empty() {
            let nodes = import_nodes(tx, js_trim(&after), &self.links, &self.options)?;
            tx.append(root, &nodes)?;
        }
        Ok(AfterStartMatch::Done {
            imported: true,
            last_line: end,
        })
    }
    fn replace(
        &self,
        _: &mut Transaction<'_>,
        _: &MarkdownOptions,
        _: NodeKey,
        _: Option<&[NodeKey]>,
        _: &Match,
        _: Option<&Match>,
        _: Option<Vec<String>>,
        _: bool,
    ) -> Result<ReplaceResult> {
        Ok(ReplaceResult::NotHandled)
    }
}
