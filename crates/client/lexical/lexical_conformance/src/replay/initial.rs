//! Restore the recorder's explicit committed seed before interpreting a partial trace.
use super::*;

fn key(value: &Value) -> Result<NodeKey> {
    let raw = string(value)?;
    if raw == "root" {
        return Ok(NodeKey::ROOT);
    }
    let index = raw
        .parse::<u32>()
        .map_err(|_| fail("invalid initial key"))?;
    if index == 0 {
        return Err(fail("initial numeric key cannot alias root"));
    }
    Ok(NodeKey::from_parts(KeyParts {
        generation: 0,
        index,
    }))
}
fn point(value: &Value) -> Result<Point> {
    let node = key(&value["key"])?;
    let offset =
        u32::try_from(integer(&value["offset"])?).map_err(|_| fail("initial point offset"))?;
    match string(&value["type"])? {
        "text" => Ok(Point::text(node, Utf16Offset(offset))),
        "element" => Ok(Point::element(node, ChildIndex(offset))),
        _ => Err(fail("initial point type")),
    }
}
impl Replayer {
    pub(super) fn restore_initial(&mut self, editor: &mut Editor, initial: &Value) -> Result<()> {
        if initial.as_object().is_none_or(|value| {
            value.len() != 5
                || !["editorState", "selection", "keys", "nodeMapKeys", "nextKey"]
                    .iter()
                    .all(|field| value.contains_key(*field))
        }) {
            return Err(fail("initial field set mismatch"));
        }
        let layout = initial["keys"]
            .as_array()
            .ok_or_else(|| fail("initial keys"))?
            .iter()
            .map(key)
            .collect::<Result<Vec<_>>>()?;
        for (raw, node) in initial["keys"]
            .as_array()
            .ok_or_else(|| fail("initial keys"))?
            .iter()
            .zip(&layout)
        {
            self.bind_key(string(raw)?, *node)?;
        }
        let selection = match initial["selection"]["type"].as_str() {
            None if initial["selection"].is_null() => None,
            Some("range") => {
                let mut range = RangeSelection::new(
                    point(&initial["selection"]["anchor"])?,
                    point(&initial["selection"]["focus"])?,
                );
                range.format = TextFormat::from_bits_retain(
                    u32::try_from(integer(&initial["selection"]["format"])?)
                        .map_err(|_| fail("initial selection format"))?,
                );
                range.style = string(&initial["selection"]["style"])?.into();
                Some(Selection::Range(range))
            }
            Some("node") => {
                let mut nodes = NodeSelection::new();
                for node in initial["selection"]["keys"]
                    .as_array()
                    .ok_or_else(|| fail("initial selection keys"))?
                {
                    nodes.add(key(node)?);
                }
                Some(Selection::Node(nodes))
            }
            _ => return Err(fail("unsupported initial selection")),
        };
        let next = u32::try_from(integer(&initial["nextKey"])?)
            .map_err(|_| fail("initial key counter"))?;
        editor.restore_conformance_state(
            &serde_json::from_value(initial["editorState"].clone())?,
            &layout,
            NodeKey::from_parts(KeyParts {
                generation: 0,
                index: next,
            }),
            selection,
        )?;
        let actual = serde_json::to_value(editor.state().to_json()?)?;
        self.compare(&initial["editorState"], &actual)
            .map_err(|error| fail(format!("initial JSON: {error}")))?;
        if to_js_json_string(&initial["editorState"]) != to_js_json_string(&actual) {
            return Err(fail("initial JSON property order mismatch"));
        }
        self.compare(
            &initial["nodeMapKeys"],
            &json!(
                snapshot::keys(editor.state())
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            ),
        )?;
        self.compare(&initial["selection"], &snapshot::selection(editor.state())?)?;
        self.states.insert(0, editor.state().clone());
        Ok(())
    }
}
