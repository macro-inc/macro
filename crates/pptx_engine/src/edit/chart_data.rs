//! `setChartData`: rewrites the series of a plot (names, categories, values)
//! as worksheet references with caches, keeping each series' formatting.
//!
//! Data is laid out the way PowerPoint lays out a chart's sheet: series names
//! in row 1 from column B on, categories in column A from row 2 on, and the
//! values of series `i` in column `i + 1`.

use super::chart::{
    self, SER_ORDER, child_int, import_chart_fragment, set_child_val, set_series_color, xml_text,
};
use super::ops::ChartSeriesData;
use crate::error::{Error, Result};
use crate::xml::{NodeId, Ns, XmlDoc};

/// Most series a chart edit writes.
pub(crate) const MAX_SERIES: usize = 255;
/// Most categories a chart edit writes.
pub(crate) const MAX_CATEGORIES: usize = 10_000;
/// Most data cells (categories × series) a chart edit writes.
const MAX_CELLS: usize = 250_000;
/// Sheet used when the chart's formulas name none.
const DEFAULT_SHEET: &str = "Sheet1";

/// Where the rewritten data lives in the workbook.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Layout {
    /// Worksheet name (unquoted).
    pub sheet: String,
    /// Whether categories were written as numbers (the chart had numeric categories).
    pub numeric_categories: bool,
}

/// Checks a data set before any part is touched.
pub(crate) fn validate(categories: &[String], series: &[ChartSeriesData]) -> Result<()> {
    if categories.is_empty() {
        return Err(Error::InvalidEdit(
            "a chart needs at least one category".into(),
        ));
    }
    if series.is_empty() {
        return Err(Error::InvalidEdit(
            "a chart needs at least one series".into(),
        ));
    }
    if categories.len() > MAX_CATEGORIES || series.len() > MAX_SERIES {
        return Err(Error::InvalidEdit(format!(
            "charts are limited to {MAX_CATEGORIES} categories and {MAX_SERIES} series"
        )));
    }
    if categories.len() * series.len() > MAX_CELLS {
        return Err(Error::InvalidEdit(format!(
            "charts are limited to {MAX_CELLS} values"
        )));
    }
    for s in series {
        if s.values.len() > categories.len() {
            return Err(Error::InvalidEdit(format!(
                "series `{}` has {} values for {} categories",
                s.name,
                s.values.len(),
                categories.len()
            )));
        }
        if s.values.iter().flatten().any(|v| !v.is_finite()) {
            return Err(Error::InvalidEdit(format!(
                "series `{}` has a value that is not a finite number",
                s.name
            )));
        }
    }
    Ok(())
}

/// Spreadsheet column name of a 0-based index (`0` → `A`, `26` → `AA`).
pub(crate) fn column_name(index: usize) -> String {
    let mut n = index + 1;
    let mut letters = Vec::new();
    while n > 0 {
        let rem = (n - 1) % 26;
        letters.push(char::from(b'A' + rem as u8));
        n = (n - 1) / 26;
    }
    letters.iter().rev().collect()
}

/// The sheet of a formula as written (`'Sheet 1'!$A$2:$A$5` → `'Sheet 1'`).
fn formula_sheet(formula: &str) -> Option<&str> {
    let f = formula.trim();
    let end = if let Some(quoted) = f.strip_prefix('\'') {
        // A quoted name doubles embedded quotes.
        let bytes = quoted.as_bytes();
        let mut i = 0;
        loop {
            match bytes.get(i)? {
                b'\'' if bytes.get(i + 1) == Some(&b'\'') => i += 2,
                b'\'' => break i + 2,
                _ => i += 1,
            }
        }
    } else {
        f.find('!')?
    };
    let sheet = f.get(..end)?;
    let plain = !sheet.is_empty() && !sheet.contains(['[', '(', ',', ' ', '\'']);
    let valid = f[end..].starts_with('!') && (plain || sheet.starts_with('\''));
    valid.then_some(sheet)
}

/// A sheet name as a formula writes it, unquoted.
fn unquote(sheet: &str) -> String {
    match sheet.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')) {
        Some(inner) => inner.replace("''", "'"),
        None => sheet.to_owned(),
    }
}

/// The first formula (`c:f`) of a series' name, categories, or values.
fn first_formula(doc: &XmlDoc, ser: NodeId) -> Option<String> {
    ["tx", "cat", "val"]
        .iter()
        .filter_map(|name| doc.child(ser, Ns::C, name))
        .flat_map(|d| doc.children(d).collect::<Vec<_>>())
        .find_map(|r| doc.child(r, Ns::C, "f"))
        .map(|f| doc.text(f))
}

/// The cache (or literal) element inside a data reference such as `c:val`.
fn cache_of(doc: &XmlDoc, data: NodeId) -> Option<NodeId> {
    doc.children(data).find_map(|inner| match doc.local(inner) {
        "numLit" | "strLit" => Some(inner),
        "numRef" => doc.child(inner, Ns::C, "numCache"),
        "strRef" => doc.child(inner, Ns::C, "strCache"),
        "multiLvlStrRef" => doc.child(inner, Ns::C, "multiLvlStrCache"),
        _ => None,
    })
}

/// The number format of a numeric data reference, if it has one.
fn format_code(doc: &XmlDoc, data: NodeId) -> Option<String> {
    let cache = cache_of(doc, data)?;
    if !matches!(doc.local(cache), "numCache" | "numLit") {
        return None;
    }
    doc.child(cache, Ns::C, "formatCode")
        .map(|f| doc.text(f))
        .filter(|f| !f.trim().is_empty())
}

/// Number formats of the categories when they stay numeric: the chart had
/// numeric categories and every new one is a number.
fn numeric_categories(doc: &XmlDoc, ser: NodeId, categories: &[String]) -> Option<String> {
    let cat = doc.child(ser, Ns::C, "cat")?;
    let numeric = doc
        .children(cat)
        .any(|c| matches!(doc.local(c), "numRef" | "numLit"));
    let all_numbers = categories
        .iter()
        .all(|c| c.trim().parse::<f64>().is_ok_and(f64::is_finite));
    (numeric && all_numbers).then(|| format_code(doc, cat).unwrap_or_else(|| "General".into()))
}

/// A number as a cache point writes it.
pub(crate) fn number_text(v: f64) -> String {
    if v == 0.0 { "0".into() } else { v.to_string() }
}

/// Replaces child `local` of a series with `xml` (or inserts it in schema order).
fn replace_child(doc: &mut XmlDoc, ser: NodeId, local: &str, xml: &str) -> Result<()> {
    let new = import_chart_fragment(doc, xml)?;
    match doc.child(ser, Ns::C, local) {
        Some(old) => {
            doc.insert_before(old, new);
            doc.detach(old);
        }
        None => doc.insert_in_order(ser, new, SER_ORDER),
    }
    Ok(())
}

/// What every series of one rewrite shares.
struct Frame<'a> {
    /// The sheet as formulas write it (quoted when needed).
    sheet: &'a str,
    categories: &'a [String],
    /// Number format of numeric categories (`None` = text categories).
    category_format: Option<&'a str>,
}

impl Frame<'_> {
    /// Last data row (row 1 holds the series names).
    fn last_row(&self) -> usize {
        self.categories.len() + 1
    }

    fn name_xml(&self, column: &str, name: &str) -> String {
        format!(
            "<c:tx><c:strRef><c:f>{}</c:f><c:strCache><c:ptCount val=\"1\"/><c:pt idx=\"0\"><c:v>{}</c:v></c:pt></c:strCache></c:strRef></c:tx>",
            xml_text(&format!("{}!${column}$1", self.sheet)),
            xml_text(name)
        )
    }

    fn categories_xml(&self) -> String {
        let formula = xml_text(&format!("{}!$A$2:$A${}", self.sheet, self.last_row()));
        let count = self.categories.len();
        match self.category_format {
            Some(code) => {
                let points: String = self
                    .categories
                    .iter()
                    .enumerate()
                    .filter_map(|(i, c)| {
                        let v = c.trim().parse::<f64>().ok()?;
                        Some(format!(
                            "<c:pt idx=\"{i}\"><c:v>{}</c:v></c:pt>",
                            number_text(v)
                        ))
                    })
                    .collect();
                format!(
                    "<c:cat><c:numRef><c:f>{formula}</c:f><c:numCache><c:formatCode>{}</c:formatCode><c:ptCount val=\"{count}\"/>{points}</c:numCache></c:numRef></c:cat>",
                    xml_text(code)
                )
            }
            None => {
                let points: String = self
                    .categories
                    .iter()
                    .enumerate()
                    .map(|(i, c)| format!("<c:pt idx=\"{i}\"><c:v>{}</c:v></c:pt>", xml_text(c)))
                    .collect();
                format!(
                    "<c:cat><c:strRef><c:f>{formula}</c:f><c:strCache><c:ptCount val=\"{count}\"/>{points}</c:strCache></c:strRef></c:cat>"
                )
            }
        }
    }

    fn values_xml(&self, column: &str, values: &[Option<f64>], format: &str) -> String {
        let formula = xml_text(&format!(
            "{}!${column}$2:${column}${}",
            self.sheet,
            self.last_row()
        ));
        let points: String = values
            .iter()
            .enumerate()
            .filter_map(|(i, v)| {
                v.map(|v| format!("<c:pt idx=\"{i}\"><c:v>{}</c:v></c:pt>", number_text(v)))
            })
            .collect();
        format!(
            "<c:val><c:numRef><c:f>{formula}</c:f><c:numCache><c:formatCode>{}</c:formatCode><c:ptCount val=\"{}\"/>{points}</c:numCache></c:numRef></c:val>",
            xml_text(format),
            self.categories.len()
        )
    }

    /// Writes series `index` (0-based, sheet column `index + 1`).
    fn write(
        &self,
        doc: &mut XmlDoc,
        ser: NodeId,
        index: usize,
        data: &ChartSeriesData,
    ) -> Result<()> {
        let column = column_name(index + 1);
        let format = doc
            .child(ser, Ns::C, "val")
            .and_then(|v| format_code(doc, v))
            .unwrap_or_else(|| "General".into());
        replace_child(doc, ser, "tx", &self.name_xml(&column, &data.name))?;
        replace_child(doc, ser, "cat", &self.categories_xml())?;
        replace_child(
            doc,
            ser,
            "val",
            &self.values_xml(&column, &data.values, &format),
        )?;
        Ok(())
    }
}

/// A copy of `template` as a new series with index and order `n`, keeping
/// its formatting but none of its per-point details.
fn clone_series(doc: &mut XmlDoc, plot: NodeId, template: NodeId, n: i64) -> Result<NodeId> {
    let ser = doc.deep_clone(template);
    // Point formatting and trendlines describe the template's data; extensions
    // carry its unique id.
    for name in ["dPt", "trendline", "errBars", "extLst"] {
        doc.remove_children_named(ser, Ns::C, name);
    }
    if let Some(labels) = doc.child(ser, Ns::C, "dLbls") {
        doc.remove_children_named(labels, Ns::C, "dLbl");
    }
    if let Some(marker) = doc.child(ser, Ns::C, "marker") {
        doc.remove_children_named(marker, Ns::C, "spPr");
    }
    let n_text = n.to_string();
    set_child_val(doc, ser, "idx", &n_text, SER_ORDER);
    set_child_val(doc, ser, "order", &n_text, SER_ORDER);
    // Pies and doughnuts color points, not series.
    if !matches!(
        doc.local(plot),
        "pieChart" | "pie3DChart" | "doughnutChart" | "ofPieChart"
    ) {
        let accent = format!("accent{}", n.rem_euclid(6) + 1);
        let line = chart::colors_line(doc, plot);
        set_series_color(doc, ser, &accent, line)?;
    }
    Ok(ser)
}

/// Removes per-point formatting and labels at or past `count` points.
fn trim_points(doc: &mut XmlDoc, plot: NodeId, count: usize) {
    let beyond = |doc: &XmlDoc, n: NodeId| {
        child_int(doc, n, "idx").is_some_and(|i| i < 0 || i as usize >= count)
    };
    let mut holders: Vec<NodeId> = doc.children_named(plot, Ns::C, "ser").collect();
    holders.push(plot);
    for holder in holders {
        let points: Vec<NodeId> = doc
            .children_named(holder, Ns::C, "dPt")
            .filter(|&p| beyond(doc, p))
            .collect();
        let labels: Vec<NodeId> = doc
            .child(holder, Ns::C, "dLbls")
            .map(|d| {
                doc.children_named(d, Ns::C, "dLbl")
                    .filter(|&l| beyond(doc, l))
                    .collect()
            })
            .unwrap_or_default();
        for n in points.into_iter().chain(labels) {
            doc.detach(n);
        }
    }
}

/// Rewrites the series of `plot` to show exactly `categories` and `series`.
///
/// Series keep their formatting by position (in plot order); extra series
/// copy the last one with the next accent color; surplus series are removed.
pub(crate) fn rewrite(
    doc: &mut XmlDoc,
    plot: NodeId,
    categories: &[String],
    series: &[ChartSeriesData],
) -> Result<Layout> {
    let existing = chart::plot_series(doc, plot);
    let (Some(&first), Some(&template)) = (existing.first(), existing.last()) else {
        return Err(Error::InvalidEdit("the chart has no series".into()));
    };
    let sheet = existing
        .iter()
        .filter_map(|&s| first_formula(doc, s))
        .find_map(|f| formula_sheet(&f).map(str::to_owned))
        .unwrap_or_else(|| DEFAULT_SHEET.to_owned());
    let category_format = numeric_categories(doc, first, categories);
    let frame = Frame {
        sheet: &sheet,
        categories,
        category_format: category_format.as_deref(),
    };
    let area = doc
        .parent(plot)
        .ok_or_else(|| Error::InvalidEdit("the plot is detached".into()))?;
    let mut next = chart::all_series(doc, area)
        .iter()
        .flat_map(|&s| [child_int(doc, s, "idx"), child_int(doc, s, "order")])
        .flatten()
        .max()
        .unwrap_or(-1)
        .max(-1)
        .saturating_add(1);
    let mut anchor = doc
        .children_named(plot, Ns::C, "ser")
        .last()
        .unwrap_or(template);
    for (i, data) in series.iter().enumerate() {
        let ser = match existing.get(i) {
            Some(&s) => s,
            None => {
                let s = clone_series(doc, plot, template, next)?;
                doc.insert_after(anchor, s);
                anchor = s;
                next = next.saturating_add(1);
                s
            }
        };
        frame.write(doc, ser, i, data)?;
    }
    for &surplus in existing.iter().skip(series.len()) {
        doc.detach(surplus);
    }
    trim_points(doc, plot, categories.len());
    Ok(Layout {
        sheet: unquote(&sheet),
        numeric_categories: category_format.is_some(),
    })
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn column_names() {
        assert_eq!(column_name(0), "A");
        assert_eq!(column_name(1), "B");
        assert_eq!(column_name(25), "Z");
        assert_eq!(column_name(26), "AA");
        assert_eq!(column_name(27), "AB");
        assert_eq!(column_name(701), "ZZ");
        assert_eq!(column_name(702), "AAA");
    }

    #[test]
    fn formula_sheets() {
        assert_eq!(formula_sheet("Sheet1!$A$2:$A$5"), Some("Sheet1"));
        assert_eq!(formula_sheet("'Sheet 1'!$B$1"), Some("'Sheet 1'"));
        assert_eq!(formula_sheet("'It''s'!$B$1"), Some("'It''s'"));
        assert_eq!(unquote("'It''s'"), "It's");
        assert_eq!(unquote("Data"), "Data");
        assert_eq!(formula_sheet("$A$1"), None);
        assert_eq!(formula_sheet("'unterminated!$A$1"), None);
        assert_eq!(formula_sheet("[1]Sheet1!$A$1"), None);
    }

    #[test]
    fn validation() {
        let s = |values: Vec<Option<f64>>| ChartSeriesData {
            name: "S".into(),
            values,
        };
        let cats = vec!["A".to_owned(), "B".to_owned()];
        assert!(validate(&cats, &[s(vec![Some(1.0), None])]).is_ok());
        assert!(
            validate(&cats, &[s(vec![Some(1.0)])]).is_ok(),
            "short series pad with blanks"
        );
        assert!(validate(&cats, &[s(vec![Some(1.0); 3])]).is_err());
        assert!(validate(&cats, &[s(vec![Some(f64::NAN)])]).is_err());
        assert!(validate(&[], &[s(vec![])]).is_err());
        assert!(validate(&cats, &[]).is_err());
    }
}
