//! Splitting table rows across pages: each cell's content breaks between
//! its lines, the rest continuing in the same row on the next page.

use super::super::{Item, PlacedLine};
use super::stack::{RowBox, Stack, TableBox};
use crate::model::props::HeightRule;
use pptx_engine::path::Rect;

const EPS: f32 = 0.01;

/// Lines of a stack as (top, bottom).
fn line_spans(stack: &Stack) -> Vec<(f32, f32)> {
    stack
        .items
        .iter()
        .filter_map(|i| match i {
            Item::Line(l) => Some((l.y, l.y + l.line().height)),
            _ => None,
        })
        .collect()
}

/// Whether content may break after this line: not where widow and orphan
/// control would leave a single line of its paragraph on either side.
fn breaks_after(l: &PlacedLine) -> bool {
    let n = l.para.lines.lines.len();
    let before = l.line + 1;
    before >= n || !l.para.format.props.widow_control || (before >= 2 && n - before >= 2)
}

/// The lowest line bottom at or above `limit` that no line crosses and
/// that splits no paragraph against its widow control (0 when there is
/// none).
pub fn line_cut(stack: &Stack, limit: f32) -> f32 {
    let lines = line_spans(stack);
    stack
        .items
        .iter()
        .filter_map(|i| match i {
            Item::Line(l) if breaks_after(l) => Some(l.y + l.line().height),
            _ => None,
        })
        .filter(|&cut| {
            cut <= limit + EPS && !lines.iter().any(|&(t, b)| t < cut - EPS && b > cut + EPS)
        })
        .fold(0.0, f32::max)
}

/// Splits a stack at `cut` (a line boundary): what is above it, and what is
/// below it moved up so its first line starts at the top.
pub fn split_stack(stack: &Stack, cut: f32) -> (Stack, Stack) {
    let shift = line_spans(stack)
        .iter()
        .map(|&(top, _)| top)
        .filter(|&top| top >= cut - EPS)
        .fold(f32::MAX, f32::min);
    let shift = if shift == f32::MAX { cut } else { shift };
    let mut a = Stack {
        height: cut,
        notes: stack.notes.clone(),
        ..Stack::default()
    };
    let mut b = Stack {
        height: (stack.height - shift).max(0.0),
        ..Stack::default()
    };
    for item in &stack.items {
        match item {
            Item::Line(l) => {
                if l.y < cut - EPS {
                    a.items.push(item.clone());
                } else {
                    let mut l = l.clone();
                    l.y -= shift;
                    b.items.push(Item::Line(l));
                }
            }
            Item::Fill { rect, color } => {
                let (top, bottom) = (rect.y, rect.y + rect.h);
                if top < cut - EPS {
                    a.items.push(Item::Fill {
                        rect: Rect::from_xywh(rect.x, top, rect.w, bottom.min(cut) - top),
                        color: *color,
                    });
                }
                if bottom > cut + EPS {
                    let from = top.max(shift);
                    if bottom > from {
                        b.items.push(Item::Fill {
                            rect: Rect::from_xywh(rect.x, from - shift, rect.w, bottom - from),
                            color: *color,
                        });
                    }
                }
            }
            Item::Rule {
                x0,
                y0,
                x1,
                y1,
                border,
            } => {
                let (top, bottom) = (y0.min(*y1), y0.max(*y1));
                if bottom <= cut + EPS {
                    a.items.push(item.clone());
                } else if top >= cut - EPS {
                    b.items.push(Item::Rule {
                        x0: *x0,
                        y0: y0 - shift,
                        x1: *x1,
                        y1: y1 - shift,
                        border: *border,
                    });
                } else if (x0 - x1).abs() < EPS {
                    // A vertical rule continues on both sides of the cut.
                    a.items.push(Item::Rule {
                        x0: *x0,
                        y0: top,
                        x1: *x1,
                        y1: cut,
                        border: *border,
                    });
                    b.items.push(Item::Rule {
                        x0: *x0,
                        y0: 0.0,
                        x1: *x1,
                        y1: (bottom - shift).max(0.0),
                        border: *border,
                    });
                } else {
                    a.items.push(item.clone());
                }
            }
            Item::Drawing(d) => {
                if d.rect.y < cut - EPS {
                    a.items.push(item.clone());
                } else {
                    let mut d = d.clone();
                    d.rect.y -= shift;
                    b.items.push(Item::Drawing(d));
                }
            }
            Item::LineNumber { baseline, .. } => {
                if *baseline < cut {
                    a.items.push(item.clone());
                }
            }
        }
    }
    for anchor in &stack.anchors {
        if anchor.para_top < cut - EPS {
            a.anchors.push(anchor.clone());
        } else {
            let mut anchor = anchor.clone();
            anchor.shift(0.0, -shift);
            b.anchors.push(anchor);
        }
    }
    (a, b)
}

/// Splits row `r` so its first part fits in `room` points: every cell keeps
/// the lines that fit and continues below them. `None` when the row may
/// not break (cannot split, exact height, merged cells) or nothing of its
/// overflowing cells fits.
pub fn split_row(tb: &TableBox, r: usize, room: f32) -> Option<(RowBox, RowBox)> {
    let row = &tb.rows[r];
    let exact = matches!(
        tb.geom.rows.get(r).and_then(|g| g.tr.height),
        Some((_, HeightRule::Exact))
    );
    // Repeated header rows never break either.
    if row.cant_split || row.header || exact || row.cells.iter().any(|c| c.rows != 1) {
        return None;
    }
    let mut first = row.clone();
    let mut rest = row.clone();
    rest.header = false;
    let (mut h1, mut h2) = (0.0f32, 0.0f32);
    let mut fits_some = false;
    let mut continues = false;
    for (k, cell) in row.cells.iter().enumerate() {
        let m = &cell.geom.margins;
        let limit = room - m[0] - m[2] - row.border_top;
        let content = &cell.content;
        let (a, b) = if content.height <= limit + EPS {
            (content.clone(), Stack::default())
        } else {
            let cut = line_cut(content, limit);
            fits_some |= cut > EPS;
            continues = true;
            split_stack(content, cut)
        };
        h1 = h1.max(a.height + m[0] + m[2]);
        h2 = h2.max(b.height + m[0] + m[2]);
        first.cells[k].content = a;
        rest.cells[k].content = b;
    }
    if !fits_some || !continues {
        return None;
    }
    // Like a paragraph under widow control, a row leaves no single line
    // behind or alone at the top of the next page.
    let lines = |row: &RowBox| {
        row.cells
            .iter()
            .map(|c| {
                c.content
                    .items
                    .iter()
                    .filter(|i| matches!(i, Item::Line(_)))
                    .count()
            })
            .max()
            .unwrap_or(0)
    };
    let widow_control = row.cells.iter().any(|c| {
        c.content
            .items
            .iter()
            .any(|i| matches!(i, Item::Line(l) if l.para.format.props.widow_control))
    });
    if widow_control && (lines(&first) < 2 || lines(&rest) < 2) {
        return None;
    }
    // The first part ends at the page; the rest makes room for its top
    // border again, and keeps the bottom one.
    first.height = (h1 + row.border_top).min(room);
    first.border_bottom = 0.0;
    rest.height = h2 + row.border_top + row.border_bottom;
    Some((first, rest))
}
