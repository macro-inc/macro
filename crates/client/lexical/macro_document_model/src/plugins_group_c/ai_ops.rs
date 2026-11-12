//! Native AI-edit operations: the Source `Doc.apply` semantics of the
//! ai-editing worker's `DocumentOp`s, over the native model.
//!
//! Each op is one application input. The host sends `merge: true` for every op
//! after the first of an edit, so the whole edit is one undo step regardless of
//! timing. A refused op (unknown id, wrong target, missed substring) changes
//! nothing and reports `Handled::No`; the host stops there and keeps the ops
//! already applied, exactly as Source's per-op transactions do.
//!
//! The op types and appliers depend only on the model, so the worker could
//! adopt them later.
use lexical_model::*;

mod text;

/// Source `Scope` (`nth` is 1-based; 0 matches nothing).
#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Scope {
    Nth { n: f64 },
    All,
}

/// The `DocumentOp`s this applier implements; others are refused.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[expect(
    clippy::enum_variant_names,
    reason = "variants mirror Source DocumentOp kinds; block ops arrive in later phases"
)]
pub(crate) enum AiOp {
    InsertText {
        node: String,
        at: f64,
        text: String,
    },
    RemoveText {
        node: String,
        at: f64,
        len: f64,
    },
    SetText {
        node: String,
        text: String,
    },
    AppendText {
        node: String,
        text: String,
    },
    PrependText {
        node: String,
        text: String,
    },
    ReplaceText {
        node: String,
        find: String,
        to: String,
        scope: Scope,
    },
}

#[derive(Clone, Debug)]
struct AiOpCommand {
    /// `None` when the op kind or shape is not supported yet.
    op: Option<AiOp>,
    merge: bool,
}

static AI_OP: CommandKey<AiOpCommand> = CommandKey::new("group-c.ai-op");
static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&AI_OP),
    priority: CommandPriority::Normal,
    placement: Placement::After,
}];

pub(super) fn decode(name: &str, json: &str, _generation: u32) -> Result<Option<Command>, Error> {
    if name != AI_OP.name() {
        return Ok(None);
    }
    let value: serde_json::Value = serde_json::from_str(json)?;
    let serde_json::Value::Object(envelope) = value else {
        return Err(Error::Invariant("group-c.ai-op payload must be an object"));
    };
    let merge = match envelope.get("merge") {
        None => false,
        Some(serde_json::Value::Bool(merge)) => *merge,
        Some(_) => return Err(Error::Invariant("group-c.ai-op merge must be a boolean")),
    };
    // An op this applier does not implement is refused, never fatal.
    let op = match envelope.get("op") {
        Some(op @ serde_json::Value::Object(_)) => serde_json::from_value(op.clone()).ok(),
        _ => None,
    };
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &AI_OP,
        AiOpCommand { op, merge },
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(AiOps)
}

/// A Source `EditError`: the op is refused and the document is unchanged.
#[derive(Debug)]
pub(crate) struct Refused;

pub(crate) type OpResult<T> = Result<Result<T, Refused>, Error>;

struct AiOps;
impl Plugin for AiOps {
    fn name(&self) -> &'static str {
        "group-c.ai-ops"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(command) = command.payload(&AI_OP) else {
            return Ok(Handled::No);
        };
        let Some(op) = &command.op else {
            return Ok(Handled::No);
        };
        // Source applyAiOps drops the selection before the first op.
        tx.set_selection(None)?;
        if command.merge {
            tx.add_tag(UpdateTag::HistoryMerge);
        }
        Ok(match apply(tx, op)? {
            Ok(()) => Handled::Yes,
            Err(Refused) => Handled::No,
        })
    }
}

/// Validate first, write second: a refusal leaves the transaction untouched.
pub(crate) fn apply(tx: &mut Transaction<'_>, op: &AiOp) -> OpResult<()> {
    match op {
        AiOp::InsertText { node, at, text } => text::insert_text(tx, node, *at, text),
        AiOp::RemoveText { node, at, len } => text::remove_text(tx, node, *at, *len),
        AiOp::SetText { node, text } => text::set_text(tx, node, text),
        AiOp::AppendText { node, text } => text::append_text(tx, node, text),
        AiOp::PrependText { node, text } => text::prepend_text(tx, node, text),
        AiOp::ReplaceText {
            node,
            find,
            to,
            scope,
        } => text::replace_text(tx, node, find, to, *scope),
    }
}

/// Source MarkdownPopup `resolveSelectedNodeIds`: durable ids of every
/// top-level block the range selection touches, deduplicated in order.
pub(super) fn query(
    name: &str,
    _data: &serde_json::Value,
    _generation: u32,
    state: &EditorState,
) -> Result<Option<serde_json::Value>, Error> {
    if name != "group-c.selected-block-ids" {
        return Ok(None);
    }
    let view = state.view();
    let Some(Selection::Range(selection)) = view.selection() else {
        return Ok(Some(serde_json::Value::Array(Vec::new())));
    };
    let mut ids: Vec<serde_json::Value> = Vec::new();
    for node in selection.nodes(view)? {
        let top = view.top_level_element(node)?.unwrap_or(node);
        if let Some(id) = crate::node_ids::get_id(view, top)? {
            let id = serde_json::Value::String(id.into());
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    Ok(Some(serde_json::Value::Array(ids)))
}

/// Source `$byId`: the node currently carrying a durable id.
pub(crate) fn by_id(tx: &Transaction<'_>, id: &str) -> Result<Option<NodeKey>, Error> {
    // Read the durable `id` state itself: hosts index ids differently
    // (`NodeIdState` in the model plugin, `NodeIdIndex` in document_session).
    let view = tx.view();
    for (key, _) in view.descendants(view.root()) {
        if crate::node_ids::get_id(view, key)?.is_some_and(|found| found.as_str() == id) {
            return Ok(Some(key));
        }
    }
    Ok(None)
}

/// Source `$blockById`: the nearest block-level element at or above the id.
pub(crate) fn block_by_id(tx: &Transaction<'_>, id: &str) -> Result<Option<NodeKey>, Error> {
    let Some(mut key) = by_id(tx, id)? else {
        return Ok(None);
    };
    let view = tx.view();
    loop {
        if view.kind(key) == Some(NodeKind::Element) && !view.is_inline(key) {
            return Ok(Some(key));
        }
        let Some(parent) = view.parent(key) else {
            return Ok(None);
        };
        key = parent;
    }
}

/// Source `Doc.textBlock`: a block that holds text, not a table/list/root container.
pub(crate) fn text_block(tx: &Transaction<'_>, id: &str) -> Result<Option<NodeKey>, Error> {
    let Some(block) = block_by_id(tx, id)? else {
        return Ok(None);
    };
    let container = matches!(
        tx.type_name(block)?,
        "table" | "tablerow" | "tablecell" | "list" | "task-list" | "root"
    );
    Ok((!container).then_some(block))
}

#[cfg(test)]
mod test;
