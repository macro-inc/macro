//! Native AI-edit operations: the Source `Doc.apply` semantics of the
//! ai-editing worker's `DocumentOp`s, over the native model.
//!
//! Each op is one application input, grouped for undo by the editor's history
//! rule like any other commit (Source groups AI edits by its 400 ms merge
//! window, not per edit). A refused op changes no document, selection, tag or
//! history state: it emits one typed `group-c.ai-op-refused` event and reports
//! `Handled::No`; the host reports it and applies the ops after it, as the app's
//! Source editor drops a failing update and carries on.
//!
//! The op types and appliers depend only on the model, so the worker could
//! adopt them later.
use lexical_model::*;
use lexical_rich_nodes::heading::HeadingTagType;
use lexical_rich_nodes::list::ListType;

mod nodes;
mod text;

/// Source `Scope` (`nth` is 1-based; 0 or a fraction matches nothing, as in Source).
#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Scope {
    Nth { n: f64 },
    All,
}

/// Source `Format`, a text format a `formatNode` sets or clears.
#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
enum WireFormat {
    Bold,
    Italic,
    Underline,
    Strike,
    Code,
}

impl From<WireFormat> for TextFormatType {
    fn from(format: WireFormat) -> Self {
        match format {
            WireFormat::Bold => Self::Bold,
            WireFormat::Italic => Self::Italic,
            WireFormat::Underline => Self::Underline,
            WireFormat::Strike => Self::Strikethrough,
            WireFormat::Code => Self::Code,
        }
    }
}

/// Source `Position` as sent. Source `place` tests the keys in this order and
/// takes any other object as `prependToRoot`.
#[derive(Clone, Debug, serde::Deserialize)]
struct WirePosition {
    after: Option<String>,
    before: Option<String>,
    #[serde(rename = "appendToRoot")]
    append_to_root: Option<serde_json::Value>,
}

/// Where a moved or inserted node goes.
#[derive(Clone, Debug)]
pub(crate) enum Position {
    After(String),
    Before(String),
    AppendToRoot,
    PrependToRoot,
}

impl From<WirePosition> for Position {
    fn from(at: WirePosition) -> Self {
        match (at.after, at.before, at.append_to_root) {
            (Some(after), _, _) => Self::After(after),
            (None, Some(before), _) => Self::Before(before),
            (None, None, Some(_)) => Self::AppendToRoot,
            (None, None, None) => Self::PrependToRoot,
        }
    }
}

/// Source `BlockType` for `setBlockType`.
#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
enum WireBlockType {
    Paragraph,
    Heading,
    Quote,
    Code,
}

/// Source `setIndent.indent`: a step or an absolute level.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(untagged)]
enum WireIndent {
    Step(WireStep),
    Level(f64),
}

#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
enum WireStep {
    In,
    Out,
}

/// A block type `setBlockType` builds (Source `blocks.$blockNode`).
#[derive(Clone, Debug)]
pub(crate) enum BlockType {
    Paragraph,
    Heading(HeadingTagType),
    Quote,
    Code(Option<String>),
}

/// A validated `setIndent` target.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Indent {
    In,
    Out,
    Level(u32),
}

/// Source `NodeSpec` block kinds this applier builds (`Doc.buildNode`).
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(tag = "block", rename_all = "camelCase")]
enum WireBlockSpec {
    Paragraph {
        text: Option<String>,
    },
    Heading {
        level: f64,
        text: Option<String>,
    },
    Quote {
        text: Option<String>,
    },
    Code {
        language: Option<String>,
        text: Option<String>,
    },
    List {
        list: WireListKind,
        items: Vec<String>,
    },
    Table {
        rows: Vec<Vec<String>>,
    },
    Divider {},
    Equation {
        tex: String,
        inline: Option<bool>,
    },
}

/// The block kinds `WireBlockSpec` decodes; other Source kinds (cards, HTML,
/// database queries, media) belong to later phases and are refused.
const SUPPORTED_BLOCKS: [&str; 8] = [
    "paragraph",
    "heading",
    "quote",
    "code",
    "list",
    "table",
    "divider",
    "equation",
];

#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
enum WireListKind {
    Bullet,
    Number,
    Check,
}

/// A block `insertNode` builds, validated.
#[derive(Clone, Debug)]
pub(crate) enum InsertSpec {
    Paragraph(Option<String>),
    Heading(HeadingTagType, Option<String>),
    Quote(Option<String>),
    Code {
        language: Option<String>,
        text: Option<String>,
    },
    List {
        list: ListType,
        items: Vec<String>,
    },
    Table(Vec<Vec<String>>),
    Divider,
    Equation {
        tex: String,
        inline: bool,
    },
}

/// Source `insertNode`'s spec: an inline spec throws ("insertNode requires a
/// block spec"); a block kind this applier does not build, or a spec that does
/// not match its kind, is refused as unsupported (Source would build an
/// invalid node from a malformed spec).
fn insert_spec(spec: serde_json::Value) -> Result<InsertSpec, AiOpRefusal> {
    if spec.get("inline").is_some() {
        return Err(AiOpRefusal::WrongTarget);
    }
    if !spec
        .get("block")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|block| SUPPORTED_BLOCKS.contains(&block))
    {
        return Err(AiOpRefusal::UnsupportedOp);
    }
    let spec: WireBlockSpec =
        serde_json::from_value(spec).map_err(|_| AiOpRefusal::UnsupportedOp)?;
    Ok(match spec {
        WireBlockSpec::Paragraph { text } => InsertSpec::Paragraph(text),
        WireBlockSpec::Heading { level, text } => InsertSpec::Heading(heading_tag(level)?, text),
        WireBlockSpec::Quote { text } => InsertSpec::Quote(text),
        WireBlockSpec::Code { language, text } => InsertSpec::Code { language, text },
        WireBlockSpec::List { list, items } => InsertSpec::List {
            list: match list {
                WireListKind::Bullet => ListType::Bullet,
                WireListKind::Number => ListType::Number,
                WireListKind::Check => ListType::Check,
            },
            items,
        },
        WireBlockSpec::Table { rows } => InsertSpec::Table(rows),
        WireBlockSpec::Divider {} => InsertSpec::Divider,
        WireBlockSpec::Equation { tex, inline } => InsertSpec::Equation {
            tex,
            inline: inline.unwrap_or(false),
        },
    })
}

/// The wire shape of the `DocumentOp`s this applier implements.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum WireOp {
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
    RemoveNode {
        node: String,
    },
    MoveNode {
        node: String,
        at: WirePosition,
    },
    FormatNode {
        node: String,
        format: WireFormat,
        on: bool,
    },
    ClearNodeFormat {
        node: String,
    },
    SetBlockType {
        node: String,
        block: WireBlockType,
        level: Option<f64>,
        language: Option<String>,
    },
    SetIndent {
        node: String,
        indent: WireIndent,
    },
    MergeBlocks {
        nodes: Vec<String>,
        separator: String,
    },
    InsertNode {
        #[serde(rename = "ref")]
        reference: String,
        spec: serde_json::Value,
        at: WirePosition,
    },
}

/// Kinds `WireOp` decodes; any other Source kind is refused as unsupported.
const SUPPORTED_KINDS: [&str; 14] = [
    "insertText",
    "removeText",
    "setText",
    "appendText",
    "prependText",
    "replaceText",
    "removeNode",
    "moveNode",
    "formatNode",
    "clearNodeFormat",
    "setBlockType",
    "setIndent",
    "mergeBlocks",
    "insertNode",
];

/// A validated op: offsets and lengths are safe integers (UTF-16 units).
#[derive(Clone, Debug)]
pub(crate) enum AiOp {
    InsertText {
        node: String,
        at: u64,
        text: String,
    },
    RemoveText {
        node: String,
        at: u64,
        len: u64,
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
    RemoveNode {
        node: String,
    },
    MoveNode {
        node: String,
        at: Position,
    },
    FormatNode {
        node: String,
        format: TextFormatType,
        on: bool,
    },
    ClearNodeFormat {
        node: String,
    },
    SetBlockType {
        node: String,
        block: BlockType,
    },
    SetIndent {
        node: String,
        indent: Indent,
    },
    MergeBlocks {
        nodes: Vec<String>,
        separator: String,
    },
    InsertNode {
        /// The op's ref, which becomes the inserted node's id.
        reference: String,
        spec: InsertSpec,
        at: Position,
    },
}

/// The numeric op field a refusal names.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NumberField {
    /// `insertText.at` or `removeText.at`.
    At,
    /// `removeText.len`.
    Len,
    /// `setIndent.indent`.
    Indent,
    /// `setBlockType.level`.
    Level,
}

/// Why a number is outside the AI-edit domain (finite non-negative safe integers).
///
/// Source's JavaScript `slice` accepts every one of these; native refuses them
/// as corrupt model input (a named difference, not Source parity).
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NumberProblem {
    /// Not representable in JSON; reachable only through direct Rust callers.
    NonFinite,
    /// Below zero.
    Negative,
    /// Has a fractional part.
    Fractional,
    /// Above `Number.MAX_SAFE_INTEGER`.
    AboveMaxSafeInteger,
    /// Outside the values the native model can represent: a heading level other
    /// than 1-6 (Source would build an invalid `h7`-style heading) or an indent
    /// above `u32::MAX` (Source would loop for each level).
    OutOfRange,
}

/// Why an AI op was refused. The document, selection and history are unchanged.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "cause", rename_all = "camelCase")]
pub enum AiOpRefusal {
    /// A Source op kind or target this applier does not implement yet.
    UnsupportedOp,
    /// A number outside the AI-edit domain.
    InvalidNumber {
        /// The field.
        field: NumberField,
        /// What is wrong with it.
        problem: NumberProblem,
    },
    /// `at + len` exceeds `Number.MAX_SAFE_INTEGER`.
    RangeTooLarge,
    /// No node carries the id.
    UnknownNode,
    /// The id names a node this op cannot edit (a container, or no block).
    WrongTarget,
    /// `replaceText` found nothing to replace.
    FindMissed,
    /// The edit would split a UTF-16 surrogate pair.
    SplitsSurrogate,
}

/// The host event for a refused op, emitted in the same input's output.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AiOpRefused {
    /// The typed cause.
    pub cause: AiOpRefusal,
    /// The host's token for the `group-c.ai-op` input that was refused, so a
    /// refusal is attributed to its own input and never to nested work.
    pub invocation: u32,
}

pub(crate) static AI_OP_REFUSED: EventKey<AiOpRefused> = EventKey::new("group-c.ai-op-refused");

/// `Number.MAX_SAFE_INTEGER`.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// A finite non-negative safe integer, else the typed problem.
pub(crate) fn safe_integer(value: f64, field: NumberField) -> Result<u64, AiOpRefusal> {
    let problem = if !value.is_finite() {
        NumberProblem::NonFinite
    } else if value < 0.0 {
        NumberProblem::Negative
    } else if value.fract() != 0.0 {
        NumberProblem::Fractional
    } else if value > MAX_SAFE_INTEGER as f64 {
        NumberProblem::AboveMaxSafeInteger
    } else {
        // Exact: a non-negative integral f64 at or below 2^53 - 1.
        return Ok(value as u64);
    };
    Err(AiOpRefusal::InvalidNumber { field, problem })
}

fn validate(op: WireOp) -> Result<AiOp, AiOpRefusal> {
    Ok(match op {
        WireOp::InsertText { node, at, text } => AiOp::InsertText {
            node,
            at: safe_integer(at, NumberField::At)?,
            text,
        },
        WireOp::RemoveText { node, at, len } => {
            let at = safe_integer(at, NumberField::At)?;
            let len = safe_integer(len, NumberField::Len)?;
            // Both are at most 2^53 - 1, so the sum cannot overflow u64.
            if at.checked_add(len).is_none_or(|end| end > MAX_SAFE_INTEGER) {
                return Err(AiOpRefusal::RangeTooLarge);
            }
            AiOp::RemoveText { node, at, len }
        }
        WireOp::SetText { node, text } => AiOp::SetText { node, text },
        WireOp::AppendText { node, text } => AiOp::AppendText { node, text },
        WireOp::PrependText { node, text } => AiOp::PrependText { node, text },
        WireOp::ReplaceText {
            node,
            find,
            to,
            scope,
        } => AiOp::ReplaceText {
            node,
            find,
            to,
            scope,
        },
        WireOp::RemoveNode { node } => AiOp::RemoveNode { node },
        WireOp::MoveNode { node, at } => AiOp::MoveNode {
            node,
            at: at.into(),
        },
        WireOp::FormatNode { node, format, on } => AiOp::FormatNode {
            node,
            format: format.into(),
            on,
        },
        WireOp::ClearNodeFormat { node } => AiOp::ClearNodeFormat { node },
        WireOp::SetBlockType {
            node,
            block,
            level,
            language,
        } => AiOp::SetBlockType {
            node,
            block: match block {
                WireBlockType::Paragraph => BlockType::Paragraph,
                // Source `h${level ?? 1}`.
                WireBlockType::Heading => BlockType::Heading(heading_tag(level.unwrap_or(1.0))?),
                WireBlockType::Quote => BlockType::Quote,
                WireBlockType::Code => BlockType::Code(language),
            },
        },
        WireOp::SetIndent { node, indent } => AiOp::SetIndent {
            node,
            indent: match indent {
                WireIndent::Step(WireStep::In) => Indent::In,
                WireIndent::Step(WireStep::Out) => Indent::Out,
                WireIndent::Level(level) => Indent::Level(indent_level(level)?),
            },
        },
        WireOp::MergeBlocks { nodes, separator } => AiOp::MergeBlocks { nodes, separator },
        WireOp::InsertNode {
            reference,
            spec,
            at,
        } => AiOp::InsertNode {
            reference,
            spec: insert_spec(spec)?,
            at: at.into(),
        },
    })
}

/// Lexical `ListItemNode.setIndent`: a fraction is floored; a negative or
/// non-finite value throws there and is refused here.
fn indent_level(level: f64) -> Result<u32, AiOpRefusal> {
    let refuse = |problem| AiOpRefusal::InvalidNumber {
        field: NumberField::Indent,
        problem,
    };
    if !level.is_finite() {
        return Err(refuse(NumberProblem::NonFinite));
    }
    let floored = level.floor();
    if floored < 0.0 {
        return Err(refuse(NumberProblem::Negative));
    }
    if floored > f64::from(u32::MAX) {
        return Err(refuse(NumberProblem::OutOfRange));
    }
    // Exact: a non-negative integral f64 at or below u32::MAX.
    Ok(floored as u32)
}

/// A heading level 1-6 as its tag.
fn heading_tag(level: f64) -> Result<HeadingTagType, AiOpRefusal> {
    let refuse = |problem| AiOpRefusal::InvalidNumber {
        field: NumberField::Level,
        problem,
    };
    let level = safe_integer(level, NumberField::Level)?;
    Ok(match level {
        1 => HeadingTagType::H1,
        2 => HeadingTagType::H2,
        3 => HeadingTagType::H3,
        4 => HeadingTagType::H4,
        5 => HeadingTagType::H5,
        6 => HeadingTagType::H6,
        _ => return Err(refuse(NumberProblem::OutOfRange)),
    })
}

#[derive(Clone, Debug)]
struct AiOpCommand {
    /// The validated op, or the refusal the handler reports.
    op: Result<AiOp, AiOpRefusal>,
    invocation: u32,
}

static AI_OP: CommandKey<AiOpCommand> = CommandKey::new("group-c.ai-op");
/// Source applyAiOps' first update: `$setSelection(null)`, even for no ops.
static AI_EDIT_CLEAR_SELECTION: CommandKey<()> = CommandKey::new("group-c.ai-edit-clear-selection");
static COMMANDS: [CommandRegistration; 2] = [
    CommandRegistration {
        command: CommandKind::Extension(&AI_OP),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
    CommandRegistration {
        command: CommandKind::Extension(&AI_EDIT_CLEAR_SELECTION),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    },
];

/// Decode `group-c.ai-op {op, invocation}`. A malformed envelope is a decode error;
/// an unsupported kind or out-of-domain number decodes to a typed refusal.
pub(super) fn decode(name: &str, json: &str, _generation: u32) -> Result<Option<Command>, Error> {
    if name == AI_EDIT_CLEAR_SELECTION.name() {
        // Closed payload: the clear takes no arguments.
        if serde_json::from_str::<serde_json::Value>(json)? != serde_json::json!({}) {
            return Err(Error::Invariant(
                "group-c.ai-edit-clear-selection payload must be {}",
            ));
        }
        return Ok(Some(Command::Extension(ExtensionCommand::new(
            &AI_EDIT_CLEAR_SELECTION,
            (),
        ))));
    }
    if name != AI_OP.name() {
        return Ok(None);
    }
    let value: serde_json::Value = serde_json::from_str(json)?;
    let serde_json::Value::Object(envelope) = value else {
        return Err(Error::Invariant("group-c.ai-op payload must be an object"));
    };
    // Closed envelope: a stale `merge` from an older host must not be ignored.
    if envelope
        .keys()
        .any(|key| key != "op" && key != "invocation")
    {
        return Err(Error::Invariant(
            "group-c.ai-op payload takes only op and invocation",
        ));
    }
    let invocation = match envelope
        .get("invocation")
        .and_then(serde_json::Value::as_u64)
    {
        Some(token) => u32::try_from(token)
            .map_err(|_| Error::Invariant("group-c.ai-op invocation must be a u32"))?,
        None => return Err(Error::Invariant("group-c.ai-op invocation must be a u32")),
    };
    let Some(op @ serde_json::Value::Object(fields)) = envelope.get("op") else {
        return Err(Error::Invariant("group-c.ai-op op must be an object"));
    };
    let Some(serde_json::Value::String(kind)) = fields.get("kind") else {
        return Err(Error::Invariant("group-c.ai-op op.kind must be a string"));
    };
    let op = if SUPPORTED_KINDS.contains(&kind.as_str()) {
        let wire: WireOp = serde_json::from_value(op.clone())
            .map_err(|_| Error::Invariant("group-c.ai-op op fields do not match its kind"))?;
        validate(wire)
    } else {
        Err(AiOpRefusal::UnsupportedOp)
    };
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &AI_OP,
        AiOpCommand { op, invocation },
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(AiOps)
}

pub(crate) type OpResult<T> = Result<Result<T, AiOpRefusal>, Error>;

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
        if command.payload(&AI_EDIT_CLEAR_SELECTION).is_some() {
            // Selection only, untagged, like Source's discrete clear update.
            tx.set_selection(None)?;
            return Ok(Handled::Yes);
        }
        let Some(command) = command.payload(&AI_OP) else {
            return Ok(Handled::No);
        };
        // Plan against the current state before any write: a refusal is decided
        // while selection, tags and nodes are untouched.
        let planned = match &command.op {
            Ok(op) => plan(tx, op)?,
            Err(refusal) => Err(*refusal),
        };
        match planned {
            Ok(writes) => {
                // Source applyAiOps drops the selection before an edit's ops run.
                tx.set_selection(None)?;
                text::execute(tx, writes)?;
                Ok(Handled::Yes)
            }
            Err(cause) => {
                // Event-only commit: no document, selection, tag or history change.
                tx.emit(
                    &AI_OP_REFUSED,
                    AiOpRefused {
                        cause,
                        invocation: command.invocation,
                    },
                );
                Ok(Handled::No)
            }
        }
    }
}

/// Encode a refused op for the host: `{"cause": ...}`.
pub(super) fn event_payload(event: &PluginEvent) -> Result<Option<serde_json::Value>, Error> {
    let Some(refused) = event.payload(&AI_OP_REFUSED) else {
        return Ok(None);
    };
    // `{"cause": …, …fields, "invocation": n}`; the cause stays a closed tag.
    let mut payload = serde_json::to_value(refused.cause)?;
    let serde_json::Value::Object(fields) = &mut payload else {
        return Err(Error::Invariant(
            "group-c.ai-op-refused cause must encode as an object",
        ));
    };
    fields.insert("invocation".into(), refused.invocation.into());
    Ok(Some(payload))
}

/// Plan one op without writing: its ordered writes, or the typed refusal.
pub(crate) fn plan(tx: &Transaction<'_>, op: &AiOp) -> OpResult<Vec<text::Write>> {
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
        AiOp::RemoveNode { node } => nodes::remove_node(tx, node),
        AiOp::MoveNode { node, at } => nodes::move_node(tx, node, at),
        AiOp::FormatNode { node, format, on } => nodes::format_node(tx, node, *format, *on),
        AiOp::ClearNodeFormat { node } => nodes::clear_node_format(tx, node),
        AiOp::SetBlockType { node, block } => nodes::set_block_type(tx, node, block),
        AiOp::SetIndent { node, indent } => nodes::set_indent(tx, node, *indent),
        AiOp::MergeBlocks { nodes, separator } => nodes::merge_blocks(tx, nodes, separator),
        AiOp::InsertNode {
            reference,
            spec,
            at,
        } => nodes::insert_node(tx, reference, spec, at),
    }
}

/// Source MarkdownPopup `resolveSelectedNodeIds`: durable ids of every
/// top-level block the range or table selection touches, deduplicated in order.
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
    // Source reads `getNodes()` of the popup's range or table selection; a
    // table selection yields the table, its rows and the selected cell
    // subtrees in document order.
    let nodes = match view.selection() {
        Some(selection @ (Selection::Range(_) | Selection::Table(_))) => selection.nodes(view)?,
        _ => return Ok(Some(serde_json::Value::Array(Vec::new()))),
    };
    let mut ids: Vec<serde_json::Value> = Vec::new();
    for node in nodes {
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
pub(crate) fn by_id(tx: &Transaction<'_>, id: &str) -> OpResult<NodeKey> {
    // Read the durable `id` state itself: hosts index ids differently
    // (`NodeIdState` in the model plugin, `NodeIdIndex` in document_session).
    let view = tx.view();
    for (key, _) in view.descendants(view.root()) {
        if crate::node_ids::get_id(view, key)?.is_some_and(|found| found.as_str() == id) {
            return Ok(Ok(key));
        }
    }
    Ok(Err(AiOpRefusal::UnknownNode))
}

/// Source `$blockById`: the nearest block-level element at or above the id.
pub(crate) fn block_by_id(tx: &Transaction<'_>, id: &str) -> OpResult<NodeKey> {
    let mut key = match by_id(tx, id)? {
        Ok(key) => key,
        Err(refusal) => return Ok(Err(refusal)),
    };
    let view = tx.view();
    loop {
        if view.kind(key) == Some(NodeKind::Element) && !view.is_inline(key) {
            return Ok(Ok(key));
        }
        let Some(parent) = view.parent(key) else {
            return Ok(Err(AiOpRefusal::WrongTarget));
        };
        key = parent;
    }
}

/// Source `Doc.textBlock`: a block that holds text, not a table/list/root container.
pub(crate) fn text_block(tx: &Transaction<'_>, id: &str) -> OpResult<NodeKey> {
    let block = match block_by_id(tx, id)? {
        Ok(block) => block,
        Err(refusal) => return Ok(Err(refusal)),
    };
    let container = matches!(
        tx.type_name(block)?,
        "table" | "tablerow" | "tablecell" | "list" | "task-list" | "root"
    );
    Ok(if container {
        Err(AiOpRefusal::WrongTarget)
    } else {
        Ok(block)
    })
}

#[cfg(test)]
mod test;
