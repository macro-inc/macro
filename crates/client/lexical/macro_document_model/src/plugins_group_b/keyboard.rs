//! Inline format escape, Enter normalization and bounded block indentation.
use super::*;
use lexical_rich_nodes::{heading::HeadingNode, quote::QuoteNode};
use std::collections::HashSet;

#[derive(Clone, Default)]
struct PendingCleanup(bool);

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder
        .extension_state(PendingCleanup::default())
        .plugin(Keyboard)
}

struct Keyboard;
impl Plugin for Keyboard {
    fn name(&self) -> &'static str {
        "group-b.keyboard"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[
            CommandRegistration {
                command: CommandKind::Key(KeyCommand::ArrowRight),
                priority: CommandPriority::High,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::Key(KeyCommand::Enter),
                priority: CommandPriority::Normal,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::Key(KeyCommand::Tab),
                priority: CommandPriority::Editor,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::InsertParagraph,
                priority: CommandPriority::Normal,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::IndentContent,
                priority: CommandPriority::Low,
                placement: Placement::Before,
            },
            CommandRegistration {
                command: CommandKind::OutdentContent,
                priority: CommandPriority::Editor,
                placement: Placement::After,
            },
        ]
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        match command {
            Command::Key {
                command: KeyCommand::ArrowRight,
                ..
            } => arrow_right(tx),
            Command::InsertParagraph => {
                tx.extension_mut::<PendingCleanup>()?.0 = true;
                Ok(Handled::No)
            }
            Command::IndentContent => indent_with_limit(tx),
            Command::OutdentContent => {
                let handled = lexical_rich_nodes::rich_text::outdent_content(tx)
                    .map_err(|lexical_rich_nodes::Error::Model(error)| error)?;
                Ok(if handled { Handled::Yes } else { Handled::No })
            }
            Command::Key {
                command: KeyCommand::Tab,
                event,
            } => {
                if !matches!(tx.selection(), Some(Selection::Range(_))) {
                    return Ok(Handled::No);
                }
                tx.prevent_default();
                let command = if event.as_ref().is_some_and(|e| e.shift) {
                    Command::OutdentContent
                } else {
                    Command::IndentContent
                };
                tx.dispatch(&command)
            }
            Command::Key {
                command: KeyCommand::Enter,
                event,
            } => {
                let handled = enter(tx, event.as_ref())?;
                if handled == Handled::Yes {
                    tx.prevent_default();
                }
                Ok(handled)
            }
            _ => Ok(Handled::No),
        }
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, _: &Commit) -> Result<(), Error> {
        if tx.extension::<PendingCleanup>()?.0 {
            tx.extension_mut::<PendingCleanup>()?.0 = false;
            clear_empty_typing_style(tx)?;
        }
        Ok(())
    }
}

fn arrow_right(tx: &mut Transaction<'_>) -> Result<Handled, Error> {
    let Some(range) = tx.selection().and_then(Selection::as_range) else {
        return Ok(Handled::No);
    };
    if !range.is_collapsed() {
        return Ok(Handled::No);
    }
    let focus = range.focus;
    let typing_format = range.format;
    match focus {
        Point::Text { key, offset } if offset == Utf16Offset::ZERO => {
            if let Some(left) = tx
                .prev_sibling(key)
                .filter(|left| has_escapable_format(tx, *left))
            {
                move_past_space_or_insert_after(tx, left, Some(key))?;
                tx.prevent_default();
                return Ok(Handled::Yes);
            }
        }
        Point::Element { key, offset } if offset > ChildIndex(0) => {
            if let Some(left) = tx
                .child_at_index(key, ChildIndex(offset.0 - 1))
                .filter(|left| has_escapable_format(tx, *left))
            {
                let right = tx.child_at_index(key, offset);
                move_past_space_or_insert_after(tx, left, right)?;
                tx.prevent_default();
                return Ok(Handled::Yes);
            }
        }
        _ => {}
    }
    let Point::Text { key, offset } = focus else {
        return Ok(Handled::No);
    };
    let escapable = TextFormat::CODE | TextFormat::HIGHLIGHT | TextFormat::STRIKETHROUGH;
    if offset != tx.text_content_size(key)
        || (!typing_format.intersects(escapable) && !has_escapable_format(tx, key))
    {
        return Ok(Handled::No);
    }
    tx.prevent_default();
    for format in [
        TextFormatType::Code,
        TextFormatType::Highlight,
        TextFormatType::Strikethrough,
    ] {
        if typing_format.has(format) {
            tx.toggle_selection_format(format)?;
        }
    }
    let right = tx.next_sibling(key);
    move_past_space_or_insert_after(tx, key, right)?;
    Ok(Handled::Yes)
}

fn has_escapable_format(tx: &Transaction<'_>, key: NodeKey) -> bool {
    tx.view().text(key).is_some_and(|text| {
        text.format
            .intersects(TextFormat::CODE | TextFormat::HIGHLIGHT | TextFormat::STRIKETHROUGH)
    })
}

fn move_past_space_or_insert_after(
    tx: &mut Transaction<'_>,
    left: NodeKey,
    right: Option<NodeKey>,
) -> Result<(), Error> {
    let space = if let Some(right) = right.filter(|key| {
        tx.view()
            .text(*key)
            .is_some_and(|text| text.text.as_str().starts_with(' '))
    }) {
        right
    } else {
        let space = tx.create_text(" ")?;
        tx.text(space)?
            .set_format(TextFormat::empty())?
            .set_style("")?;
        tx.insert_after(left, space, true)?;
        space.key()
    };
    tx.text(space)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))
}

fn clear_empty_typing_style(tx: &mut Transaction<'_>) -> Result<(), Error> {
    let Some(mut range) = tx.selection().and_then(Selection::as_range).cloned() else {
        return Ok(());
    };
    if !range.is_collapsed() {
        return Ok(());
    }
    let anchor = range.anchor.key();
    let block = if tx.is::<Paragraph>(anchor) {
        Some(anchor)
    } else {
        tx.top_level_element(anchor)?
    };
    if block.is_some_and(|key| tx.is::<Paragraph>(key) && tx.text_content(key).trim().is_empty())
        && (range.format != TextFormat::empty() || !range.style.is_empty())
    {
        range.format = TextFormat::empty();
        range.style = "".into();
        tx.set_selection(Some(Selection::Range(range)))?;
    }
    Ok(())
}

fn at_start(tx: &Transaction<'_>, range: &RangeSelection, heading: bool, empty_only: bool) -> bool {
    if !range.is_collapsed() {
        return false;
    }
    let key = range.anchor.key();
    if matches!(range.anchor, Point::Element { .. })
        && tx
            .children_keys(key)
            .ok()
            .and_then(|keys| keys.get(range.anchor.offset() as usize).copied())
            .is_some_and(|key| tx.is_line_break(key))
    {
        return true;
    }
    if range.anchor.offset() != 0 {
        return false;
    }
    let Some(parent) = tx.parent(key) else {
        return false;
    };
    let matched = if heading {
        tx.is::<HeadingNode>(parent)
    } else {
        tx.is::<Paragraph>(parent)
    };
    let target = if matched {
        parent
    } else if tx.is::<Root>(parent) {
        key
    } else {
        return false;
    };
    !empty_only || tx.text_content(target).trim().is_empty()
}

fn enter(tx: &mut Transaction<'_>, event: Option<&KeyEvent>) -> Result<Handled, Error> {
    let Some(range) = tx.selection().and_then(Selection::as_range).cloned() else {
        return Ok(Handled::No);
    };
    if event.is_some_and(|e| e.ctrl || e.meta || e.alt) {
        return Ok(Handled::No);
    }
    if event.is_some_and(|e| e.shift) && !at_start(tx, &range, false, true) {
        return tx.dispatch(&Command::InsertLineBreak {
            select_start: false,
        });
    }
    let anchor = tx.top_level_element(range.anchor.key())?;
    let focus = tx.top_level_element(range.focus.key())?;
    if let Some(block) = anchor.filter(|key| {
        tx.is::<HeadingNode>(*key) && !tx.text_content(*key).is_empty() && Some(*key) == focus
    }) {
        if at_start(tx, &range, true, false) {
            let p = tx.create(Paragraph::default())?;
            tx.insert_before(block, p, true)?;
            return Ok(Handled::Yes);
        }
        if let Some(next) = tx.insert_paragraph()? {
            if tx.is::<HeadingNode>(next) {
                let fields = tx
                    .view()
                    .element(next)
                    .ok_or(Error::NotAnElement(next))?
                    .clone();
                let p = tx.create(Paragraph::default())?;
                tx.element(p)?.set_direction(fields.direction)?;
                tx.set_indent(p, fields.indent)?;
                tx.replace(next, p, true)?;
                tx.select_start(p)?;
            }
            clear_empty_typing_style(tx)?;
            return Ok(Handled::Yes);
        }
        return Ok(Handled::No);
    }
    if let Some(block) = focus.filter(|key| {
        range.is_collapsed() && (tx.is::<HeadingNode>(*key) || tx.is::<QuoteNode>(*key))
    }) {
        if tx.text_content(block).is_empty() {
            let p = tx.create(Paragraph::default())?;
            tx.replace(block, p, false)?;
            tx.select_start(p)?;
            return Ok(Handled::Yes);
        }
        if matches!(range.focus, Point::Text { .. })
            && range.focus.offset() == 0
            && tx.first_child(block) == Some(range.focus.key())
        {
            let quote = tx.create(QuoteNode::default())?;
            tx.insert_before(block, quote, true)?;
            return Ok(Handled::Yes);
        }
    }
    tx.extension_mut::<PendingCleanup>()?.0 = true;
    tx.dispatch(&Command::InsertParagraph)
}

fn indent_with_limit(tx: &mut Transaction<'_>) -> Result<Handled, Error> {
    let Some(range) = tx.selection().and_then(Selection::as_range) else {
        return Ok(Handled::No);
    };
    let nodes = range.nodes(tx.view())?;
    let mut handled = HashSet::new();
    for node in nodes {
        if handled.contains(&node) {
            continue;
        }
        let Some(block) = tx.find_matching_parent(node, |state, key| {
            state.is_element(key) && !state.is_inline(key)
        }) else {
            continue;
        };
        if handled.contains(&block) || !tx.can_indent(block) {
            continue;
        }
        handled.insert(block);
        if matches!(tx.type_name(block)?, "code" | "quote" | "heading") {
            continue;
        }
        let depth = tx.indent(block);
        let previous = tx
            .prev_sibling(block)
            .filter(|key| tx.is_element(*key))
            .map(|key| tx.indent(key))
            .unwrap_or(0);
        if depth < previous.saturating_add(1) {
            tx.set_indent(block, depth + 1)?;
        }
    }
    Ok(if handled.is_empty() {
        Handled::No
    } else {
        Handled::Yes
    })
}

#[cfg(test)]
mod test;
