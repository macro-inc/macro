//! Replay the model half of TabIndentation registration and command priority.
use crate::replay::*;
use lexical_model::*;
use serde_json::Value;

pub(crate) fn register(r: &mut Replayer, args: &Value) -> Result<()> {
    let args = args
        .as_array()
        .ok_or_else(|| fail("tab plugin arguments"))?;
    if args.first() != Some(&serde_json::json!({"$ed":0})) || args.len() > 2 {
        return Err(fail("unsupported tab plugin arguments"));
    }
    let max = args
        .get(1)
        .filter(|v| !v.is_null() && v.get("$undef").is_none())
        .map(|v| integer(v).and_then(|n| u32::try_from(n).map_err(|_| fail("tab maximum indent"))))
        .transpose()?;
    r.tab_indent = Some(max);
    Ok(())
}

pub(crate) fn dispatch(
    r: &Replayer,
    tx: &mut Transaction<'_>,
    command: &str,
    payload: &Value,
) -> Result<bool> {
    if command == "KEY_TAB_COMMAND" && r.tab_indent.is_some() {
        let Some(range) = tx.selection().and_then(Selection::as_range) else {
            return Ok(false);
        };
        let command = if lexical_rich_nodes::tab::indent_over_tab(tx, range)? {
            if payload["shiftKey"] == true {
                "OUTDENT_CONTENT_COMMAND"
            } else {
                "INDENT_CONTENT_COMMAND"
            }
        } else {
            "INSERT_TAB_COMMAND"
        };
        return dispatch(r, tx, command, &Value::Null);
    }
    // The tab plugin's critical indent listener runs before rich text's editor listener.
    if command == "INDENT_CONTENT_COMMAND" {
        if let Some(max) = r.tab_indent
            && lexical_rich_nodes::tab::indent_with_limit(tx, max, &|view, key| {
                view.can_indent(key)
            })?
        {
            return Ok(true);
        }
        if r.rich_text_registered {
            return Ok(lexical_rich_nodes::rich_text::indent_content(tx)?);
        }
        return Ok(false);
    }
    if !r.rich_text_registered {
        return Ok(false);
    }
    match command {
        "INSERT_TAB_COMMAND" => Ok(lexical_rich_nodes::rich_text::insert_tab(tx)?),
        "OUTDENT_CONTENT_COMMAND" => Ok(lexical_rich_nodes::rich_text::outdent_content(tx)?),
        "FORMAT_TEXT_COMMAND" => Ok(lexical_rich_nodes::rich_text::format_text(
            tx,
            string(payload)?.parse().map_err(|_| fail("format"))?,
        )?),
        _ => Err(fail(format!("unmapped command: {command}"))),
    }
}

#[cfg(test)]
mod test;
