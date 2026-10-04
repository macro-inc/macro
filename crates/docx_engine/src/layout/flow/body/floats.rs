//! Floating things in the body: text frames, the bands of the page that
//! floats leave no room beside, and drawings placed on the page.

use super::super::super::drawing::Wrap;
use super::super::super::format::TableCtx;
use super::super::super::inline::{FieldValues, Kind};
use super::super::super::{Item, ParaBox, StoryRef};
use super::super::Env;
use super::super::anchors::{PageGeom, resolve};
use super::super::frames::{
    FrameWrap, PendingFrame, across_text, emit_frame, frame_box, resolve_frame,
};
use super::super::stack::{PendingAnchor, StackCtx, placed};
use super::super::textbox::text_box_items;
use super::{EPS, Flow};
use crate::model::block::Block;
use std::sync::Arc;

/// A frame at least this fraction of the column wide leaves no room for
/// text beside it.
const WIDE_FRAME: f32 = 0.66;

impl Flow<'_, '_> {
    pub(super) fn avail_bottom(&self) -> f32 {
        self.cur.as_ref().map_or(0.0, |c| {
            // Text stops at the next blocked band below it.
            c.bands
                .iter()
                .filter(|(top, _)| *top >= c.y - EPS)
                .fold(c.bottom - c.notes_height, |b, (top, _)| b.min(*top))
        })
    }

    /// Moves the current position past a blocked band it is in.
    pub(super) fn skip_bands(&mut self) {
        if let Some(c) = &mut self.cur {
            while let Some(&(_, bottom)) = c
                .bands
                .iter()
                .find(|(top, bottom)| *top <= c.y + EPS && *bottom > c.y + EPS)
            {
                c.y = bottom;
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
                c.bands
                    .push((rect.y - f.props.v_space, rect.y + rect.h + f.props.v_space));
            }
        }
        Some(end)
    }

    /// Reserves the bands of the floating drawings in `pb` that leave no
    /// room for text beside them, for a paragraph whose first line starts
    /// at the current position, `above` points below the paragraph's own
    /// top (its space before); moves to the next column first when such a
    /// drawing does not fit. Returns the paragraph top the drawings are
    /// positioned from.
    pub(super) fn reserve_float_bands(
        &mut self,
        pb: &Arc<ParaBox>,
        col_left: f32,
        width: f32,
        above: f32,
    ) -> f32 {
        let mut above = above;
        for attempt in 0..2 {
            let Some(c) = &self.cur else {
                return 0.0;
            };
            let top = c.y;
            let para_top = top - above;
            let geom = self.page_geom();
            let mut bands = Vec::new();
            for line in &pb.lines.lines {
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
                        line_top: top + line.top,
                        char_x: col_left + pb.lines.x[k],
                        story: pb.story.clone(),
                        block: pb.block.clone(),
                        object: o,
                        cell: None,
                    };
                    let Some(r) = resolve(&a, &geom) else {
                        continue;
                    };
                    let beside_column = r.x + r.w <= col_left || r.x >= col_left + width;
                    let no_room = match anchor.wrap {
                        Wrap::TopAndBottom => true,
                        Wrap::Square | Wrap::Tight => r.w >= width * WIDE_FRAME,
                        Wrap::None => false,
                    };
                    if no_room && !beside_column && !anchor.behind {
                        bands.push((r.y - anchor.dist[0], r.y + r.h + anchor.dist[1]));
                    }
                }
            }
            let bottom = c.bottom - c.notes_height;
            let overflows = bands.iter().any(|&(_, b)| b > bottom + EPS);
            if attempt == 0 && overflows && c.placed_any {
                // The paragraph starts the next column, with no space above.
                self.next_column(false);
                above = 0.0;
                continue;
            }
            if let Some(c) = &mut self.cur {
                c.bands.extend(bands);
            }
            return para_top;
        }
        self.cur.as_ref().map_or(0.0, |c| c.y)
    }

    /// When a band starts within `next` points below the current position
    /// and there is room below it, moves past it and says so.
    pub(super) fn jump_band(&mut self, next: f32) -> bool {
        let Some(c) = &mut self.cur else {
            return false;
        };
        let bottom = c.bottom - c.notes_height;
        let band = c
            .bands
            .iter()
            .filter(|(top, _)| *top >= c.y - EPS && *top < c.y + next + EPS)
            .map(|&(_, b)| b)
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
