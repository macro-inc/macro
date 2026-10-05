//! Text boxes: the text of a floating shape, laid out in the shape once the
//! shape has its place on the page.

use super::super::drawing::TextAnchor;
use super::super::inline::FieldValues;
use super::super::{Item, StoryRef};
use super::stack::{PendingAnchor, StackCtx, stack_story};
use super::{Env, offset_items};
use crate::model::block::IdGen;
use crate::model::parse::StoryReader;
use pptx_engine::path::Rect;

/// The text of the shape of `a` laid out in `rect`, where the shape went.
pub(super) fn text_box_items(
    env: &Env<'_>,
    fields: &FieldValues,
    a: &PendingAnchor,
    rect: Rect,
) -> Vec<Item> {
    let Some(tb) = a.drawing.text_box() else {
        return Vec::new();
    };
    let mut ids = IdGen::sequential();
    let story = StoryReader::new(&a.drawing.tree, &mut ids)
        .read(tb.content)
        .story;
    let [left, top, right, bottom] = tb.insets;
    let stack = stack_story(
        env,
        &story,
        None,
        &StackCtx {
            story: StoryRef::TextBox(a.block.clone(), a.object),
            width: (rect.w - left - right).max(1.0),
            table: Default::default(),
            fields: fields.clone(),
            note_number: None,
            float_frames: false,
            page: None,
        },
    );
    let room = rect.h - top - bottom;
    let dy = match tb.anchor {
        TextAnchor::Top => 0.0,
        TextAnchor::Middle => (room - stack.height) / 2.0,
        TextAnchor::Bottom => room - stack.height,
    }
    .max(0.0);
    let mut items = stack.items;
    offset_items(&mut items, rect.x + left, rect.y + top + dy);
    // Text that does not fit in the shape is cut off at its edges.
    for it in &mut items {
        if let Item::Line(l) = it {
            l.clip = Some(rect);
        }
    }
    items
}
