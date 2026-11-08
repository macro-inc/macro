//! CustomCodeNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable CustomCodeNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomCodeNode {
    /// Stored code payload.
    #[serde(flatten)]
    pub code: CodeNode,
    /// Stored preview enabled payload.
    #[serde(default)]
    pub preview_enabled: bool,
}
impl NodeType for CustomCodeNode {
    const TYPE: &'static str = "custom-code";
    type Kind = ElementKind;
    const HAS_LANGUAGE_FIELD: bool = true;
    lexical_model::impl_default_node!();
    fn flag_probe() -> Option<Self> {
        Some(Self::default())
    }
    fn import(tx: &mut Transaction<'_>, json: &SerializedNode) -> crate::ModelResult<NodeKey> {
        let key = super::wire::import_node::<Self>(tx, json)?;
        if let Some(state) = json.get("$").and_then(Value::as_object) {
            if let Some(peer) = state
                .get("peerId")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                crate::peer::set_peer_id(tx, key, peer.into())?;
            }
            if let Some(id) = state
                .get("id")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                tx.set_state(key, &crate::node_ids::ID_STATE, Some(id.into()))?;
            }
        }
        Ok(key)
    }
    fn import_json(json: &SerializedNode) -> crate::ModelResult<Self> {
        let json = super::wire::own_json(Self::TYPE, json)?;
        Ok(serde_json::from_value(Value::Object(json))?)
    }
}
impl ImportPolicy for CustomCodeNode {
    const IMPORTED_STATE: ImportedState = ImportedState::Full;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl ElementNode for CustomCodeNode {
    type Parent = CodeNode;
    fn as_parent(&self) -> &Self::Parent {
        &self.code
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
        Some(&mut self.code)
    }
    fn json_version(&self) -> u32 {
        1
    }
}
impl SearchText for CustomCodeNode {}

/// Constructor language normalization; unknown labels remain unchanged.
pub fn normalize_custom_language(language: Option<&str>) -> String {
    let language = language.unwrap_or("plaintext");
    match language.to_lowercase().as_str() {
        "plaintext" => "plaintext".to_owned(),
        "text" => "plaintext".to_owned(),
        "txt" => "plaintext".to_owned(),
        "javascript" => "javascript".to_owned(),
        "js" => "javascript".to_owned(),
        "jsx" => "javascript".to_owned(),
        "java script" => "javascript".to_owned(),
        "typescript" => "typescript".to_owned(),
        "ts" => "typescript".to_owned(),
        "tsx" => "typescript".to_owned(),
        "type script" => "typescript".to_owned(),
        "json" => "json".to_owned(),
        "python" => "python".to_owned(),
        "py" => "python".to_owned(),
        "rust" => "rust".to_owned(),
        "rs" => "rust".to_owned(),
        "java" => "java".to_owned(),
        "swift" => "swift".to_owned(),
        "c" => "c".to_owned(),
        "cpp" => "cpp".to_owned(),
        "c++" => "cpp".to_owned(),
        "css" => "css".to_owned(),
        "html" => "html".to_owned(),
        "markdown" => "markdown".to_owned(),
        "md" => "markdown".to_owned(),
        "powershell" => "powershell".to_owned(),
        "sh" => "powershell".to_owned(),
        "sql" => "sql".to_owned(),
        "bash" => "bash".to_owned(),
        "svg" => "svg".to_owned(),
        "xml" => "svg".to_owned(),
        _ => language.to_owned(),
    }
}
impl From<CodeNode> for CustomCodeNode {
    fn from(code: CodeNode) -> Self {
        Self {
            code: CodeNode {
                language: Some(normalize_custom_language(code.language())),
                theme: None,
            },
            preview_enabled: false,
        }
    }
}

impl Default for CustomCodeNode {
    fn default() -> Self {
        Self::from(CodeNode::default())
    }
}

/// Create authored custom code using constructor language normalization.
pub fn create_custom_code_node(
    tx: &mut Transaction<'_>,
    language: Option<&str>,
) -> crate::ModelResult<Id<CustomCodeNode>> {
    tx.create(CustomCodeNode {
        code: CodeNode {
            language: Some(normalize_custom_language(language)),
            theme: None,
        },
        preview_enabled: false,
    })
}

/// Replace a code block's language and text, retaining SVG preview only for SVG.
pub fn set_custom_code(
    tx: &mut Transaction<'_>,
    key: Id<CustomCodeNode>,
    language: Option<&str>,
    code: &str,
) -> crate::ModelResult<()> {
    {
        let mut node = tx.get_mut::<CustomCodeNode>(key)?;
        node.code.language = language.map(str::to_owned);
        if !language.is_some_and(|lang| lang.eq_ignore_ascii_case("svg")) {
            node.preview_enabled = false;
        }
    }
    let text = tx.create_text(code)?;
    let size = tx.children_size(key);
    tx.splice(key, ChildIndex(0), size, &[text.key()])?;
    Ok(())
}
