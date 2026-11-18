//! Node export preserves virtual hooks, with direct encoding for exact builtin payloads.
use super::{fields, string, write_value};
use crate::node::{AbsentKeys, NullKeys};
use crate::*;
use std::any::TypeId;

pub(super) fn write(view: StateRef<'_>, key: NodeKey, output: &mut String) -> Result<(), Error> {
    if builtin(view, key, output)? {
        return Ok(());
    }
    let json = view.export_json(key)?;
    let element = view.kind(key) == Some(NodeKind::Element);
    output.push('{');
    let mut count = 0;
    for (name, value) in fields(&json) {
        if count != 0 {
            output.push(',');
        }
        string(name, output);
        output.push(':');
        if element && name == "children" {
            children(view, key, output)?;
        } else {
            write_value(value, output);
        }
        count += 1;
    }
    if element && !json.contains_key("children") {
        if count != 0 {
            output.push(',');
        }
        output.push_str("\"children\":");
        children(view, key, output)?;
    }
    output.push('}');
    Ok(())
}

fn children(view: StateRef<'_>, key: NodeKey, output: &mut String) -> Result<(), Error> {
    output.push('[');
    for (index, child) in view.children(key).enumerate() {
        if index != 0 {
            output.push(',');
        }
        write(view, child, output)?;
    }
    output.push(']');
    Ok(())
}

fn number(value: u32, output: &mut String) {
    match value {
        0 => output.push('0'),
        1 => output.push('1'),
        _ => output.push_str(ryu_js::Buffer::new().format(f64::from(value))),
    }
}

fn builtin(view: StateRef<'_>, key: NodeKey, output: &mut String) -> Result<bool, Error> {
    let slot = view.slot(key).ok_or(Error::NodeNotFound(key))?;
    let table = view.state.registry.vtable(slot.type_index);
    #[cfg(feature = "foreign-nodes")]
    if table.foreign.is_some()
        || slot.foreign_instance.get().is_some()
        || view
            .state
            .registry
            .native_overlays
            .contains_key(&slot.type_index)
    {
        return Ok(false);
    }
    let root = table.type_id == TypeId::of::<Root>();
    let paragraph = table.type_id == TypeId::of::<Paragraph>();
    let text = table.type_id == TypeId::of::<Text>();
    let tab = table.type_id == TypeId::of::<Tab>();
    let linebreak = table.type_id == TypeId::of::<LineBreak>();
    if !(root || paragraph || text || tab || linebreak) {
        return Ok(false);
    }
    let registration = view.state.registry.registered(slot.type_index);
    let state_fields = if let Some(state) = &slot.state {
        let layout = &registration.state_layout;
        #[cfg(feature = "foreign-nodes")]
        let layout = &view.state.registry.foreign_states.layout(layout);
        if layout.entries.iter().any(|entry| entry.flat) {
            return Ok(false);
        }
        let mut fields = SerializedNode::new();
        state.export(layout, &mut fields);
        Some(fields)
    } else {
        None
    };
    let paragraph_fields = if paragraph {
        let data = view.element(key).ok_or(Error::NotAnElement(key))?;
        let first = view.children(key).find_map(|child| view.text(child));
        // ParagraphNode.exportJSON backfills from the first text child's getters:
        // a value, its raw null, or undefined (omitted).
        let (format, style) = first.map_or(
            (
                JsonField::Value(data.text_format),
                JsonField::Value(data.text_style.as_ref()),
            ),
            TextData::json_format_style,
        );
        Some((
            format,
            style,
            first.is_none() && data.text_format.is_empty() && !data.text_style.is_empty(),
        ))
    } else {
        None
    };
    output.push('{');
    let mut comma = false;
    match &slot.base {
        BaseData::Element(data) => {
            output.push_str("\"children\":");
            children(view, key, output)?;
            if !data.absent.contains(AbsentKeys::DIRECTION) {
                output.push_str(",\"direction\":");
                output.push_str(match data.direction {
                    None => "null",
                    Some(TextDirection::Ltr) => "\"ltr\"",
                    Some(TextDirection::Rtl) => "\"rtl\"",
                });
            }
            output.push_str(",\"format\":");
            string(data.format.as_str(), output);
            if !data.absent.contains(AbsentKeys::INDENT) {
                output.push_str(",\"indent\":");
                if data.raw_indent_is_null && table.raw_null_indent {
                    output.push_str("null");
                } else {
                    number(data.indent, output);
                }
            }
            comma = true;
        }
        BaseData::Text(data) => {
            for (name, flag, null, value) in [
                (
                    "detail",
                    AbsentKeys::DETAIL,
                    NullKeys::DETAIL,
                    data.detail.bits(),
                ),
                (
                    "format",
                    AbsentKeys::FORMAT,
                    NullKeys::FORMAT,
                    data.format.bits(),
                ),
            ] {
                if !data.absent.contains(flag) {
                    if comma {
                        output.push(',');
                    }
                    string(name, output);
                    output.push(':');
                    if data.null.contains(null) {
                        output.push_str("null");
                    } else {
                        number(value, output);
                    }
                    comma = true;
                }
            }
            if !data.absent.contains(AbsentKeys::MODE) {
                if comma {
                    output.push(',');
                }
                output.push_str("\"mode\":");
                output.push_str(match data.mode {
                    TextMode::Normal => "\"normal\"",
                    TextMode::Token => "\"token\"",
                    TextMode::Segmented => "\"segmented\"",
                });
                comma = true;
            }
            for (name, flag, null, value) in [
                (
                    "style",
                    AbsentKeys::STYLE,
                    NullKeys::STYLE,
                    data.style.as_ref(),
                ),
                (
                    "text",
                    AbsentKeys::TEXT,
                    NullKeys::empty(),
                    data.text.as_str(),
                ),
            ] {
                if !data.absent.contains(flag) {
                    if comma {
                        output.push(',');
                    }
                    string(name, output);
                    output.push(':');
                    if !null.is_empty() && data.null.contains(null) {
                        output.push_str("null");
                    } else {
                        string(value, output);
                    }
                    comma = true;
                }
            }
        }
        BaseData::LineBreak => {}
        BaseData::Decorator => return Err(Error::Invariant("builtin JSON kind mismatch")),
    }
    if comma {
        output.push(',');
    }
    output.push_str("\"type\":");
    string(registration.type_name, output);
    output.push_str(",\"version\":1");
    if let Some(fields) = state_fields {
        for (name, value) in super::fields(&fields) {
            output.push(',');
            string(name, output);
            output.push(':');
            write_value(value, output);
        }
    }
    if let Some((format, style, style_first)) = paragraph_fields {
        let write_style = |output: &mut String| match style {
            JsonField::Value(style) => {
                output.push_str(",\"textStyle\":");
                string(style, output);
            }
            JsonField::Null => output.push_str(",\"textStyle\":null"),
            JsonField::Absent => {}
        };
        if style_first {
            write_style(output);
        }
        match format {
            JsonField::Value(format) => {
                output.push_str(",\"textFormat\":");
                number(format.bits(), output);
            }
            JsonField::Null => output.push_str(",\"textFormat\":null"),
            JsonField::Absent => {}
        }
        if !style_first {
            write_style(output);
        }
    }
    output.push('}');
    Ok(true)
}
