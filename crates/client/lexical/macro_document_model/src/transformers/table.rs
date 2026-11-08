//! Tables recurse through the source's dedicated cell transformer subsets.
use super::*;
use lexical_markdown::{Error, Result};
use lexical_model::*;
use lexical_rich_nodes::table::*;
use std::collections::BTreeMap;
fn registry(internal: bool, options: &MacroMarkdownOptions) -> Result<Transformers> {
    let mut out = Vec::new();
    if !internal {
        out.push(transformer("BR_TAG_TO_LINE_BREAK", options)?);
    }
    out.push(Transformer::Element(Arc::new(CheckList)));
    let names = if internal {
        &[
            "I_USER_MENTION",
            "I_DOCUMENT_MENTION",
            "I_CONTACT_MENTION",
            "I_DATE_MENTION",
            "I_EQUATION_NODE",
            "I_IMAGE_CONSTRAINED",
            "IMAGE",
            "I_VIDEO",
        ][..]
    } else {
        &[
            "E_USER_MENTION",
            "I_DOCUMENT_MENTION",
            "E_DOCUMENT_MENTION",
            "E_CONTACT_MENTION",
            "I_DATE_MENTION",
            "E_BLOCK_EQUATION_NODE",
            "IMAGE",
            "I_VIDEO",
        ][..]
    };
    for name in names {
        out.push(transformer(name, options)?);
    }
    if !internal {
        for i in 0..8 {
            out.push(transformer(&format!("HTML_ENTITY_{i}"), options)?);
        }
    }
    for name in [
        "HTML_TEXT_FORMAT_EXPORTER",
        "HTML_TEXT_FORMAT_IMPORTER_0",
        "HTML_TEXT_FORMAT_IMPORTER_1",
        "HTML_TEXT_FORMAT_IMPORTER_2",
    ] {
        out.push(transformer(name, options)?);
    }
    out.extend(lexical_markdown::builtin::transformers());
    Ok(Transformers::new(out))
}
fn attrs(text: &str) -> Result<BTreeMap<String, String>> {
    Ok(RegexMatcher::new(r#"([\w-]+)="([^"]*)""#, "")?
        .find_all(text)
        .iter()
        .map(|m| (m.get(1).unwrap_or("").into(), m.get(2).unwrap_or("").into()))
        .collect())
}
fn attr_number(text: &str) -> Option<f64> {
    let number = js_to_number(&serde_json::Value::String(text.into()));
    number.is_finite().then_some(number)
}
fn positive(text: &str) -> Option<f64> {
    attr_number(text).filter(|n| *n > 0.0)
}
fn span(text: &str) -> Option<u32> {
    attr_number(text)
        .filter(|n| *n >= 2.0 && n.fract() == 0.0 && *n <= u32::MAX as f64)
        .map(|n| n as u32)
}
fn matcher(tag: &str) -> Result<RegexMatcher> {
    Ok(RegexMatcher::new(
        &format!(r#"<{tag}((?:\s+[\w-]+="[^"]*")*)\s*>(.*?)</{tag}>"#),
        "s",
    )?)
}
pub(super) fn import_internal(
    tx: &mut Transaction<'_>,
    parent: NodeKey,
    m: &Match,
    opts: &MarkdownOptions,
    options: &MacroMarkdownOptions,
) -> Result<ReplaceResult> {
    let table_attrs = attrs(m.get(1).unwrap_or(""))?;
    let table = tx.create(TableNode::default())?;
    let transformers = registry(true, options)?;
    for row_match in matcher("m-table-row")?.find_all(m.full()) {
        let row_attrs = attrs(row_match.get(1).unwrap_or(""))?;
        let height = row_attrs
            .get("height")
            .and_then(|s| positive(s))
            .map(JsNumber);
        let row = tx.create(TableRowNode { height })?;
        for cell_match in matcher("m-table-cell")?.find_all(row_match.get(2).unwrap_or("")) {
            let attrs = attrs(cell_match.get(1).unwrap_or(""))?;
            let data = TableCellNode {
                col_span: attrs.get("colspan").and_then(|s| span(s)).unwrap_or(1),
                row_span: attrs.get("rowspan").and_then(|s| span(s)).unwrap_or(1),
                header_state: match attrs.get("header").map(String::as_str) {
                    Some("row") => TableCellHeaderState::ROW,
                    Some("col") => TableCellHeaderState::COLUMN,
                    Some("both") => TableCellHeaderState::BOTH,
                    _ => TableCellHeaderState::NO_STATUS,
                },
                ..Default::default()
            };
            let cell = tx.create(data)?;
            let content = cell_match
                .get(2)
                .unwrap_or("")
                .replace("\\n", "\n")
                .replace("<br>", "");
            convert_from_markdown_string(tx, &content, &transformers, Some(cell.key()), opts)?;
            tx.append(row, &[cell.key()])?;
        }
        tx.append(table, &[row.key()])?;
    }
    if let Some(widths) = table_attrs
        .get("col-widths")
        .and_then(|text| text.split(',').map(positive).collect::<Option<Vec<_>>>())
        .filter(|widths| !widths.is_empty())
    {
        tx.get_mut::<TableNode>(table)?.col_widths =
            Some(widths.into_iter().map(|w| Some(JsNumber(w))).collect()).into();
    }
    tx.replace(parent, table, false)?;
    Ok(ReplaceResult::Handled)
}
fn cells(
    tx: &mut Transaction<'_>,
    text: &str,
    opts: &MarkdownOptions,
    options: &MacroMarkdownOptions,
) -> Result<Option<Vec<NodeKey>>> {
    let regex = RegexMatcher::new(r"^(?:\|)(.+)(?:\|)\s?$", "")?;
    let Some(m) = regex.exec(text) else {
        return Ok(None);
    };
    let Some(body) = m.get(1).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let transformers = registry(false, options)?;
    let mut result = Vec::new();
    let opts = MarkdownOptions {
        should_preserve_new_lines: true,
        ..*opts
    };
    for content in body.split('|') {
        let cell = tx.create(TableCellNode::default())?;
        let content = content.replace("\\n", "\n");
        convert_from_markdown_string(
            tx,
            js_trim(&content),
            &transformers,
            Some(cell.key()),
            &opts,
        )?;
        result.push(cell.key());
    }
    Ok(Some(result))
}
pub(super) fn import_external(
    tx: &mut Transaction<'_>,
    parent: NodeKey,
    m: &Match,
    opts: &MarkdownOptions,
    options: &MacroMarkdownOptions,
) -> Result<ReplaceResult> {
    if RegexMatcher::new(r"^(\| ?:?-*:? ?)+\|\s?$", "")?.test(m.full()) {
        if let Some(table) = tx
            .view()
            .prev_sibling(parent)
            .filter(|k| tx.view().is::<TableNode>(*k))
            && let Some(row) = tx
                .view()
                .last_child(table)
                .filter(|k| tx.view().is::<TableRowNode>(*k))
        {
            for cell in tx.view().children_keys(row)? {
                if tx.view().is::<TableCellNode>(cell) {
                    tx.get_mut::<TableCellNode>(cell)?.set_header_styles(
                        TableCellHeaderState::NO_STATUS,
                        TableCellHeaderState::NO_STATUS,
                    );
                }
            }
            tx.remove(parent, false)?;
        }
        return Ok(ReplaceResult::Handled);
    }
    let Some(first) = cells(tx, m.full(), opts, options)? else {
        return Ok(ReplaceResult::Handled);
    };
    let mut max = first.len();
    let mut rows = vec![first];
    let mut sibling = tx.view().prev_sibling(parent);
    while let Some(key) = sibling {
        if !tx.view().is::<Paragraph>(key) || tx.view().children_size(key) != 1 {
            break;
        }
        let Some(child) = tx
            .view()
            .first_child(key)
            .filter(|key| tx.view().is_text(*key))
        else {
            break;
        };
        let text = tx.view().text_content(child).into_owned();
        let Some(row) = cells(tx, &text, opts, options)? else {
            break;
        };
        max = max.max(row.len());
        rows.insert(0, row);
        sibling = tx.view().prev_sibling(key);
        tx.remove(key, false)?;
    }
    let table = tx.create(TableNode::default())?;
    for mut row_cells in rows {
        let row = tx.create(TableRowNode::default())?;
        tx.append(table, &[row.key()])?;
        while row_cells.len() < max {
            row_cells.push(tx.create(TableCellNode::default())?.key());
            let cell = *row_cells
                .last()
                .ok_or(Error::InvalidArgument("missing padded cell"))?;
            let p = tx.create(Paragraph {})?;
            tx.append(cell, &[p.key()])?;
        }
        tx.append(row, &row_cells)?;
    }
    let prev = tx
        .view()
        .prev_sibling(parent)
        .filter(|key| tx.view().is::<TableNode>(*key));
    let table = if let Some(prev) = prev.filter(|key| {
        tx.view()
            .first_child(*key)
            .is_some_and(|row| tx.view().children_size(row) as usize == max)
    }) {
        let rows = tx.view().children_keys(table)?;
        tx.append(prev, &rows)?;
        tx.remove(parent, false)?;
        prev
    } else {
        tx.replace(parent, table, false)?;
        table.key()
    };
    tx.select_end(table)?;
    Ok(ReplaceResult::Handled)
}
fn attr(output: &mut String, name: &str, value: impl std::fmt::Display) {
    output.push_str(&format!(" {name}=\"{value}\""));
}
fn number_string(n: f64) -> String {
    to_js_json_string(&js_number(n))
}
pub(super) fn export(
    cx: &mut ExportCx<'_>,
    node: NodeKey,
    internal: bool,
    options: &MacroMarkdownOptions,
) -> Result<Option<String>> {
    let Some(table) = cx.state().cast::<TableNode>(node) else {
        return Ok(None);
    };
    let transformers = registry(internal, options)?;
    if !internal {
        let (map, _, _) = compute_table_map_skip_cell_check(cx.state(), table, None, None)?;
        let mut output = Vec::new();
        for (r, row) in map.rows.iter().enumerate() {
            let mut values = Vec::new();
            let mut header = false;
            for (c, slot) in row.iter().enumerate() {
                let Some(slot) = slot else {
                    values.push(String::new());
                    continue;
                };
                if slot.start_row as usize == r && slot.start_column as usize == c {
                    let markdown = convert_to_markdown_string(
                        &cx.state(),
                        &transformers,
                        Some(slot.cell.key()),
                        cx.options(),
                    )?
                    .replace('\n', "\\n");
                    values.push(js_trim(&markdown).into());
                } else {
                    values.push(String::new());
                }
                header |= matches!(
                    slot.header_state,
                    TableCellHeaderState::ROW | TableCellHeaderState::BOTH
                );
            }
            output.push(format!("| {} |", values.join(" | ")));
            if header {
                output.push(format!("| {} |", vec!["---"; values.len()].join(" | ")));
            }
        }
        return Ok(Some(output.join("\n")));
    }
    let mut output = "<m-table".to_owned();
    if let Some(widths) = cx
        .state()
        .get::<TableNode>(table)
        .and_then(|t| t.col_widths.as_ref())
    {
        attr(
            &mut output,
            "col-widths",
            widths
                .iter()
                .map(|w| number_string(w.map_or(0.0, |w| (w.0 + 0.5).floor())))
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    output.push('>');
    for row in cx.state().children_keys(table)? {
        let Some(data) = cx.state().get::<TableRowNode>(row) else {
            continue;
        };
        output.push_str("<m-table-row");
        if let Some(height) = data.height {
            attr(&mut output, "height", number_string(height.0));
        }
        output.push('>');
        for cell in cx.state().children_keys(row)? {
            let Some(data) = cx.state().get::<TableCellNode>(cell) else {
                continue;
            };
            output.push_str("<m-table-cell");
            if data.col_span > 1 {
                attr(&mut output, "colspan", data.col_span);
            }
            if data.row_span > 1 {
                attr(&mut output, "rowspan", data.row_span);
            }
            match data.header_state {
                TableCellHeaderState::ROW => attr(&mut output, "header", "row"),
                TableCellHeaderState::COLUMN => attr(&mut output, "header", "col"),
                TableCellHeaderState::BOTH => attr(&mut output, "header", "both"),
                _ => {}
            }
            output.push('>');
            output.push_str(
                &convert_to_markdown_string(&cx.state(), &transformers, Some(cell), cx.options())?
                    .replace('\n', "\\n"),
            );
            output.push_str("</m-table-cell>");
        }
        output.push_str("</m-table-row>");
    }
    output.push_str("</m-table>");
    Ok(Some(output))
}
