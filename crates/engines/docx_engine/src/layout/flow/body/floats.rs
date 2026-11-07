//! Floating things in the body: text frames, the bands of the page that
//! floats leave no room beside, and drawings placed on the page.

use super::super::super::drawing::Wrap;
use super::super::super::format::TableCtx;
use super::super::super::inline::{FieldValues, Kind};
use super::super::super::{Item, StoryRef};
use super::super::Env;
use super::super::anchors::{PageGeom, resolve};
use super::super::frames::{
    FrameWrap, PendingFrame, across_text, emit_frame, frame_box, resolve_frame,
};
use super::super::stack::{PendingAnchor, StackCtx, placed};
use super::super::textbox::text_box_items;
use super::paragraphs::Placing;
use super::{EPS, Flow};
use crate::model::block::Block;
use std::sync::Arc;

/// A frame at least this fraction of the column wide leaves no room for
/// text beside it.
const WIDE_FRAME: f32 = 0.66;

/// A stretch of the page that body text skips, below and above a float
/// that leaves no room beside it: from `top` to `bottom`, in the columns
/// the float reaches into (between `left` and `right`).
#[derive(Clone, Copy, Debug)]
pub(super) struct Band {
    pub(super) top: f32,
    pub(super) bottom: f32,
    pub(super) left: f32,
    pub(super) right: f32,
}

impl Band {
    /// Whether the band reaches into the column from `left`, `width` wide.
    fn crosses(&self, left: f32, width: f32) -> bool {
        self.left < left + width - EPS && self.right > left + EPS
    }
}

impl Flow<'_, '_> {
    /// The bands that cross the current column.
    fn column_bands(&self) -> Vec<Band> {
        let (left, width) = self.col_geom();
        self.cur.as_ref().map_or(Vec::new(), |c| {
            c.bands
                .iter()
                .filter(|b| b.crosses(left, width))
                .copied()
                .collect()
        })
    }

    pub(super) fn avail_bottom(&self) -> f32 {
        let bands = self.column_bands();
        self.cur.as_ref().map_or(0.0, |c| {
            // Text stops at the next blocked band below it.
            bands
                .iter()
                .filter(|b| b.top >= c.y - EPS)
                .fold(c.bottom - c.notes_height, |bottom, b| bottom.min(b.top))
        })
    }

    /// Moves the current position past a blocked band it is in.
    pub(super) fn skip_bands(&mut self) {
        let bands = self.column_bands();
        if let Some(c) = &mut self.cur {
            while let Some(b) = bands
                .iter()
                .find(|b| b.top <= c.y + EPS && b.bottom > c.y + EPS)
            {
                c.y = b.bottom;
            }
        }
    }

    /// Places the text frame starting at `blocks[i]`, if it starts one, and
    /// returns the index after its paragraphs.
    pub(super) fn place_frame(&mut self, blocks: &[&Block], i: usize) -> Option<usize> {
        let (col_left, width) = self.col_geom();
        let sc = StackCtx {
            story: StoryRef::Body,
            width,
            table: TableCtx::default(),
            fields: self.fields(),
            note_number: None,
            float_frames: false,
            page: Some(self.page_geom()),
        };
        let (mut f, end) = frame_box(self.env, &self.env.doc.body, blocks, i, &sc)?;
        self.skip_bands();
        let (y, placed_any) = self
            .cur
            .as_ref()
            .map_or((0.0, false), |c| (c.y, c.placed_any));
        f.para_top = y;
        f.text_left = col_left;
        let wrap = f.wrap();
        // Text cannot go beside a frame across it that leaves no room.
        let blocks_text = (wrap == FrameWrap::NotBeside
            || (wrap == FrameWrap::Beside && f.width >= width * WIDE_FRAME))
            && across_text(&f, &self.page_geom());
        let in_flow = f.follows_text() && blocks_text;
        if in_flow && y + f.height > self.avail_bottom() + EPS && placed_any {
            self.next_column(false);
            f.para_top = self.cur.as_ref().map_or(0.0, |c| c.y);
        }
        let geom = self.page_geom();
        let fields = self.fields();
        let rect = resolve_frame(&f, &geom);
        let mut items = Vec::new();
        let mut anchors = Vec::new();
        emit_frame(&f, rect, &mut items, &mut anchors);
        let on_page = OnPage {
            env: self.env,
            fields: &fields,
            geom: &geom,
        };
        if let Some(c) = &mut self.cur {
            c.body.extend(items);
            place_anchors(&on_page, &anchors, &mut c.behind, &mut c.front);
            if in_flow {
                c.y = c.y.max(rect.y + rect.h + f.props.v_space);
                c.placed_any = true;
            } else if blocks_text {
                c.bands.push(Band {
                    top: rect.y - f.props.v_space,
                    bottom: rect.y + rect.h + f.props.v_space,
                    left: rect.x,
                    right: rect.x + rect.w,
                });
            }
        }
        Some(end)
    }

    /// Reserves the bands of the floating drawings in the lines still to
    /// place of a paragraph that goes on at the current position, `above`
    /// points below the paragraph's own top (its space before). When such
    /// a band does not fit, the paragraph moves to the next column first.
    /// Returns the paragraph top the drawings are positioned from.
    pub(super) fn reserve_float_bands(&mut self, p: &mut Placing, above: f32) -> f32 {
        let Some((top, bottom, placed_any)) = self
            .cur
            .as_ref()
            .map(|c| (c.y, c.bottom - c.notes_height, c.placed_any))
        else {
            return 0.0;
        };
        let mut para_top = top - above;
        let mut bands = self.float_bands(p, top, para_top);
        if placed_any && bands.iter().any(|b| b.bottom > bottom + EPS) {
            // The paragraph starts the next column, with no space above.
            self.next_column(false);
            self.follow_column(p);
            para_top = self.cur.as_ref().map_or(0.0, |c| c.y);
            bands = self.float_bands(p, para_top, para_top);
        }
        if let Some(c) = &mut self.cur {
            c.bands.extend(bands);
        }
        para_top
    }

    /// The bands of the floating drawings that leave no room for text
    /// beside them in the lines of `p` still to place, when those lines
    /// start at `top` in a paragraph starting at `para_top`.
    fn float_bands(&self, p: &Placing, top: f32, para_top: f32) -> Vec<Band> {
        let pb = &p.pb;
        let geom = self.page_geom();
        let lines = &pb.lines.lines;
        let base = lines.get(p.li).map_or(0.0, |l| l.top);
        let mut bands = Vec::new();
        for line in lines.iter().skip(p.li) {
            for k in line.start..line.end {
                let Kind::Anchor(o) = pb.inline.clusters[k].kind else {
                    continue;
                };
                let d = &pb.inline.objects[o as usize];
                let Some(anchor) = &d.anchor else {
                    continue;
                };
                let a = PendingAnchor {
                    drawing: Arc::new(d.clone()),
                    para_top,
                    line_top: top + line.top - base,
                    char_x: p.col_left + pb.lines.x[k],
                    story: pb.story.clone(),
                    block: pb.block.clone(),
                    object: o,
                    cell: None,
                };
                let Some(r) = resolve(&a, &geom) else {
                    continue;
                };
                let no_room = match anchor.wrap {
                    Wrap::TopAndBottom => true,
                    Wrap::Square | Wrap::Tight => r.w >= p.width * WIDE_FRAME,
                    Wrap::None => false,
                };
                let band = Band {
                    top: r.y - anchor.dist[0],
                    bottom: r.y + r.h + anchor.dist[1],
                    left: r.x,
                    right: r.x + r.w,
                };
                if no_room && !anchor.behind && band.crosses(p.col_left, p.width) {
                    bands.push(band);
                }
            }
        }
        bands
    }

    /// When a band starts within `next` points below the current position
    /// and there is room below it, moves past it and says so.
    pub(super) fn jump_band(&mut self, next: f32) -> bool {
        let bands = self.column_bands();
        let Some(c) = &mut self.cur else {
            return false;
        };
        let bottom = c.bottom - c.notes_height;
        let band = bands
            .iter()
            .filter(|b| b.top >= c.y - EPS && b.top < c.y + next + EPS)
            .map(|b| b.bottom)
            .fold(None, |acc: Option<f32>, b| {
                Some(acc.map_or(b, |a| a.max(b)))
            });
        match band {
            Some(b) if b + next <= bottom + EPS => {
                c.y = b;
                true
            }
            _ => false,
        }
    }
}

/// The page floating drawings and frames go on.
pub(super) struct OnPage<'p, 'a> {
    /// For the text in text boxes.
    pub(super) env: &'p Env<'a>,
    /// The page's field values.
    pub(super) fields: &'p FieldValues,
    /// The page.
    pub(super) geom: &'p PageGeom,
}

/// Places a header's or footer's text frames, given where its stack went.
pub(super) fn place_frames(
    page: &OnPage<'_, '_>,
    frames: &mut [PendingFrame],
    origin: (f32, f32),
    out: &mut Vec<Item>,
    behind: &mut Vec<Item>,
    front: &mut Vec<Item>,
) {
    for f in frames {
        f.offset(origin.0, origin.1);
        let rect = resolve_frame(f, page.geom);
        let mut anchors = Vec::new();
        emit_frame(f, rect, out, &mut anchors);
        place_anchors(page, &anchors, behind, front);
    }
}

/// Places floating drawings behind or in front of the text, with the text
/// of text boxes over their shapes.
pub(super) fn place_anchors(
    page: &OnPage<'_, '_>,
    anchors: &[PendingAnchor],
    behind: &mut Vec<Item>,
    front: &mut Vec<Item>,
) {
    let mut sorted: Vec<&PendingAnchor> = anchors.iter().collect();
    sorted.sort_by_key(|a| a.drawing.anchor.as_ref().map_or(0, |x| x.z));
    for a in sorted {
        let Some(rect) = resolve(a, page.geom) else {
            continue;
        };
        let out = if a.drawing.anchor.as_ref().is_some_and(|x| x.behind) {
            &mut *behind
        } else {
            &mut *front
        };
        out.push(placed(Arc::clone(&a.drawing), rect, a.story.clone()));
        out.extend(text_box_items(page.env, page.fields, a, rect));
    }
}

#[cfg(test)]
mod test;
