//! Source word-command interception around a leading inline decorator.
use super::*;
use lexical_rich_nodes::code::CodeNode;

const START: &str = "group-b.move-to-start";
const END: &str = "group-b.move-to-end";

pub(super) fn decode(
    name: &str,
    json: &str,
    event: Option<&KeyEvent>,
) -> Result<Option<Command>, Error> {
    let (kind, key) = match name {
        START => (KeyCommand::MoveToStart, "ArrowLeft"),
        END => (KeyCommand::MoveToEnd, "ArrowRight"),
        _ => return Ok(None),
    };
    let event = event.ok_or(Error::Invariant("word navigation keyboard facts"))?;
    if event.key.as_ref() != key || event.ctrl == event.meta || event.alt || event.is_composing {
        return Err(Error::Invariant("word navigation key chord"));
    }
    serde_json::from_str::<()>(json)?;
    Ok(Some(Command::Key {
        command: kind,
        event: Some(event.clone()),
    }))
}
pub(super) fn key_prevents_default(name: &str) -> Option<bool> {
    matches!(name, START | END).then_some(false)
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(WordNavigation)
}
struct WordNavigation;
impl Plugin for WordNavigation {
    fn name(&self) -> &'static str {
        "group-b.word-navigation"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[
            CommandRegistration {
                command: CommandKind::Key(KeyCommand::MoveToStart),
                priority: CommandPriority::High,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::Key(KeyCommand::MoveToEnd),
                priority: CommandPriority::High,
                placement: Placement::After,
            },
        ];
        COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Key {
            command,
            event: Some(event),
        } = command
        else {
            return Ok(Handled::No);
        };
        if tx.view_host().is_apple() {
            return Ok(Handled::No);
        }
        let Some(range) = tx.selection().and_then(Selection::as_range).cloned() else {
            return Ok(Handled::No);
        };
        // Source tests BOTH endpoints, through either actual Code constructor.
        if [range.anchor.key(), range.focus.key()]
            .into_iter()
            .any(|key| {
                tx.find_matching_parent(key, |state, key| {
                    state.is::<CodeNode>(key) || state.is::<crate::nodes::CustomCodeNode>(key)
                })
                .is_some()
            })
        {
            return Ok(Handled::No);
        }
        match command {
            KeyCommand::MoveToStart => {
                let Some(block) = tx.find_matching_parent(range.focus.key(), |state, key| {
                    state.is_element(key) && !state.is_inline(key)
                }) else {
                    return Ok(Handled::No);
                };
                let Some(decorator) = leading_inline_decorator(tx, block) else {
                    return Ok(Handled::No);
                };
                if range.is_collapsed()
                    && tx.next_sibling(decorator) == Some(range.anchor.key())
                    && range.anchor.offset() == 0
                {
                    tx.prevent_default();
                    tx.set_point(PointRole::Focus, Point::element(block, ChildIndex(0)))?;
                    if !event.shift {
                        tx.set_point(PointRole::Anchor, Point::element(block, ChildIndex(0)))?;
                    }
                }
                Ok(Handled::Yes)
            }
            KeyCommand::MoveToEnd => {
                let Point::Element {
                    key,
                    offset: ChildIndex(0),
                } = range.anchor
                else {
                    return Ok(Handled::No);
                };
                Ok(
                    if tx.is_element(key)
                        && !tx.is_inline(key)
                        && leading_inline_decorator(tx, key).is_some()
                    {
                        Handled::Yes
                    } else {
                        Handled::No
                    },
                )
            }
            _ => Ok(Handled::No),
        }
    }
}
fn leading_inline_decorator(state: &impl Read, block: NodeKey) -> Option<NodeKey> {
    state
        .first_child(block)
        .filter(|key| state.is_decorator(*key) && state.is_inline(*key))
}

#[cfg(test)]
mod test;
