//! Bind source setters to the owning typed model payloads and editing APIs.
use crate::replay::*;
use lexical_model::*;
use macro_document_model::nodes::*;
use serde_json::Value;
pub(crate) fn call(
    r: &mut Replayer,
    tx: &mut Transaction<'_>,
    key: NodeKey,
    method: &str,
    args: &[Value],
) -> Result<Option<Value>> {
    let first = args.first().cloned().unwrap_or_else(undefined);
    let returns_node = match method {
        "setIsDraft" => {
            tx.get_mut::<CommentNode>(key)?.is_draft =
                first.as_bool().ok_or_else(|| fail("draft flag"))?;
            true
        }
        "setThreadId" => {
            tx.get_mut::<CommentNode>(key)?.thread_id = if first.get("$undef").is_some() {
                Maybe::Missing
            } else {
                serde_json::from_value(first)?
            };
            true
        }
        "setQuery" => {
            tx.get_mut::<DatabaseQueryNode>(key)?.data = serde_json::from_value(first)?;
            false
        }
        "setExpanded" => {
            tx.get_mut::<AgentSessionMentionNode>(key)?.expanded =
                first.as_bool().ok_or_else(|| fail("expanded flag"))?;
            false
        }
        "setCode" => {
            let id = tx
                .view()
                .cast::<CustomCodeNode>(key)
                .ok_or_else(|| fail("custom code"))?;
            set_custom_code(
                tx,
                id,
                first.as_str(),
                args.get(1)
                    .and_then(Value::as_str)
                    .ok_or_else(|| fail("code text"))?,
            )?;
            true
        }
        "setHeight" if tx.is::<lexical_rich_nodes::table::TableRowNode>(key) => {
            tx.get_mut::<lexical_rich_nodes::table::TableRowNode>(key)?
                .height = first.as_f64().map(lexical_rich_nodes::table::JsNumber);
            true
        }
        "setColSpan" => {
            tx.get_mut::<lexical_rich_nodes::table::TableCellNode>(key)?
                .col_span = u32::try_from(integer(&first)?).map_err(|_| fail("cell span"))?;
            true
        }
        "setHeight" | "setWidth" if tx.is::<ImageNode>(key) || tx.is::<VideoNode>(key) => {
            let number = Maybe::Value(JsNumber(
                first.as_f64().ok_or_else(|| fail("media dimension"))?,
            ));
            if tx.is::<ImageNode>(key) {
                let mut node = tx.get_mut::<ImageNode>(key)?;
                if method == "setHeight" {
                    node.media.height = number;
                } else {
                    node.media.width = number;
                }
            } else {
                let mut node = tx.get_mut::<VideoNode>(key)?;
                if method == "setHeight" {
                    node.media.height = number;
                } else {
                    node.media.width = number;
                }
            }
            true
        }
        _ => return Ok(None),
    };
    Ok(Some(if returns_node {
        r.node(tx.view(), key)?
    } else {
        undefined()
    }))
}
