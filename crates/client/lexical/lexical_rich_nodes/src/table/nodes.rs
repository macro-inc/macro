//! Table payloads preserve upstream JSON field order and import coercions.
use super::*;
use serde::{Deserialize, Deserializer, Serialize, Serializer, de::DeserializeOwned};

/// A JavaScript number; integral finite values serialize without a decimal part.
#[derive(Clone, Copy, Debug, PartialEq, PartialOrd, Deserialize)]
#[serde(transparent)]
pub struct JsNumber(pub f64);
impl Serialize for JsNumber {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        if self.0.is_finite() && self.0.fract() == 0.0 && self.0.abs() < 9_007_199_254_740_992.0 {
            serializer.serialize_i64(self.0 as i64)
        } else {
            serializer.serialize_f64(self.0)
        }
    }
}
bitflags::bitflags! {
    /// Upstream TableCellHeaderStates, retaining arithmetic toggle results.
    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
    pub struct TableCellHeaderState: u8 {
        /// Ordinary data cell.
        const NO_STATUS = 0;
        /// Header for its column, placed in a header row.
        const ROW = 1;
        /// Header for its row, placed in a header column.
        const COLUMN = 2;
        /// Both header flags.
        const BOTH = 3;
    }
}
impl Serialize for TableCellHeaderState {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_u8(self.bits())
    }
}
impl<'de> Deserialize<'de> for TableCellHeaderState {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        Ok(Self::from_bits_retain(u8::deserialize(deserializer)?))
    }
}
fn falsy_default<'de, D: Deserializer<'de>, T: DeserializeOwned + Default>(
    d: D,
) -> std::result::Result<T, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    if js_truthy(&value) {
        serde_json::from_value(value).map_err(serde::de::Error::custom)
    } else {
        Ok(T::default())
    }
}
fn falsy_one<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<u32, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    if js_truthy(&value) {
        serde_json::from_value(value).map_err(serde::de::Error::custom)
    } else {
        Ok(1)
    }
}
fn header_masked<'de, D: Deserializer<'de>>(
    d: D,
) -> std::result::Result<TableCellHeaderState, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    let bits = if js_truthy(&value) {
        serde_json::from_value::<u32>(value).map_err(serde::de::Error::custom)?
    } else {
        0
    };
    Ok(TableCellHeaderState::from_bits_retain((bits & 3) as u8))
}
fn one() -> u32 {
    1
}
fn is_zero(v: &u32) -> bool {
    *v == 0
}
fn is_false(v: &bool) -> bool {
    !v
}
fn invalid_align(v: &Option<String>) -> bool {
    !matches!(v.as_deref(), Some("middle" | "bottom"))
}

/// Upstream TableNode payload; tree links belong to the core model.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableNode {
    /// Optional column widths; null slots preserve out-of-range insertion behavior.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub col_widths: Option<Vec<Option<JsNumber>>>,
    /// Number of frozen columns; omitted at zero.
    #[serde(
        default,
        deserialize_with = "falsy_default",
        skip_serializing_if = "is_zero"
    )]
    pub frozen_column_count: u32,
    /// Number of frozen rows; omitted at zero.
    #[serde(
        default,
        deserialize_with = "falsy_default",
        skip_serializing_if = "is_zero"
    )]
    pub frozen_row_count: u32,
    /// Alternating row shading.
    #[serde(
        default,
        deserialize_with = "falsy_default",
        skip_serializing_if = "is_false"
    )]
    pub row_striping: bool,
}
impl NodeType for TableNode {
    const TYPE: &'static str = "table";
    type Kind = ElementKind;
    impl_default_node!();
    fn class_name() -> &'static str {
        "TableNode"
    }
}
impl ElementNode for TableNode {
    element_node_base!();
    fn is_shadow_root(&self, _: ElementView<'_>) -> bool {
        true
    }
    fn can_be_empty(&self, _: ElementView<'_>) -> bool {
        false
    }
    fn can_indent(&self, _: ElementView<'_>) -> bool {
        false
    }
    fn extract_with_child(
        &self,
        _: ElementView<'_>,
        _: NodeKey,
        _: Option<&Selection>,
        destination: CopyDestination,
    ) -> bool {
        destination == CopyDestination::Html
    }
}
/// Capability consumed by table handlers when placing a caret before a table.
pub trait CanSelectBefore: Send + Sync {
    /// Whether a caret can be placed before this node.
    fn can_select_before(&self) -> bool;
}
impl CanSelectBefore for TableNode {
    fn can_select_before(&self) -> bool {
        true
    }
}
impl TableNode {
    /// Sum cell spans in the first row, or zero for a table without rows.
    pub fn column_count(view: StateRef<'_>, table: Id<Self>) -> u32 {
        view.first_child(table).map_or(0, |row| {
            view.children(row)
                .filter_map(|cell| view.get::<TableCellNode>(cell))
                .map(|cell| cell.col_span)
                .sum()
        })
    }
}
/// Upstream TableRowNode payload.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TableRowNode {
    /// Optional height, preserving fractional values and zero.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<JsNumber>,
}
impl NodeType for TableRowNode {
    const TYPE: &'static str = "tablerow";
    type Kind = ElementKind;
    impl_default_node!();
    fn class_name() -> &'static str {
        "TableRowNode"
    }
}
impl ElementNode for TableRowNode {
    element_node_base!();
    fn is_shadow_root(&self, _: ElementView<'_>) -> bool {
        true
    }
    fn can_be_empty(&self, _: ElementView<'_>) -> bool {
        false
    }
    fn can_indent(&self, _: ElementView<'_>) -> bool {
        false
    }
    fn extract_with_child(
        &self,
        _: ElementView<'_>,
        _: NodeKey,
        _: Option<&Selection>,
        destination: CopyDestination,
    ) -> bool {
        destination == CopyDestination::Html
    }
}
/// Upstream TableCellNode payload, in exportJSON field order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCellNode {
    /// Raw alignment; only middle/bottom are exported.
    #[serde(
        default,
        deserialize_with = "falsy_default",
        skip_serializing_if = "invalid_align"
    )]
    pub vertical_align: Option<String>,
    /// Background fill; empty input becomes null.
    #[serde(default, deserialize_with = "falsy_default")]
    pub background_color: Option<String>,
    /// Horizontal span; falsy imported values become one.
    #[serde(default = "one", deserialize_with = "falsy_one")]
    pub col_span: u32,
    /// Imported header bits are masked to BOTH.
    #[serde(default, deserialize_with = "header_masked")]
    pub header_state: TableCellHeaderState,
    /// Vertical span; falsy imported values become one.
    #[serde(default = "one", deserialize_with = "falsy_one")]
    pub row_span: u32,
    /// Optional width; falsy imported values are absent.
    #[serde(
        default,
        deserialize_with = "falsy_default",
        skip_serializing_if = "Option::is_none"
    )]
    pub width: Option<JsNumber>,
}
impl Default for TableCellNode {
    fn default() -> Self {
        Self::new(TableCellHeaderState::NO_STATUS, 1, None)
    }
}
impl TableCellNode {
    /// Construct a cell with row span one and no fill or vertical alignment.
    pub fn new(header_state: TableCellHeaderState, col_span: u32, width: Option<JsNumber>) -> Self {
        Self {
            vertical_align: None,
            background_color: None,
            col_span,
            header_state,
            row_span: 1,
            width,
        }
    }
    /// Replace only masked header bits.
    pub fn set_header_styles(&mut self, header: TableCellHeaderState, mask: TableCellHeaderState) {
        self.header_state = TableCellHeaderState::from_bits_retain(
            (header.bits() & mask.bits()) | (self.header_state.bits() & !mask.bits()),
        );
    }
    /// Upstream arithmetic toggle: toggling BOTH from ROW yields the retained value four.
    pub fn toggle_header_style(&mut self, header: TableCellHeaderState) {
        let bits = if self.has_header_state(header) {
            self.header_state.bits().wrapping_sub(header.bits())
        } else {
            self.header_state.bits().wrapping_add(header.bits())
        };
        self.header_state = TableCellHeaderState::from_bits_retain(bits);
    }
    /// Whether every requested header bit is present.
    pub fn has_header_state(&self, header: TableCellHeaderState) -> bool {
        self.header_state.contains(header)
    }
    /// Whether any header status is present, including arithmetic toggle bits.
    pub fn has_header(&self) -> bool {
        !self.header_state.is_empty()
    }
    /// Store nonempty alignment, leaving export filtering to the payload serializer.
    pub fn set_vertical_align(&mut self, value: Option<String>) {
        self.vertical_align = value.filter(|v| !v.is_empty());
    }
}
impl NodeType for TableCellNode {
    const TYPE: &'static str = "tablecell";
    type Kind = ElementKind;
    impl_default_node!();
    fn class_name() -> &'static str {
        "TableCellNode"
    }
}
impl ElementNode for TableCellNode {
    element_node_base!();
    fn is_shadow_root(&self, _: ElementView<'_>) -> bool {
        true
    }
    fn can_be_empty(&self, _: ElementView<'_>) -> bool {
        false
    }
    fn can_indent(&self, _: ElementView<'_>) -> bool {
        false
    }
    fn collapse_at_start(_: &mut Transaction<'_>, _: Id<Self>, _: SelectionSlot) -> Result<bool> {
        Ok(true)
    }
}
#[cfg(test)]
mod test;
