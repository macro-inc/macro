//! Office Math Markup (OMML) in DrawingML text: finding equations in
//! paragraphs, reading them into an [`Equation`], and writing one back.
//!
//! PowerPoint keeps an equation in a paragraph as `a14:m` (DrawingML 2010)
//! holding an `m:oMathPara` (display) or `m:oMath` (inline). Files usually
//! wrap it in `mc:AlternateContent`: either the whole shape (the fallback is
//! a picture of the text) or, as the engine writes, just the equation (the
//! fallback a text run with its linear form). Math runs carry DrawingML run
//! properties (`a:rPr`) where Word has `w:rPr`.

use super::symbols::{default_style, plain_char};
use super::tree::{Alphabet, Borders, Equation, FracKind, Justify, LimLoc, List, Node, Run, Style};
use crate::model::text::RunProps;
use crate::xml::{NodeId, Ns, XmlDoc};

/// The OMML namespace.
pub const M_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/math";
/// The OMML namespace of ISO 29500 strict documents.
const M_NS_STRICT: &str = "http://purl.oclc.org/ooxml/officeDocument/math";
/// The markup compatibility namespace.
pub const MC_NS: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
/// The DrawingML 2010 namespace (`a14:`).
pub const A14_NS: &str = "http://schemas.microsoft.com/office/drawing/2010/main";
/// The DrawingML namespace.
pub const A_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";

/// Resolves a math run's or structure's `a:rPr` to its formatting.
pub type PropsResolver<'a> = &'a dyn Fn(NodeId) -> Option<Box<RunProps>>;

/// The `a14:m` element of a paragraph child that holds an equation: the
/// child itself, or the one in an `mc:AlternateContent` choice.
pub fn equation_element(doc: &XmlDoc, item: NodeId) -> Option<NodeId> {
    if doc.is(item, Ns::A14, "m") {
        return Some(item);
    }
    if doc.is(item, Ns::MC, "AlternateContent") {
        let choice = doc.children(item).find(|&c| doc.is(c, Ns::MC, "Choice"))?;
        return doc.children(choice).find(|&c| doc.is(c, Ns::A14, "m"));
    }
    None
}

/// Whether a paragraph child is an equation.
pub fn is_equation_item(doc: &XmlDoc, item: NodeId) -> bool {
    equation_element(doc, item).is_some()
}

fn is_math_ns(doc: &XmlDoc, ns: Ns) -> bool {
    matches!(doc.ns_uri(ns), Some(M_NS | M_NS_STRICT))
}

/// Whether `n` is the OMML element `local`.
fn is_m(doc: &XmlDoc, n: NodeId, local: &str) -> bool {
    doc.local(n) == local && is_math_ns(doc, doc.ns(n))
}

fn m_child(doc: &XmlDoc, n: NodeId, local: &str) -> Option<NodeId> {
    doc.children(n).find(|&c| is_m(doc, c, local))
}

/// The `m:val` of an element (prefixed or not).
fn val(doc: &XmlDoc, n: NodeId) -> Option<&str> {
    doc.attrs(n).find(|a| a.local() == "val").map(|a| a.value())
}

/// An on/off property of a `...Pr` element: absent is `default`, present
/// without a value is on.
fn flag(doc: &XmlDoc, pr: Option<NodeId>, name: &str, default: bool) -> bool {
    let Some(el) = pr.and_then(|p| m_child(doc, p, name)) else {
        return default;
    };
    match val(doc, el) {
        Some(v) => crate::xml::parse_bool(v).unwrap_or(true),
        None => true,
    }
}

/// A character property (`m:chr`, `m:begChr`...): absent is `default`, an
/// empty value is no character.
fn chr(doc: &XmlDoc, pr: Option<NodeId>, name: &str, default: Option<char>) -> Option<char> {
    match pr.and_then(|p| m_child(doc, p, name)) {
        Some(el) => val(doc, el).and_then(|v| v.chars().next()),
        None => default,
    }
}

fn str_prop<'a>(doc: &'a XmlDoc, pr: Option<NodeId>, name: &str) -> Option<&'a str> {
    pr.and_then(|p| m_child(doc, p, name))
        .and_then(|el| val(doc, el))
}

/// Reads the equation of an `a14:m` element (or of an `m:oMathPara` /
/// `m:oMath` directly).
pub fn read_equation(doc: &XmlDoc, m: NodeId, resolve: PropsResolver<'_>) -> Equation {
    let reader = Reader { doc, resolve };
    let content = if is_m(doc, m, "oMathPara") || is_m(doc, m, "oMath") {
        Some(m)
    } else {
        doc.children(m)
            .find(|&c| is_m(doc, c, "oMathPara") || is_m(doc, c, "oMath"))
    };
    let Some(content) = content else {
        return Equation::new(false, Vec::new());
    };
    if is_m(doc, content, "oMath") {
        return Equation::new(false, reader.list(content));
    }
    let justify = match str_prop(doc, m_child(doc, content, "oMathParaPr"), "jc") {
        Some("left") => Justify::Left,
        Some("right") => Justify::Right,
        Some("center") => Justify::Center,
        _ => Justify::CenterGroup,
    };
    let mut lines: Vec<List> = doc
        .children(content)
        .filter(|&c| is_m(doc, c, "oMath"))
        .map(|c| reader.list(c))
        .collect();
    if lines.is_empty() {
        lines.push(Vec::new());
    }
    Equation {
        display: true,
        justify,
        lines,
    }
}

struct Reader<'a> {
    doc: &'a XmlDoc,
    resolve: PropsResolver<'a>,
}

impl Reader<'_> {
    /// Formatting from a structure's `m:ctrlPr`.
    fn ctrl_props(&self, pr: Option<NodeId>) -> Option<Box<RunProps>> {
        let doc = self.doc;
        let ctrl = pr.and_then(|p| m_child(doc, p, "ctrlPr"))?;
        let rpr = doc.children(ctrl).find(|&c| doc.is(c, Ns::A, "rPr"))?;
        (self.resolve)(rpr)
    }

    /// The items of an argument element (`m:e`, `m:num`...), empty when absent.
    fn arg(&self, parent: NodeId, name: &str) -> List {
        m_child(self.doc, parent, name)
            .map(|a| self.list(a))
            .unwrap_or_default()
    }

    fn list(&self, parent: NodeId) -> List {
        let mut out = Vec::new();
        for c in self.doc.children(parent) {
            if !is_math_ns(self.doc, self.doc.ns(c)) {
                continue;
            }
            self.node(c, &mut out);
        }
        out
    }

    fn node(&self, n: NodeId, out: &mut List) {
        let doc = self.doc;
        let pr = |name: &str| m_child(doc, n, name);
        let item = match doc.local(n) {
            "r" => {
                self.run(n, out);
                return;
            }
            "f" => {
                let p = pr("fPr");
                Node::Frac {
                    kind: match str_prop(doc, p, "type") {
                        Some("skw") => FracKind::Skewed,
                        Some("lin") => FracKind::Linear,
                        Some("noBar") => FracKind::NoBar,
                        _ => FracKind::Bar,
                    },
                    num: self.arg(n, "num"),
                    den: self.arg(n, "den"),
                    props: self.ctrl_props(p),
                }
            }
            "sSub" => Node::Scripts {
                base: self.arg(n, "e"),
                sub: Some(self.arg(n, "sub")),
                sup: None,
            },
            "sSup" => Node::Scripts {
                base: self.arg(n, "e"),
                sub: None,
                sup: Some(self.arg(n, "sup")),
            },
            "sSubSup" => Node::Scripts {
                base: self.arg(n, "e"),
                sub: Some(self.arg(n, "sub")),
                sup: Some(self.arg(n, "sup")),
            },
            "sPre" => Node::PreScripts {
                base: self.arg(n, "e"),
                sub: self.arg(n, "sub"),
                sup: self.arg(n, "sup"),
            },
            "rad" => {
                let p = pr("radPr");
                Node::Radical {
                    degree: (!flag(doc, p, "degHide", false)).then(|| self.arg(n, "deg")),
                    body: self.arg(n, "e"),
                    props: self.ctrl_props(p),
                }
            }
            "nary" => {
                let p = pr("naryPr");
                let op = chr(doc, p, "chr", Some('∫')).unwrap_or('∫');
                // PowerPoint always writes the placement; the operator's own
                // default reads as `Auto`.
                let integral = super::symbols::is_integral(op);
                Node::Nary {
                    op,
                    limits: match str_prop(doc, p, "limLoc") {
                        Some("undOvr") if integral => LimLoc::UnderOver,
                        Some("subSup") if !integral => LimLoc::SubSup,
                        _ => LimLoc::Auto,
                    },
                    grow: flag(doc, p, "grow", false),
                    sub: (!flag(doc, p, "subHide", false)).then(|| self.arg(n, "sub")),
                    sup: (!flag(doc, p, "supHide", false)).then(|| self.arg(n, "sup")),
                    body: self.arg(n, "e"),
                    props: self.ctrl_props(p),
                }
            }
            "d" => {
                let p = pr("dPr");
                Node::Delim {
                    open: chr(doc, p, "begChr", Some('(')),
                    close: chr(doc, p, "endChr", Some(')')),
                    sep: chr(doc, p, "sepChr", Some('|')).unwrap_or('|'),
                    grow: flag(doc, p, "grow", true),
                    items: doc
                        .children(n)
                        .filter(|&c| is_m(doc, c, "e"))
                        .map(|c| self.list(c))
                        .collect(),
                    props: self.ctrl_props(p),
                }
            }
            "func" => Node::Func {
                name: self.arg(n, "fName"),
                body: self.arg(n, "e"),
            },
            "limLow" | "limUpp" => Node::Limit {
                upper: doc.local(n) == "limUpp",
                base: self.arg(n, "e"),
                limit: self.arg(n, "lim"),
            },
            "acc" => {
                let p = pr("accPr");
                Node::Accent {
                    chr: chr(doc, p, "chr", Some('\u{302}')).unwrap_or('\u{302}'),
                    base: self.arg(n, "e"),
                    props: self.ctrl_props(p),
                }
            }
            "bar" => {
                let p = pr("barPr");
                Node::Bar {
                    top: str_prop(doc, p, "pos") == Some("top"),
                    base: self.arg(n, "e"),
                    props: self.ctrl_props(p),
                }
            }
            "groupChr" => {
                let p = pr("groupChrPr");
                Node::GroupChr {
                    chr: chr(doc, p, "chr", Some('⏟')).unwrap_or('⏟'),
                    top: str_prop(doc, p, "pos") == Some("top"),
                    base: self.arg(n, "e"),
                    props: self.ctrl_props(p),
                }
            }
            "borderBox" => {
                let p = pr("borderBoxPr");
                let f = |name| flag(doc, p, name, false);
                Node::BorderBox {
                    borders: Borders {
                        hide_top: f("hideTop"),
                        hide_bottom: f("hideBot"),
                        hide_left: f("hideLeft"),
                        hide_right: f("hideRight"),
                        strike_h: f("strikeH"),
                        strike_v: f("strikeV"),
                        strike_bltr: f("strikeBLTR"),
                        strike_tlbr: f("strikeTLBR"),
                    },
                    base: self.arg(n, "e"),
                    props: self.ctrl_props(p),
                }
            }
            "box" => Node::Group(self.arg(n, "e")),
            "eqArr" => Node::EqArray(
                doc.children(n)
                    .filter(|&c| is_m(doc, c, "e"))
                    .map(|c| self.list(c))
                    .collect(),
            ),
            "m" => Node::Matrix(
                doc.children(n)
                    .filter(|&c| is_m(doc, c, "mr"))
                    .map(|row| {
                        doc.children(row)
                            .filter(|&c| is_m(doc, c, "e"))
                            .map(|c| self.list(c))
                            .collect()
                    })
                    .collect(),
            ),
            "phant" => {
                let p = pr("phantPr");
                Node::Phantom {
                    show: flag(doc, p, "show", true),
                    zero_width: flag(doc, p, "zeroWid", false),
                    zero_ascent: flag(doc, p, "zeroAsc", false),
                    zero_descent: flag(doc, p, "zeroDesc", false),
                    base: self.arg(n, "e"),
                }
            }
            // Arguments met out of place, and wrappers such as `m:oMath`.
            "e" | "oMath" | "num" | "den" | "sub" | "sup" | "deg" | "lim" | "fName" => {
                out.extend(self.list(n));
                return;
            }
            _ => return,
        };
        out.push(item);
    }

    fn run(&self, r: NodeId, out: &mut List) {
        let doc = self.doc;
        let mpr = m_child(doc, r, "rPr");
        let normal = flag(doc, mpr, "nor", false);
        let explicit_style = match str_prop(doc, mpr, "sty") {
            Some("p") => Some(Style::Plain),
            Some("b") => Some(Style::Bold),
            Some("i") => Some(Style::Italic),
            Some("bi") => Some(Style::BoldItalic),
            _ => None,
        };
        let explicit_alphabet = match str_prop(doc, mpr, "scr") {
            Some("script") => Some(Alphabet::Script),
            Some("fraktur") => Some(Alphabet::Fraktur),
            Some("double-struck") => Some(Alphabet::DoubleStruck),
            Some("sans-serif") => Some(Alphabet::SansSerif),
            Some("monospace") => Some(Alphabet::Monospace),
            _ => None,
        };
        let props = doc
            .children(r)
            .find(|&c| doc.is(c, Ns::A, "rPr"))
            .and_then(|n| (self.resolve)(n));
        let text: String = doc
            .children(r)
            .filter(|&c| is_m(doc, c, "t"))
            .map(|t| doc.text(t))
            .collect();
        if normal {
            out.push(Node::Run(Run {
                text,
                style: explicit_style,
                alphabet: explicit_alphabet,
                normal: true,
                props,
            }));
            return;
        }
        // Split the text where math alphanumerics change the style.
        let start = out.len();
        for c in text.chars() {
            let (base, style, alphabet) = plain_char(c);
            let alphabet = alphabet.or(explicit_alphabet);
            let alphabet = alphabet.filter(|a| *a != Alphabet::Roman);
            let style = match (style, explicit_style) {
                (Some(s), _) => Some(s),
                (None, s) => s,
            };
            // Script and fraktur letters have one weight here; their style is noise.
            let style = if matches!(
                alphabet,
                Some(Alphabet::Script | Alphabet::Fraktur | Alphabet::DoubleStruck)
            ) {
                None
            } else {
                style.filter(|s| *s != default_style(base))
            };
            let extend = match out[start..].last_mut() {
                Some(Node::Run(last)) if last.style == style && last.alphabet == alphabet => {
                    last.text.push(base);
                    true
                }
                _ => false,
            };
            if !extend {
                out.push(Node::Run(Run {
                    text: base.to_string(),
                    style,
                    alphabet,
                    normal: false,
                    props: props.clone(),
                }));
            }
        }
    }
}

/// DrawingML run properties to write on math runs and structures: the
/// attributes (`sz="2400"`) and fill markup taken from the text around the
/// equation.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RunTemplate {
    /// Attributes to add to `a:rPr` (each with a leading space).
    pub attrs: String,
    /// Fill markup (`<a:solidFill>…</a:solidFill>`), placed before `a:latin`.
    pub fill: String,
}

/// The math font PowerPoint names in equations.
const MATH_LATIN: &str = r#"<a:latin typeface="Cambria Math" panose="02040503050406030204" pitchFamily="18" charset="0"/>"#;

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// An `on`/`off` OMML value.
fn onoff(v: bool) -> &'static str {
    if v { "1" } else { "0" }
}

/// Writes an equation as the content of `a14:m`: an `m:oMathPara` or
/// `m:oMath` declaring the OMML namespace.
pub fn math_xml(eq: &Equation, tpl: &RunTemplate) -> String {
    let w = Writer { tpl };
    let mut out = String::new();
    if eq.display {
        let jc = match eq.justify {
            Justify::CenterGroup => "centerGroup",
            Justify::Center => "center",
            Justify::Left => "left",
            Justify::Right => "right",
        };
        out.push_str(&format!(
            r#"<m:oMathPara xmlns:m="{M_NS}"><m:oMathParaPr><m:jc m:val="{jc}"/></m:oMathParaPr>"#
        ));
        for line in &eq.lines {
            out.push_str("<m:oMath>");
            w.list(line, &mut out);
            out.push_str("</m:oMath>");
        }
        out.push_str("</m:oMathPara>");
    } else {
        out.push_str(&format!(r#"<m:oMath xmlns:m="{M_NS}">"#));
        for line in &eq.lines {
            w.list(line, &mut out);
        }
        out.push_str("</m:oMath>");
    }
    out
}

/// The `a14:m` element of an equation (declaring `a14:` and `a:`).
pub fn a14_xml(eq: &Equation, tpl: &RunTemplate) -> String {
    format!(
        r#"<a14:m xmlns:a14="{A14_NS}" xmlns:a="{A_NS}">{}</a14:m>"#,
        math_xml(eq, tpl)
    )
}

/// An equation as a paragraph child: `mc:AlternateContent` whose choice
/// (for readers of DrawingML 2010) holds the math and whose fallback is a
/// text run of `fallback` (what other readers, such as LibreOffice, show).
pub fn alternate_content_xml(eq: &Equation, tpl: &RunTemplate, fallback: &str) -> String {
    format!(
        r#"<mc:AlternateContent xmlns:mc="{MC_NS}" xmlns:a="{A_NS}"><mc:Choice xmlns:a14="{A14_NS}" Requires="a14"><a14:m>{}</a14:m></mc:Choice><mc:Fallback><a:r><a:rPr lang="en-US"{}>{}</a:rPr><a:t>{}</a:t></a:r></mc:Fallback></mc:AlternateContent>"#,
        math_xml(eq, tpl),
        tpl.attrs,
        tpl.fill,
        esc(fallback)
    )
}

struct Writer<'a> {
    tpl: &'a RunTemplate,
}

impl Writer<'_> {
    fn rpr(&self, italic: bool, bold: bool) -> String {
        format!(
            r#"<a:rPr lang="en-US"{}{}{}>{}{MATH_LATIN}</a:rPr>"#,
            if bold { r#" b="1""# } else { "" },
            if italic { r#" i="1""# } else { r#" i="0""# },
            self.tpl.attrs,
            self.tpl.fill
        )
    }

    fn ctrl(&self) -> String {
        format!("<m:ctrlPr>{}</m:ctrlPr>", self.rpr(true, false))
    }

    fn arg(&self, name: &str, list: &[Node], out: &mut String) {
        if list.is_empty() {
            out.push_str(&format!("<m:{name}/>"));
            return;
        }
        out.push_str(&format!("<m:{name}>"));
        self.list(list, out);
        out.push_str(&format!("</m:{name}>"));
    }

    fn list(&self, list: &[Node], out: &mut String) {
        for node in list {
            self.node(node, out);
        }
    }

    fn pr(&self, name: &str, inner: &str, out: &mut String) {
        out.push_str(&format!("<m:{name}>{inner}{}</m:{name}>", self.ctrl()));
    }

    fn node(&self, node: &Node, out: &mut String) {
        match node {
            Node::Run(r) => self.run(r, out),
            Node::Frac { kind, num, den, .. } => {
                out.push_str("<m:f>");
                let ty = match kind {
                    FracKind::Bar => String::new(),
                    FracKind::Skewed => r#"<m:type m:val="skw"/>"#.to_owned(),
                    FracKind::Linear => r#"<m:type m:val="lin"/>"#.to_owned(),
                    FracKind::NoBar => r#"<m:type m:val="noBar"/>"#.to_owned(),
                };
                self.pr("fPr", &ty, out);
                self.arg("num", num, out);
                self.arg("den", den, out);
                out.push_str("</m:f>");
            }
            Node::Scripts { base, sub, sup } => {
                let name = match (sub, sup) {
                    (Some(_), Some(_)) => "sSubSup",
                    (Some(_), None) => "sSub",
                    (None, _) => "sSup",
                };
                out.push_str(&format!("<m:{name}>"));
                self.pr(&format!("{name}Pr"), "", out);
                self.arg("e", base, out);
                if let Some(s) = sub {
                    self.arg("sub", s, out);
                }
                match (sub, sup) {
                    (_, Some(s)) => self.arg("sup", s, out),
                    (None, None) => self.arg("sup", &[], out),
                    _ => {}
                }
                out.push_str(&format!("</m:{name}>"));
            }
            Node::PreScripts { base, sub, sup } => {
                out.push_str("<m:sPre>");
                self.pr("sPrePr", "", out);
                self.arg("sub", sub, out);
                self.arg("sup", sup, out);
                self.arg("e", base, out);
                out.push_str("</m:sPre>");
            }
            Node::Radical { degree, body, .. } => {
                out.push_str("<m:rad>");
                let hide = if degree.is_none() {
                    r#"<m:degHide m:val="1"/>"#
                } else {
                    ""
                };
                self.pr("radPr", hide, out);
                self.arg("deg", degree.as_deref().unwrap_or_default(), out);
                self.arg("e", body, out);
                out.push_str("</m:rad>");
            }
            Node::Nary {
                op,
                limits,
                grow,
                sub,
                sup,
                body,
                ..
            } => {
                out.push_str("<m:nary>");
                let mut p = String::new();
                if *op != '∫' {
                    p.push_str(&format!(r#"<m:chr m:val="{}"/>"#, esc(&op.to_string())));
                }
                let under = match limits {
                    LimLoc::UnderOver => true,
                    LimLoc::SubSup => false,
                    LimLoc::Auto => !super::symbols::is_integral(*op),
                };
                p.push_str(&format!(
                    r#"<m:limLoc m:val="{}"/>"#,
                    if under { "undOvr" } else { "subSup" }
                ));
                if *grow {
                    p.push_str(r#"<m:grow m:val="1"/>"#);
                }
                if sub.is_none() {
                    p.push_str(r#"<m:subHide m:val="1"/>"#);
                }
                if sup.is_none() {
                    p.push_str(r#"<m:supHide m:val="1"/>"#);
                }
                self.pr("naryPr", &p, out);
                self.arg("sub", sub.as_deref().unwrap_or_default(), out);
                self.arg("sup", sup.as_deref().unwrap_or_default(), out);
                self.arg("e", body, out);
                out.push_str("</m:nary>");
            }
            Node::Delim {
                open,
                close,
                sep,
                grow,
                items,
                ..
            } => {
                out.push_str("<m:d>");
                let c = |c: Option<char>| esc(&c.map(String::from).unwrap_or_default());
                let mut p = String::new();
                if *open != Some('(') {
                    p.push_str(&format!(r#"<m:begChr m:val="{}"/>"#, c(*open)));
                }
                if *sep != '|' {
                    p.push_str(&format!(r#"<m:sepChr m:val="{}"/>"#, c(Some(*sep))));
                }
                if *close != Some(')') {
                    p.push_str(&format!(r#"<m:endChr m:val="{}"/>"#, c(*close)));
                }
                if !grow {
                    p.push_str(r#"<m:grow m:val="0"/>"#);
                }
                self.pr("dPr", &p, out);
                if items.is_empty() {
                    self.arg("e", &[], out);
                }
                for item in items {
                    self.arg("e", item, out);
                }
                out.push_str("</m:d>");
            }
            Node::Func { name, body } => {
                out.push_str("<m:func>");
                self.pr("funcPr", "", out);
                self.arg("fName", name, out);
                self.arg("e", body, out);
                out.push_str("</m:func>");
            }
            Node::Limit { upper, base, limit } => {
                let name = if *upper { "limUpp" } else { "limLow" };
                out.push_str(&format!("<m:{name}>"));
                self.pr(&format!("{name}Pr"), "", out);
                self.arg("e", base, out);
                self.arg("lim", limit, out);
                out.push_str(&format!("</m:{name}>"));
            }
            Node::Accent { chr, base, .. } => {
                out.push_str("<m:acc>");
                let p = format!(r#"<m:chr m:val="{}"/>"#, esc(&chr.to_string()));
                self.pr("accPr", &p, out);
                self.arg("e", base, out);
                out.push_str("</m:acc>");
            }
            Node::Bar { top, base, .. } => {
                out.push_str("<m:bar>");
                let p = format!(r#"<m:pos m:val="{}"/>"#, if *top { "top" } else { "bot" });
                self.pr("barPr", &p, out);
                self.arg("e", base, out);
                out.push_str("</m:bar>");
            }
            Node::GroupChr { chr, top, base, .. } => {
                out.push_str("<m:groupChr>");
                let p = format!(
                    r#"<m:chr m:val="{}"/><m:pos m:val="{}"/><m:vertJc m:val="{}"/>"#,
                    esc(&chr.to_string()),
                    if *top { "top" } else { "bot" },
                    if *top { "bot" } else { "top" }
                );
                self.pr("groupChrPr", &p, out);
                self.arg("e", base, out);
                out.push_str("</m:groupChr>");
            }
            Node::BorderBox { borders, base, .. } => {
                out.push_str("<m:borderBox>");
                let mut p = String::new();
                for (name, on) in [
                    ("hideTop", borders.hide_top),
                    ("hideBot", borders.hide_bottom),
                    ("hideLeft", borders.hide_left),
                    ("hideRight", borders.hide_right),
                    ("strikeH", borders.strike_h),
                    ("strikeV", borders.strike_v),
                    ("strikeBLTR", borders.strike_bltr),
                    ("strikeTLBR", borders.strike_tlbr),
                ] {
                    if on {
                        p.push_str(&format!(r#"<m:{name} m:val="1"/>"#));
                    }
                }
                self.pr("borderBoxPr", &p, out);
                self.arg("e", base, out);
                out.push_str("</m:borderBox>");
            }
            Node::Group(base) => {
                out.push_str("<m:box>");
                self.pr("boxPr", "", out);
                self.arg("e", base, out);
                out.push_str("</m:box>");
            }
            Node::EqArray(rows) => {
                out.push_str("<m:eqArr>");
                self.pr("eqArrPr", "", out);
                for row in rows {
                    self.arg("e", row, out);
                }
                out.push_str("</m:eqArr>");
            }
            Node::Matrix(rows) => {
                let cols = rows.iter().map(Vec::len).max().unwrap_or(0).max(1);
                out.push_str("<m:m>");
                let p = format!(
                    r#"<m:mcs><m:mc><m:mcPr><m:count m:val="{cols}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs>"#
                );
                self.pr("mPr", &p, out);
                for row in rows {
                    out.push_str("<m:mr>");
                    for c in 0..cols {
                        self.arg("e", row.get(c).map_or(&[][..], Vec::as_slice), out);
                    }
                    out.push_str("</m:mr>");
                }
                out.push_str("</m:m>");
            }
            Node::Phantom {
                show,
                zero_width,
                zero_ascent,
                zero_descent,
                base,
            } => {
                out.push_str("<m:phant>");
                let mut p = String::new();
                if !show {
                    p.push_str(&format!(r#"<m:show m:val="{}"/>"#, onoff(false)));
                }
                for (name, on) in [
                    ("zeroWid", *zero_width),
                    ("zeroAsc", *zero_ascent),
                    ("zeroDesc", *zero_descent),
                ] {
                    if on {
                        p.push_str(&format!(r#"<m:{name} m:val="{}"/>"#, onoff(true)));
                    }
                }
                self.pr("phantPr", &p, out);
                self.arg("e", base, out);
                out.push_str("</m:phant>");
            }
        }
    }

    fn run(&self, r: &Run, out: &mut String) {
        if r.text.is_empty() {
            return;
        }
        let mut mpr = String::new();
        if r.normal {
            mpr.push_str(r#"<m:nor m:val="1"/>"#);
        }
        let style = r.style;
        let alphabet = r.alphabet.unwrap_or(Alphabet::Roman);
        // Letters PowerPoint stores as math alphanumerics (𝑥, ℝ); explicit
        // styles that have no such characters go in `m:sty`.
        let mut text = String::new();
        for c in r.text.chars() {
            let st = style.unwrap_or_else(|| default_style(c));
            let mapped = if r.normal {
                None
            } else {
                super::symbols::math_char(c, st, alphabet)
            };
            text.push(mapped.unwrap_or(c));
        }
        let needs_sty = match style {
            Some(s) => r.text.chars().any(|c| {
                !r.normal
                    && super::symbols::math_char(c, s, alphabet).is_none()
                    && c.is_alphanumeric()
            }),
            None => false,
        };
        if needs_sty || (r.normal && style.is_some()) {
            let v = match style.unwrap_or(Style::Plain) {
                Style::Plain => "p",
                Style::Bold => "b",
                Style::Italic => "i",
                Style::BoldItalic => "bi",
            };
            mpr.push_str(&format!(r#"<m:sty m:val="{v}"/>"#));
        }
        let italic = !r.normal
            && match style {
                Some(s) => matches!(s, Style::Italic | Style::BoldItalic),
                None => r.text.chars().any(|c| default_style(c) == Style::Italic),
            };
        let bold = matches!(style, Some(Style::Bold | Style::BoldItalic));
        // `m:rPr` comes first, then the DrawingML properties, then the text.
        out.push_str("<m:r>");
        if !mpr.is_empty() {
            out.push_str(&format!("<m:rPr>{mpr}</m:rPr>"));
        }
        out.push_str(&self.rpr(italic, bold));
        let space = if text.starts_with(' ') || text.ends_with(' ') {
            r#" xml:space="preserve""#
        } else {
            ""
        };
        out.push_str(&format!("<m:t{space}>{}</m:t></m:r>", esc(&text)));
    }
}
