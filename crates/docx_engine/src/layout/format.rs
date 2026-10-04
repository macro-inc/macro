//! Resolved formatting of paragraphs and runs, with caches.

use crate::model::content::{Attrs, key};
use crate::model::numbering::{Label, Numbering};
use crate::model::props::{PPr, ParaProps, RPr, RunProps, TblPr, TcPr, ThemeInfo, TrPr};
use crate::model::section::Section;
use crate::model::settings::Settings;
use crate::model::styles::Styles;
use crate::xml::{Decl, SnippetContext};
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

/// The table context of a paragraph: which table style and conditional
/// formats apply to the cell it is in.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct TableCtx {
    /// Table style id.
    pub style: Option<String>,
    /// Applicable conditions, in precedence order.
    pub conds: Vec<&'static str>,
}

/// A paragraph's resolved formatting.
#[derive(Clone, Debug)]
pub struct ParaFormat {
    /// Paragraph properties.
    pub props: ParaProps,
    /// Run properties every run starts from (defaults, table and paragraph
    /// styles), before character styles and direct formatting.
    pub base_rpr: RPr,
    /// The paragraph mark's resolved run properties.
    pub mark: Arc<RunProps>,
    /// Section properties when the paragraph ends a section.
    pub section: Option<Section>,
}

/// Table formatting from the table style for one cell.
#[derive(Clone, Debug, Default)]
pub struct CellStyle {
    /// Table properties.
    pub tbl: TblPr,
    /// Row properties.
    pub tr: TrPr,
    /// Cell properties.
    pub tc: TcPr,
}

/// Resolves formatting against a document's style sheet.
pub struct Formats<'d> {
    /// Styles.
    pub styles: &'d Styles,
    /// Numbering.
    pub numbering: &'d Numbering,
    /// Settings.
    pub settings: &'d Settings,
    /// Theme.
    pub theme: &'d ThemeInfo,
    snippets: SnippetContext,
    paras: RefCell<HashMap<(String, TableCtx), Arc<ParaFormat>>>,
    runs: RefCell<HashMap<(Attrs, usize), Arc<RunProps>>>,
    run_snippets: RefCell<HashMap<(Box<str>, Box<str>), RPr>>,
}

impl<'d> Formats<'d> {
    /// A resolver for a document's parts.
    pub fn new(
        styles: &'d Styles,
        numbering: &'d Numbering,
        settings: &'d Settings,
        theme: &'d ThemeInfo,
        decls: &[Decl],
    ) -> Self {
        Self {
            styles,
            numbering,
            settings,
            theme,
            snippets: SnippetContext::new(decls),
            paras: RefCell::new(HashMap::new()),
            runs: RefCell::new(HashMap::new()),
            run_snippets: RefCell::new(HashMap::new()),
        }
    }

    /// The snippet context of the main part.
    pub fn snippets(&self) -> &SnippetContext {
        &self.snippets
    }

    /// Reads direct paragraph properties from a `w:pPr` snippet.
    pub fn read_ppr(&self, xml: &str) -> PPr {
        if xml.is_empty() {
            return PPr::default();
        }
        self.snippets
            .parse(xml)
            .map(|t| PPr::read(&t, t.root(), self.theme))
            .unwrap_or_default()
    }

    fn table_rpr(&self, table: &TableCtx, into: &mut RPr) {
        if let Some(ts) = self.styles.table_style(table.style.as_deref()) {
            into.apply(&ts.rpr, true);
            for c in &table.conds {
                if let Some((_, f)) = ts.cond.iter().find(|(t, _)| t == c) {
                    into.apply(&f.rpr, true);
                }
            }
        }
    }

    fn table_ppr(&self, table: &TableCtx, into: &mut PPr) {
        if let Some(ts) = self.styles.table_style(table.style.as_deref()) {
            into.apply(&ts.ppr);
            for c in &table.conds {
                if let Some((_, f)) = ts.cond.iter().find(|(t, _)| t == c) {
                    into.apply(&f.ppr);
                }
            }
        }
    }

    /// Table-style formatting for a cell.
    pub fn cell_style(&self, table: &TableCtx) -> CellStyle {
        let mut out = CellStyle::default();
        if let Some(ts) = self.styles.table_style(table.style.as_deref()) {
            out.tbl.apply(&ts.tbl);
            out.tr.apply(&ts.tr);
            out.tc.apply(&ts.tc);
            for c in &table.conds {
                if let Some((_, f)) = ts.cond.iter().find(|(t, _)| t == c) {
                    out.tbl.apply(&f.tbl);
                    out.tr.apply(&f.tr);
                    out.tc.apply(&f.tc);
                }
            }
        }
        out
    }

    /// A paragraph's formatting from its `w:pPr` snippet.
    pub fn paragraph(&self, ppr_xml: &str, table: &TableCtx) -> Arc<ParaFormat> {
        let cache_key = (ppr_xml.to_owned(), table.clone());
        if let Some(f) = self.paras.borrow().get(&cache_key) {
            return Arc::clone(f);
        }
        let (direct, section) = if ppr_xml.is_empty() {
            (PPr::default(), None)
        } else {
            match self.snippets.parse(ppr_xml) {
                Ok(t) => {
                    let p = PPr::read(&t, t.root(), self.theme);
                    let section = t
                        .w_child(t.root(), "sectPr")
                        .map(|s| Section::read(&t, s, self.theme));
                    (p, section)
                }
                Err(_) => (PPr::default(), None),
            }
        };
        let style = self.styles.paragraph_style(direct.style.as_deref());
        let mut props = self.styles.doc_ppr.clone();
        self.table_ppr(table, &mut props);
        let style_num = style.map(|s| s.ppr.num).unwrap_or_default();
        let num_id = direct.num.num_id.or(style_num.num_id);
        let ilvl = direct.num.ilvl.or(style_num.ilvl).unwrap_or(0);
        let level_ppr = num_id
            .filter(|id| *id > 0)
            .and_then(|id| self.numbering.level_ppr(id, ilvl, self.styles));
        let numbering_from_style = direct.num.num_id.is_none() && style_num.num_id.is_some();
        match (&level_ppr, style) {
            (Some(lp), Some(s)) if numbering_from_style => {
                props.apply(lp);
                props.apply(&s.ppr);
            }
            (Some(lp), Some(s)) => {
                props.apply(&s.ppr);
                props.apply(lp);
            }
            (Some(lp), None) => props.apply(lp),
            (None, Some(s)) => props.apply(&s.ppr),
            (None, None) => {}
        }
        props.apply(&direct);
        props.style = style.map(|s| s.id.clone()).or(direct.style.clone());
        // Run base: defaults, table style, paragraph style (toggling).
        let mut base_rpr = self.styles.doc_rpr.clone();
        self.table_rpr(table, &mut base_rpr);
        if let Some(s) = style {
            base_rpr.apply(&s.rpr, true);
        }
        let mut mark = base_rpr.clone();
        if let Some(cs) = direct.mark.style.as_deref()
            && let Some(c) = self.styles.character_style(Some(cs))
        {
            mark.apply(&c.rpr, true);
        }
        mark.apply(&direct.mark, false);
        let format = Arc::new(ParaFormat {
            props: props.resolve(),
            base_rpr,
            mark: Arc::new(mark.resolve()),
            section,
        });
        self.paras
            .borrow_mut()
            .insert(cache_key, Arc::clone(&format));
        format
    }

    fn snippet_rpr(&self, qname: &str, xml: &str) -> RPr {
        let cache_key: (Box<str>, Box<str>) = (qname.into(), xml.into());
        if let Some(r) = self.run_snippets.borrow().get(&cache_key) {
            return r.clone();
        }
        let mut r = RPr::default();
        if let Ok(t) = self.snippets.parse(xml) {
            r.read_child(&t, t.root(), self.theme);
        }
        self.run_snippets.borrow_mut().insert(cache_key, r.clone());
        r
    }

    /// Direct run properties carried by span attributes.
    pub fn direct_rpr(&self, attrs: &Attrs) -> RPr {
        let mut r = RPr::default();
        for (qname, xml) in attrs.run_props() {
            let part = self.snippet_rpr(qname, xml);
            r.apply(&part, false);
        }
        r
    }

    /// A run's resolved properties within a paragraph.
    pub fn run(&self, attrs: &Attrs, para: &Arc<ParaFormat>) -> Arc<RunProps> {
        // Spans differ only in their run-property keys for formatting purposes.
        let fmt_attrs = attrs.without(|k| !k.starts_with(key::RUN_PROP));
        let cache_key = (fmt_attrs, Arc::as_ptr(para) as usize);
        if let Some(r) = self.runs.borrow().get(&cache_key) {
            return Arc::clone(r);
        }
        let direct = self.direct_rpr(attrs);
        let mut r = para.base_rpr.clone();
        if let Some(cs) = direct.style.as_deref()
            && let Some(c) = self.styles.character_style(Some(cs))
        {
            r.apply(&c.rpr, true);
        }
        r.apply(&direct, false);
        let resolved = Arc::new(r.resolve());
        self.runs
            .borrow_mut()
            .insert(cache_key, Arc::clone(&resolved));
        resolved
    }

    /// Label run properties: the paragraph mark's, with the level's on top.
    pub fn label_props(&self, para: &ParaFormat, label: &Label) -> RunProps {
        let mut r = para.base_rpr.clone();
        // The paragraph mark's direct formatting carries over to the number.
        let mark = &para.props.mark;
        r.apply(mark, false);
        r.apply(&label.rpr, false);
        let mut props = r.resolve();
        // Numbers are never underlined or struck through by the paragraph's text formatting.
        if label.rpr.underline.is_none() {
            props.underline = None;
        }
        props
    }
}
