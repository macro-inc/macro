//! One current model read for the Source draft quote getter.
use super::*;
use serde::{de, Deserialize, Deserializer};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    #[serde(rename = "nodeId")]
    node_id: String,
    cursor: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    #[serde(deserialize_with = "object")]
    anchor: Cursor,
    #[serde(deserialize_with = "object")]
    focus: Cursor,
    #[serde(rename = "markId")]
    mark_id: String,
}

// deserialize_map rejects positional struct arrays while preserving original
// duplicate fields for the derived DTO decoders, including nested cursors.
fn object<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct Object<T>(std::marker::PhantomData<T>);
    impl<'de, T: Deserialize<'de>> de::Visitor<'de> for Object<T> {
        type Value = T;
        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("an object")
        }
        fn visit_map<A: de::MapAccess<'de>>(self, map: A) -> Result<T, A::Error> {
            T::deserialize(de::value::MapAccessDeserializer::new(map))
        }
    }
    deserializer.deserialize_map(Object(std::marker::PhantomData))
}

fn request(text: &str) -> Result<Request, BoundaryError> {
    let mut decoder = serde_json::Deserializer::from_str(text);
    let value = object(&mut decoder)?;
    decoder.end()?;
    Ok(value)
}

fn cursor_value(cursor: Cursor) -> loro::LoroValue {
    loro::LoroValue::Map(
        std::collections::HashMap::from([
            (
                "nodeId".into(),
                loro::LoroValue::String(cursor.node_id.into()),
            ),
            (
                "cursor".into(),
                loro::LoroValue::Binary(cursor.cursor.into()),
            ),
        ])
        .into(),
    )
}

fn reply(count: u32, text: String) -> wire::QueryReplyMsg {
    wire::QueryReplyMsg {
        text,
        count,
        keys: vec![],
        nodes: vec![],
        points: vec![],
    }
}

pub(super) fn query(
    session: &crate::EditorSession,
    msg: &wire::QueryMsg,
) -> Result<wire::QueryReplyMsg, BoundaryError> {
    if msg.key != 0 || msg.flags != 0 {
        return Err(BoundaryError::Invalid("comment draft text fields"));
    }
    let request = request(&msg.text)?;
    let view = session.surface().state().view();
    // Source reads current marked text first, and resolves the stored range
    // only when the trimmed, block-joined mark text is empty.
    let marked = macro_document_model::nodes::get_comment_mark_text(view, &request.mark_id)?;
    if !marked.is_empty() {
        return Ok(reply(1, marked));
    }
    let cursors = loro::LoroValue::Map(
        std::collections::HashMap::from([
            ("anchor".into(), cursor_value(request.anchor)),
            ("focus".into(), cursor_value(request.focus)),
        ])
        .into(),
    );
    let Some(ViewSelection::Range { anchor, focus, .. }) = session.resolve_selection(&cursors)
    else {
        // count=0 is unavailable, distinct from a resolved empty string.
        return Ok(reply(0, String::new()));
    };
    let text = RangeSelection::new(anchor, focus).text_content(view)?;
    Ok(reply(1, text))
}

#[cfg(test)]
mod test;
