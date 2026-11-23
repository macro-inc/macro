//! Typed saved-view fidelity; diagnostic paths never reach report rendering.
use import_notion::domain::model::NotionId;
use import_notion::domain::views::{ViewLossKind, ViewSetting, ViewType};
use serde::{Deserialize, Serialize};

/// A counted semantic loss from one imported saved view.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ViewWarning {
    /// Source identity, never printed.
    pub source_id: NotionId,
    /// Original view identity, never printed.
    pub view_id: NotionId,
    /// Database display title.
    pub source: String,
    /// View display title.
    pub view: String,
    /// Lost query/layout component.
    pub kind: ViewLossKind,
    /// Semantic display setting supplied by the translator.
    pub setting: ViewSetting,
    /// Original layout, for layout/visibility explanations.
    pub layout: ViewType,
    /// Property display titles, never config keys or predicate values.
    pub properties: Vec<String>,
    /// Number of distinct losses with this explanation.
    pub count: u32,
}

impl ViewWarning {
    /// Exhaustive readable rendering, independent of source path spellings.
    pub fn render(&self) -> String {
        format!(
            "Database “{}”, view “{}”: {}",
            self.source,
            self.view,
            self.detail()
        )
    }

    pub(crate) fn detail(&self) -> String {
        let properties = self
            .properties
            .iter()
            .map(|name| format!("“{name}”"))
            .collect::<Vec<_>>()
            .join(", ");
        let context = if properties.is_empty() {
            String::new()
        } else {
            format!(" for {properties}")
        };
        let detail = match self.kind {
            ViewLossKind::Filter => format!(
                "the filter{context} could not be preserved exactly; this view may show additional rows"
            ),
            ViewLossKind::FilterIncludesBlankStatus => {
                format!("the filter{context} may include additional rows with an empty status")
            }
            ViewLossKind::Sort => {
                format!("the sort{context} was omitted; rows may appear in a different order")
            }
            ViewLossKind::Layout => {
                let layout = match self.layout {
                    ViewType::Table => "table",
                    ViewType::Board => "board",
                    ViewType::Timeline => "timeline",
                    ViewType::List => "list",
                    ViewType::Calendar => "calendar",
                    ViewType::Gallery => "gallery",
                    ViewType::Form => "form",
                    ViewType::Chart => "chart",
                    ViewType::Map => "map",
                    ViewType::Dashboard => "dashboard",
                    ViewType::Unknown => "Notion",
                };
                format!("the {layout} layout is shown as a table")
            }
            ViewLossKind::Setting => match self.setting {
                ViewSetting::ColumnVisibility | ViewSetting::HiddenColumn => {
                    if self.layout == ViewType::Table {
                        format!(
                            "column visibility{context} could not be kept; imported table columns stay visible"
                        )
                    } else {
                        format!("column visibility{context} could not be preserved exactly")
                    }
                }
                ViewSetting::ColumnWidth => format!("the column width{context} could not be kept"),
                ViewSetting::Grouping => {
                    format!("the grouping or lane order{context} could not be preserved exactly")
                }
                ViewSetting::QuickFilters => {
                    format!("the quick filters setting{context} could not be kept")
                }
                ViewSetting::WrapCells => {
                    format!("the wrap cells setting{context} could not be kept")
                }
                ViewSetting::Cover => format!("the cover setting{context} could not be kept"),
                ViewSetting::ShowWeekends => {
                    format!("the show weekends setting{context} could not be kept")
                }
                ViewSetting::Other => format!("the display setting{context} could not be kept"),
            },
        };
        let mut message = format!("{detail}.");
        if self.count > 1 {
            let details = match self.kind {
                ViewLossKind::Filter | ViewLossKind::FilterIncludesBlankStatus => {
                    "filter conditions"
                }
                ViewLossKind::Sort => "sort rules",
                ViewLossKind::Layout => "layout details",
                ViewLossKind::Setting => "display settings",
            };
            message.push_str(&format!(" {} {details} were affected.", self.count));
        }
        message
    }
}

#[cfg(test)]
mod test {
    use super::*;
    #[test]
    fn every_view_setting_renders_a_readable_exhaustive_sentence() {
        let settings = [
            ViewSetting::HiddenColumn,
            ViewSetting::ColumnVisibility,
            ViewSetting::ColumnWidth,
            ViewSetting::Grouping,
            ViewSetting::QuickFilters,
            ViewSetting::WrapCells,
            ViewSetting::Cover,
            ViewSetting::ShowWeekends,
            ViewSetting::Other,
        ];
        for setting in settings {
            let expected = match setting {
                ViewSetting::ColumnVisibility | ViewSetting::HiddenColumn => {
                    "column visibility for “Owner” could not be kept; imported table columns stay visible"
                }
                ViewSetting::ColumnWidth => "the column width for “Owner” could not be kept",
                ViewSetting::Grouping => {
                    "the grouping or lane order for “Owner” could not be preserved exactly"
                }
                ViewSetting::QuickFilters => {
                    "the quick filters setting for “Owner” could not be kept"
                }
                ViewSetting::WrapCells => "the wrap cells setting for “Owner” could not be kept",
                ViewSetting::Cover => "the cover setting for “Owner” could not be kept",
                ViewSetting::ShowWeekends => {
                    "the show weekends setting for “Owner” could not be kept"
                }
                ViewSetting::Other => "the display setting for “Owner” could not be kept",
            };
            let warning = ViewWarning {
                source_id: NotionId::parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap(),
                view_id: NotionId::parse("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb").unwrap(),
                source: "Tasks".into(),
                view: "Active tasks".into(),
                kind: ViewLossKind::Setting,
                setting,
                layout: ViewType::Table,
                properties: vec!["Owner".into()],
                count: 1,
            };
            assert_eq!(
                crate::domain::models::FidelityWarning::ViewLoss(warning).render(),
                format!("Database “Tasks”, view “Active tasks”: {expected}.")
            );
        }
    }
}
