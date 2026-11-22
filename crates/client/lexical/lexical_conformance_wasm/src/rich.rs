//! Development-only rich package boundary for external differential drivers.
use super::*;
use lexical_markdown::{
    MarkdownOptions, ShortcutTrigger, Transformers, builtin::transformers,
    convert_from_markdown_string, convert_to_markdown_string, markdown_shortcuts,
    markdown_shortcuts_on_enter,
};
use lexical_rich_nodes::{code::*, heading::*, link::*, list::*, mark::*, quote::*, table::*};
use std::sync::Arc;
mod input;
use input::Input;
/// Isolated rich editor, history and markdown registry; no host callbacks or I/O.
#[wasm_bindgen]
pub struct RichHandle {
    _lifetime: debug::LiveEditor,
    editor: Editor,
    history: History,
    transformers: Transformers,
}
#[wasm_bindgen]
impl RichHandle {
    /// Create the pinned upstream rich profile with matching intrinsic transforms.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<RichHandle, JsError> {
        Self::create()
            .map(debug::returned_handle)
            .map_err(debug::error)
    }
    /// Apply one development command at explicit monotonic milliseconds.
    pub fn apply(&mut self, input: &str, now_ms: u32) -> Result<String, JsError> {
        self.execute(input, HistoryTime(u64::from(now_ms)))
            .map(debug::returned_string)
            .map_err(debug::error)
    }
    /// Compare key-free JSON, all selection variants, root text and markdown.
    pub fn snapshot(&self) -> Result<String, JsError> {
        self.capture(None)
            .map(debug::returned_string)
            .map_err(debug::error)
    }
}
impl RichHandle {
    fn create() -> Result<Self, BoundaryError> {
        let builder = Editor::builder(EditorMode::Headless)
            .node::<HeadingNode>()
            .node::<QuoteNode>()
            .node::<MarkNode>();
        let builder = register_code_nodes(list_extension(builder, ListConfig::default()));
        let builder = transform::link_extension(builder);
        let matcher = auto::RegexLinkMatcher {
            regex: regress::Regex::new(r"https?://[a-zA-Z0-9._/-]+")
                .expect("fixed differential URL expression"),
            url_transformer: Arc::new(str::to_owned),
        };
        let builder = auto::register_auto_link(
            builder,
            auto::AutoLinkConfig {
                matchers: vec![Arc::new(matcher)],
                ..Default::default()
            },
        );
        let mut editor = register_table(builder, &TableConfig::default()).build()?;
        editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.select_start(p)
        })?;
        Ok(Self {
            _lifetime: debug::LiveEditor::new(),
            editor,
            history: History::new(HistoryConfig::default(), HistoryTime(0)),
            transformers: Transformers::new(transformers()),
        })
    }
    fn execute(&mut self, input: &str, now: HistoryTime) -> Result<String, BoundaryError> {
        let input: Input = serde_json::from_str(input)?;
        match input {
            Input::Undo => {
                self.history.undo(&mut self.editor, now)?;
            }
            Input::Redo => {
                self.history.redo(&mut self.editor, now)?;
            }
            _ => {
                let mut tx = self.editor.transaction();
                let result = input.apply(&mut tx, &self.transformers);
                if let Err(error) = result {
                    drop(tx);
                    return self.capture(Some(error.to_string()));
                }
                let commit = match tx.commit() {
                    Ok(commit) => commit,
                    Err(error) => return self.capture(Some(error.to_string())),
                };
                if !commit.changes.is_empty() || commit.selection_changed {
                    self.history.record(&commit, now);
                }
                if matches!(
                    input,
                    Input::Core {
                        shortcuts: true,
                        ..
                    }
                ) {
                    let mut tx = self.editor.transaction();
                    let changed = markdown_shortcuts(
                        &mut tx,
                        &ShortcutTrigger::from_commit(&commit, false),
                        &self.transformers,
                        &MarkdownOptions::default(),
                    )?;
                    if changed {
                        tx.add_tag(UpdateTag::HistoryPush);
                        let commit = tx.commit()?;
                        self.history.record(&commit, now);
                    }
                }
            }
        }
        self.capture(None)
    }
    fn capture(&self, error: Option<String>) -> Result<String, BoundaryError> {
        let state = self.editor.state();
        let selection = match state.selection() {
            Some(Selection::Table(t)) => {
                json!({"type":"table","table":snapshot::path(state.view(),t.table).ok(),"anchor":json!({"path":snapshot::path(state.view(),t.anchor.key()).ok(),"offset":t.anchor.offset(),"type":t.anchor.point_type().to_string()}),"focus":json!({"path":snapshot::path(state.view(),t.focus.key()).ok(),"offset":t.focus.offset(),"type":t.focus.point_type().to_string()})})
            }
            Some(Selection::Node(n)) => {
                json!({"type":"node","nodes":n.nodes(state.view()).iter().map(|k|snapshot::path(state.view(),*k)).collect::<Result<Vec<_>,_>>()?})
            }
            _ => snapshot::selection(state)?,
        };
        Ok(to_js_json_string(
            &json!({"state":state.to_json()?,"selection":selection,"text":state.root_text_content().as_ref(),"markdown":convert_to_markdown_string(state,&self.transformers,None,&MarkdownOptions::default())?,"error":error}),
        ))
    }
}
#[cfg(test)]
mod test;
