//! Serialized export theme, defaulting to the headless empty theme.
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
/// Theme classes used by node HTML export.
pub struct EditorTheme {
    /// Optional view theme class or nested theme.
    pub paragraph: Option<String>,

    /// Optional view theme class or nested theme.
    pub quote: Option<String>,

    /// Optional view theme class or nested theme.
    pub heading: HeadingTheme,

    /// Optional view theme class or nested theme.
    pub link: Option<String>,

    /// Optional view theme class or nested theme.
    pub code: Option<String>,
    /// highlightType -> class (theme.codeHighlight[type]).

    /// Optional view theme class or nested theme.
    pub code_highlight: std::collections::BTreeMap<String, String>,

    /// Optional view theme class or nested theme.
    pub tab: Option<String>,

    /// Optional view theme class or nested theme.
    pub mark: Option<String>,

    /// Optional view theme class or nested theme.
    pub mark_overlap: Option<String>,

    /// Optional view theme class or nested theme.
    pub table: Option<String>,

    /// Optional view theme class or nested theme.
    pub table_row: Option<String>,

    /// Optional view theme class or nested theme.
    pub table_cell: Option<String>,

    /// Optional view theme class or nested theme.
    pub table_cell_header: Option<String>,

    /// Optional view theme class or nested theme.
    pub table_row_striping: Option<String>,

    /// Optional view theme class or nested theme.
    pub table_alignment: Option<TableAlignmentTheme>,

    /// Optional view theme class or nested theme.
    pub list: Option<ListTheme>,

    /// Optional view theme class or nested theme.
    pub text: Option<TextTheme>,

    /// Optional view theme class or nested theme.
    pub search_match: Option<String>,
    /// `theme['inline-search']` (Macro InlineSearchNode).
    #[serde(rename = "inline-search")]

    /// Optional view theme class or nested theme.
    pub inline_search: Option<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
/// Theme classes used by node HTML export.
pub struct HeadingTheme {
    /// Optional view theme class or nested theme.
    pub h1: Option<String>,
    /// Optional view theme class or nested theme.
    pub h2: Option<String>,
    /// Optional view theme class or nested theme.
    pub h3: Option<String>,

    /// Optional view theme class or nested theme.
    pub h4: Option<String>,
    /// Optional view theme class or nested theme.
    pub h5: Option<String>,
    /// Optional view theme class or nested theme.
    pub h6: Option<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
/// Theme classes used by node HTML export.
pub struct TableAlignmentTheme {
    /// Optional view theme class or nested theme.
    pub center: Option<String>,
    /// Optional view theme class or nested theme.
    pub right: Option<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
/// Theme classes used by node HTML export.
pub struct ListTheme {
    /// Optional view theme class or nested theme.
    pub ul: Option<String>,
    /// Optional view theme class or nested theme.
    pub ol: Option<String>,

    /// Optional view theme class or nested theme.
    pub ul_depth: Vec<String>,
    /// Optional view theme class or nested theme.
    pub ol_depth: Vec<String>,

    /// Optional view theme class or nested theme.
    pub nested: Option<NestedListTheme>,
    /// Optional view theme class or nested theme.
    pub checklist: Option<String>,

    /// Optional view theme class or nested theme.
    pub listitem: Option<String>,
    /// Optional view theme class or nested theme.
    pub listitem_checked: Option<String>,
    /// Optional view theme class or nested theme.
    pub listitem_unchecked: Option<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
/// Theme classes used by node HTML export.
pub struct NestedListTheme {
    /// Optional view theme class or nested theme.
    pub list: Option<String>,
    /// Optional view theme class or nested theme.
    pub listitem: Option<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
/// Theme classes used by node HTML export.
pub struct TextTheme {
    /// Optional view theme class or nested theme.
    pub base: Option<String>,
    /// Optional view theme class or nested theme.
    pub bold: Option<String>,
    /// Optional view theme class or nested theme.
    pub capitalize: Option<String>,

    /// Optional view theme class or nested theme.
    pub code: Option<String>,
    /// Optional view theme class or nested theme.
    pub highlight: Option<String>,
    /// Optional view theme class or nested theme.
    pub italic: Option<String>,

    /// Optional view theme class or nested theme.
    pub lowercase: Option<String>,
    /// Optional view theme class or nested theme.
    pub strikethrough: Option<String>,
    /// Optional view theme class or nested theme.
    pub subscript: Option<String>,

    /// Optional view theme class or nested theme.
    pub superscript: Option<String>,
    /// Optional view theme class or nested theme.
    pub underline: Option<String>,
    /// Optional view theme class or nested theme.
    pub uppercase: Option<String>,

    /// Optional view theme class or nested theme.
    pub underline_strikethrough: Option<String>,
}
