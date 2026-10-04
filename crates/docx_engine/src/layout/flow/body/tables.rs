//! Body tables: rows across columns and pages, and floating tables
//! (`w:tblpPr`), which sit at a position of their own.

use super::super::super::{Item, StoryRef};
use super::super::anchors::PageGeom;
use super::super::split::split_row;
use super::super::stack::{RowBox, Sink, TableBox, emit_row, table_box};
use super::floats::{OnPage, place_anchors};
use super::{EPS, Flow};
use crate::model::block::Block;
use crate::model::props::TablePosition;

/// Where a floating table's left edge goes on the page.
pub(in crate::layout::flow) fn float_x(pos: &TablePosition, g: &PageGeom, width: f32) -> f32 {
    let (x0, span) = match pos.h_anchor.as_str() {
        "margin" => (g.left, g.width - g.left - g.right),
        "page" => (0.0, g.width),
        _ => (g.col_left, g.col_width),
    };
    match pos.x_align.as_deref() {
        Some("center") => x0 + (span - width) / 2.0,
        Some("right" | "outside") => x0 + span - width,
        Some("left" | "inside") => x0,
        _ => x0 + pos.x,
    }
}

/// Where a floating table `height` tall starts on the page, `y` being the
/// top of the text it is anchored to.
pub(in crate::layout::flow) fn float_y(
    pos: &TablePosition,
    g: &PageGeom,
    y: f32,
    height: f32,
) -> f32 {
    let (y0, span) = match pos.v_anchor.as_str() {
        "page" => (0.0, g.height),
        "margin" => (g.top, g.height - g.top - g.bottom),
        _ => (y, 0.0),
    };
    match pos.y_align.as_deref() {
        Some("inline") => y,
        Some("center") => y0 + (span - height) / 2.0,
        Some("bottom" | "outside") => y0 + span - height,
        Some("top" | "inside") => y0,
        _ => y0 + pos.y,
    }
}

/// Whether a row stays on the page of the row after it: rows with a
/// paragraph kept with the next one do.
fn keeps_with_next(row: &RowBox) -> bool {
    row.cells.iter().any(|c| {
        c.content
            .items
            .iter()
            .any(|i| matches!(i, Item::Line(l) if l.para.format.props.keep_next))
    })
}

/// The last row that goes to a page together with row `r`. Header rows
/// also keep with the first row they head (when the table has one).
fn keep_chain_end(tb: &TableBox, r: usize) -> usize {
    let headed = tb.rows.iter().any(|row| !row.header);
    let mut end = r;
    while end + 1 < tb.rows.len()
        && ((headed && tb.rows[end].header) || keeps_with_next(&tb.rows[end]))
    {
        end += 1;
    }
    end
}

impl Flow<'_, '_> {
    pub(super) fn place_table(&mut self, b: &Block) {
        let (mut col_left, width) = self.col_geom();
        if let (Some(prev), Some(c)) = (self.prev.take(), &mut self.cur)
            && c.placed_any
        {
            c.y += prev.after;
        }
        let mut tb = table_box(
            self.env,
            &self.env.doc.body,
            b,
            width,
            &StoryRef::Body,
            &self.fields(),
        );
        // A floating table takes no room beside it (text goes on below it)
        // but sits at its own position.
        let float = tb.geom.tbl.position.clone();
        let height: f32 = tb.rows.iter().map(|r| r.height).sum();
        if let Some(pos) = &float {
            let g = self.page_geom();
            tb.geom.left = float_x(pos, &g, tb.geom.width()) - col_left;
            self.float_down(pos, height, true);
        }
        let headers: Vec<usize> = (0..tb.rows.len())
            .take_while(|&r| tb.rows[r].header)
            .collect();
        let mut r = 0;
        // The row was moved to a fresh column already: place it even if it
        // does not fit, or a row taller than the page would never land.
        let mut moved = false;
        while r < tb.rows.len() {
            self.skip_bands();
            let h = tb.rows[r].height;
            let (y, top, placed_any) = self
                .cur
                .as_ref()
                .map_or((0.0, 0.0, false), |c| (c.y, c.top, c.placed_any));
            let avail = self.avail_bottom();
            // Rows kept with the next one go to the next column together
            // when they do not fit here but would there.
            let chain: f32 = tb.rows[r..=keep_chain_end(&tb, r)]
                .iter()
                .map(|row| row.height)
                .sum();
            let keep = placed_any && !moved && chain > h && y + chain > avail + EPS;
            let mut next = keep && chain <= avail - top;
            if !next && y + h > avail + EPS {
                if self.jump_band(h) {
                    continue;
                }
                // A row that may break keeps the lines that fit here and
                // goes on in the next column.
                let split = split_row(&tb, r, avail - y);
                next = split.is_some() || (placed_any && !moved);
                if let Some((first, rest)) = split {
                    tb.rows[r] = first;
                    self.emit_table_row(&tb, r, col_left);
                    tb.rows[r] = rest;
                }
            }
            if next {
                self.next_column(false);
                moved = true;
                // Rows go on in the new column; a floating table keeps its
                // place across the page.
                let (left, _) = self.col_geom();
                if float.is_some() {
                    tb.geom.left += col_left - left;
                }
                col_left = left;
                if let Some(pos) = &float {
                    self.float_down(pos, height, false);
                }
                // Repeat header rows at the top of the new page.
                if r >= headers.len() && !headers.is_empty() {
                    for &hr in &headers {
                        self.emit_table_row(&tb, hr, col_left);
                    }
                }
                continue;
            }
            self.emit_table_row(&tb, r, col_left);
            moved = false;
            r += 1;
        }
        if let (Some(pos), Some(c)) = (&float, &mut self.cur) {
            c.y += pos.bottom_from_text;
        }
        self.prev = None;
    }

    /// Moves down to where floating table rows start on this page: below
    /// the anchoring text on the first page (`first`), at the same place on
    /// the page after that for tables positioned on the page.
    fn float_down(&mut self, pos: &TablePosition, height: f32, first: bool) {
        let on_page = pos.v_anchor != "text";
        if !first && !on_page {
            return;
        }
        let g = self.page_geom();
        if let Some(c) = &mut self.cur {
            let top = float_y(pos, &g, c.y, height);
            // On a page with nothing on it yet, a table placed on the page
            // goes to its place even above the body (over a tall header).
            c.y = if on_page && !c.placed_any {
                top
            } else {
                c.y.max(top)
            };
        }
    }

    fn emit_table_row(&mut self, tb: &TableBox, r: usize, col_left: f32) {
        let y = self.cur.as_ref().map_or(0.0, |c| c.y);
        let mut items = Vec::new();
        let mut anchors = Vec::new();
        let mut notes: Vec<(bool, i64)> = Vec::new();
        let sink = Sink {
            items: &mut items,
            anchors: &mut anchors,
            notes: &mut notes,
        };
        emit_row(tb, r, col_left, y, sink);
        let ids: Vec<i64> = notes
            .iter()
            .filter(|(e, _)| !e)
            .map(|(_, id)| *id)
            .collect();
        self.add_notes(&ids);
        let geom = self.page_geom();
        let fields = self.fields();
        let on_page = OnPage {
            env: self.env,
            fields: &fields,
            geom: &geom,
        };
        if let Some(c) = &mut self.cur {
            c.body.extend(items);
            place_anchors(&on_page, &anchors, &mut c.behind, &mut c.front);
            c.y += tb.rows[r].height;
            c.placed_any = true;
            c.hard = false;
        }
    }
}
