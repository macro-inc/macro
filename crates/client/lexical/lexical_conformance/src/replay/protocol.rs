//! Editor routing and validation of the recorded host protocol.
use super::*;
pub(super) fn validate_config(config: &Value) -> Result<()> {
    let object = config
        .as_object()
        .ok_or_else(|| fail("missing editor config"))?;
    for key in object.keys() {
        if ![
            "namespace",
            "namespaceGenerated",
            "nodeClasses",
            "headless",
            "nodes",
            "replacements",
            "plugins",
            "theme",
            "editable",
            "rootElement",
        ]
        .contains(&key.as_str())
        {
            return Err(fail(format!("unsupported config field {key}")));
        }
    }
    string(&config["namespace"])?;
    if !config["editable"].is_boolean() || !config["rootElement"].is_boolean() {
        return Err(fail("invalid editor host config"));
    }
    if !config["plugins"].as_array().is_some_and(Vec::is_empty) {
        return Err(fail("unimplemented configured plugin"));
    }
    for replacement in config["replacements"]
        .as_array()
        .ok_or_else(|| fail("replacement array"))?
    {
        let index = match (
            replacement["replace"]["$klass"].as_str(),
            replacement["withKlass"]["$klass"].as_str(),
        ) {
            (Some("code"), Some("custom-code")) => 0,
            (Some("list"), Some("task-list")) => 1,
            _ => return Err(fail("unimplemented configured replacement/plugin")),
        };
        if replacement["with"]["$fn"]
            != format!("@macro-inc/lexical-core/node-list.NodeReplacements.{index}.with")
        {
            return Err(fail("unmapped replacement factory"));
        }
    }
    for node in config["nodes"]
        .as_array()
        .ok_or_else(|| fail("missing configured nodes"))?
    {
        if ![
            "root",
            "text",
            "linebreak",
            "tab",
            "paragraph",
            "artificial",
            "heading",
            "list",
            "listitem",
            "quote",
            "code",
            "table",
            "tablecell",
            "tablerow",
            "hashtag",
            "code-highlight",
            "autolink",
            "link",
            "overflow",
            "test_block",
            "test_segmented",
            "test_exclude_from_copy_block",
            "test_decorator",
            "test_inline_block",
            "test_shadow_root",
            "test_text",
            "mark",
        ]
        .contains(&string(node)?)
            && !macro_document_model::is_supported_node_type(string(node)?)
        {
            return Err(fail(format!("unimplemented configured class {node}")));
        }
    }
    // Theme, namespace, editability and root attachment are host inputs. The
    // interpreter executes no DOM path; view APIs fail rather than using a fake.
    Ok(())
}

pub(super) fn validate_operation(op: &Value) -> Result<()> {
    if let Some(editor) = op.get("editor") {
        integer(editor)?;
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
                "onUpdate"
                    if value.as_object().is_some_and(|object| {
                        object.len() == 1 && object.get("$tape").is_some_and(Value::is_u64)
                    }) => {}
                _ => return Err(fail(format!("unsupported update option: {key}"))),
            }
        }
    }
    Ok(())
}

#[derive(Default)]
pub(super) struct EditorSession {
    version: u64,
    attached: bool,
    rich_text_registered: bool,
    pending_writes: bool,
    active_selection: Option<usize>,
    pending_install: Option<Commit>,
    pending_command: bool,
    updates: Vec<Value>,
    causes: Vec<Value>,
    on_update: Vec<Value>,
    microtasks: std::collections::VecDeque<Value>,
}
impl EditorSession {
    pub(super) fn has_pending_work(&self) -> bool {
        !self.on_update.is_empty()
            || !self.microtasks.is_empty()
            || self.pending_install.is_some()
            || !self.updates.is_empty()
    }
}
impl Replayer {
    pub(super) fn take_editor_session(&mut self) -> EditorSession {
        EditorSession {
            version: std::mem::take(&mut self.version),
            attached: std::mem::take(&mut self.attached),
            rich_text_registered: std::mem::take(&mut self.rich_text_registered),
            pending_writes: std::mem::take(&mut self.pending_writes),
            active_selection: std::mem::take(&mut self.active_selection),
            pending_install: std::mem::take(&mut self.pending_install),
            pending_command: std::mem::take(&mut self.pending_command),
            updates: std::mem::take(&mut self.updates),
            causes: std::mem::take(&mut self.causes),
            on_update: std::mem::take(&mut self.on_update),
            microtasks: std::mem::take(&mut self.microtasks),
        }
    }
    pub(super) fn install_editor_session(&mut self, session: EditorSession) {
        self.version = session.version;
        self.attached = session.attached;
        self.rich_text_registered = session.rich_text_registered;
        self.pending_writes = session.pending_writes;
        self.active_selection = session.active_selection;
        self.pending_install = session.pending_install;
        self.pending_command = session.pending_command;
        self.updates = session.updates;
        self.causes = session.causes;
        self.on_update = session.on_update;
        self.microtasks = session.microtasks;
    }
    pub(crate) fn captured_state(&self, receiver: &Value) -> Option<EditorState> {
        let key = node_key(receiver).ok()?;
        let identity = receiver["identity"].as_u64()?;
        self.saved_states
            .iter()
            .chain(self.states.values())
            .find(|state| {
                state.view().node(key).is_some_and(|node| {
                    let pointer = std::ptr::from_ref(node.base()) as usize;
                    self.records
                        .get(&(key, pointer))
                        .is_some_and(|record| record.1 == identity)
                })
            })
            .cloned()
    }
    pub(super) fn operation_editor(&self, op: &Value) -> Result<Option<u64>> {
        if op["op"] == "createEditor" {
            return Ok(Some(integer(&op["id"])?));
        }
        if let Some(receiver) = op.get("this")
            && receiver.get("$ed").is_some()
        {
            let decoded = self.decode(receiver)?;
            return Ok(Some(integer(&decoded["$editor"])?));
        }
        op.get("editor").map(integer).transpose()
    }
}
