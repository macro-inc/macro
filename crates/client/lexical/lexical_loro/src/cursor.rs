use super::*;
use crate::policy::synced_owner;
use lexical_model::{ChildIndex, Point, Selection, Utf16Offset};
use loro::{
    LoroValue,
    cursor::{Cursor, PosType, Side},
};
/// Durable node id plus the native relative cursor, never an ephemeral NodeKey.
#[derive(Clone, Debug, PartialEq)]
pub struct NodeCursor {
    /// Application node-id plugin's durable id.
    pub node_id: String,
    /// Native CRDT relative position.
    pub cursor: Cursor,
}
/// Awareness anchor and focus cursors.
#[derive(Clone, Debug, PartialEq)]
pub struct SelectionCursors {
    /// Initial endpoint.
    pub anchor: NodeCursor,
    /// Extended endpoint.
    pub focus: NodeCursor,
}
impl LoroProjection {
    /// Convert a range/table selection without writing to the CRDT; node selections have no presence.
    pub fn cursor(
        &self,
        doc: &LoroDoc,
        state: &EditorState,
        selection: &Selection,
    ) -> Option<SelectionCursors> {
        let (a, f) = match selection {
            Selection::Range(r) => (r.anchor, r.focus),
            Selection::Table(s) => (s.anchor, s.focus),
            Selection::Node(_) => return None,
        };
        Some(SelectionCursors {
            anchor: self.point_cursor(doc, state, a)?,
            focus: self.point_cursor(doc, state, f)?,
        })
    }
    fn point_cursor(&self, doc: &LoroDoc, state: &EditorState, point: Point) -> Option<NodeCursor> {
        if synced_owner(state.view(), point.key(), self.policy) != Some(point.key())
            || self.policy.is_transparent(state.view(), point.key())
        {
            return None;
        }
        let slots = self.index.nodes.get(&point.key())?;
        let node_id = slots.id.clone()?;
        let cursor = if state.view().is_text(point.key()) {
            let Container::Text(text) = doc.get_container(slots.text.clone()?)? else {
                return None;
            };
            let unicode =
                text.convert_pos(point.offset() as usize, PosType::Utf16, PosType::Unicode)?;
            text.get_cursor(unicode, Side::Middle)?
        } else if let Some(children) = &slots.children {
            let Container::MovableList(list) = doc.get_container(children.clone())? else {
                return None;
            };
            list.get_cursor(point.offset() as usize, Side::Middle)?
        } else {
            let path = doc.get_path_to_container(&slots.map)?;
            let (parent, loro::Index::Seq(index)) = path.last()? else {
                return None;
            };
            let Container::MovableList(list) = doc.get_container(parent.clone())? else {
                return None;
            };
            list.get_cursor(*index, Side::Middle)?
        };
        Some(NodeCursor { node_id, cursor })
    }
    /// Resolve a durable cursor into a clamped model point; deleted/unindexed nodes return None.
    pub fn point(&self, doc: &LoroDoc, state: &EditorState, cursor: &NodeCursor) -> Option<Point> {
        let key = *self.index.ids.get(&cursor.node_id)?;
        if !state.view().is_attached(key)
            || synced_owner(state.view(), key, self.policy) != Some(key)
            || self.policy.is_transparent(state.view(), key)
        {
            return None;
        }
        let position = doc.get_cursor_pos(&cursor.cursor).ok()?.current.pos;
        if state.view().is_text(key) {
            let map = self.index.nodes.get(&key)?;
            let Container::Text(text) = doc.get_container(map.text.clone()?)? else {
                return None;
            };
            let offset = text.convert_pos(
                position.min(text.len_unicode()),
                PosType::Unicode,
                PosType::Utf16,
            )?;
            let size = state.view().text_content_size(key).0;
            return Some(Point::text(
                key,
                Utf16Offset(u32::try_from(offset).ok()?.min(size)),
            ));
        }
        let slots = self.index.nodes.get(&key)?;
        let own_children = doc
            .get_path_to_container(&cursor.cursor.container)
            .and_then(|p| p.last().cloned())
            .is_some_and(|(parent, _)| parent == slots.map)
            && matches!(
                doc.get_container(cursor.cursor.container.clone()),
                Some(Container::MovableList(_))
            );
        Some(Point::element(
            key,
            ChildIndex(if own_children {
                u32::try_from(position)
                    .ok()?
                    .min(state.view().children_size(key))
            } else {
                0
            }),
        ))
    }
}
/// Encode lexicalSelectionCodec's nodeId/string and cursor/binary fields.
pub fn encode_selection(cursors: &SelectionCursors) -> LoroValue {
    fn node(cursor: &NodeCursor) -> LoroValue {
        LoroValue::Map(
            vec![
                (
                    "nodeId".into(),
                    LoroValue::String(cursor.node_id.as_str().into()),
                ),
                (
                    "cursor".into(),
                    LoroValue::Binary(cursor.cursor.encode().into()),
                ),
            ]
            .into(),
        )
    }
    LoroValue::Map(
        vec![
            ("anchor".into(), node(&cursors.anchor)),
            ("focus".into(), node(&cursors.focus)),
        ]
        .into(),
    )
}
/// Decode only the expected awareness shape; invalid cursor bytes return None.
pub fn decode_selection(value: &LoroValue) -> Option<SelectionCursors> {
    fn node(value: &LoroValue) -> Option<NodeCursor> {
        let LoroValue::Map(map) = value else {
            return None;
        };
        let LoroValue::String(id) = map.get("nodeId")? else {
            return None;
        };
        let LoroValue::Binary(bytes) = map.get("cursor")? else {
            return None;
        };
        Some(NodeCursor {
            node_id: id.to_string(),
            cursor: Cursor::decode(bytes).ok()?,
        })
    }
    let LoroValue::Map(map) = value else {
        return None;
    };
    Some(SelectionCursors {
        anchor: node(map.get("anchor")?)?,
        focus: node(map.get("focus")?)?,
    })
}
