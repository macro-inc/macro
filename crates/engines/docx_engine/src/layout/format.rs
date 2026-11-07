//! Resolved formatting of paragraphs and runs, with caches.

use crate::hash::FxMap;
use crate::model::content::{Attrs, key};
use crate::model::numbering::{Label, Numbering};
use crate::model::props::{PPr, ParaProps, RPr, RunProps, TblPr, TcPr, ThemeInfo, TrPr};
use crate::model::section::Section;
use crate::model::settings::Settings;
use crate::model::styles::Styles;
use crate::xml::{Decl, SnippetContext};
use std::sync::Arc;
use std::sync::Mutex;

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
    cache: Arc<FormatCache>,
}

/// Run properties parsed from attribute snippets, by (element name, XML).
type SnippetRuns = FxMap<(Box<str>, Box<str>), RPr>;

/// Resolved runs by the address of their attribute set and of their
/// paragraph format, with the attribute set they were resolved for.
type RunsById = FxMap<(usize, usize), (Attrs, Arc<RunProps>)>;

/// Resolved formats, kept between layouts of the same style sheet.
#[derive(Debug, Default)]
pub struct FormatCache {
    paras: Mutex<FxMap<(String, TableCtx), Arc<ParaFormat>>>,
    runs: Mutex<FxMap<(Attrs, usize), Arc<RunProps>>>,
    run_snippets: Mutex<SnippetRuns>,
    /// Resolved runs by the identity of their attribute set (which the
    /// entry holds, so the address stays its own) and paragraph format.
    run_ids: Mutex<RunsById>,
    parsed: Mutex<Parsed>,
}

/// Property elements parsed from their XML, by kind (`tblPr`, `tcPr`...).
#[derive(Default)]
struct Parsed(FxMap<&'static str, FxMap<Box<str>, Arc<dyn std::any::Any + Send + Sync>>>);

impl std::fmt::Debug for Parsed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_map()
            .entries(self.0.iter().map(|(k, v)| (k, v.len())))
            .finish()
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
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
            cache: Arc::new(FormatCache::default()),
        }
    }

    /// A resolver that keeps its results in `cache` (which must belong to
    /// the same style sheet).
    pub fn with_cache(mut self, cache: Arc<FormatCache>) -> Self {
        self.cache = cache;
        self
    }

    /// The snippet context of the main part.
    pub fn snippets(&self) -> &SnippetContext {
        &self.snippets
    }

    /// A property element read from its XML once per style sheet: tables
    /// repeat the same row and cell properties, and every layout reads them.
    pub fn parsed<T: Clone + Send + Sync + 'static>(
        &self,
        kind: &'static str,
        xml: &str,
        read: impl FnOnce() -> T,
    ) -> T {
        if let Some(v) = lock(&self.cache.parsed)
            .0
            .get(kind)
            .and_then(|m| m.get(xml))
            .and_then(|v| v.downcast_ref::<T>())
        {
            return v.clone();
        }
        let value = read();
        lock(&self.cache.parsed)
            .0
            .entry(kind)
            .or_default()
            .insert(xml.into(), Arc::new(value.clone()));
        value
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
        if let Some(f) = lock(&self.cache.paras).get(&cache_key) {
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
        if direct.num.num_id == Some(0) && style_num.num_id.is_some_and(|id| id > 0) {
            // Turning a list style's numbering off also drops the indents
            // that go with it.
            props.ind_left = self.styles.doc_ppr.ind_left;
            props.ind_first = self.styles.doc_ppr.ind_first;
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
        lock(&self.cache.paras).insert(cache_key, Arc::clone(&format));
        format
    }

    fn snippet_rpr(&self, qname: &str, xml: &str) -> RPr {
        let cache_key: (Box<str>, Box<str>) = (qname.into(), xml.into());
        if let Some(r) = lock(&self.cache.run_snippets).get(&cache_key) {
            return r.clone();
        }
        let mut r = RPr::default();
        if let Ok(t) = self.snippets.parse(xml) {
            r.read_child(&t, t.root(), self.theme);
        }
        lock(&self.cache.run_snippets).insert(cache_key, r.clone());
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
        // Spans share attribute sets, and a laid-out paragraph keeps its
        // format: most runs are found by identity without hashing.
        let id_key = (attrs.ptr(), Arc::as_ptr(para) as usize);
        if let Some((held, r)) = lock(&self.cache.run_ids).get(&id_key)
            && held.same(attrs)
        {
            return Arc::clone(r);
        }
        let resolved = self.run_by_value(attrs, para);
        let mut ids = lock(&self.cache.run_ids);
        if ids.len() > 200_000 {
            ids.clear();
        }
        ids.insert(id_key, (attrs.clone(), Arc::clone(&resolved)));
        resolved
    }

    fn run_by_value(&self, attrs: &Attrs, para: &Arc<ParaFormat>) -> Arc<RunProps> {
        // Spans differ only in their run-property keys for formatting purposes.
        let fmt_attrs = attrs.without(|k| !k.starts_with(key::RUN_PROP));
        let cache_key = (fmt_attrs, Arc::as_ptr(para) as usize);
        if let Some(r) = lock(&self.cache.runs).get(&cache_key) {
            return Arc::clone(r);
        }
        let direct = self.direct_rpr(attrs);
        let mut r = para.base_rpr.clone();
        if let Some(cs) = direct.style.as_deref()
            && let Some(c) = self.styles.character_style(Some(cs))
        {
            if c.name.eq_ignore_ascii_case("hyperlink") && self.is_toc_entry(para) {
                // Word shows table of contents links in the entry's own
                // formatting, without the link color or underline.
                let mut link = c.rpr.clone();
                link.color = None;
                link.underline = None;
                r.apply(&link, true);
            } else {
                r.apply(&c.rpr, true);
            }
        }
        r.apply(&direct, false);
        let resolved = Arc::new(r.resolve());
        lock(&self.cache.runs).insert(cache_key, Arc::clone(&resolved));
        resolved
    }

    /// Whether a paragraph is a table of contents entry (a built-in `toc N`
    /// style, whatever the document's language calls it).
    fn is_toc_entry(&self, para: &ParaFormat) -> bool {
        self.styles
            .paragraph_style(para.props.style.as_deref())
            .is_some_and(|s| {
                let name = s.name.to_ascii_lowercase();
                name.strip_prefix("toc ")
                    .is_some_and(|n| n.trim().parse::<u8>().is_ok())
            })
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
