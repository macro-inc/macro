//! Dispatch for the core model's upstream API names.
use crate::replay::*;
use crate::test_nodes::*;
use lexical_model::*;
use serde_json::{Value, json};
pub(crate) fn call(r: &mut Replayer, tx: &mut Transaction<'_>, op: &Value) -> Result<Value> {
    let name = string(&op["fn"])?;
    if !r.in_callback
        && name.starts_with("@lexical/")
        && name
            .rsplit('.')
            .next()
            .is_some_and(|name| name.starts_with("$create"))
    {
        return Err(ReplayError::NoActiveEditor);
    }
    let args = r.decode(op.get("args").unwrap_or(&json!([])))?;
    let a = args.as_array().ok_or_else(|| fail("args must be array"))?;
    let receiver = op
        .get("this")
        .map(|v| r.decode(v))
        .transpose()?
        .unwrap_or(Value::Null);
    let snapshot = r.read_state.clone();
    let view = snapshot
        .as_ref()
        .map(EditorState::view)
        .unwrap_or(tx.view());
    let short = name.rsplit('.').next().unwrap_or(name);
    if receiver.get("$caretValue").is_some()
        || short.contains("Caret")
        || short == "$caretRangeFromSelection"
    {
        return super::caret::call(r, tx, &receiver, short, a);
    }
    if let Some(property) = name.strip_prefix("get:") {
        return super::properties::get(r, tx, &receiver, property);
    }
    if receiver.get("$selection").is_some() || receiver.get("$point").is_some() {
        return super::selection::call(r, tx, &receiver, short, a);
    }
    if receiver.get("$node").is_some() {
        return super::nodes::call(r, tx, &receiver, short, a);
    }
    match name {
        "@lexical/table.$createTableNode" => {
            let key = tx
                .create(lexical_rich_nodes::table::TableNode::default())?
                .key();
            r.node(tx.view(), key)
        }
        "@lexical/table.$createTableRowNode" => {
            let height = a
                .first()
                .and_then(Value::as_f64)
                .map(lexical_rich_nodes::table::JsNumber);
            let key = tx
                .create(lexical_rich_nodes::table::TableRowNode { height })?
                .key();
            r.node(tx.view(), key)
        }
        "@lexical/table.$createTableCellNode" => {
            use lexical_rich_nodes::table::{JsNumber, TableCellHeaderState, TableCellNode};
            let header = u8::try_from(u32_arg(a, 0, 0)?).map_err(|_| fail("header state"))?;
            let width = a.get(2).and_then(Value::as_f64).map(JsNumber);
            let key = tx
                .create(TableCellNode::new(
                    TableCellHeaderState::from_bits_retain(header),
                    u32_arg(a, 1, 1)?,
                    width,
                ))?
                .key();
            r.node(tx.view(), key)
        }
        "@lexical/list.$createListNode" => {
            let kind = match a.first().and_then(Value::as_str).unwrap_or("number") {
                "number" | "ol" => lexical_rich_nodes::list::ListType::Number,
                "bullet" | "ul" => lexical_rich_nodes::list::ListType::Bullet,
                "check" => lexical_rich_nodes::list::ListType::Check,
                _ => return Err(fail("list type")),
            };
            let start = a.get(1).and_then(Value::as_i64).unwrap_or(1);
            let start = i32::try_from(start).map_err(|_| fail("list start"))?;
            let key = lexical_rich_nodes::list::create_list_node(tx, kind, start)?.key();
            r.node(tx.view(), key)
        }
        "@lexical/list.$createListItemNode" => {
            let key = lexical_rich_nodes::list::create_list_item_node(
                tx,
                a.first().and_then(Value::as_bool),
            )?
            .key();
            r.node(tx.view(), key)
        }
        "@lexical/list/utils.$getListDepth" => {
            let key = node_key(a.first().ok_or_else(|| fail("list"))?)?;
            let id = view.cast(key).ok_or_else(|| fail("list"))?;
            Ok(json!(lexical_rich_nodes::list::utils::get_list_depth(
                &view, id
            )?))
        }
        "@lexical/rich-text.$createHeadingNode" => {
            let tag = serde_json::from_value(a.first().cloned().unwrap_or(json!("h1")))?;
            let key = lexical_rich_nodes::heading::create_heading_node(tx, tag)?.key();
            r.node(tx.view(), key)
        }
        "@lexical/rich-text.$createQuoteNode" => {
            let key = lexical_rich_nodes::quote::create_quote_node(tx)?.key();
            r.node(tx.view(), key)
        }
        "@lexical/hashtag.$createHashtagNode" => {
            let key = lexical_rich_nodes::hashtag::create_hashtag_node(tx, str_arg(a, 0)?)?.key();
            r.node(tx.view(), key)
        }
        "@lexical/rich-text.$isHeadingNode" | "@lexical/rich-text.$isQuoteNode" => {
            let key = a
                .first()
                .filter(|v| v.get("$node").is_some())
                .map(node_key)
                .transpose()?;
            Ok(json!(key.is_some_and(|key| if short == "$isHeadingNode" {
                view.is::<lexical_rich_nodes::heading::HeadingNode>(key)
            } else {
                view.is::<lexical_rich_nodes::quote::QuoteNode>(key)
            })))
        }
        "LexicalEditor.dispatchCommand" => {
            if !r.rich_text_registered {
                return Ok(json!(false));
            }
            let command = string(&a.first().ok_or_else(|| fail("command"))?["$cmd"])?;
            let handled = match command {
                "FORMAT_TEXT_COMMAND" => lexical_rich_nodes::rich_text::format_text(
                    tx,
                    str_arg(a, 1)?.parse().map_err(|_| fail("format"))?,
                )?,
                "INSERT_TAB_COMMAND" => lexical_rich_nodes::rich_text::insert_tab(tx)?,
                _ => return Err(fail(format!("unmapped command: {command}"))),
            };
            Ok(json!(handled))
        }
        "lexical/LexicalUtils.scheduleMicroTask" => {
            r.microtasks
                .push_back(a.first().ok_or_else(|| fail("callback"))?.clone());
            Ok(undefined())
        }
        "lexical/LexicalUtils.emptyFunction" => Ok(undefined()),
        "lexical/LexicalUtils.resetRandomKey" => Ok(undefined()),
        "@lexical/internal/invariant.default" => {
            if a.first().and_then(Value::as_bool) == Some(true) {
                Ok(undefined())
            } else {
                Err(fail(format!(
                    "oracle invariant: {}",
                    a.get(1).unwrap_or(&Value::Null)
                )))
            }
        }
        "lexical/__tests__/utils.$assertRangeSelection" => {
            let value = a.first().ok_or_else(|| fail("range argument"))?;
            tx.range_at(slot_arg(r, value)?)?;
            Ok(value.clone())
        }
        "@lexical/text.$rootTextContent" => Ok(json!(view.text_content(NodeKey::ROOT))),
        "lexical.$nodesOfType" => {
            let name = string(&a.first().ok_or_else(|| fail("class"))?["$klass"])?;
            let mut nodes = std::iter::once(NodeKey::ROOT)
                .chain(view.descendants(NodeKey::ROOT).map(|(key, _)| key))
                .filter(|key| view.type_name(*key).is_ok_and(|typ| typ == name))
                .collect::<Vec<_>>();
            nodes.sort();
            nodes.into_iter().map(|key| r.node(view, key)).collect()
        }
        "lexical.$getRoot" => r.node(view, NodeKey::ROOT),
        "lexical.$getSelection" => Ok(r.selection(tx)),
        "lexical.$createRangeSelection" | "lexical.$createNodeSelection" => {
            let selection = if short == "$createRangeSelection" {
                Selection::Range(RangeSelection::at_root())
            } else {
                Selection::Node(NodeSelection::new())
            };
            let id = r.selections.len();
            r.selections.push(tx.detach_selection(selection));
            r.selection_values.push(None);
            Ok(
                json!({"$selection":id,"kind":if short == "$createRangeSelection" {"range"} else {"node"}}),
            )
        }
        "lexical.$setSelection" => {
            super::selection::activate(
                r,
                tx,
                a.first().ok_or_else(|| fail("selection argument"))?,
            )?;
            Ok(undefined())
        }
        "lexical.$isRangeSelection" => Ok(json!(
            a.first()
                .and_then(|v| v.get("$selection"))
                .and_then(Value::as_u64)
                .and_then(|id| r.selections.get(id as usize))
                .and_then(|slot| tx.selection_at(*slot).ok().flatten())
                .is_some_and(Selection::is_range)
        )),
        "lexical.$isNodeSelection" => Ok(json!(
            a.first()
                .and_then(|v| v.get("$selection"))
                .and_then(Value::as_u64)
                .and_then(|id| r.selections.get(id as usize))
                .and_then(|slot| tx.selection_at(*slot).ok().flatten())
                .is_some_and(Selection::is_node)
        )),
        "lexical.$createTextNode" | "lexical/nodes/LexicalTextNode.$createTextNode" => {
            let key = tx
                .create_text(a.first().and_then(Value::as_str).unwrap_or(""))?
                .key();
            r.node(tx.view(), key)
        }
        "lexical.$createParagraphNode"
        | "lexical/nodes/LexicalParagraphNode.$createParagraphNode" => {
            let key = tx.create(Paragraph::default())?.key();
            r.node(tx.view(), key)
        }
        "lexical.$createLineBreakNode" => {
            let key = tx.create(LineBreak::default())?.key();
            r.node(tx.view(), key)
        }
        "lexical.$createTabNode" => {
            let key = tx.create(Tab::default())?.key();
            r.node(tx.view(), key)
        }
        "lexical/__tests__/utils.$createTestElementNode" => {
            let key = tx.create(TestElementNode::default())?.key();
            r.node(tx.view(), key)
        }
        "lexical/__tests__/utils.$createTestInlineElementNode" => {
            let key = tx.create(TestInlineElementNode::default())?.key();
            r.node(tx.view(), key)
        }
        "lexical/__tests__/utils.$createTestShadowRootNode" => {
            let key = tx.create(TestShadowRootNode::default())?.key();
            r.node(tx.view(), key)
        }
        "lexical/__tests__/utils.$createTestExcludeFromCopyElementNode" => {
            let key = tx.create(TestExcludeFromCopyElementNode::default())?.key();
            r.node(tx.view(), key)
        }
        "lexical/__tests__/utils.$createTestDecoratorNode" => {
            let key = tx.create(TestDecoratorNode::default())?.key();
            r.node(tx.view(), key)
        }
        "lexical/__tests__/utils.$createTestSegmentedNode" => {
            let key = tx.create(TestSegmentedNode::default())?.key();
            tx.text(key)?
                .set_text_content(a.first().and_then(Value::as_str).unwrap_or(""))?
                .set_mode(TextMode::Segmented)?;
            r.node(tx.view(), key)
        }
        "lexical.$getNodeByKey" => {
            let key = key_arg(r, a.first().ok_or_else(|| fail("key argument"))?)?;
            if view.contains(key) {
                r.node(view, key)
            } else {
                Ok(Value::Null)
            }
        }
        "lexical.$isTextNode"
        | "lexical.$isElementNode"
        | "lexical.$isRootNode"
        | "lexical.$isParagraphNode"
        | "lexical.$isLineBreakNode"
        | "lexical.$isTabNode"
        | "lexical.$isTokenOrSegmented" => {
            let Some(arg) = a.first().filter(|v| v.get("$node").is_some()) else {
                return Ok(json!(false));
            };
            let key = node_key(arg)?;
            Ok(json!(match short {
                "$isTextNode" => view.is_text(key),
                "$isElementNode" => view.is_element(key),
                "$isRootNode" => view.is::<Root>(key),
                "$isParagraphNode" => view.is::<Paragraph>(key),
                "$isLineBreakNode" => view.is_line_break(key),
                "$isTabNode" => view.is::<Tab>(key),
                _ => view.is_token_or_segmented(key),
            }))
        }
        "lexical/LexicalNormalization.$normalizeSelection" => {
            let value = a.first().ok_or_else(|| fail("selection argument"))?;
            let slot = slot_arg(r, value)?;
            tx.normalize_selection_at(slot)?;
            Ok(value.clone())
        }
        "lexical.$selectAll" => {
            tx.select_all(None)?;
            Ok(r.selection(tx))
        }
        "lexical.$insertNodes" => {
            let nodes = node_args(a.first().ok_or_else(|| fail("nodes argument"))?)?;
            tx.insert_nodes_at_selection(&nodes)?;
            Ok(undefined())
        }
        "lexical.$addUpdateTag" => {
            tx.add_tag(str_arg(a, 0)?.parse().map_err(|_| fail("tag"))?);
            Ok(undefined())
        }
        "lexical.$hasUpdateTag" => Ok(json!(
            tx.has_tag(&str_arg(a, 0)?.parse().map_err(|_| fail("tag"))?)
        )),
        "lexical.getStyleObjectFromCSS" => Ok(Value::Object(
            parse_css_declarations(str_arg(a, 0)?)
                .into_iter()
                .map(|(k, v)| (k, Value::String(v)))
                .collect(),
        )),
        "LexicalEditor.getEditorState" => {
            let state = tx.committed_state();
            let id = if let Some(id) = r
                .saved_states
                .iter()
                .position(|s| s.same_snapshot(state) && s.selection() == state.selection())
            {
                id
            } else {
                r.saved_states.push(state.clone());
                r.saved_states.len() - 1
            };
            Ok(json!({"$snapshot":id}))
        }
        "EditorState.toJSON" => {
            let id = integer(&receiver["$snapshot"])? as usize;
            Ok(serde_json::to_value(
                r.saved_states
                    .get(id)
                    .ok_or_else(|| fail("state handle"))?
                    .to_json()?,
            )?)
        }
        "iter" => {
            if receiver.is_array() {
                return Ok(receiver);
            }
            if let Some(set) = receiver.get("$set") {
                Ok(set.clone())
            } else if let Some(map) = receiver.get("$map") {
                Ok(map.clone())
            } else {
                Err(fail("unmapped iterable"))
            }
        }
        _ => Err(fail(format!("unmapped API: {name}"))),
    }
}
pub(crate) fn key_arg(r: &Replayer, value: &Value) -> Result<NodeKey> {
    if let Some(key) = value.get("$nodeKey") {
        return key_index(key);
    }
    if value.get("$node").is_some() {
        return node_key(value);
    }
    r.keys
        .get(string(value)?)
        .copied()
        .ok_or_else(|| fail(format!("unknown key argument: {value}")))
}
pub(crate) fn slot_arg(r: &Replayer, value: &Value) -> Result<SelectionSlot> {
    r.selections
        .get(integer(&value["$selection"])? as usize)
        .copied()
        .ok_or_else(|| fail("selection handle"))
}
pub(crate) fn node_args(value: &Value) -> Result<Vec<NodeKey>> {
    value
        .as_array()
        .ok_or_else(|| fail("expected nodes"))?
        .iter()
        .map(node_key)
        .collect()
}
pub(crate) fn str_arg(args: &[Value], n: usize) -> Result<&str> {
    args.get(n)
        .ok_or_else(|| fail("missing string argument"))
        .and_then(string)
}
pub(crate) fn u32_arg(args: &[Value], n: usize, default: u32) -> Result<u32> {
    args.get(n)
        .filter(|v| v.get("$undef").is_none())
        .map(|v| integer(v).and_then(|n| u32::try_from(n).map_err(|_| fail("offset overflow"))))
        .unwrap_or(Ok(default))
}
