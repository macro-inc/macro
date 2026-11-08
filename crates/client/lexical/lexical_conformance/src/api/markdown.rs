//! Recorded markdown names dispatch to the portable engine and real transformers.
use super::lexical::slot_arg;
use crate::replay::*;
use lexical_markdown::{
    MarkdownOptions, Transformer, Transformers, builtin::*, convert_from_markdown_string,
    convert_selection_to_markdown_string, convert_to_markdown_string, normalize_markdown,
};
use lexical_model::*;
use serde_json::{Value, json};
use std::sync::Arc;
mod recorded;
use recorded::with_registry;
fn registry(
    value: Option<&Value>,
    owner: &Arc<std::sync::Mutex<Replayer>>,
) -> Result<Transformers> {
    let Some(value) = value.filter(|v| v.get("$undef").is_none()) else {
        return Ok(Transformers::new(transformers()));
    };
    let array = value
        .as_array()
        .ok_or_else(|| fail("markdown transformer array"))?;
    let mut out = Vec::new();
    for value in array {
        if value.get("$transformer").is_none() {
            out.push(Transformer::TextMatch(Arc::new(
                recorded::RecordedLink::decode(value, owner.clone())?,
            )));
            continue;
        }
        let name = string(&value["$transformer"])?;
        if let Some(index) = name.strip_prefix(
            "@macro-inc/lexical-core/transformers/transformers.HTML_ENTITY_TRANSFORMERS.",
        ) {
            out.push(macro_document_model::transformers::transformer(
                &format!("HTML_ENTITY_{index}"),
                &Default::default(),
            )?);
            continue;
        }
        if name.starts_with("@macro-inc/lexical-core/transformers.") {
            out.push(macro_document_model::transformers::from_source_reference(
                name,
                &macro_document_model::transformers::MacroMarkdownOptions::default(),
            )?);
            continue;
        }
        let name = name.rsplit('.').next().unwrap_or(name);
        out.push(match name {
            "HEADING" => Transformer::Element(Arc::new(Heading)),
            "QUOTE" => Transformer::Element(Arc::new(Quote)),
            "UNORDERED_LIST" => Transformer::Element(Arc::new(UnorderedList)),
            "ORDERED_LIST" => Transformer::Element(Arc::new(OrderedList)),
            "CHECK_LIST" => Transformer::Element(Arc::new(CheckList)),
            "CODE" => Transformer::MultilineElement(Arc::new(Code)),
            "LINK" => Transformer::TextMatch(Arc::new(Link)),
            "INLINE_CODE" => Transformer::TextFormat(INLINE_CODE.clone()),
            "HIGHLIGHT" => Transformer::TextFormat(HIGHLIGHT.clone()),
            "BOLD_ITALIC_STAR" => Transformer::TextFormat(BOLD_ITALIC_STAR.clone()),
            "BOLD_ITALIC_UNDERSCORE" => Transformer::TextFormat(BOLD_ITALIC_UNDERSCORE.clone()),
            "BOLD_STAR" => Transformer::TextFormat(BOLD_STAR.clone()),
            "BOLD_UNDERSCORE" => Transformer::TextFormat(BOLD_UNDERSCORE.clone()),
            "STRIKETHROUGH" => Transformer::TextFormat(STRIKETHROUGH.clone()),
            "ITALIC_STAR" => Transformer::TextFormat(ITALIC_STAR.clone()),
            "ITALIC_UNDERSCORE" => Transformer::TextFormat(ITALIC_UNDERSCORE.clone()),
            _ => macro_document_model::transformers::transformer(name, &Default::default())
                .map_err(|_| fail(format!("unmapped markdown transformer: {name}")))?,
        });
    }
    Ok(Transformers::new(out))
}
fn root(value: Option<&Value>) -> Result<Option<NodeKey>> {
    value
        .filter(|v| !v.is_null() && v.get("$undef").is_none())
        .map(node_key)
        .transpose()
}
pub(crate) fn call(
    r: &mut Replayer,
    tx: &mut Transaction<'_>,
    name: &str,
    args: &[Value],
) -> Result<Value> {
    let snapshot = r.read_state.clone();
    let view = snapshot
        .as_ref()
        .map(EditorState::view)
        .unwrap_or(tx.view());
    let short = name.rsplit('.').next().unwrap_or(name);
    match short {
        "normalizeMarkdown" => Ok(json!(normalize_markdown(
            string(args.first().ok_or_else(|| fail("markdown source"))?)?,
            args.get(1).and_then(Value::as_bool).unwrap_or(false)
        ))),
        "$convertSelectionToMarkdownString" => {
            let selection = args
                .get(1)
                .filter(|v| !v.is_null() && v.get("$undef").is_none())
                .map(|v| slot_arg(r, v).and_then(|slot| Ok(tx.selection_at(slot)?.cloned())))
                .transpose()?
                .flatten();
            let opts = MarkdownOptions {
                list_indent: r.list_indent.unwrap_or(r.markdown_options.list_indent),
                should_preserve_new_lines: args.get(2).and_then(Value::as_bool).unwrap_or(false),
                ..r.markdown_options
            };
            if selection
                .as_ref()
                .is_none_or(|s| matches!(s,Selection::Range(range) if range.is_collapsed()))
            {
                return Ok(json!(convert_selection_to_markdown_string(
                    &view,
                    &Transformers::default(),
                    selection.as_ref(),
                    &opts
                )?));
            }
            if !r.in_callback {
                return Err(ReplayError::NoActiveEditor);
            }
            with_registry(r, args.first(), |registry| {
                Ok(json!(convert_selection_to_markdown_string(
                    &view,
                    registry,
                    selection.as_ref(),
                    &opts
                )?))
            })
        }
        "$convertToMarkdownString" => {
            if !r.in_callback {
                return Err(ReplayError::NoActiveEditor);
            }
            let opts = MarkdownOptions {
                list_indent: r.list_indent.unwrap_or(r.markdown_options.list_indent),
                should_preserve_new_lines: args.get(2).and_then(Value::as_bool).unwrap_or(false),
                ..r.markdown_options
            };
            let root = root(args.get(1))?;
            with_registry(r, args.first(), |registry| {
                Ok(json!(convert_to_markdown_string(
                    &view, registry, root, &opts
                )?))
            })
        }
        "$convertFromMarkdownString" => {
            if !r.in_callback {
                return Err(ReplayError::NoActiveEditor);
            }
            let opts = MarkdownOptions {
                list_indent: r.list_indent.unwrap_or(r.markdown_options.list_indent),
                should_preserve_new_lines: args.get(3).and_then(Value::as_bool).unwrap_or(false),
                should_merge_adjacent_lines: args.get(4).and_then(Value::as_bool).unwrap_or(false),
            };
            let text = string(args.first().ok_or_else(|| fail("markdown source"))?)?;
            let root = root(args.get(2))?;
            with_registry(r, args.get(1), |registry| {
                convert_from_markdown_string(tx, text, registry, root, &opts)?;
                Ok(())
            })?;
            Ok(undefined())
        }
        _ => Err(fail(format!("unmapped markdown API: {name}"))),
    }
}
