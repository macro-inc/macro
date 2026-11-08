//! Strict interpreter: every operation, return value and snapshot is checked.
use crate::config::validate_config;
use crate::{fixture::Fixture, snapshot, test_nodes};
use lexical_model::*;
use serde_json::{Value, json};
use std::collections::HashMap;
mod bindings;
mod carets;
pub(crate) use carets::{CaretBindings, IteratorValue};
mod initial;
mod records;
mod selections;
pub(crate) use bindings::Bindings;
pub(crate) use records::RecordIdentities;
pub(crate) use selections::SelectionBindings;

/// A malformed fixture, unsupported operation, or observable oracle mismatch.
#[derive(Debug, thiserror::Error)]
pub enum ReplayError {
    /// Observable replay mismatch with operation context.
    #[error("{0}")]
    Mismatch(String),
    /// Model operation failed.
    #[error(transparent)]
    Model(#[from] lexical_model::Error),
    /// A rich-node operation failed.
    #[error(transparent)]
    Rich(#[from] lexical_rich_nodes::Error),
    /// A markdown operation failed.
    #[error(transparent)]
    Markdown(#[from] lexical_markdown::Error),
    /// An operation requires the upstream ambient editor callback.
    #[error(
        "Unable to find an active editor. This method can only be used synchronously during the callback of editor.update(), editor.read(), or editor.getEditorState().read(..., {{editor}}). Detected on the page: 1 compatible editor(s) with version \"0.45.0+git\""
    )]
    NoActiveEditor,
    /// Invalid fixture JSON.
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    /// Native source failed.
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
pub(crate) type Result<T> = std::result::Result<T, ReplayError>;
pub(crate) fn fail(message: impl Into<String>) -> ReplayError {
    ReplayError::Mismatch(message.into())
}
pub(crate) fn undefined() -> Value {
    json!({"$undef":true})
}
pub(crate) fn integer(value: &Value) -> Result<u64> {
    value
        .as_u64()
        .ok_or_else(|| fail(format!("expected integer: {value}")))
}
pub(crate) fn string(value: &Value) -> Result<&str> {
    value
        .as_str()
        .ok_or_else(|| fail(format!("expected string: {value}")))
}

/// Owns one fixture's identities, persistent versions and callback tapes.
#[derive(Default)]
pub struct Replayer {
    pub(crate) rich_text_registered: bool,
    pub(crate) tab_indent: Option<Option<u32>>,
    pub(crate) code_highlight: bool,
    pub(crate) d6_collapse_code_highlight: bool,
    pub(crate) code_prism_registered: bool,
    pub(crate) d6_handle_keys: HashMap<String, String>,
    pub(crate) d6_oracle_max_key: u32,
    pub(crate) d6_model_body: std::collections::HashSet<NodeKey>,
    pub(crate) d6_model_leaves: std::collections::HashSet<NodeKey>,
    pub(crate) markdown_options: lexical_markdown::MarkdownOptions,
    pub(crate) in_callback: bool,
    pub(crate) carets: CaretBindings,
    pub(crate) bindings: Bindings,
    pub(crate) record_ids: RecordIdentities,
    pub(crate) record_owner: Option<(u64, EditorState)>,
    pub(crate) version: u64,
    pub(crate) committed_version: u64,
    pub(crate) read_state: Option<EditorState>,
    pub(crate) selections: SelectionBindings,
    pub(crate) tapes: Vec<crate::fixture::Tape>,
    pub(crate) tape_positions: Vec<usize>,
    pub(crate) updates: Vec<Value>,
    pub(crate) causes: Vec<Value>,
    pub(crate) pending_editor_random: Vec<f64>,
    pub(crate) clock: f64,
    pub(crate) tick: u64,
    pub(crate) attached: bool,
    pub(crate) pending_writes: bool,
    /// Enforce exact upstream key allocation, in addition to bijective identity.
    pub strict_keys: bool,
    pub(crate) pending_install: Option<Commit>,
    pub(crate) pending_command: bool,
    pub(crate) microtasks: std::collections::VecDeque<Value>,
}
impl Replayer {
    pub(crate) fn saved_state(&self, id: usize) -> Result<EditorState> {
        self.bindings.saved_state(id)
    }
    /// Replay all trace operations and final state; no original JS executes.
    pub fn replay(&mut self, fixture: &Fixture) -> Result<()> {
        if fixture.schema != 2
            || fixture.tier != "A-rec"
            || (!fixture.partial
                && (fixture.initial["editorState"] != Value::Null
                    || fixture.initial["selection"] != Value::Null))
        {
            return Err(fail("unsupported fixture initialization"));
        }
        self.d6_collapse_code_highlight = fixture.source.repo == "lexical"
            && fixture.source.file
                == "packages/lexical-code-prism/src/__tests__/unit/LexicalCodeNodeTabs.test.ts"
            && fixture.trace.iter().any(|op| {
                op["op"] == "plugin" && op["name"] == "@lexical/code-prism.registerCodeHighlighting"
            });
        for normalization in &fixture.normalize {
            match normalization.as_str() {
                "listIndent: 2" => self.markdown_options.list_indent = 2,
                "codeHighlight" => self.code_highlight = true,
                "d6_collapse_code_highlight" if self.d6_collapse_code_highlight => {}
                _ => {
                    return Err(fail(format!(
                        "unimplemented declared normalization: {normalization}"
                    )));
                }
            }
        }
        if !fixture.partial
            && fixture
                .initial
                .as_object()
                .is_none_or(|initial| initial.len() != 2)
        {
            return Err(fail("unsupported initial fields"));
        }
        if fixture.source.version != "0.45.0"
            || !matches!(fixture.source.repo.as_str(), "lexical" | "macro")
        {
            return Err(fail("unsupported upstream version/repository"));
        }
        if fixture.trace.iter().any(|op| op["op"] == "createEditor") {
            validate_config(&fixture.config)?;
        } else if fixture.config != json!({}) {
            return Err(fail("configuration without an editor"));
        }
        if !fixture.outcome_differs.is_empty() {
            return Err(fail("unimplemented development/production outcome policy"));
        }
        if !fixture
            .source
            .recorded_with
            .starts_with("lexical-conformance@")
        {
            return Err(fail("unknown recorder build"));
        }
        self.bindings.bind_key("root".into(), NodeKey::ROOT)?;
        self.tapes = fixture.tapes.clone();
        self.tape_positions = vec![0; fixture.tapes.len()];
        let mut editor = None;
        let mut scratch = test_nodes::builder()
            .build()
            .map_err(|e| fail(e.to_string()))?;
        let mut i = 0;
        while i < fixture.trace.len() {
            let op = &fixture.trace[i];
            validate_operation(op)?;
            let kind = string(&op["op"])?;
            let result = match kind {
                "entropy" | "clock" | "tick" => {
                    let mut tx = scratch.transaction();
                    self.execute(op, &mut tx)
                }
                "createEditor" => {
                    if editor.is_some() || op["id"] != 0 {
                        return Err(fail("unimplemented multiple editors"));
                    }
                    validate_config(&op["config"])?;
                    self.attached = op["config"]["rootElement"] == true;
                    let draws = 1 + usize::from(op["config"]["namespaceGenerated"] == true);
                    if self.pending_editor_random.len() != draws {
                        return Err(fail(format!(
                            "editor random draw count: {} != {draws}",
                            self.pending_editor_random.len()
                        )));
                    }
                    self.pending_editor_random.clear();
                    let nodes = op["config"]["nodes"]
                        .as_array()
                        .ok_or_else(|| fail("configured nodes"))?
                        .iter()
                        .map(|node| string(node).map(str::to_owned))
                        .collect::<Result<Vec<_>>>()?;
                    let mut ed =
                        test_nodes::configured_builder(&nodes, op["config"]["rootElement"] == true)
                            .build()
                            .map_err(|e| fail(e.to_string()))?;
                    if let Some(ret) = op.get("ret") {
                        self.compare(ret, &json!({"$editor":0}))?;
                    }
                    if fixture.partial {
                        self.restore_initial(&mut ed, &fixture.initial)?;
                    }
                    editor = Some(ed);
                    Ok(())
                }
                "call"
                    if matches!(
                        op["fn"].as_str(),
                        Some("LexicalEditor.parseEditorState" | "LexicalEditor.setEditorState")
                    ) =>
                {
                    let ed = editor.as_mut().ok_or_else(|| fail("missing editor"))?;
                    self.editor_call(op, ed)
                }
                "update" | "commit" if self.pending_install.is_some() => {
                    if kind == "update" {
                        let cause = if self.pending_command {
                            "listener-enqueued"
                        } else {
                            "setEditorState"
                        };
                        if op["cause"] != cause || op["calls"] != json!([]) {
                            return Err(fail("unexpected state-install update"));
                        }
                        self.updates.push(op["id"].clone());
                        if !self.causes.contains(&op["cause"]) {
                            self.causes.push(op["cause"].clone());
                        }
                        Ok(())
                    } else {
                        let commit = self
                            .pending_install
                            .take()
                            .ok_or_else(|| fail("state install commit"))?;
                        self.pending_command = false;
                        self.version += 1;
                        self.compare(&op["updates"], &json!(self.updates))?;
                        self.compare(&op["causes"], &json!(self.causes))?;
                        if op["index"] != self.version {
                            return Err(fail("state install commit index"));
                        }
                        self.committed_version = self.version;
                        self.bindings.pin_state(self.version, commit.next.clone())?;
                        snapshot::compare(self, &op["snapshot"], &commit.next, Some(&commit))?;
                        self.updates.clear();
                        self.causes.clear();
                        Ok(())
                    }
                }
                "update" | "commit" => {
                    if kind == "commit" && self.version != 0 {
                        return Err(fail("commit without a pending update"));
                    }
                    let ed = editor.as_mut().ok_or_else(|| fail("missing editor"))?;
                    self.version += 1;
                    let mut tx = ed.transaction();
                    self.begin_slots(&mut tx, true)?;
                    self.pending_writes = false;
                    if kind == "commit" && self.version == 1 && self.attached {
                        tx.mark_dirty(NodeKey::ROOT)?;
                        tx.add_tag(UpdateTag::HistoryMerge);
                    }
                    loop {
                        let pending = &fixture.trace[i];
                        if pending["op"] == "commit" {
                            self.capture_slots(&tx)?;
                            let commit = tx.commit()?;
                            self.compare(&pending["updates"], &Value::Array(self.updates.clone()))?;
                            self.compare(&pending["causes"], &Value::Array(self.causes.clone()))?;
                            if pending["index"] != self.version {
                                return Err(fail("commit index mismatch"));
                            }
                            self.committed_version = self.version;
                            self.bindings.pin_state(self.version, commit.next.clone())?;
                            snapshot::compare(
                                self,
                                &pending["snapshot"],
                                &commit.next,
                                Some(&commit),
                            )?;
                            self.updates.clear();
                            self.causes.clear();
                            break;
                        }
                        self.execute(pending, &mut tx)
                            .map_err(|e| fail(format!("op {i}: {e}")))?;
                        if pending["op"] == "update"
                            && pending["opts"]["discrete"] == true
                            && self.pending_writes
                        {
                            let next = fixture.trace[i + 1..]
                                .iter()
                                .find(|next| !matches!(next["op"].as_str(), Some("clock" | "log")));
                            if next.is_none_or(|next| next["op"] != "commit") {
                                return Err(fail(
                                    "discrete update lacks immediate commit boundary",
                                ));
                            }
                        }
                        let next_update = fixture
                            .trace
                            .get(i + 1..)
                            .and_then(|tail| {
                                tail.iter().find(|next| {
                                    !matches!(next["op"].as_str(), Some("clock" | "log"))
                                })
                            })
                            .is_some_and(|next| next["op"] == "update");
                        if pending["op"] == "update"
                            && !self.pending_writes
                            && (pending["opts"]["discrete"] == true || !next_update)
                        {
                            self.capture_slots(&tx)?;
                            let commit = tx.commit()?;
                            if !commit.is_noop() {
                                return Err(fail("unexpected tag-only commit"));
                            }
                            self.version -= 1;
                            self.updates.clear();
                            self.causes.clear();
                            self.pending_writes = false;
                            break;
                        }
                        i += 1;
                        if i == fixture.trace.len() {
                            self.capture_slots(&tx)?;
                            let commit = tx.commit()?;
                            if !commit.is_noop() {
                                return Err(fail("unconsumed nonempty commit"));
                            }
                            self.version -= 1;
                            break;
                        }
                    }
                    Ok(())
                }
                "call" if op["fn"] == "LexicalEditor.dispatchCommand" => {
                    let ed = editor.as_mut().ok_or_else(|| fail("missing editor"))?;
                    let mut tx = ed.transaction();
                    self.begin_slots(&mut tx, false)?;
                    self.execute(op, &mut tx)?;
                    self.capture_slots(&tx)?;
                    self.pending_install = Some(tx.commit()?);
                    self.pending_command = true;
                    Ok(())
                }
                "plugin"
                    if op["name"]
                        == "@lexical/react/LexicalTabIndentationPlugin.registerTabIndentation" =>
                {
                    crate::api::tab::register(self, &op["args"])
                }
                "plugin" if op["name"] == "@lexical/code-prism.registerCodeHighlighting" => {
                    if op["args"] != json!([{"$ed":0}]) {
                        return Err(fail("Prism plugin arguments"));
                    }
                    self.code_prism_registered = true;
                    Ok(())
                }
                "plugin" => {
                    if op["name"] != "@lexical/rich-text.registerRichText"
                        || op["args"] != json!([{"$ed":0}])
                    {
                        return Err(fail(format!(
                            "unmapped plugin registration: {}",
                            op["name"]
                        )));
                    }
                    self.rich_text_registered = true;
                    Ok(())
                }
                "call" | "read" | "log" => {
                    let ed = editor.as_mut().unwrap_or(&mut scratch);
                    // resetRandomKey can precede editor construction.
                    if kind == "call" && op["fn"] == "lexical/LexicalUtils.resetRandomKey" {
                        self.compare(&op["ret"], &undefined())
                    } else {
                        let mut tx = ed.transaction();
                        self.begin_slots(&mut tx, false)?;
                        self.execute(op, &mut tx)
                    }
                }
                _ => Err(fail(format!("unmapped operation: {kind}"))),
            };
            result.map_err(|e| fail(format!("op {i} {kind}: {e}")))?;
            i += 1;
        }
        if let Some(ed) = editor {
            snapshot::compare(self, &fixture.r#final, ed.state(), None)?;
        } else {
            self.compare(&fixture.r#final, &Value::Null)?;
        }
        if !self.microtasks.is_empty() {
            return Err(fail("unconsumed microtask callback"));
        }
        if !self.pending_editor_random.is_empty() {
            return Err(fail("unconsumed editor entropy"));
        }
        for (position, tape) in self.tape_positions.iter().zip(&self.tapes) {
            if *position != tape.invocations.len() {
                return Err(fail("missing callback tape invocations"));
            }
        }
        Ok(())
    }
    // These inputs belong to upstream editor bookkeeping, not sans-I/O node
    // algorithms: editor ids draw Math.random; commit scheduling reads performance.
    // Consume their protocol explicitly, without claiming a model entropy read.
    fn host_input(&mut self, op: &Value) -> Result<()> {
        match string(&op["op"])? {
            "entropy" => {
                if op["src"] != "random" || self.pending_editor_random.len() >= 2 {
                    return Err(fail("unsupported entropy draw"));
                }
                let value = op["v"]
                    .as_f64()
                    .filter(|v| *v >= 0.0 && *v < 1.0)
                    .ok_or_else(|| fail("invalid editor random draw"))?;
                self.pending_editor_random.push(value);
            }
            "clock" => {
                if op["src"] != "perf" {
                    return Err(fail("unsupported clock source"));
                }
                let value = op["t"]
                    .as_f64()
                    .filter(|v| v.is_finite() && *v >= self.clock)
                    .ok_or_else(|| fail("invalid scheduling clock"))?;
                self.clock = value;
            }
            "tick" => {
                if integer(&op["n"])? != self.tick {
                    return Err(fail("tick order mismatch"));
                }
                if !matches!(
                    op["reason"].as_str(),
                    Some("microtask" | "read-flush" | "onUpdate" | "await")
                ) {
                    return Err(fail("unsupported batching boundary"));
                }
                self.tick += 1;
            }
            _ => return Err(fail("invalid host input")),
        }
        Ok(())
    }
    fn editor_call(&mut self, op: &Value, editor: &mut Editor) -> Result<()> {
        let args = self.decode(&op["args"])?;
        let actual = if op["fn"] == "LexicalEditor.parseEditorState" {
            let mut value = args[0].clone();
            materialize_keys(&mut value)?;
            let state = if let Some(text) = value.as_str() {
                editor.parse_editor_state_str(text)?
            } else {
                editor.parse_editor_state(&serde_json::from_value(value)?)?
            };
            let id = self.bindings.save_state(state)?;
            json!({"$snapshot":id})
        } else {
            let id = integer(&args[0]["$snapshot"])? as usize;
            let state = self.saved_state(id)?.clone();
            let mut tags = TagSet::default();
            if let Some(tag) = args[1]["tag"].as_str() {
                tags.insert(tag.parse().map_err(|_| fail("tag"))?);
            }
            self.pending_install = Some(editor.set_editor_state(state, tags)?);
            if !self.causes.iter().any(|cause| cause == "setEditorState") {
                self.causes.push(json!("setEditorState"));
            }
            self.selections.set_active(None)?;
            undefined()
        };
        self.compare(op.get("ret").unwrap_or(&undefined()), &actual)
    }
    pub(crate) fn begin_slots(
        &mut self,
        tx: &mut Transaction<'_>,
        clone_active: bool,
    ) -> Result<()> {
        let previous_active = self.selections.active()?.map(|active| active.id);
        if clone_active {
            self.selections.set_active(None)?;
        }
        let slots = self
            .selections
            .values()?
            .into_iter()
            .enumerate()
            .map(|(id, s)| {
                if !clone_active && previous_active == Some(id) {
                    tx.bind_foreign_selection_identity(
                        SelectionSlot::Active,
                        self.selections.identity(id)?,
                    )?;
                    Ok(SelectionSlot::Active)
                } else {
                    match s {
                        Some(value) => {
                            Ok(tx.detach_foreign_selection(value, self.selections.identity(id)?))
                        }
                        None => Ok(SelectionSlot::Active),
                    }
                }
            })
            .collect::<Result<Vec<_>>>()?;
        self.selections.replace_slots(slots)
    }
    pub(crate) fn capture_slots(&mut self, tx: &Transaction<'_>) -> Result<()> {
        self.selections.synchronize(tx)?;
        self.bindings.capture_retired_records(tx, self.version)?;
        let values = self
            .selections
            .slots()?
            .into_iter()
            .map(|slot| {
                tx.selection_at(slot)
                    .map(|s| s.map(Selection::snapshot_for_foreign_read))
            })
            .collect::<std::result::Result<_, _>>()?;
        self.selections.replace_values(values)
    }
    pub(crate) fn execute(&mut self, op: &Value, tx: &mut Transaction<'_>) -> Result<()> {
        validate_operation(op)?;
        match string(&op["op"])? {
            "call" => {
                let result = crate::api::call(self, tx, op);
                if let Some(expected) = op.get("throws") {
                    match result {
                        Ok(value) => {
                            Err(fail(format!("expected exception {expected}, got {value}")))
                        }
                        Err(error @ ReplayError::NoActiveEditor) => self.compare(
                            expected,
                            &json!({"name":"Error", "message":error.to_string()}),
                        ),
                        Err(ReplayError::Model(error)) => self.compare(
                            expected,
                            &json!({"name":"Error", "message":error.to_string()}),
                        ),
                        Err(other) => Err(other),
                    }
                } else {
                    let actual = result?;
                    self.compare(op.get("ret").unwrap_or(&undefined()), &actual)
                        .map_err(|e| fail(format!("{}: {e}", op["fn"])))
                }
            }
            "update" => {
                if op["cause"] != "test"
                    && !(self.rich_text_registered
                        && op["cause"] == "listener-enqueued"
                        && op["calls"] == json!([]))
                {
                    return Err(fail("unimplemented plugin cascade"));
                }
                self.updates.push(op["id"].clone());
                if !self.causes.contains(&op["cause"]) {
                    self.causes.push(op["cause"].clone());
                }
                if let Some(selection) = op.get("selectionAtBegin") {
                    return Err(fail(format!("unimplemented view selection: {selection}")));
                }
                if let Some(tag) = op["opts"]["tag"].as_str() {
                    tx.add_tag(tag.parse().map_err(|_| fail("tag"))?);
                }
                if let Some(tags) = op["opts"]["tag"].as_array() {
                    for tag in tags {
                        tx.add_tag(string(tag)?.parse().map_err(|_| fail("tag"))?);
                    }
                }

                let result = self.execute_calls(&op["calls"], tx).and_then(|()| {
                    if self.code_prism_registered {
                        crate::api::tab::initialize_code_language(tx)?;
                    }
                    self.pending_writes |= tx.has_dirty_nodes()
                        || tx.selection() != tx.committed_state().selection()
                        || tx.selection().is_some_and(Selection::is_dirty);
                    tx.flush_with(if op["opts"]["skipTransforms"] == true {
                        FlushMode::NormalizeOnly
                    } else {
                        FlushMode::Transforms
                    })
                    .map_err(Into::into)
                });
                if op.get("error").is_some() {
                    return Err(fail(format!("unimplemented update rollback: {result:?}")));
                }
                result
            }
            "read" => {
                let previous = self.read_state.take();
                self.read_state = if let Some(state) = op.get("state") {
                    let decoded = self.decode(state)?;
                    Some(
                        self.saved_state(integer(&decoded["$snapshot"])? as usize)?
                            .clone(),
                    )
                } else if self.updates.is_empty() {
                    Some(tx.committed_state().clone())
                } else {
                    None
                };
                let result = self.execute_calls(&op["calls"], tx);
                self.read_state = previous;
                result
            }
            "tick" => {
                self.host_input(op)?;
                while let Some(callback) = self.microtasks.pop_front() {
                    self.invoke_tape(tx, &callback, &[])?;
                }
                Ok(())
            }
            "clock" | "entropy" => self.host_input(op),
            "log" => {
                if !matches!(op["level"].as_str(), Some("warn" | "error")) {
                    return Err(fail("unsupported advisory log level"));
                }
                string(&op["message"])?;
                Ok(())
            }
            other => Err(fail(format!("unmapped operation: {other}"))),
        }
    }
    pub(crate) fn invoke_tape(
        &mut self,
        tx: &mut Transaction<'_>,
        callback: &Value,
        args: &[Value],
    ) -> Result<Value> {
        let id = integer(&callback["$tape"])? as usize;
        let position = self
            .tape_positions
            .get_mut(id)
            .ok_or_else(|| fail("unknown callback tape"))?;
        let invocation = self
            .tapes
            .get(id)
            .and_then(|tape| tape.invocations.get(*position))
            .cloned()
            .ok_or_else(|| fail("extra callback invocation"))?;
        *position += 1;
        self.compare(&Value::Array(invocation.args), &Value::Array(args.to_vec()))?;
        self.execute_calls(&Value::Array(invocation.calls), tx)?;
        if let Some(error) = invocation.throws {
            return Err(fail(format!("callback threw: {error}")));
        }
        self.decode(invocation.ret.as_ref().unwrap_or(&undefined()))
    }
    pub(crate) fn execute_calls(&mut self, calls: &Value, tx: &mut Transaction<'_>) -> Result<()> {
        let previous = self.in_callback;
        self.in_callback = true;
        let result = self.execute_callback_calls(calls, tx);
        self.in_callback = previous;
        result
    }
    fn execute_callback_calls(&mut self, calls: &Value, tx: &mut Transaction<'_>) -> Result<()> {
        for (i, call) in calls
            .as_array()
            .ok_or_else(|| fail("expected calls"))?
            .iter()
            .enumerate()
        {
            self.execute(call, tx)
                .map_err(|e| fail(format!("call {i}: {e}")))?;
        }
        Ok(())
    }
    pub(crate) fn decode(&self, value: &Value) -> Result<Value> {
        if let Some(object) = value.as_object() {
            for tag in ["$h", "$ed", "$state", "$sel", "$pt", "$caret", "$iterator"] {
                if let Some(id) = object.get(tag) {
                    return self
                        .bindings
                        .handle(&format!("{tag}:{id}"))?
                        .ok_or_else(|| fail(format!("unknown handle {tag}:{id}")));
                }
            }
            if let Some(raw) = object.get("$key") {
                let _ = raw;
                let key = self
                    .bindings
                    .key(string(&object["raw"])?)?
                    .ok_or_else(|| fail("unknown key"))?;
                return Ok(key_value(key));
            }
            let mut decoded = serde_json::Map::new();
            for (key, value) in object {
                decoded.insert(key.clone(), self.decode(value)?);
            }
            return Ok(Value::Object(decoded));
        }
        if let Some(array) = value.as_array() {
            return array.iter().map(|v| self.decode(v)).collect();
        }
        Ok(value.clone())
    }
    pub(crate) fn compare(&mut self, expected: &Value, actual: &Value) -> Result<()> {
        if let Some(object) = expected.as_object() {
            for (tag, actual_tag) in [
                ("$h", "$node"),
                ("$ed", "$editor"),
                ("$state", "$snapshot"),
                ("$sel", "$selection"),
                ("$pt", "$point"),
                ("$caret", "$caretValue"),
                ("$iterator", "$iteratorValue"),
            ] {
                if let Some(id) = object.get(tag) {
                    if actual.get(actual_tag).is_none() {
                        return Err(fail(format!("expected {tag} object, got {actual}")));
                    }
                    let binding = format!("{tag}:{id}");
                    if let Some(bound) = self.bindings.handle(&binding)? {
                        if &bound != actual {
                            return Err(fail(format!(
                                "identity mismatch {binding}: {bound} != {actual}"
                            )));
                        }
                    } else {
                        if tag == "$caret" {
                            for field in ["type", "direction"] {
                                if object.get(field) != actual.get(field) {
                                    return Err(fail(format!("caret {field} mismatch")));
                                }
                            }
                            if let Some(origin) = object.get("origin") {
                                self.compare(origin, &actual["origin"])?;
                            }
                            for field in ["caret", "distance"] {
                                if let Some(expected) = object.get(field) {
                                    self.compare(expected, &actual[field])?;
                                }
                            }
                        }
                        if tag == "$sel" && object.get("kind") != actual.get("kind") {
                            return Err(fail("selection kind mismatch"));
                        }
                        if tag == "$h" {
                            if !["key", "type", "ver"]
                                .iter()
                                .all(|key| object.contains_key(*key))
                            {
                                return Err(fail("new node handle lacks identity metadata"));
                            }
                            if let Some(typ) = object.get("type")
                                && typ != &actual["type"]
                                && !(self.d6_collapse_code_highlight
                                    && self.code_prism_registered
                                    && typ == "code-highlight"
                                    && actual["type"] == "text"
                                    && self.d6_model_leaves.contains(&node_key(actual)?))
                            {
                                return Err(fail(format!(
                                    "node type: {typ} != {}",
                                    actual["type"]
                                )));
                            }
                            if let Some(ver) = object.get("ver")
                                && ver != &actual["ver"]
                            {
                                return Err(fail(format!(
                                    "node version: {ver} != {}",
                                    actual["ver"]
                                )));
                            }
                            if let Some(raw) = object.get("key") {
                                self.bind_key(string(raw)?, node_key(actual)?)?;
                                if self.d6_collapse_code_highlight && self.code_prism_registered {
                                    self.d6_handle_keys
                                        .insert(binding.clone(), string(raw)?.to_owned());
                                }
                            }
                        }
                        if self
                            .bindings
                            .handles()?
                            .iter()
                            .any(|(other, value)| other.starts_with(tag) && value == actual)
                        {
                            return Err(fail(format!("distinct oracle handles alias {binding}")));
                        }
                        self.bindings.bind_handle(binding, actual.clone())?;
                    }
                    return Ok(());
                }
            }
            if object.contains_key("$key") {
                let key = if actual.get("$nodeKey").is_some() {
                    tagged_key(actual, "$nodeKey")?
                } else if let Some(raw) = actual.as_str() {
                    if raw == "root" {
                        NodeKey::ROOT
                    } else {
                        key_index(&json!(
                            raw.parse::<u32>().map_err(|_| fail("actual key string"))?
                        ))?
                    }
                } else {
                    return Err(fail(format!("expected key got {actual}")));
                };
                return self.bind_key(string(&object["raw"])?, key);
            }
            let a = actual
                .as_object()
                .ok_or_else(|| fail(format!("object mismatch: {expected} != {actual}")))?;
            if object.len() != a.len() {
                return Err(fail(format!(
                    "object shape mismatch: {expected} != {actual}"
                )));
            }
            for (key, value) in object {
                self.compare(
                    value,
                    a.get(key)
                        .ok_or_else(|| fail(format!("missing field {key}")))?,
                )?;
            }
            return Ok(());
        }
        if let Some(array) = expected.as_array() {
            let a = actual
                .as_array()
                .ok_or_else(|| fail(format!("array mismatch: {expected} != {actual}")))?;
            if array.len() != a.len() {
                return Err(fail(format!(
                    "array length mismatch: {expected} != {actual}"
                )));
            }
            for (e, a) in array.iter().zip(a) {
                self.compare(e, a)?;
            }
            return Ok(());
        }
        if expected != actual {
            return Err(fail(format!("value mismatch: {expected} != {actual}")));
        }
        Ok(())
    }
    pub(crate) fn bind_key(&mut self, raw: &str, key: NodeKey) -> Result<()> {
        if self.strict_keys && raw != key.to_string() {
            return Err(fail(format!(
                "strict key allocation mismatch: {raw} != {key}"
            )));
        }
        if let Some(existing) = self.bindings.key(raw)? {
            if existing != key {
                return Err(fail(format!(
                    "key bijection mismatch: {raw} {existing} != {key}"
                )));
            }
        } else {
            if self.bindings.keys()?.values().any(|other| *other == key) {
                return Err(fail(format!(
                    "key bijection is not injective: {raw} -> {key}"
                )));
            }
            self.bindings.bind_key(raw.into(), key)?;
        }
        Ok(())
    }
    pub(crate) fn node(&mut self, view: StateRef<'_>, key: NodeKey) -> Result<Value> {
        let node = view.node_or_err(key)?;
        let record = view.foreign_record_identity(key)?;
        let version = self
            .record_owner
            .as_ref()
            .filter(|(_, state)| {
                state
                    .view()
                    .node(key)
                    .is_some_and(|node| record.matches(node))
            })
            .map_or(self.version, |(version, _)| *version);
        let (version, identity) = self.record_ids.identify(key, record, version)?;
        Ok(
            json!({"$node":key.index(),"generation":key.generation(),"identity":identity,"ver":version,"type":node.type_name()}),
        )
    }
    pub(crate) fn selection(&mut self, tx: &mut Transaction<'_>) -> Result<Value> {
        self.selection_at(tx, SelectionSlot::Active)
    }
    pub(crate) fn selection_at(
        &mut self,
        tx: &mut Transaction<'_>,
        slot: SelectionSlot,
    ) -> Result<Value> {
        self.selections.synchronize(tx)?;
        let identity = tx
            .foreign_selection_identity(slot)
            .ok_or_else(|| fail("selection slot identity"))?;
        let slot = tx.foreign_selection_slot(&identity).unwrap_or(slot);
        let Some(selection) = tx.selection_at(slot)? else {
            return Ok(Value::Null);
        };
        let kind = if selection.is_range() {
            "range"
        } else {
            "node"
        };
        let id = match self.selections.find(&identity)? {
            Some(id) => {
                self.selections.set_slot(id, slot)?;
                id
            }
            None => self.selections.push(slot, identity)?,
        };
        if slot == SelectionSlot::Active
            && self
                .selections
                .active()?
                .is_none_or(|active| active.id != id)
        {
            self.selections.set_active(Some(id))?;
        }
        Ok(json!({"$selection":id,"kind":kind}))
    }
}
pub(crate) fn key_index(value: &Value) -> Result<NodeKey> {
    Ok(NodeKey::from_parts(KeyParts {
        generation: 0,
        index: u32::try_from(integer(value)?).map_err(|_| fail("key overflow"))?,
    }))
}
pub(crate) fn key_value(key: NodeKey) -> Value {
    json!({"$nodeKey":key.index(),"generation":key.generation()})
}
pub(crate) fn tagged_key(value: &Value, tag: &str) -> Result<NodeKey> {
    let index = key_index(&value[tag])?.index();
    let generation = value
        .get("generation")
        .map(integer)
        .transpose()?
        .unwrap_or(0);
    Ok(NodeKey::from_parts(KeyParts {
        generation: u32::try_from(generation).map_err(|_| fail("key generation overflow"))?,
        index,
    }))
}
pub(crate) fn node_key(value: &Value) -> Result<NodeKey> {
    tagged_key(value, "$node")
}

#[cfg(test)]
mod test;

fn materialize_keys(value: &mut Value) -> Result<()> {
    if value.get("$nodeKey").is_some() {
        *value = json!(tagged_key(value, "$nodeKey")?.to_string());
    } else if let Some(object) = value.as_object_mut() {
        for child in object.values_mut() {
            materialize_keys(child)?;
        }
    } else if let Some(array) = value.as_array_mut() {
        for child in array {
            materialize_keys(child)?;
        }
    }
    Ok(())
}

fn validate_operation(op: &Value) -> Result<()> {
    if let Some(editor) = op.get("editor")
        && editor != 0
    {
        return Err(fail("unsupported operation editor id"));
    }
    if op.get("parent").is_some() {
        return Err(fail("unimplemented nested update parent"));
    }
    if op["op"] == "update" {
        let options = op["opts"]
            .as_object()
            .ok_or_else(|| fail("missing update options"))?;
        for (key, value) in options {
            match key.as_str() {
                "tag"
                    if value.is_string()
                        || value
                            .as_array()
                            .is_some_and(|tags| tags.iter().all(Value::is_string)) => {}
                "discrete" | "skipTransforms" if value.is_boolean() => {}
                _ => return Err(fail(format!("unsupported update option: {key}"))),
            }
        }
    }
    Ok(())
}
