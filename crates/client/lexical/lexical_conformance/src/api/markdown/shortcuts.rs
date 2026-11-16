//! Recorded registration and update boundaries for the shared shortcut engine.
use super::*;
use lexical_markdown::{ShortcutTrigger, markdown_shortcuts, markdown_shortcuts_on_enter};

pub(crate) fn register(r: &mut Replayer, args: &Value) -> Result<()> {
    let args = args
        .as_array()
        .ok_or_else(|| fail("markdown shortcut arguments"))?;
    if args.first() != Some(&json!({"$ed":r.editor_id})) || args.len() > 2 {
        return Err(fail("unsupported markdown shortcut arguments"));
    }
    with_registry(r, args.get(1), |_| Ok(()))?;
    r.markdown_shortcuts = Some(args.get(1).cloned().unwrap_or_else(undefined));
    Ok(())
}

pub(crate) fn followup(r: &mut Replayer, tx: &mut Transaction<'_>) -> Result<bool> {
    let (Some(value), Some(commit)) = (
        r.markdown_shortcuts.clone(),
        r.markdown_shortcut_commit.clone(),
    ) else {
        return Ok(false);
    };
    let opts = MarkdownOptions {
        list_indent: r.list_indent.unwrap_or(r.markdown_options.list_indent),
        ..r.markdown_options
    };
    let trigger = ShortcutTrigger::from_commit(&commit, tx.composition_key().is_some());
    let previous = r.in_callback;
    r.in_callback = true;
    let result = with_registry(r, Some(&value), |registry| {
        Ok(markdown_shortcuts(tx, &trigger, registry, &opts)?)
    });
    r.in_callback = previous;
    if result.as_ref().is_ok_and(|handled| *handled) {
        tx.add_tag(UpdateTag::HistoryPush);
    }
    result
}

pub(crate) fn enter(r: &mut Replayer, tx: &mut Transaction<'_>, payload: &Value) -> Result<bool> {
    let Some(value) = r.markdown_shortcuts.clone() else {
        return Ok(false);
    };
    // The recorded Enter cases pass null. A real DOM event needs a host that
    // records preventDefault; do not silently pretend its side effects happened.
    if !payload.is_null() {
        return Err(fail("markdown Enter requires a recorded null event"));
    }
    let opts = MarkdownOptions {
        list_indent: r.list_indent.unwrap_or(r.markdown_options.list_indent),
        ..r.markdown_options
    };
    with_registry(r, Some(&value), |registry| {
        Ok(markdown_shortcuts_on_enter(tx, false, registry, &opts)?)
    })
}
