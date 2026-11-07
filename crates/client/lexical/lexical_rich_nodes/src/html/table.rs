//! Table DOM construction and selection-dependent column pruning.
use super::*;
use crate::table::{TableCellNode, TableNode, TableRowNode};
use lexical_html::js::js_number_to_string;
use std::collections::{HashMap, HashSet};
fn pixels(value: f64) -> String {
    format!("{}px", js_number_to_string(value))
}
fn alignment(ctx: &ExportCtx<'_>, key: NodeKey, el: &mut HtmlElement) -> lexical_html::Result<()> {
    if let Some(theme) = &ctx.theme.table_alignment {
        let format = ctx.state.element_data(key)?.format;
        add_class_names(
            el,
            &[match format {
                lexical_model::ElementFormat::Center => theme.center.as_deref(),
                lexical_model::ElementFormat::Right => theme.right.as_deref(),
                _ => None,
            }],
        );
    }
    Ok(())
}
impl ExportDom for TableNode {
    fn export_dom<'a>(
        &'a self,
        ctx: &ExportCtx<'a>,
        key: NodeKey,
    ) -> lexical_html::Result<DomExportOutput<'a>> {
        let mut el = HtmlElement::new("table");
        set_dom_style_from_css(&mut el, &ctx.state.element_data(key)?.style);
        let mut columns = HtmlElement::new("colgroup");
        for index in 0..TableNode::column_count(
            ctx.state.view(),
            ctx.state
                .view()
                .cast::<TableNode>(key)
                .ok_or(lexical_model::Error::NodeTypeMismatch(key))?,
        ) {
            let mut col = HtmlElement::new("col");
            if let Some(width) = self
                .col_widths
                .as_ref()
                .and_then(|widths| widths.get(index as usize))
                .and_then(|width| *width)
                .filter(|width| width.0 != 0.0 && !width.0.is_nan())
            {
                col.style_set_property("width", &pixels(width.0));
            }
            columns.append(HtmlNode::Element(col));
        }
        el.append(HtmlNode::Element(columns));
        add_class_names(&mut el, &[ctx.theme.table.as_deref()]);
        if self.row_striping {
            add_class_names(&mut el, &[ctx.theme.table_row_striping.as_deref()]);
            el.set_attribute("data-lexical-row-striping", "true");
        }
        alignment(ctx, key, &mut el)?;
        element_export_dom(ctx, key, &mut el)?;
        let mut output = DomExportOutput::element(el);
        output.after = Some(Box::new(move |ctx, siblings, index| {
            let Some(HtmlNode::Element(el)) = siblings.get_mut(index) else {
                return Ok(());
            };
            alignment(ctx, key, el)?;
            let (map, _, _) = crate::table::compute_table_map_skip_cell_check(
                ctx.state.view(),
                ctx.state
                    .view()
                    .cast::<TableNode>(key)
                    .ok_or(lexical_model::Error::NodeTypeMismatch(key))?,
                None,
                None,
            )?;
            let mut positions = HashMap::new();
            for cell in map.rows.iter().flatten().flatten() {
                positions
                    .entry(cell.cell.key())
                    .or_insert((cell.start_column, cell.col_span));
            }
            let mut known = HashSet::new();
            for row in el.direct_children_mut("tr") {
                for cell in &mut row.children {
                    if let HtmlNode::Element(cell) = cell
                        && let Some((start, span)) = cell
                            .lexical_key
                            .take()
                            .and_then(|key| positions.remove(&key))
                    {
                        known.extend(start..start + span);
                    }
                }
            }
            for columns in el.direct_children_mut("colgroup") {
                let mut index = 0;
                columns.children.retain(|child| { if matches!(child, HtmlNode::Element(col) if col.tag.eq_ignore_ascii_case("col")) { let keep = known.contains(&index); index += 1; keep } else { true } });
            }
            let mut body = HtmlElement::new("tbody");
            let mut rest = Vec::new();
            for child in std::mem::take(&mut el.children) {
                if matches!(&child, HtmlNode::Element(row) if row.tag.eq_ignore_ascii_case("tr")) {
                    body.append(child);
                } else {
                    rest.push(child);
                }
            }
            rest.push(HtmlNode::Element(body));
            el.children = rest;
            Ok(())
        }));
        Ok(output)
    }
}
impl ExportDom for TableRowNode {
    fn export_dom<'a>(
        &'a self,
        ctx: &ExportCtx<'a>,
        key: NodeKey,
    ) -> lexical_html::Result<DomExportOutput<'a>> {
        let mut el = HtmlElement::new("tr");
        if let Some(height) = self
            .height
            .filter(|height| height.0 != 0.0 && !height.0.is_nan())
        {
            el.style_set_property("height", &pixels(height.0));
        }
        add_class_names(&mut el, &[ctx.theme.table_row.as_deref()]);
        element_export_dom(ctx, key, &mut el)?;
        Ok(DomExportOutput::element(el))
    }
}
impl ExportDom for TableCellNode {
    fn export_dom<'a>(
        &'a self,
        ctx: &ExportCtx<'a>,
        key: NodeKey,
    ) -> lexical_html::Result<DomExportOutput<'a>> {
        let header = !self.header_state.is_empty();
        let mut el = HtmlElement::new(if header { "th" } else { "td" });
        let width = self
            .width
            .filter(|width| width.0 != 0.0 && !width.0.is_nan());
        if let Some(width) = width {
            el.style_set_property("width", &pixels(width.0));
        }
        if self.col_span > 1 {
            el.set_attribute("colspan", self.col_span.to_string());
        }
        if self.row_span > 1 {
            el.set_attribute("rowspan", self.row_span.to_string());
        }
        if let Some(background) = &self.background_color {
            el.style_set_property("background-color", background);
        }
        if let Some(align @ ("middle" | "bottom")) = self.vertical_align.as_deref() {
            el.style_set_property("vertical-align", align);
        }
        add_class_names(
            &mut el,
            &[
                ctx.theme.table_cell.as_deref(),
                if header {
                    ctx.theme.table_cell_header.as_deref()
                } else {
                    None
                },
            ],
        );
        element_export_dom(ctx, key, &mut el)?;
        el.lexical_key = Some(key);
        el.style_set_property("border", "1px solid black");
        el.style_set_property("width", &pixels(width.map_or(75.0, |width| width.0)));
        el.style_set_property(
            "vertical-align",
            self.vertical_align
                .as_deref()
                .filter(|value| !value.is_empty())
                .unwrap_or("top"),
        );
        el.style_set_property("text-align", "start");
        if self.background_color.is_none() && header {
            el.style_set_property("background-color", "#f2f3f5");
        }
        Ok(DomExportOutput::element(el))
    }
}
