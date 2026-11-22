//! Source title-to-body keyboard handoff; browser focus remains with the host.
use super::*;

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {}

static FOCUS_START: CommandKey<()> = CommandKey::new("group-b.focus-start");
static PREPEND_PARAGRAPH: CommandKey<()> = CommandKey::new("group-b.prepend-paragraph");
static REMOVE_LEADING_EMPTY_PARAGRAPH: CommandKey<NodeKey> =
    CommandKey::new("group-b.remove-leading-empty-paragraph");

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct RemoveInput {
    key: u32,
}

/// Source `STOPPING_BLOCK_TYPES` in block-decorator navigation.
const STOPPING_BLOCK_TYPES: [&str; 5] = [
    "image",
    "video",
    "horizontalrule",
    "database-query",
    "document-card",
];

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name == REMOVE_LEADING_EMPTY_PARAGRAPH.name() {
        let value: serde_json::Value = serde_json::from_str(json)?;
        if !value.is_object() {
            return Err(Error::Invariant("title handoff object payload"));
        }
        let input: RemoveInput = serde_json::from_value(value)?;
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &REMOVE_LEADING_EMPTY_PARAGRAPH,
            NodeKey::from_parts(KeyParts {
                index: input.key,
                generation,
            }),
        ))));
    }
    let key = if name == FOCUS_START.name() {
        &FOCUS_START
    } else if name == PREPEND_PARAGRAPH.name() {
        &PREPEND_PARAGRAPH
    } else {
        return Ok(None);
    };
    let value: serde_json::Value = serde_json::from_str(json)?;
    if !value.is_object() {
        return Err(Error::Invariant("title handoff object payload"));
    }
    let _: Input = serde_json::from_value(value)?;
    Ok(Some(Command::Extension(ExtensionCommand::new(key, ()))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(TitleHandoff)
}

struct TitleHandoff;

impl Plugin for TitleHandoff {
    fn name(&self) -> &'static str {
        "group-b.title-handoff"
    }

    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[
            CommandRegistration {
                command: CommandKind::Extension(&FOCUS_START),
                priority: CommandPriority::Editor,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::Extension(&PREPEND_PARAGRAPH),
                priority: CommandPriority::Editor,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::Extension(&REMOVE_LEADING_EMPTY_PARAGRAPH),
                priority: CommandPriority::Editor,
                placement: Placement::After,
            },
        ];
        COMMANDS
    }

    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(extension) = command else {
            return Ok(Handled::No);
        };
        if extension.payload(&FOCUS_START).is_some() {
            select_document_start(tx)?;
            return Ok(Handled::Yes);
        }
        if extension.payload(&PREPEND_PARAGRAPH).is_some() {
            prepend_paragraph(tx)?;
            return Ok(Handled::Yes);
        }
        if let Some(key) = extension.payload(&REMOVE_LEADING_EMPTY_PARAGRAPH) {
            remove_captured_paragraph(tx, *key)?;
            return Ok(Handled::Yes);
        }
        Ok(Handled::No)
    }
}

/// Source `$selectDocumentStart`: select a stopping block decorator, otherwise
/// the start of the first child; an empty root stays unchanged.
fn select_document_start(tx: &mut Transaction<'_>) -> Result<(), Error> {
    let Some(first) = tx.first_child(NodeKey::ROOT) else {
        return Ok(());
    };
    if is_stopping_block(tx, first)? {
        let mut nodes = NodeSelection::new();
        nodes.add(first);
        return tx.set_selection(Some(Selection::Node(nodes)));
    }
    tx.select_start(first)
}

fn is_stopping_block(tx: &Transaction<'_>, key: NodeKey) -> Result<bool, Error> {
    let view = tx.view();
    Ok(view.kind(key) == Some(NodeKind::Decorator)
        && !view.is_inline(key)
        && view.is_keyboard_selectable(key)
        && STOPPING_BLOCK_TYPES.contains(&view.type_name(key)?))
}

/// Source title Enter: a paragraph holding an empty text node goes before the
/// first child (or into an empty root) and receives the caret.
fn prepend_paragraph(tx: &mut Transaction<'_>) -> Result<(), Error> {
    let paragraph = tx.create(Paragraph::default())?;
    let text = tx.create_text("")?;
    tx.append(paragraph, &[text.key()])?;
    match tx.first_child(NodeKey::ROOT) {
        Some(first) => {
            tx.insert_before(first, paragraph, false)?;
        }
        None => tx.append(NodeKey::ROOT, &[paragraph.key()])?,
    }
    tx.select_end(paragraph)
}

/// Source body Backspace into the title: the host checks the empty, unindented
/// first paragraph at keydown and captures its key; the queued removal then
/// removes that node if it still exists, without revalidating, outside history.
fn remove_captured_paragraph(tx: &mut Transaction<'_>, key: NodeKey) -> Result<(), Error> {
    // Source tags the deferred update historic before looking the node up.
    tx.add_tag(UpdateTag::Historic);
    // Detached records are collected between updates, as in Source, so a
    // captured key that is no longer attached names no node.
    if tx.view().node(key).is_none() || !tx.is_attached(key) {
        return Ok(());
    }
    tx.remove(key, false)
}

#[cfg(test)]
mod test;
