//! DetailsNode and DetailsSummaryNode: GitHub `<details>` sections. Source registers
//! them only in read-only renderers (`StaticRenderNodeTypes`), never in an editor preset.
use super::*;
/// Portable DetailsNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailsNode {
    /// Whether the section starts expanded.
    pub open: bool,
}
impl NodeType for DetailsNode {
    const TYPE: &'static str = "details";
    type Kind = ElementKind;
    fn flag_probe() -> Option<Self> {
        Some(Self::default())
    }
    fn import(tx: &mut Transaction<'_>, json: &SerializedNode) -> crate::ModelResult<NodeKey> {
        super::wire::import_node::<Self>(tx, json)
    }
    /// Source `importJSON`: `serialized.open === true`, so any other value is closed.
    fn import_json(json: &SerializedNode) -> crate::ModelResult<Self> {
        Ok(Self {
            open: json.get("open") == Some(&Value::Bool(true)),
        })
    }
}
impl ImportPolicy for DetailsNode {
    // importJSON constructs a fresh node and never calls updateFromJSON.
    const IMPORTED_STATE: ImportedState = ImportedState::None;
    const IMPORT_ELEMENT_DATA: bool = false;
}
impl ElementNode for DetailsNode {
    lexical_model::element_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
}
impl SearchText for DetailsNode {}

/// Portable DetailsSummaryNode payload: the always-visible `<summary>` line.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct DetailsSummaryNode {}
impl NodeType for DetailsSummaryNode {
    const TYPE: &'static str = "details-summary";
    type Kind = ElementKind;
    fn flag_probe() -> Option<Self> {
        Some(Self::default())
    }
    fn import(tx: &mut Transaction<'_>, json: &SerializedNode) -> crate::ModelResult<NodeKey> {
        super::wire::import_node::<Self>(tx, json)
    }
    fn import_json(_: &SerializedNode) -> crate::ModelResult<Self> {
        Ok(Self {})
    }
}
impl ImportPolicy for DetailsSummaryNode {
    const IMPORTED_STATE: ImportedState = ImportedState::None;
    const IMPORT_ELEMENT_DATA: bool = false;
}
impl ElementNode for DetailsSummaryNode {
    lexical_model::element_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
}
impl SearchText for DetailsSummaryNode {}
