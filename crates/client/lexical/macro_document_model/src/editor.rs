//! Exact node registries matching lexical-service and web presets.
use crate::nodes::*;
use lexical_model::*;
use lexical_rich_nodes::{
    code::{CodeHighlightNode, CodeNode},
    heading::HeadingNode,
    link::{AutoLinkNode, LinkNode},
    list::{ListItemNode, ListNode},
    mark::MarkNode,
    quote::QuoteNode,
    table::{TableCellNode, TableNode, TableRowNode},
};
/// Web editor preset.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditorType {
    /// Plain text.
    PlainText,
    /// Single-line title with inline search.
    Title,
    /// Markdown document.
    Markdown,
    /// Markdown with synchronization.
    MarkdownSync,
    /// Chat composer, excluding video.
    Chat,
    /// Calendar composer, excluding HTML and media.
    Calendar,
}
/// Explicit registry and replacement policy for every entry point.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditorConfig {
    /// All supported classes without replacements or plugins.
    Export,
    /// All classes and the code/list replacements.
    Headless,
    /// Web preset classes and applicable replacements.
    Preset(EditorType),
}
type NodeRegistration = (&'static str, fn(EditorBuilder) -> EditorBuilder);
fn register<T: NodeType>(builder: EditorBuilder) -> EditorBuilder {
    builder.node::<T>()
}
const SUPPORTED_REGISTRATIONS: &[NodeRegistration] = &[
    (CodeNode::TYPE, register::<CodeNode>),
    (CustomCodeNode::TYPE, register::<CustomCodeNode>),
    (DatabaseQueryNode::TYPE, register::<DatabaseQueryNode>),
    (HeadingNode::TYPE, register::<HeadingNode>),
    (LinkNode::TYPE, register::<LinkNode>),
    (AutoLinkNode::TYPE, register::<AutoLinkNode>),
    (ListNode::TYPE, register::<ListNode>),
    (TaskListNode::TYPE, register::<TaskListNode>),
    (ListItemNode::TYPE, register::<ListItemNode>),
    (QuoteNode::TYPE, register::<QuoteNode>),
    (DocumentMentionNode::TYPE, register::<DocumentMentionNode>),
    (DocumentCardNode::TYPE, register::<DocumentCardNode>),
    (PasteNode::TYPE, register::<PasteNode>),
    (UserMentionNode::TYPE, register::<UserMentionNode>),
    (ContactMentionNode::TYPE, register::<ContactMentionNode>),
    (DateMentionNode::TYPE, register::<DateMentionNode>),
    (
        PullRequestMentionNode::TYPE,
        register::<PullRequestMentionNode>,
    ),
    (
        BookingLinkMentionNode::TYPE,
        register::<BookingLinkMentionNode>,
    ),
    (
        AgentSessionMentionNode::TYPE,
        register::<AgentSessionMentionNode>,
    ),
    (ReplyTargetNode::TYPE, register::<ReplyTargetNode>),
    (GroupMentionNode::TYPE, register::<GroupMentionNode>),
    (InlineSearchNode::TYPE, register::<InlineSearchNode>),
    (UnlinkedTextNode::TYPE, register::<UnlinkedTextNode>),
    (CodeHighlightNode::TYPE, register::<CodeHighlightNode>),
    (ImageNode::TYPE, register::<ImageNode>),
    (VideoNode::TYPE, register::<VideoNode>),
    (TableNode::TYPE, register::<TableNode>),
    (TableCellNode::TYPE, register::<TableCellNode>),
    (TableRowNode::TYPE, register::<TableRowNode>),
    (CompletionNode::TYPE, register::<CompletionNode>),
    (MarkNode::TYPE, register::<MarkNode>),
    (CommentNode::TYPE, register::<CommentNode>),
    (SearchMatchNode::TYPE, register::<SearchMatchNode>),
    (EquationNode::TYPE, register::<EquationNode>),
    (SnapshotNode::TYPE, register::<SnapshotNode>),
    (HorizontalRuleNode::TYPE, register::<HorizontalRuleNode>),
    (DiffNode::TYPE, register::<DiffNode>),
    (DiffInsertNode::TYPE, register::<DiffInsertNode>),
    (DiffDeleteNode::TYPE, register::<DiffDeleteNode>),
    (DiffTextNode::TYPE, register::<DiffTextNode>),
    (HtmlRenderNode::TYPE, register::<HtmlRenderNode>),
    (ClassedBlockNode::TYPE, register::<ClassedBlockNode>),
    (WatermarkNode::TYPE, register::<WatermarkNode>),
    (ThemeMentionNode::TYPE, register::<ThemeMentionNode>),
    (TagMentionNode::TYPE, register::<TagMentionNode>),
    (ConnectAppNode::TYPE, register::<ConnectAppNode>),
    (
        AccountManagerRequestNode::TYPE,
        register::<AccountManagerRequestNode>,
    ),
    (UnknownMentionNode::TYPE, register::<UnknownMentionNode>),
    (AwaitNode::TYPE, register::<AwaitNode>),
    (MagicChipNode::TYPE, register::<MagicChipNode>),
    (AgentActivityNode::TYPE, register::<AgentActivityNode>),
    (AgentContextNode::TYPE, register::<AgentContextNode>),
    (
        CursorSystemNotificationNode::TYPE,
        register::<CursorSystemNotificationNode>,
    ),
];
/// Whether a serialized type belongs to the source supported registry.
pub fn is_supported_node_type(name: &str) -> bool {
    matches!(name, "root" | "paragraph" | "text" | "tab" | "linebreak")
        || SUPPORTED_REGISTRATIONS.iter().any(|(ty, _)| *ty == name)
}
/// Register one named source class, retaining the caller's mode and other classes.
pub fn register_supported_node(builder: EditorBuilder, name: &str) -> crate::ModelResult<EditorBuilder> {
    if matches!(name, "root" | "paragraph" | "text" | "tab" | "linebreak") {
        return Ok(builder);
    }
    let (_, register) = SUPPORTED_REGISTRATIONS
        .iter()
        .find(|(ty, _)| *ty == name)
        .ok_or_else(|| Error::UnknownSerializedType(name.into()))?;
    Ok(register(builder))
}
/// Register every supported class in the source registry's order.
pub fn register_supported_nodes(builder: EditorBuilder) -> EditorBuilder {
    SUPPORTED_REGISTRATIONS
        .iter()
        .fold(builder, |builder, (_, register)| register(builder))
}
/// Export/gate registry builder; unknown types remain errors, replacements are absent.
pub fn export_builder() -> EditorBuilder {
    register_supported_nodes(Editor::builder(EditorMode::Headless))
}
/// Build the lexical-service document export registry, without code/list replacements.
pub fn export_registry() -> Editor {
    export_builder()
        .build()
        .expect("valid static Macro export registry")
}
/// Headless registry builder, with the two source NodeReplacements.
pub fn headless_builder() -> EditorBuilder {
    register_supported_nodes(Editor::builder(EditorMode::Headless))
        .replace::<CodeNode, CustomCodeNode>(CustomCodeNode::from)
        .replace::<ListNode, TaskListNode>(TaskListNode::from)
}
/// Build the replacement-enabled headless registry.
pub fn headless_editor() -> Editor {
    headless_builder()
        .build()
        .expect("valid static Macro headless registry")
}
/// Web preset builder with exactly the source exclusions and applicable replacements.
pub fn preset_builder(ty: EditorType) -> EditorBuilder {
    match ty {
        EditorType::PlainText => Editor::builder(EditorMode::ViewAttached),
        EditorType::Title => Editor::builder(EditorMode::ViewAttached).node::<InlineSearchNode>(),
        EditorType::Markdown
        | EditorType::MarkdownSync
        | EditorType::Chat
        | EditorType::Calendar => {
            let builder = register_preset_nodes(Editor::builder(EditorMode::ViewAttached), ty);
            builder
                .replace::<CodeNode, CustomCodeNode>(CustomCodeNode::from)
                .replace::<ListNode, TaskListNode>(TaskListNode::from)
        }
    }
}
/// Build a view-attached web preset.
pub fn preset_editor(ty: EditorType) -> Editor {
    preset_builder(ty)
        .build()
        .expect("valid static Macro preset registry")
}
fn register_preset_nodes(builder: EditorBuilder, ty: EditorType) -> EditorBuilder {
    let builder = builder.node::<CodeNode>();
    let builder = builder.node::<CustomCodeNode>();
    let builder = builder.node::<DatabaseQueryNode>();
    let builder = builder.node::<HeadingNode>();
    let builder = builder.node::<LinkNode>();
    let builder = builder.node::<AutoLinkNode>();
    let builder = builder.node::<ListNode>();
    let builder = builder.node::<TaskListNode>();
    let builder = builder.node::<ListItemNode>();
    let builder = builder.node::<QuoteNode>();
    let builder = builder.node::<DocumentMentionNode>();
    let builder = builder.node::<DocumentCardNode>();
    let builder = builder.node::<PasteNode>();
    let builder = builder.node::<UserMentionNode>();
    let builder = builder.node::<ContactMentionNode>();
    let builder = builder.node::<DateMentionNode>();
    let builder = builder.node::<PullRequestMentionNode>();
    let builder = builder.node::<BookingLinkMentionNode>();
    let builder = builder.node::<AgentSessionMentionNode>();
    let builder = builder.node::<ReplyTargetNode>();
    let builder = builder.node::<GroupMentionNode>();
    let builder = builder.node::<InlineSearchNode>();
    let builder = builder.node::<UnlinkedTextNode>();
    let builder = builder.node::<CodeHighlightNode>();
    let builder = if ty != EditorType::Calendar {
        builder.node::<ImageNode>()
    } else {
        builder
    };
    let builder = if !matches!(ty, EditorType::Chat | EditorType::Calendar) {
        builder.node::<VideoNode>()
    } else {
        builder
    };
    let builder = builder.node::<TableNode>();
    let builder = builder.node::<TableCellNode>();
    let builder = builder.node::<TableRowNode>();
    let builder = builder.node::<CompletionNode>();
    let builder = builder.node::<MarkNode>();
    let builder = builder.node::<CommentNode>();
    let builder = builder.node::<SearchMatchNode>();
    let builder = builder.node::<EquationNode>();
    let builder = builder.node::<SnapshotNode>();
    let builder = builder.node::<HorizontalRuleNode>();
    let builder = builder.node::<DiffNode>();
    let builder = builder.node::<DiffInsertNode>();
    let builder = builder.node::<DiffDeleteNode>();
    let builder = builder.node::<DiffTextNode>();
    let builder = if ty != EditorType::Calendar {
        builder.node::<HtmlRenderNode>()
    } else {
        builder
    };
    let builder = builder.node::<ClassedBlockNode>();
    let builder = builder.node::<WatermarkNode>();
    let builder = builder.node::<ThemeMentionNode>();
    let builder = builder.node::<TagMentionNode>();
    let builder = builder.node::<ConnectAppNode>();
    let builder = builder.node::<AccountManagerRequestNode>();
    let builder = builder.node::<UnknownMentionNode>();
    let builder = builder.node::<AwaitNode>();
    let builder = builder.node::<MagicChipNode>();
    let builder = builder.node::<AgentActivityNode>();
    let builder = builder.node::<AgentContextNode>();
    builder.node::<CursorSystemNotificationNode>()
}
