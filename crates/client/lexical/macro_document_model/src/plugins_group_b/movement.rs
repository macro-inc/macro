//! Atomic block/list movement, insertion selection and block-gap caret policy.
use super::*;
use lexical_rich_nodes::list::{ListItemNode, ListNode};

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
enum MoveAction {
    DragSelection {
        key: u32,
    },
    Gap {
        previous: u32,
        next: u32,
    },
    Insertion {
        key: u32,
        before: bool,
    },
    Move {
        source: u32,
        target: u32,
        before: bool,
    },
    Swipe {
        key: u32,
        outdent: bool,
    },
}
#[derive(Clone, Debug)]
struct MoveCommand {
    action: MoveAction,
    generation: u32,
}
static MOVE: CommandKey<MoveCommand> = CommandKey::new("group-b.move");
pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != MOVE.name() {
        return Ok(None);
    }
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &MOVE,
        MoveCommand {
            action: serde_json::from_str(json)?,
            generation,
        },
    ))))
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(Movement)
}
#[derive(serde::Deserialize)]
struct DropInsertion {
    key: u32,
    generation: u32,
    before: bool,
}
struct Movement;
static COMMANDS: [CommandRegistration; 2] = [
    CommandRegistration {
        command: CommandKind::Paste,
        priority: CommandPriority::Critical,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&MOVE),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
];
impl Plugin for Movement {
    fn name(&self) -> &'static str {
        "group-b.movement"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        if let Command::Paste(payload) = command {
            let Some(facts) = payload.get("application/x-macro-drop") else {
                return Ok(Handled::No);
            };
            let facts: DropInsertion = serde_json::from_str(facts)?;
            let key = NodeKey::from_parts(KeyParts {
                index: facts.key,
                generation: facts.generation,
            });
            if key == NodeKey::ROOT || !tx.is_attached(key) {
                return Ok(Handled::Yes);
            }
            if facts.before {
                tx.select_start(key)?;
            } else {
                tx.select_end(key)?;
            }
            return Ok(Handled::No);
        }
        let Command::Extension(extension) = command else {
            return Ok(Handled::No);
        };
        let Some(command) = extension.payload(&MOVE) else {
            return Ok(Handled::No);
        };
        let key = |index| {
            NodeKey::from_parts(KeyParts {
                index,
                generation: command.generation,
            })
        };
        let handled = match command.action {
            MoveAction::DragSelection { key: index } => {
                let mut key = key(index);
                if key == NodeKey::ROOT || !tx.is_attached(key) {
                    return Ok(Handled::No);
                }
                if tx.is::<ListItemNode>(key)
                    && let Some(parent) = tx.parent(key).filter(|parent| {
                        tx.is::<ListNode>(*parent) && tx.first_child(*parent) == Some(key)
                    })
                {
                    key = parent;
                }
                let keys = if tx.is::<ListItemNode>(key) {
                    nested_group(tx, key)?
                } else {
                    vec![key]
                };
                let mut selection = NodeSelection::new();
                for key in keys {
                    selection.add(key);
                }
                tx.set_selection(Some(Selection::Node(selection)))?;
                true
            }
            MoveAction::Gap { previous, next } => {
                let previous = key(previous);
                let next = key(next);
                if tx.parent(previous) != Some(NodeKey::ROOT)
                    || tx.next_sibling(previous) != Some(next)
                    || !super::structure::needs_caret(tx, previous)
                    || !super::structure::needs_caret(tx, next)
                {
                    return Ok(Handled::No);
                }
                let p = tx.create(Paragraph::default())?;
                tx.insert_after(previous, p, true)?;
                tx.select_start(p)?;
                tx.add_tag(UpdateTag::HistoryPush);
                true
            }
            MoveAction::Insertion { key: index, before } => {
                let key = key(index);
                if key == NodeKey::ROOT || !tx.is_attached(key) {
                    return Ok(Handled::No);
                }
                if before {
                    tx.select_start(key)?;
                } else {
                    tx.select_end(key)?;
                }
                true
            }
            MoveAction::Move {
                source,
                target,
                before,
            } => move_block(tx, key(source), key(target), before)?,
            MoveAction::Swipe {
                key: index,
                outdent,
            } => swipe(tx, key(index), outdent)?,
        };
        Ok(if handled { Handled::Yes } else { Handled::No })
    }
}
pub(super) fn nested_group(tx: &impl Read, item: NodeKey) -> Result<Vec<NodeKey>, Error> {
    let indent = tx.indent(item);
    let mut group = vec![item];
    let mut sibling = tx.next_sibling(item);
    while let Some(key) = sibling.filter(|key| tx.is::<ListItemNode>(*key)) {
        let children = tx.children_keys(key)?;
        let wrapper = !children.is_empty() && children.iter().all(|key| tx.is::<ListNode>(*key));
        if tx.indent(key) <= indent && !wrapper {
            break;
        }
        group.push(key);
        sibling = tx.next_sibling(key);
    }
    Ok(group)
}
fn list_like(tx: &mut Transaction<'_>, list: NodeKey) -> Result<NodeKey, Error> {
    let kind = tx.get_or_err::<ListNode>(list)?.list_type();
    Ok(tx.create(ListNode::new(kind, 1))?.key())
}
fn move_block(
    tx: &mut Transaction<'_>,
    source: NodeKey,
    target: NodeKey,
    before: bool,
) -> Result<bool, Error> {
    if source == target
        || source == NodeKey::ROOT
        || target == NodeKey::ROOT
        || !tx.is_attached(source)
        || !tx.is_attached(target)
        || tx.is_parent_of(source, target)
    {
        return Ok(false);
    }
    let parent = tx.parent(source);
    let target_parent = tx.parent(target).filter(|_| tx.is::<ListItemNode>(target));
    if tx.is::<ListItemNode>(source) && tx.is::<ListItemNode>(target) && parent == target_parent {
        let group = nested_group(tx, source)?;
        if group.contains(&target) {
            return Ok(false);
        }
        if before {
            for item in group {
                tx.insert_before(target, item, true)?;
            }
        } else {
            let mut anchor = target;
            for item in group {
                tx.insert_after(anchor, item, true)?;
                anchor = item;
            }
        }
        return Ok(true);
    }
    if tx.is::<ListItemNode>(source)
        && let Some(parent) = parent.filter(|key| tx.is::<ListNode>(*key))
    {
        let group = nested_group(tx, source)?;
        if group
            .iter()
            .any(|key| *key == target || tx.is_parent_of(*key, target))
        {
            return Ok(false);
        }
        let list = list_like(tx, parent)?;
        tx.append(list, &group)?;
        let target = target_parent
            .filter(|key| tx.is::<ListNode>(*key))
            .unwrap_or(target);
        if before {
            tx.insert_before(target, list, true)?;
        } else {
            tx.insert_after(target, list, true)?;
        }
        if tx.children_size(parent) == 0 {
            tx.remove(parent, false)?;
        }
        return Ok(true);
    }
    if !tx.is::<ListItemNode>(source)
        && let Some(list) = target_parent.filter(|key| tx.is::<ListNode>(*key))
    {
        let group = nested_group(tx, target)?;
        let last = group
            .last()
            .copied()
            .ok_or(Error::Invariant("target group"))?;
        let split = if before {
            tx.index_within_parent(target)
        } else {
            tx.index_within_parent(last)
                .map(|index| ChildIndex(index.0 + 1))
        }
        .ok_or(Error::Invariant("list split index"))?;
        let children = tx.children_keys(list)?;
        let (above, below) = children
            .split_at_checked(split.0 as usize)
            .ok_or(Error::Invariant("list split index"))?;
        if !above.is_empty() {
            let new = list_like(tx, list)?;
            tx.append(new, above)?;
            tx.insert_before(list, new, true)?;
        }
        tx.insert_before(list, source, true)?;
        if !below.is_empty() {
            let new = list_like(tx, list)?;
            tx.append(new, below)?;
            tx.insert_before(list, new, true)?;
        }
        tx.remove(list, false)?;
        return Ok(true);
    }
    let target = target_parent
        .filter(|key| tx.is::<ListNode>(*key))
        .unwrap_or(target);
    if source == target {
        return Ok(false);
    }
    if before {
        tx.insert_before(target, source, true)?;
    } else {
        tx.insert_after(target, source, true)?;
    }
    Ok(true)
}
fn swipe(tx: &mut Transaction<'_>, mut item: NodeKey, outdent: bool) -> Result<bool, Error> {
    if !tx.is::<ListItemNode>(item) || !tx.is_attached(item) {
        return Ok(false);
    }
    loop {
        let inner = tx
            .first_child(item)
            .filter(|key| tx.is::<ListNode>(*key))
            .and_then(|key| tx.first_child(key))
            .filter(|key| tx.is::<ListItemNode>(*key));
        let Some(inner) = inner else {
            break;
        };
        item = inner;
    }
    let before = tx.indent(item);
    if outdent {
        if before == 0 {
            return Ok(false);
        }
    } else if !tx.can_indent(item)
        || tx.prev_sibling(item).is_some_and(|previous| {
            !tx.is_element(previous) || before >= tx.indent(previous).saturating_add(1)
        })
    {
        return Ok(false);
    }
    let Some(parent) = tx.parent(item).filter(|key| tx.is::<ListNode>(*key)) else {
        return Ok(false);
    };
    let group = nested_group(tx, item)?;
    let nested = group.get(1..).ok_or(Error::Invariant("nested group"))?;
    if !nested.is_empty() {
        let temp = list_like(tx, parent)?;
        tx.append(temp, nested)?;
    }
    tx.set_indent(item, if outdent { before - 1 } else { before + 1 })?;
    let mut moved = if outdent {
        tx.indent(item) < before
    } else {
        tx.indent(item) > before
    };
    if !moved {
        if outdent {
            if let Some(list) = tx.parent(item).filter(|key| tx.is::<ListNode>(*key))
                && let Some(grand) = tx.parent(list).filter(|key| tx.is::<ListItemNode>(*key))
            {
                tx.insert_after(grand, item, true)?;
                if tx.children_size(list) == 0 {
                    tx.remove(list, false)?;
                    if tx.children_size(grand) == 0 {
                        tx.remove(grand, false)?;
                    }
                }
                moved = true;
            }
        } else if let Some(list) = tx.parent(item).filter(|key| tx.is::<ListNode>(*key))
            && let Some(previous) = tx
                .prev_sibling(item)
                .filter(|key| tx.is::<ListItemNode>(*key))
        {
            let existing = tx
                .children_keys(previous)?
                .into_iter()
                .find(|key| tx.is::<ListNode>(*key));
            let inner = if let Some(inner) = existing {
                inner
            } else {
                let inner = list_like(tx, list)?;
                tx.append(previous, &[inner])?;
                inner
            };
            tx.append(inner, &[item])?;
            moved = true;
        }
    }
    let mut anchor = item;
    for key in nested {
        tx.insert_after(anchor, *key, true)?;
        anchor = *key;
    }
    Ok(moved)
}
