//! Source node-transform, custom-delete, single-line and trailing-paragraph policy.
use super::*;
use lexical_rich_nodes::{
    code::CodeNode,
    heading::{HeadingNode, HeadingTagType},
    link::LinkNode,
    list::{ListItemNode, ListType},
    quote::QuoteNode,
    selection::set_blocks_type_default,
    table::TableNode,
};

pub(super) fn single_line(builder: EditorBuilder) -> EditorBuilder {
    builder
        .transform::<Root>(|tx, root| {
            let children = tx.children_keys(root)?;
            for key in children.into_iter().skip(1).rev() {
                tx.remove(key, false)?;
            }
            Ok(())
        })
        .transform::<LineBreak>(|tx, node| tx.remove(node, false))
        .transform::<Paragraph>(|tx, node| {
            if tx.parent(node).is_some_and(|parent| !tx.is::<Root>(parent)) {
                for child in tx.children_keys(node)? {
                    tx.insert_before(node, child, true)?;
                }
                tx.remove(node, false)?;
            }
            Ok(())
        })
}
fn needs_caret(state: &impl Read, key: NodeKey) -> bool {
    state.is::<CodeNode>(key)
        || state.is::<TableNode>(key)
        || state.is_decorator(key) && !state.is_inline(key)
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(Structure).transform::<Root>(|tx, root| {
        if tx
            .last_child(root)
            .is_some_and(|last| needs_caret(tx, last))
        {
            let paragraph = tx.create(Paragraph::default())?;
            tx.append(root, &[paragraph.key()])?;
        }
        Ok(())
    })
}
static COMMANDS: [CommandRegistration; 4] = [
    CommandRegistration {
        command: CommandKind::Extension(&NODE_TRANSFORM),
        priority: CommandPriority::Editor,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::DeleteCharacter,
        priority: CommandPriority::Low,
        placement: Placement::Before,
    },
    CommandRegistration {
        command: CommandKind::DeleteWord,
        priority: CommandPriority::Low,
        placement: Placement::Before,
    },
    CommandRegistration {
        command: CommandKind::DeleteLine,
        priority: CommandPriority::Low,
        placement: Placement::Before,
    },
];
struct Structure;
impl Plugin for Structure {
    fn name(&self) -> &'static str {
        "group-b.structure"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        if let Command::Extension(command) = command {
            if let Some(kind) = command.payload(&NODE_TRANSFORM) {
                return transform(tx, *kind);
            }
            return Ok(Handled::No);
        }
        let Some(range) = tx.selection().and_then(Selection::as_range).cloned() else {
            return Ok(Handled::No);
        };
        if !range.is_collapsed() || range.anchor.offset() != 0 {
            return Ok(Handled::No);
        }
        let Some(item) = tx.find_matching_parent(range.anchor.key(), |state, key| {
            state.is::<ListItemNode>(key)
        }) else {
            return Ok(Handled::No);
        };
        if range.anchor.key() != item && tx.first_child(item) != Some(range.anchor.key()) {
            return Ok(Handled::No);
        }
        let selection = tx.selection().cloned();
        set_blocks_type_default(tx, selection.as_ref(), |tx| {
            Ok(tx.create(Paragraph::default())?.key())
        })?;
        Ok(Handled::Yes)
    }
}
fn transform(tx: &mut Transaction<'_>, kind: BlockKind) -> Result<Handled, Error> {
    let Some(mut range) = tx.selection().and_then(Selection::as_range).cloned() else {
        return Ok(Handled::No);
    };
    if let Some(list) = match kind {
        BlockKind::Bullet => Some(ListType::Bullet),
        BlockKind::Number => Some(ListType::Number),
        BlockKind::Check => Some(ListType::Check),
        _ => None,
    } {
        lexical_rich_nodes::list::format::insert_list(tx, list)?;
        return Ok(Handled::Yes);
    }
    if range.is_backward(tx.view())? {
        std::mem::swap(&mut range.anchor, &mut range.focus);
    }
    let selection = Selection::Range(range);
    set_blocks_type_default(tx, Some(&selection), |tx| {
        Ok(match kind {
            BlockKind::Paragraph => tx.create(Paragraph::default())?.key(),
            BlockKind::Heading1 => tx
                .create(HeadingNode {
                    tag: HeadingTagType::H1,
                })?
                .key(),
            BlockKind::Heading2 => tx
                .create(HeadingNode {
                    tag: HeadingTagType::H2,
                })?
                .key(),
            BlockKind::Heading3 => tx
                .create(HeadingNode {
                    tag: HeadingTagType::H3,
                })?
                .key(),
            BlockKind::Quote => tx.create(QuoteNode::default())?.key(),
            BlockKind::Code => tx.create(CodeNode::default())?.key(),
            BlockKind::Link => tx.create(LinkNode::default())?.key(),
            BlockKind::Bullet | BlockKind::Number | BlockKind::Check => {
                return Err(Error::Invariant("list handled before block replacement"));
            }
        })
    })?;
    Ok(Handled::Yes)
}
