//! The embedded workbook behind a chart: rewriting its data sheet after a
//! data edit, and building a minimal workbook for a new chart.
//!
//! The workbook is an OPC package of its own, read and written with the
//! engine's package code, so every part except the data sheet (and a table
//! over it) keeps its original bytes. The sheet holds series names in row 1
//! from column B, categories in column A from row 2, and the values of
//! series `i` in column `i + 1`, as the chart's formulas expect.

use super::chart::xml_text;
use super::chart_data::{column_name, number_text};
use super::ops::ChartSeriesData;
use crate::error::{Error, Result};
use crate::opc::Package;
use crate::xml::{NodeId, Ns, XmlDoc};
use crate::zip::{WriteData, Writer};
use std::collections::HashMap;

/// SpreadsheetML main namespace.
const MAIN_NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
/// Office relationships namespace.
const REL_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
/// Table header text for an empty category header.
const CATEGORY_HEADER: &str = "Category";

/// The data a chart's sheet holds.
#[derive(Clone, Copy, Debug)]
pub(crate) struct SheetData<'a> {
    /// Category labels (column A).
    pub categories: &'a [String],
    /// Write categories as numbers (they parse as numbers).
    pub numeric_categories: bool,
    /// Series (columns B on).
    pub series: &'a [ChartSeriesData],
}

impl SheetData<'_> {
    fn columns(&self) -> usize {
        self.series.len() + 1
    }

    fn rows(&self) -> usize {
        self.categories.len() + 1
    }

    /// The used range, `A1:{last column}{last row}`.
    fn range(&self) -> String {
        format!("A1:{}{}", column_name(self.columns() - 1), self.rows())
    }

    /// Row 1 as written without a table: blank, then the series names.
    fn plain_headers(&self) -> Vec<String> {
        std::iter::once(String::new())
            .chain(self.series.iter().map(|s| s.name.clone()))
            .collect()
    }

    /// Row 1 as a table needs it: non-empty, unique (ignoring case) names.
    fn table_headers(&self) -> Vec<String> {
        let mut used: Vec<String> = Vec::new();
        self.plain_headers()
            .into_iter()
            .enumerate()
            .map(|(i, name)| {
                let name = name.trim().to_owned();
                let base = match (name.is_empty(), i) {
                    (false, _) => name,
                    (true, 0) => CATEGORY_HEADER.to_owned(),
                    (true, _) => format!("Series{i}"),
                };
                let mut unique = base.clone();
                let mut n = 2;
                while used.iter().any(|u| u.eq_ignore_ascii_case(&unique)) {
                    unique = format!("{base}{n}");
                    n += 1;
                }
                used.push(unique.clone());
                unique
            })
            .collect()
    }
}

/// One cell's content.
enum Cell<'a> {
    Text(&'a str),
    Number(f64),
    Empty,
}

/// `(column, row)` of a cell reference like `B12` (0-based column, 1-based row).
fn parse_ref(r: &str) -> Option<(usize, usize)> {
    let split = r.find(|c: char| c.is_ascii_digit())?;
    let (letters, digits) = r.split_at(split);
    if letters.is_empty() || letters.len() > 3 || !letters.chars().all(|c| c.is_ascii_alphabetic())
    {
        return None;
    }
    let col = letters.chars().fold(0usize, |acc, c| {
        acc * 26 + usize::from(c.to_ascii_uppercase() as u8 - b'A' + 1)
    });
    Some((col - 1, digits.parse().ok()?))
}

/// The cell styles (`s`) of a sheet by position.
type Styles = HashMap<(usize, usize), String>;

fn cell_xml(out: &mut String, col: usize, row: usize, cell: Cell<'_>, style: Option<&str>) {
    let r = format!("{}{row}", column_name(col));
    let s = style.map_or_else(String::new, |s| format!(" s=\"{}\"", xml_text(s)));
    match cell {
        Cell::Text(t) if !t.is_empty() => {
            let space = if t.trim() != t {
                " xml:space=\"preserve\""
            } else {
                ""
            };
            out.push_str(&format!(
                "<c r=\"{r}\"{s} t=\"inlineStr\"><is><t{space}>{}</t></is></c>",
                xml_text(t)
            ));
        }
        Cell::Number(v) => out.push_str(&format!("<c r=\"{r}\"{s}><v>{}</v></c>", number_text(v))),
        Cell::Text(_) | Cell::Empty if !s.is_empty() => out.push_str(&format!("<c r=\"{r}\"{s}/>")),
        Cell::Text(_) | Cell::Empty => {}
    }
}

/// The rows of the data sheet (`headers` is row 1).
fn rows_xml(data: &SheetData<'_>, headers: &[String], styles: &Styles) -> String {
    let style = |col: usize, row: usize| -> Option<&str> {
        let like_row = if row == 1 { 1 } else { 2 };
        let like_col = col.min(1);
        [
            (col, row),
            (col, like_row),
            (like_col, row),
            (like_col, like_row),
        ]
        .iter()
        .find_map(|k| styles.get(k))
        .map(String::as_str)
    };
    let spans = format!("1:{}", data.columns());
    let mut out = String::new();
    out.push_str(&format!("<row r=\"1\" spans=\"{spans}\">"));
    for (col, h) in headers.iter().enumerate() {
        cell_xml(&mut out, col, 1, Cell::Text(h), style(col, 1));
    }
    out.push_str("</row>");
    for (i, category) in data.categories.iter().enumerate() {
        let row = i + 2;
        out.push_str(&format!("<row r=\"{row}\" spans=\"{spans}\">"));
        let number = data
            .numeric_categories
            .then(|| category.trim().parse::<f64>().ok())
            .flatten();
        let cat = match number {
            Some(v) => Cell::Number(v),
            None => Cell::Text(category),
        };
        cell_xml(&mut out, 0, row, cat, style(0, row));
        for (j, s) in data.series.iter().enumerate() {
            let cell = match s.values.get(i).copied().flatten() {
                Some(v) => Cell::Number(v),
                None => Cell::Empty,
            };
            cell_xml(&mut out, j + 1, row, cell, style(j + 1, row));
        }
        out.push_str("</row>");
    }
    out
}

/// Element children of `node` named `local` (any namespace).
fn kids<'a>(doc: &'a XmlDoc, node: NodeId, local: &'a str) -> impl Iterator<Item = NodeId> + 'a {
    doc.children(node).filter(move |&c| doc.local(c) == local)
}

fn kid(doc: &XmlDoc, node: NodeId, local: &str) -> Option<NodeId> {
    kids(doc, node, local).next()
}

/// Parses an element fragment in the document's main namespace and imports it.
fn import_main(doc: &mut XmlDoc, xml: &str) -> Result<NodeId> {
    let ns = doc.ns_uri(doc.ns(doc.root())).unwrap_or(MAIN_NS).to_owned();
    let wrapped = format!("<w xmlns=\"{ns}\">{xml}</w>");
    let frag = XmlDoc::parse(wrapped.as_bytes(), "worksheet fragment")?;
    let first = frag
        .first_child(frag.root())
        .ok_or_else(|| Error::InvalidEdit("empty worksheet fragment".into()))?;
    Ok(doc.import(&frag, first))
}

/// The relationship id of the sheet named `name` (or of the first sheet).
fn sheet_rid(book: &XmlDoc, name: &str) -> Option<String> {
    let sheets = kid(book, book.root(), "sheets")?;
    let all: Vec<NodeId> = kids(book, sheets, "sheet").collect();
    let pick = all
        .iter()
        .copied()
        .find(|&s| {
            book.attr(s, "name")
                .is_some_and(|n| n.eq_ignore_ascii_case(name))
        })
        .or_else(|| all.first().copied())?;
    book.attr_ns(pick, Ns::R, "id").map(str::to_owned)
}

/// Rewrites a worksheet's `sheetData` and `dimension`; returns whether the
/// old data had formulas.
fn rewrite_sheet(doc: &mut XmlDoc, data: &SheetData<'_>, headers: &[String]) -> Result<bool> {
    let root = doc.root();
    let old = kid(doc, root, "sheetData")
        .ok_or_else(|| Error::InvalidEdit("the worksheet has no sheetData".into()))?;
    let mut styles = Styles::new();
    let mut formulas = false;
    for row in kids(doc, old, "row") {
        for c in kids(doc, row, "c") {
            formulas |= kid(doc, c, "f").is_some();
            if let (Some(pos), Some(s)) = (doc.attr(c, "r").and_then(parse_ref), doc.attr(c, "s")) {
                styles.insert(pos, s.to_owned());
            }
        }
    }
    let new = import_main(
        doc,
        &format!(
            "<sheetData>{}</sheetData>",
            rows_xml(data, headers, &styles)
        ),
    )?;
    doc.insert_before(old, new);
    doc.detach(old);
    if let Some(dim) = kid(doc, root, "dimension") {
        doc.set_attr(dim, "ref", &data.range());
    }
    Ok(formulas)
}

/// Points a table over the data at the new range and headers.
fn rewrite_table(doc: &mut XmlDoc, data: &SheetData<'_>, headers: &[String]) -> Result<()> {
    let root = doc.root();
    let range = data.range();
    doc.set_attr(root, "ref", &range);
    if let Some(filter) = kid(doc, root, "autoFilter") {
        doc.set_attr(filter, "ref", &range);
    }
    let columns: String = headers
        .iter()
        .enumerate()
        .map(|(i, h)| format!("<tableColumn id=\"{}\" name=\"{}\"/>", i + 1, xml_text(h)))
        .collect();
    let new = import_main(
        doc,
        &format!(
            "<tableColumns count=\"{}\">{columns}</tableColumns>",
            headers.len()
        ),
    )?;
    match kid(doc, root, "tableColumns") {
        Some(old) => {
            doc.insert_before(old, new);
            doc.detach(old);
        }
        None => return Err(Error::InvalidEdit("the table has no columns".into())),
    }
    Ok(())
}

/// Removes the calculation chain, which lists formula cells the rewrite removed
/// (Excel rebuilds it).
fn drop_calc_chain(pkg: &mut Package, book: &str) -> Result<()> {
    let mut rels = pkg.rels(book)?;
    let chains: Vec<(String, String)> = rels
        .iter()
        .filter(|r| r.rel_type.ends_with("/calcChain"))
        .map(|r| (r.id.clone(), rels.resolve(r)))
        .collect();
    if chains.is_empty() {
        return Ok(());
    }
    for (id, target) in chains {
        rels.remove(&id);
        pkg.delete(&target);
    }
    pkg.write_rels(&rels);
    Ok(())
}

/// Rewrites the data sheet (named `sheet`, else the first) of an embedded
/// workbook; every other part keeps its bytes.
pub(crate) fn update(bytes: &[u8], sheet: &str, data: &SheetData<'_>) -> Result<Vec<u8>> {
    let mut pkg = Package::open(bytes.to_vec())?;
    let book = pkg.main_part()?;
    let book_doc = XmlDoc::parse(&pkg.read(&book)?, &book)?;
    let rid = sheet_rid(&book_doc, sheet)
        .ok_or_else(|| Error::MissingPart("worksheet of the chart's workbook".into()))?;
    let sheet_part = pkg
        .rels(&book)?
        .target_part(&rid)
        .filter(|p| pkg.has_part(p))
        .ok_or_else(|| Error::MissingPart(format!("worksheet {rid}")))?;
    let table = pkg
        .rels(&sheet_part)?
        .iter()
        .find(|r| r.rel_type.ends_with("/table"))
        .map(|r| crate::opc::resolve_target(&sheet_part, &r.target))
        .filter(|t| pkg.has_part(t));
    let headers = if table.is_some() {
        data.table_headers()
    } else {
        data.plain_headers()
    };
    let mut doc = XmlDoc::parse(&pkg.read(&sheet_part)?, &sheet_part)?;
    let formulas = rewrite_sheet(&mut doc, data, &headers)?;
    pkg.write(&sheet_part, doc.to_bytes(), None);
    if let Some(table) = table {
        let mut tdoc = XmlDoc::parse(&pkg.read(&table)?, &table)?;
        rewrite_table(&mut tdoc, data, &headers)?;
        pkg.write(&table, tdoc.to_bytes(), None);
    }
    if formulas {
        drop_calc_chain(&mut pkg, &book)?;
    }
    pkg.save()
}

/// A minimal workbook holding a chart's data on `Sheet1`.
pub(crate) fn create(data: &SheetData<'_>) -> Result<Vec<u8>> {
    const DECL: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n";
    const PKG_RELS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
    let content_types = format!(
        "{DECL}<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/><Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/></Types>"
    );
    let root_rels = format!(
        "{DECL}<Relationships xmlns=\"{PKG_RELS}\"><Relationship Id=\"rId1\" Type=\"{REL_NS}/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>"
    );
    let workbook = format!(
        "{DECL}<workbook xmlns=\"{MAIN_NS}\" xmlns:r=\"{REL_NS}\"><sheets><sheet name=\"Sheet1\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>"
    );
    let workbook_rels = format!(
        "{DECL}<Relationships xmlns=\"{PKG_RELS}\"><Relationship Id=\"rId1\" Type=\"{REL_NS}/worksheet\" Target=\"worksheets/sheet1.xml\"/><Relationship Id=\"rId2\" Type=\"{REL_NS}/styles\" Target=\"styles.xml\"/></Relationships>"
    );
    let sheet = format!(
        "{DECL}<worksheet xmlns=\"{MAIN_NS}\" xmlns:r=\"{REL_NS}\"><dimension ref=\"{}\"/><sheetData>{}</sheetData></worksheet>",
        data.range(),
        rows_xml(data, &data.plain_headers(), &Styles::new())
    );
    let styles = format!(
        "{DECL}<styleSheet xmlns=\"{MAIN_NS}\"><fonts count=\"1\"><font><sz val=\"11\"/><name val=\"Calibri\"/><family val=\"2\"/><scheme val=\"minor\"/></font></fonts><fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills><borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs><cellXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/></cellXfs><cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles></styleSheet>"
    );
    let mut w = Writer::new();
    for (name, xml) in [
        ("[Content_Types].xml", &content_types),
        ("_rels/.rels", &root_rels),
        ("xl/workbook.xml", &workbook),
        ("xl/_rels/workbook.xml.rels", &workbook_rels),
        ("xl/worksheets/sheet1.xml", &sheet),
        ("xl/styles.xml", &styles),
    ] {
        w.add(
            name,
            WriteData::Fresh {
                data: xml.as_bytes(),
                compress: true,
            },
        )?;
    }
    w.finish()
}

#[cfg(test)]
mod test {
    use super::*;

    fn data<'a>(categories: &'a [String], series: &'a [ChartSeriesData]) -> SheetData<'a> {
        SheetData {
            categories,
            numeric_categories: false,
            series,
        }
    }

    #[test]
    fn cell_references() {
        assert_eq!(parse_ref("A1"), Some((0, 1)));
        assert_eq!(parse_ref("AB12"), Some((27, 12)));
        assert_eq!(parse_ref("12"), None);
        assert_eq!(parse_ref("A"), None);
    }

    #[test]
    fn table_headers_are_unique_and_named() {
        let cats = vec!["Q1".to_owned()];
        let series = vec![
            ChartSeriesData {
                name: "Sales".into(),
                values: vec![Some(1.0)],
            },
            ChartSeriesData {
                name: "sales".into(),
                values: vec![None],
            },
            ChartSeriesData {
                name: String::new(),
                values: vec![],
            },
        ];
        let d = data(&cats, &series);
        assert_eq!(
            d.table_headers(),
            ["Category", "Sales", "sales2", "Series3"]
        );
        assert_eq!(d.plain_headers(), ["", "Sales", "sales", ""]);
        assert_eq!(d.range(), "A1:D2");
    }

    #[test]
    fn created_workbooks_hold_the_data() {
        let cats = vec!["North".to_owned(), "South & East".to_owned()];
        let series = vec![ChartSeriesData {
            name: "Units".into(),
            values: vec![Some(3.5), None],
        }];
        let bytes = create(&data(&cats, &series)).unwrap();
        let pkg = Package::open(bytes).unwrap();
        assert_eq!(pkg.main_part().unwrap(), "/xl/workbook.xml");
        let sheet =
            String::from_utf8(pkg.read("/xl/worksheets/sheet1.xml").unwrap().into_owned()).unwrap();
        assert!(sheet.contains("<dimension ref=\"A1:B3\"/>"), "{sheet}");
        assert!(
            sheet.contains("<c r=\"B1\" t=\"inlineStr\"><is><t>Units</t></is></c>"),
            "{sheet}"
        );
        assert!(
            sheet.contains("<c r=\"A3\" t=\"inlineStr\"><is><t>South &amp; East</t></is></c>"),
            "{sheet}"
        );
        assert!(sheet.contains("<c r=\"B2\"><v>3.5</v></c>"), "{sheet}");
        assert!(!sheet.contains("r=\"B3\""), "blanks have no cell: {sheet}");

        // Updating keeps every other part and replaces the rows.
        let more = vec!["Q1".to_owned()];
        let updated = update(
            &create(&data(&cats, &series)).unwrap(),
            "Sheet1",
            &data(&more, &series),
        )
        .unwrap();
        let pkg2 = Package::open(updated).unwrap();
        assert_eq!(
            pkg2.read("/xl/styles.xml").unwrap(),
            pkg.read("/xl/styles.xml").unwrap()
        );
        let sheet = String::from_utf8(pkg2.read("/xl/worksheets/sheet1.xml").unwrap().into_owned())
            .unwrap();
        assert!(sheet.contains("<dimension ref=\"A1:B2\"/>"), "{sheet}");
        assert!(
            sheet.contains("<t>Q1</t>") && !sheet.contains("North"),
            "{sheet}"
        );
    }
}
