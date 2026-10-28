//! Cell hyperlinks. Links are cell metadata: the text displayed in the cell is the
//! cell content and is not part of the link.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::{
    constants::{LAST_COLUMN, LAST_ROW},
    types::{Color, Link},
    Model,
};

/// Theme color slot of the hyperlink color (see `Theme::get_color_by_index`)
pub(crate) const THEME_COLOR_HYPERLINK: i32 = 10;

/// Returns the link target if `value` should be automatically converted into a
/// link when entered in a cell: an URL ("https://calc.com", "www.calc.com"), a
/// mailto: URI or a plain email address ("daniel@calc.com" -> "mailto:daniel@calc.com").
pub(crate) fn detect_link_target(value: &str) -> Option<String> {
    let value = value.trim();
    if value.chars().any(char::is_whitespace) {
        return None;
    }
    let lower = value.to_ascii_lowercase();
    for scheme in ["http://", "https://", "ftp://", "ftps://", "mailto:"] {
        if let Some(rest) = lower.strip_prefix(scheme) {
            if rest.is_empty() {
                return None;
            }
            return Some(value.to_string());
        }
    }
    if let Some(rest) = lower.strip_prefix("www.") {
        // "www.example.com" but not "www." or "www.example"
        if rest.contains('.') && !rest.starts_with('.') {
            return Some(format!("https://{value}"));
        }
        return None;
    }
    // an email address: local@domain.tld
    if let Some((local, domain)) = value.split_once('@') {
        if !local.is_empty()
            && !domain.contains('@')
            && domain.contains('.')
            && !domain.starts_with('.')
            && !domain.ends_with('.')
        {
            return Some(format!("mailto:{value}"));
        }
    }
    None
}

/// A link together with the cell (`row`, `column`) it is attached to.
/// This is the shape the bindings expose to UIs, with the link fields flattened:
/// `{"row": 2, "column": 2, "dynamic": false, "type": "External", "target": "..."}`.
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
pub struct CellLinkView {
    /// Row of the cell the link is attached to
    pub row: i32,
    /// Column of the cell the link is attached to
    pub column: i32,
    /// A dynamic link is created by a formula like HYPERLINK. It cannot be
    /// edited or deleted: it lives as long as the formula produces it.
    pub dynamic: bool,
    /// The link itself
    #[serde(flatten)]
    pub link: Link,
}

fn check_valid_cell(row: i32, column: i32) -> Result<(), String> {
    if !(1..=LAST_ROW).contains(&row) {
        return Err(format!("Invalid row: '{row}'"));
    }
    if !(1..=LAST_COLUMN).contains(&column) {
        return Err(format!("Invalid column: '{column}'"));
    }
    Ok(())
}

impl Model<'_> {
    /// Returns the link attached to cell (`row`, `column`) or `None` if there isn't one.
    /// Only links in the worksheet are returned: they are the editable ones.
    /// Dynamic links created by formulas like HYPERLINK are not included (they
    /// cannot be edited, only the formula can), see [`Model::get_links_list`].
    pub fn get_cell_link(&self, sheet: u32, row: i32, column: i32) -> Result<Option<Link>, String> {
        check_valid_cell(row, column)?;
        Ok(self
            .workbook
            .worksheet(sheet)?
            .links
            .get(&(row, column))
            .cloned())
    }

    /// Attaches `link` to cell (`row`, `column`), replacing any existing link.
    pub fn set_cell_link(
        &mut self,
        sheet: u32,
        row: i32,
        column: i32,
        link: Link,
    ) -> Result<(), String> {
        check_valid_cell(row, column)?;
        self.workbook
            .worksheet_mut(sheet)?
            .links
            .insert((row, column), link);
        Ok(())
    }

    /// Removes the link attached to cell (`row`, `column`). It is not an error
    /// if the cell has no link.
    pub fn delete_cell_link(&mut self, sheet: u32, row: i32, column: i32) -> Result<(), String> {
        check_valid_cell(row, column)?;
        self.workbook
            .worksheet_mut(sheet)?
            .links
            .remove(&(row, column));
        Ok(())
    }

    /// Returns all the links in the worksheet, keyed by (row, column).
    pub fn get_links(&self, sheet: u32) -> Result<&HashMap<(i32, i32), Link>, String> {
        Ok(&self.workbook.worksheet(sheet)?.links)
    }

    /// Attaches an external link to the cell if `value` looks like an URL or an
    /// email address. This is the auto-linking of typed or pasted URLs done by
    /// [`Model::set_user_input`], the same way other inputs change the number
    /// format of the cell.
    ///
    /// A cell that already has a link only gets its target updated; otherwise
    /// the link style (underline and the theme hyperlink color) is applied too.
    pub(crate) fn auto_link_cell(
        &mut self,
        sheet: u32,
        row: i32,
        column: i32,
        value: &str,
    ) -> Result<(), String> {
        let Some(target) = detect_link_target(value) else {
            return Ok(());
        };
        let is_new_link = !self
            .workbook
            .worksheet(sheet)?
            .links
            .contains_key(&(row, column));
        self.set_cell_link(
            sheet,
            row,
            column,
            Link::External {
                target,
                tooltip: None,
            },
        )?;
        if is_new_link {
            let mut style = self.get_style_for_cell(sheet, row, column)?;
            style.font.u = true;
            style.font.color = Color::Theme(THEME_COLOR_HYPERLINK, 0.0);
            self.set_cell_style(sheet, row, column, &style)?;
        }
        Ok(())
    }

    /// Returns all the links in the worksheet as a list sorted by (row, column):
    /// the links in the worksheet together with the dynamic ones created by
    /// formulas like HYPERLINK, marked with `dynamic: true` (worksheet links
    /// take precedence).
    pub fn get_links_list(&self, sheet: u32) -> Result<Vec<CellLinkView>, String> {
        let worksheet_links = &self.workbook.worksheet(sheet)?.links;
        let mut list: Vec<CellLinkView> = worksheet_links
            .iter()
            .map(|(&(row, column), link)| CellLinkView {
                row,
                column,
                dynamic: false,
                link: link.clone(),
            })
            .collect();
        for (&(link_sheet, row, column), link) in &self.links {
            if link_sheet == sheet && !worksheet_links.contains_key(&(row, column)) {
                list.push(CellLinkView {
                    row,
                    column,
                    dynamic: true,
                    link: link.clone(),
                });
            }
        }
        list.sort_by_key(|l| (l.row, l.column));
        Ok(list)
    }
}

#[cfg(test)]
mod tests {
    use super::detect_link_target;

    #[test]
    fn detect_link_target_urls() {
        assert_eq!(
            detect_link_target("https://www.ironcalc.com/"),
            Some("https://www.ironcalc.com/".to_string())
        );
        assert_eq!(
            detect_link_target("http://example.com"),
            Some("http://example.com".to_string())
        );
        assert_eq!(
            detect_link_target("ftp://ftp.gnu.org/"),
            Some("ftp://ftp.gnu.org/".to_string())
        );
        // case is kept, the scheme check is case-insensitive
        assert_eq!(
            detect_link_target("HTTPS://EXAMPLE.COM"),
            Some("HTTPS://EXAMPLE.COM".to_string())
        );
        // scheme-less www gets https:// prepended
        assert_eq!(
            detect_link_target("www.example.com"),
            Some("https://www.example.com".to_string())
        );
        // surrounding whitespace is ignored
        assert_eq!(
            detect_link_target("  www.example.com  "),
            Some("https://www.example.com".to_string())
        );
    }

    #[test]
    fn detect_link_target_emails() {
        assert_eq!(
            detect_link_target("hello@ironcalc.com"),
            Some("mailto:hello@ironcalc.com".to_string())
        );
        assert_eq!(
            detect_link_target("mailto:hello@ironcalc.com"),
            Some("mailto:hello@ironcalc.com".to_string())
        );
    }

    #[test]
    fn detect_link_target_rejects() {
        assert_eq!(detect_link_target("Hello world"), None);
        assert_eq!(detect_link_target("42"), None);
        assert_eq!(detect_link_target("https://"), None);
        assert_eq!(detect_link_target("www."), None);
        assert_eq!(detect_link_target("www.example"), None);
        assert_eq!(detect_link_target("not a link www.example.com"), None);
        assert_eq!(detect_link_target("daniel@localhost"), None);
        assert_eq!(detect_link_target("@example.com"), None);
        assert_eq!(detect_link_target("a@b@c.com"), None);
        assert_eq!(detect_link_target(""), None);
    }
}
