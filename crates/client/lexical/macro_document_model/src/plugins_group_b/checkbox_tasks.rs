//! Source checkboxToTaskPlugin over the native model: the selected checklist
//! items to create tasks from, then their replacement by task mentions.
use crate::nodes::{
    DateMentionNode, DocumentMentionNode, Maybe, UserMentionNode, create_document_mention_node,
};
use lexical_model::*;
use lexical_rich_nodes::list::{ListItemNode, item::get_checked};
use serde_json::{Value, json};

const SELECTED: &str = "group-b.selected-checkboxes";
const COUNT: &str = "group-b.selected-checkbox-count";

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}

/// Source `$getSelectedCheckboxes`: each checklist item under the range
/// selection, in first-seen order. None when the selection is not a range.
fn selected_checkboxes(state: &EditorState) -> Result<Option<Vec<NodeKey>>, Error> {
    let Some(Selection::Range(range)) = state.selection() else {
        return Ok(None);
    };
    let view = state.view();
    // Source's Set: first-seen order, constant-time membership.
    let mut items: Vec<NodeKey> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for node in range.nodes(view)? {
        let mut current = Some(node);
        while let Some(key) = current.filter(|key| *key != NodeKey::ROOT) {
            if let Some(item) = view.cast::<ListItemNode>(key)
                && get_checked(&view, item).is_some()
            {
                if seen.insert(key) {
                    items.push(key);
                }
                break;
            }
            current = view.parent(key);
        }
    }
    Ok(Some(items))
}

/// `group-b.selected-checkboxes`: Source `$getSelectedCheckboxes` +
/// `$parseCheckboxNodes`, each item's key, title and internal Markdown; null
/// when the selection is not a range (Source returns early).
/// `group-b.selected-checkbox-count`: Source MarkdownPopup's count of selected
/// items with a title, without exporting Markdown.
pub(super) fn query(
    name: &str,
    data: &Value,
    generation: u32,
    state: &EditorState,
) -> Result<Option<Value>, Error> {
    if name != SELECTED && name != COUNT {
        return Ok(None);
    }
    if generation != state.max_key().generation() {
        return Err(Error::Invariant("checkbox query generation"));
    }
    let _: Empty = serde_json::from_value(data.clone())?;
    let view = state.view();
    let Some(items) = selected_checkboxes(state)? else {
        return Ok(Some(if name == COUNT { json!(0) } else { Value::Null }));
    };
    if name == COUNT {
        let titled = items
            .iter()
            .filter(|key| !collapse(&title(view, **key)).is_empty())
            .count();
        return Ok(Some(json!(titled)));
    }
    let mut reply = Vec::with_capacity(items.len());
    for key in items {
        let markdown = crate::export::element_node_to_markdown(
            state,
            key,
            crate::export::MarkdownTarget::Internal,
            None,
        )
        .map_err(|error| Error::invariant(error.to_string()))?;
        reply.push(json!({
            "key": key.index(),
            "title": collapse(&title(view, key)),
            "markdown": markdown,
        }));
    }
    Ok(Some(Value::Array(reply)))
}

/// Source `$collectTextContent`: text without user and date mentions.
fn title(view: StateRef<'_>, key: NodeKey) -> String {
    if view.get::<UserMentionNode>(key).is_some() || view.get::<DateMentionNode>(key).is_some() {
        return String::new();
    }
    if view.element(key).is_some() {
        return view.children(key).map(|child| title(view, child)).collect();
    }
    view.text_content(key).into_owned()
}

/// JS `.trim().replace(/\s+/g, ' ')`.
fn collapse(text: &str) -> String {
    text.split(is_js_whitespace)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Created {
    key: u32,
    document_id: String,
    task_title: String,
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ReplaceInput {
    items: Vec<Created>,
}
#[derive(Clone, Debug)]
struct Replace {
    items: Vec<Created>,
    generation: u32,
}
static REPLACE: CommandKey<Replace> = CommandKey::new("group-b.checkbox-task-mentions");
static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&REPLACE),
    priority: CommandPriority::Normal,
    placement: Placement::After,
}];

pub(super) fn decode(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    if name != REPLACE.name() {
        return Ok(None);
    }
    let input: ReplaceInput = serde_json::from_str(json)?;
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &REPLACE,
        Replace {
            items: input.items,
            generation,
        },
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(CheckboxTasks)
}

struct CheckboxTasks;
impl Plugin for CheckboxTasks {
    fn name(&self) -> &'static str {
        "group-b.checkbox-tasks"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    /// Source `$replaceCheckboxWithMention` for every created task, in one
    /// update; an item removed meanwhile stays removed.
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(extension) = command else {
            return Ok(Handled::No);
        };
        let Some(command) = extension.payload(&REPLACE) else {
            return Ok(Handled::No);
        };
        if command.generation != tx.committed_state().max_key().generation() {
            return Ok(Handled::No);
        }
        let mut handled = Handled::No;
        for created in &command.items {
            let key = NodeKey::from_parts(KeyParts {
                index: created.key,
                generation: command.generation,
            });
            if !tx.is_attached(key) || !tx.is::<ListItemNode>(key) {
                continue;
            }
            let mention = create_document_mention_node(
                tx,
                DocumentMentionNode {
                    document_id: Maybe::Value(created.document_id.clone()),
                    document_name: Maybe::Value(created.task_title.clone()),
                    block_name: Maybe::Value("task".into()),
                    ..Default::default()
                },
            )?;
            let paragraph = tx.create(Paragraph::default())?;
            tx.append(paragraph, &[mention.key()])?;
            tx.replace(key, paragraph.key(), false)?;
            handled = Handled::Yes;
        }
        Ok(handled)
    }
}
