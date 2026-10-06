use std::collections::HashMap;

use crate::links::{CellLinkView, THEME_COLOR_HYPERLINK};
use crate::types::{Cell, Color, Link};

use super::{common::UserModel, history::Diff};

impl UserModel<'_> {
    /// Returns the link attached to cell (`row`, `column`) or `None` if there isn't one.
    pub fn get_cell_link(&self, sheet: u32, row: i32, column: i32) -> Result<Option<Link>, String> {
        self.model.get_cell_link(sheet, row, column)
    }

    /// Returns all the links in the worksheet, keyed by (row, column).
    pub fn get_links(&self, sheet: u32) -> Result<&HashMap<(i32, i32), Link>, String> {
        self.model.get_links(sheet)
    }

    /// Returns all the links in the worksheet as a list sorted by (row, column).
    pub fn get_links_list(&self, sheet: u32) -> Result<Vec<CellLinkView>, String> {
        self.model.get_links_list(sheet)
    }

    /// Attaches `link` to cell (`row`, `column`), replacing the existing link if there
    /// was one.
    ///
    /// If `label` is given it becomes the content of the cell (the displayed text of
    /// the link). When the cell did not have a link before, the link style (underline
    /// and the theme hyperlink color) is applied to the cell. The style is ordinary
    /// cell formatting: it can be changed afterwards and deleting the link does not
    /// remove it.
    ///
    /// The whole operation is a single entry in the undo/redo history.
    pub fn set_cell_link(
        &mut self,
        sheet: u32,
        row: i32,
        column: i32,
        link: Link,
        label: Option<&str>,
    ) -> Result<(), String> {
        let old_link = self.model.get_cell_link(sheet, row, column)?;
        let is_new_link = old_link.is_none();
        let mut diff_list = Vec::new();
        let mut needs_evaluation = false;

        if old_link.as_ref() != Some(&link) {
            self.model.set_cell_link(sheet, row, column, link.clone())?;
            diff_list.push(Diff::SetCellLink {
                sheet,
                row,
                column,
                old_value: Box::new(old_link),
                new_value: Box::new(Some(link)),
            });
        }

        if let Some(label) = label {
            if label != self.model.get_formatted_cell_value(sheet, row, column)? {
                let old_value = self
                    .model
                    .workbook
                    .worksheet(sheet)?
                    .cell(row, column)
                    .cloned();
                // If it is a spill cell we want to save the old value as None, because
                // the value of a spill cell is determined by the anchor cell
                let old_value = if matches!(old_value, Some(Cell::SpillCell { .. })) {
                    None
                } else {
                    old_value
                };
                self.model
                    .set_user_input(sheet, row, column, label.to_string())?;
                needs_evaluation = true;
                diff_list.push(Diff::SetCellValue {
                    sheet,
                    row,
                    column,
                    new_value: label.to_string(),
                    old_value: Box::new(old_value),
                });
            }
        }

        if is_new_link {
            let old_style = self.model.get_cell_style_or_none(sheet, row, column)?;
            let mut style = self.model.get_style_for_cell(sheet, row, column)?;
            style.font.u = true;
            style.font.color = Color::Theme(THEME_COLOR_HYPERLINK, 0.0);
            self.model.set_cell_style(sheet, row, column, &style)?;
            diff_list.push(Diff::SetCellStyle {
                sheet,
                row,
                column,
                old_value: Box::new(old_style),
                new_value: Box::new(style),
            });
        }

        if diff_list.is_empty() {
            // no-op, don't pollute the undo history
            return Ok(());
        }
        self.push_diff_list(diff_list);
        if needs_evaluation {
            self.evaluate_if_not_paused();
        }
        Ok(())
    }

    /// Removes the link attached to cell (`row`, `column`). It is not an error if the
    /// cell has no link. The cell content and the cell style are left untouched.
    pub fn delete_cell_link(&mut self, sheet: u32, row: i32, column: i32) -> Result<(), String> {
        let old_value = self.model.get_cell_link(sheet, row, column)?;
        if old_value.is_none() {
            return Ok(());
        }
        self.model.delete_cell_link(sheet, row, column)?;
        self.push_diff_list(vec![Diff::SetCellLink {
            sheet,
            row,
            column,
            old_value: Box::new(old_value),
            new_value: Box::new(None),
        }]);
        Ok(())
    }
}
