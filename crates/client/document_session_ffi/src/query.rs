//! Typed bulk native queries without an editor snapshot crossing on every keystroke.
use crate::*;
/// Markdown export policy, shared with the portable boundary.
pub type FfiMarkdownFlavor = MarkdownFlavor;
#[uniffi::remote(Enum)]
enum FfiMarkdownFlavor {
    Upstream,
    Application,
}
pub(crate) fn markdown(
    state: &EditorState,
    flavor: FfiMarkdownFlavor,
) -> Result<String, FfiSessionError> {
    export_markdown(state, flavor, false).map_err(invalid)
}
/// Bulk query performed synchronously without I/O.
#[derive(uniffi::Enum)]
pub enum FfiQuery {
    /// Repaint the current view without resetting sync, history or model selection.
    ViewDiff,
    /// Read one node's serialized properties.
    Node {
        /// Generation-aware native key.
        key: NodeKey,
    },
    /// Read the editor's complete serialized root.
    State,
    /// Export HTML for the whole document or selection.
    Html {
        /// Select current selection only.
        selected: bool,
    },
    /// Export Markdown for the current selection.
    SelectedMarkdown {
        /// Markdown indentation policy.
        flavor: FfiMarkdownFlavor,
    },
    /// Export selected clipboard MIME payloads.
    Clipboard,
    /// Find Unicode regular expression matches using UTF-16 point offsets.
    Find {
        /// Unicode regex source.
        pattern: String,
        /// Ignore case using ECMAScript semantics.
        ignore_case: bool,
    },
    /// Count words in cached root text.
    WordCount,
    /// Query every registered node of one type.
    NodesOfType {
        /// Serialized native node type name.
        name: String,
    },
    /// Resolve a durable application node id.
    NodeById {
        /// Durable id.
        id: String,
    },
    /// Read registry node names and type indices in registration order.
    TypeTable,
    /// Read native listener command names in priority order.
    ListenerTable,
    /// Read the durable relative selection cursor.
    SelectionCursors,
}
/// A native query result, with only the requested payload.
#[derive(uniffi::Enum)]
pub enum FfiQueryReply {
    /// Full keyed view patch from an empty renderer.
    ViewDiff {
        /// Structured native patch.
        diff: Diff,
    },
    /// UTF-8 text export.
    Text {
        /// Exported text.
        text: String,
    },
    /// Serialized model nodes as typed properties.
    Nodes {
        /// Native keys in the same order as nodes.
        keys: Vec<NodeKey>,
        /// Typed serialized nodes.
        nodes: Vec<SerializedNode>,
    },
    /// Whole serialized root.
    State {
        /// Root properties and children.
        root: SerializedNode,
    },
    /// Number of words.
    Count {
        /// Exact count.
        count: u64,
    },
    /// Start/end points for regular expression matches.
    Matches {
        /// Paired UTF-16 match endpoints.
        points: Vec<Point>,
    },
    /// Host clipboard representations.
    Clipboard {
        /// Ordered MIME payloads.
        entries: Vec<FfiClipboardEntry>,
    },
    /// Registered node types.
    Types {
        /// Registry rows.
        rows: Vec<FfiTypeRow>,
    },
    /// Listener command names.
    Listeners {
        /// Ordered command names.
        rows: Vec<FfiListenerRow>,
    },
    /// Durable selection endpoints, absent for unrepresentable selection kinds.
    Cursors {
        /// Selection anchor.
        anchor: Option<NativeCursor>,
        /// Selection focus.
        focus: Option<NativeCursor>,
    },
}
/// Registered native node type metadata.
#[derive(uniffi::Record)]
pub struct FfiTypeRow {
    /// Dense native type index.
    pub index: u16,
    /// Serialized type name.
    pub name: String,
    /// Framework node category.
    pub kind: NodeKind,
    /// Static view behavior, absent when instance-specific.
    pub flags: Option<FfiTypeFlags>,
}
/// Static view behavior of a registered node type.
#[derive(uniffi::Record)]
pub struct FfiTypeFlags {
    /// Inline layout.
    pub is_inline: bool,
    /// Text may be inserted before it.
    pub can_insert_text_before: bool,
    /// Text may be inserted after it.
    pub can_insert_text_after: bool,
    /// Keyboard selection is allowed.
    pub is_keyboard_selectable: bool,
    /// Node is isolated.
    pub is_isolated: bool,
    /// Node is a shadow root.
    pub is_shadow_root: bool,
}
pub(crate) fn query(
    session: &DocumentSession<EditorSurface>,
    request: FfiQuery,
) -> Result<FfiQueryReply, FfiSessionError> {
    let surface = session.surface();
    let state = surface.state();
    let view = state.view();
    Ok(match request {
        FfiQuery::ViewDiff => FfiQueryReply::ViewDiff {
            diff: surface.view_diff().map_err(invalid)?,
        },
        FfiQuery::Node { key } => FfiQueryReply::Nodes {
            keys: vec![key],
            nodes: vec![view.export_json(key).map_err(invalid)?],
        },
        FfiQuery::State => FfiQueryReply::State {
            root: state.to_json().map_err(invalid)?.root,
        },
        FfiQuery::Html { selected } => FfiQueryReply::Text {
            text: export_html(state, selected).map_err(invalid)?,
        },
        FfiQuery::SelectedMarkdown { flavor } => FfiQueryReply::Text {
            text: export_markdown(state, flavor, true).map_err(invalid)?,
        },
        FfiQuery::WordCount => FfiQueryReply::Count {
            count: state.root_text_content().split_whitespace().count() as u64,
        },
        FfiQuery::Clipboard => {
            let mut entries = lexical_rich_nodes::clipboard::get_clipboard_data_from_selection(
                view,
                "document-session",
                state.selection(),
            )
            .map_err(invalid)?;
            if state.selection().is_some() {
                entries.insert("text/html", export_html(state, true).map_err(invalid)?);
            }
            FfiQueryReply::Clipboard {
                entries: entries
                    .into_iter()
                    .map(|(mime, text)| FfiClipboardEntry {
                        mime: mime.to_string(),
                        text: text.to_string(),
                    })
                    .collect(),
            }
        }
        FfiQuery::Find {
            pattern,
            ignore_case,
        } => {
            let matcher = lexical_rich_nodes::utils::matcher::RegexMatcher::new(
                &pattern,
                if ignore_case { "iu" } else { "u" },
            )
            .map_err(|_| invalid("invalid regular expression"))?;
            let mut points = vec![];
            for key in view.all_text_nodes(NodeKey::ROOT) {
                for found in matcher.find_all(&view.text_content(key)) {
                    points.push(Point::text(key, found.index));
                    points.push(Point::text(key, found.end()));
                }
            }
            FfiQueryReply::Matches { points }
        }
        FfiQuery::NodesOfType { name } => {
            let registered = surface
                .registry()
                .get(&name)
                .ok_or_else(|| invalid("unregistered node type"))?;
            let keys: Vec<_> = view
                .nodes_of_type_index(registered.index)
                .into_iter()
                .collect();
            let nodes = keys
                .iter()
                .map(|key| view.export_json(*key).map_err(invalid))
                .collect::<Result<_, _>>()?;
            FfiQueryReply::Nodes { keys, nodes }
        }
        FfiQuery::NodeById { id } => {
            let mut keys = vec![];
            let mut nodes = vec![];
            for (key, _) in view.descendants(NodeKey::ROOT) {
                let node = view.export_json(key).map_err(invalid)?;
                if node
                    .get("$")
                    .and_then(|s| s.get("id"))
                    .and_then(JsonValue::as_str)
                    == Some(&id)
                {
                    keys.push(key);
                    nodes.push(node);
                    break;
                }
            }
            FfiQueryReply::Nodes { keys, nodes }
        }
        FfiQuery::TypeTable => FfiQueryReply::Types {
            rows: surface
                .registry()
                .type_table()
                .iter()
                .map(|row| FfiTypeRow {
                    index: row.index.get(),
                    name: row.type_name.into(),
                    kind: row.kind,
                    flags: row.flags.map(|f| FfiTypeFlags {
                        is_inline: f.is_inline,
                        can_insert_text_before: f.can_insert_text_before,
                        can_insert_text_after: f.can_insert_text_after,
                        is_keyboard_selectable: f.is_keyboard_selectable,
                        is_isolated: f.is_isolated,
                        is_shadow_root: f.is_shadow_root,
                    }),
                })
                .collect(),
        },
        FfiQuery::ListenerTable => FfiQueryReply::Listeners {
            rows: surface
                .listener_table()
                .iter()
                .map(|(command, priority)| FfiListenerRow {
                    command: format!("{command:?}"),
                    priority: priority.bits(),
                })
                .collect(),
        },
        FfiQuery::SelectionCursors => {
            let cursors = surface.selection_cursors();
            FfiQueryReply::Cursors {
                anchor: cursors.as_ref().map(|c| c.anchor.clone()),
                focus: cursors.map(|c| c.focus),
            }
        }
    })
}

/// Native command listener dispatch metadata.
#[derive(uniffi::Record)]
pub struct FfiListenerRow {
    /// Command identity, including registered extension names.
    pub command: String,
    /// Bit set for the five native dispatch priority levels.
    pub priority: u8,
}
