//! Resolve abstract positions only against the actual current editor state.
use crate::Pos;
use lexical_model::{ChildIndex, EditorState, NodeKey, Point, Utf16Offset};

pub(crate) fn resolve(state: &EditorState, pos: Pos) -> Option<Point> {
    let view = state.view();
    let blocks = view
        .descendants(NodeKey::ROOT)
        .map(|(key, _)| key)
        .filter(|key| view.is_block_element(*key))
        .filter(|key| {
            !view
                .descendants(*key)
                .any(|(child, _)| view.is_block_element(child))
        })
        .collect::<Vec<_>>();
    let block = *blocks.get(usize::from(pos.block) % blocks.len().max(1))?;
    let texts = view.all_text_nodes(block).collect::<Vec<_>>();
    if texts.is_empty() {
        return Some(Point::element(block, ChildIndex(0)));
    }
    let length = texts
        .iter()
        .map(|key| view.text_content_size(*key).0)
        .sum::<u32>();
    let mut offset = u32::from(pos.offset) % (length + 1);
    for key in texts {
        let text = view.text_content(key);
        let units = text.encode_utf16().collect::<Vec<_>>();
        let size = u32::try_from(units.len()).ok()?;
        if offset <= size {
            let index = usize::try_from(offset).ok()?;
            if index > 0
                && index < units.len()
                && (0xd800..=0xdbff).contains(&units[index - 1])
                && (0xdc00..=0xdfff).contains(&units[index])
            {
                offset -= 1;
            }
            return Some(Point::text(key, Utf16Offset(offset)));
        }
        offset -= size;
    }
    None
}
