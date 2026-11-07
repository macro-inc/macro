//! Reading OMML as PowerPoint writes it: every structure.

use super::*;
use crate::xml::XmlDoc;

const M: &str = "http://schemas.openxmlformats.org/officeDocument/2006/math";

/// A PowerPoint math run: DrawingML run properties, math italic text.
fn r(text: &str) -> String {
    format!(
        r#"<m:r><a:rPr lang="en-US" i="1"><a:latin typeface="Cambria Math" panose="02040503050406030204" pitchFamily="18" charset="0"/></a:rPr><m:t>{text}</m:t></m:r>"#
    )
}

const CTRL: &str =
    r#"<m:ctrlPr><a:rPr lang="en-US" i="1"><a:latin typeface="Cambria Math"/></a:rPr></m:ctrlPr>"#;

/// Reads `body` (the content of an `m:oMath`) as PowerPoint wraps it.
fn read(body: &str) -> List {
    read_eq(&format!(r#"<m:oMath xmlns:m="{M}">{body}</m:oMath>"#))
        .lines
        .remove(0)
}

fn read_eq(math: &str) -> Equation {
    let xml = format!(
        r#"<a14:m xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">{math}</a14:m>"#
    );
    let doc = XmlDoc::parse(xml.as_bytes(), "m").expect("well-formed");
    let mut eq = read_equation(&doc, doc.root(), &|_| None);
    eq.lines.iter_mut().for_each(strip_props);
    eq
}

fn latex(body: &str) -> String {
    list_to_latex(&read(body))
}

#[test]
fn runs_map_math_alphanumerics_back_to_letters() {
    assert_eq!(read(&r("𝑥=2𝑎")), vec![Node::Run(Run::new("x=2a"))]);
    // ℎ is the italic h; bold and double-struck letters keep their style.
    assert_eq!(latex(&r("ℎ𝐯ℝ𝛼Ω")), r"h\mathbf{v}\mathbb{R}\alpha\Omega");
    // An upright run (m:sty p), a text run (m:nor), and an alphabet (m:scr).
    assert_eq!(
        latex(&format!(
            r#"<m:r><m:rPr><m:sty m:val="p"/></m:rPr>{}<m:t>sin</m:t></m:r><m:r><m:rPr><m:nor/></m:rPr><m:t>if </m:t></m:r><m:r><m:rPr><m:scr m:val="fraktur"/></m:rPr><m:t>g</m:t></m:r>"#,
            "<a:rPr lang=\"en-US\" i=\"0\"/>"
        )),
        r"\mathrm{sin}\text{if }\mathfrak{g}"
    );
}

#[test]
fn reads_every_structure() {
    let a = r("𝑎");
    let b = r("𝑏");
    let cases: Vec<(String, &str)> = vec![
        (
            format!("<m:f><m:fPr>{CTRL}</m:fPr><m:num>{a}</m:num><m:den>{b}</m:den></m:f>"),
            r"\frac{a}{b}",
        ),
        (
            format!(
                r#"<m:f><m:fPr><m:type m:val="skw"/></m:fPr><m:num>{a}</m:num><m:den>{b}</m:den></m:f>"#
            ),
            r"\sfrac{a}{b}",
        ),
        (
            format!(
                r#"<m:f><m:fPr><m:type m:val="lin"/></m:fPr><m:num>{a}</m:num><m:den>{b}</m:den></m:f>"#
            ),
            r"\lfrac{a}{b}",
        ),
        (
            format!(
                r#"<m:f><m:fPr><m:type m:val="noBar"/></m:fPr><m:num>{a}</m:num><m:den>{b}</m:den></m:f>"#
            ),
            r"\genfrac{}{}{0pt}{}{a}{b}",
        ),
        (
            format!(
                "<m:sSup><m:sSupPr>{CTRL}</m:sSupPr><m:e>{a}</m:e><m:sup>{}</m:sup></m:sSup>",
                r("2")
            ),
            "a^2",
        ),
        (
            format!("<m:sSub><m:e>{a}</m:e><m:sub>{}</m:sub></m:sSub>", r("𝑖")),
            "a_i",
        ),
        (
            format!(
                "<m:sSubSup><m:e>{a}</m:e><m:sub>{}</m:sub><m:sup>{}</m:sup></m:sSubSup>",
                r("𝑖"),
                r("2")
            ),
            "a_i^2",
        ),
        (
            format!(
                "<m:sPre><m:sub>{}</m:sub><m:sup>{}</m:sup><m:e>{}</m:e></m:sPre>",
                r("1"),
                r("2"),
                r("𝑋")
            ),
            r"{}_{1}^{2}X",
        ),
        (
            format!(
                r#"<m:rad><m:radPr><m:degHide m:val="1"/>{CTRL}</m:radPr><m:deg/><m:e>{a}</m:e></m:rad>"#
            ),
            r"\sqrt{a}",
        ),
        (
            format!("<m:rad><m:deg>{}</m:deg><m:e>{a}</m:e></m:rad>", r("3")),
            r"\sqrt[3]{a}",
        ),
        (
            format!(
                r#"<m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/>{CTRL}</m:naryPr><m:sub>{}</m:sub><m:sup>{}</m:sup><m:e>{a}</m:e></m:nary>"#,
                r("𝑖=1"),
                r("𝑛")
            ),
            r"\sum_{i=1}^n a",
        ),
        // No m:chr is an integral; hidden limits.
        (
            format!(
                r#"<m:nary><m:naryPr><m:limLoc m:val="subSup"/><m:subHide m:val="1"/><m:supHide m:val="1"/></m:naryPr><m:sub/><m:sup/><m:e>{a}</m:e></m:nary>"#
            ),
            r"\int a",
        ),
        (
            format!(
                r#"<m:nary><m:naryPr><m:chr m:val="∮"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub>{}</m:sub><m:sup/><m:e>{a}</m:e></m:nary>"#,
                r("𝐶")
            ),
            r"\oint\limits_C^{}a",
        ),
        (
            format!("<m:d><m:dPr>{CTRL}</m:dPr><m:e>{a}</m:e></m:d>"),
            "(a)",
        ),
        (
            format!(
                r#"<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e>{a}</m:e></m:d>"#
            ),
            "[a]",
        ),
        (
            format!(
                r#"<m:d><m:dPr><m:begChr m:val="|"/><m:endChr m:val="|"/></m:dPr><m:e>{a}</m:e></m:d>"#
            ),
            r"\left|a\right|",
        ),
        (
            format!(
                r#"<m:d><m:dPr><m:begChr m:val="{{"/><m:endChr m:val=""/></m:dPr><m:e>{a}</m:e></m:d>"#
            ),
            r"\left\{a\right.",
        ),
        (
            format!("<m:d><m:e>{a}</m:e><m:e>{b}</m:e></m:d>"),
            r"\left(a\middle|b\right)",
        ),
        (
            format!(
                r#"<m:func><m:funcPr>{CTRL}</m:funcPr><m:fName><m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>sin</m:t></m:r></m:fName><m:e>{}</m:e></m:func>"#,
                r("𝑥")
            ),
            r"\sin x",
        ),
        (
            format!(
                r#"<m:func><m:fName><m:limLow><m:e><m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>lim</m:t></m:r></m:e><m:lim>{}</m:lim></m:limLow></m:fName><m:e>{a}</m:e></m:func>"#,
                r("𝑛→∞")
            ),
            r"\lim_{n\to\infty}a",
        ),
        (
            format!(
                "<m:limUpp><m:e>{}</m:e><m:lim>{}</m:lim></m:limUpp>",
                r("="),
                r("def")
            ),
            r"\overset{def}{=}",
        ),
        (
            format!("<m:acc><m:accPr>{CTRL}</m:accPr><m:e>{a}</m:e></m:acc>"),
            r"\hat{a}",
        ),
        (
            format!(r#"<m:acc><m:accPr><m:chr m:val="⃗"/></m:accPr><m:e>{a}</m:e></m:acc>"#),
            r"\vec{a}",
        ),
        (
            format!(r#"<m:acc><m:accPr><m:chr m:val="̅"/></m:accPr><m:e>{a}</m:e></m:acc>"#),
            r"\bar{a}",
        ),
        (format!("<m:bar><m:e>{a}</m:e></m:bar>"), r"\underline{a}"),
        (
            format!(r#"<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>{a}</m:e></m:bar>"#),
            r"\overline{a}",
        ),
        (
            format!("<m:groupChr><m:e>{a}</m:e></m:groupChr>"),
            r"\underbrace{a}",
        ),
        (
            format!(
                r#"<m:limUpp><m:e><m:groupChr><m:groupChrPr><m:chr m:val="⏞"/><m:pos m:val="top"/><m:vertJc m:val="bot"/></m:groupChrPr><m:e>{a}</m:e></m:groupChr></m:e><m:lim>{b}</m:lim></m:limUpp>"#
            ),
            r"\overbrace{a}^{b}",
        ),
        (
            format!("<m:borderBox><m:e>{a}</m:e></m:borderBox>"),
            r"\boxed{a}",
        ),
        (
            format!(
                r#"<m:borderBox><m:borderBoxPr><m:hideTop m:val="1"/><m:hideBot m:val="1"/><m:hideLeft m:val="1"/><m:hideRight m:val="1"/><m:strikeBLTR m:val="1"/></m:borderBoxPr><m:e>{a}</m:e></m:borderBox>"#
            ),
            r"\cancel{a}",
        ),
        (format!("<m:box><m:e>{a}</m:e></m:box>"), "{a}"),
        (
            format!(
                "<m:eqArr><m:e>{}</m:e><m:e>{}</m:e></m:eqArr>",
                r("𝑎&amp;=1"),
                r("𝑏&amp;=2")
            ),
            r"\begin{aligned}a & =1 \\ b & =2\end{aligned}",
        ),
        (
            format!(
                "<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val=\"2\"/><m:mcJc m:val=\"center\"/></m:mcPr></m:mc></m:mcs></m:mPr><m:mr><m:e>{a}</m:e><m:e>{b}</m:e></m:mr><m:mr><m:e>{b}</m:e><m:e>{a}</m:e></m:mr></m:m>"
            ),
            r"\begin{matrix}a & b \\ b & a\end{matrix}",
        ),
        (
            format!(
                r#"<m:phant><m:phantPr><m:show m:val="0"/></m:phantPr><m:e>{a}</m:e></m:phant>"#
            ),
            r"\phantom{a}",
        ),
    ];
    for (xml, expected) in cases {
        assert_eq!(latex(&xml), expected, "{xml}");
    }
}

#[test]
fn reads_display_equations_and_justification() {
    let eq = read_eq(&format!(
        r#"<m:oMathPara xmlns:m="{M}"><m:oMathParaPr><m:jc m:val="left"/></m:oMathParaPr><m:oMath>{}</m:oMath><m:oMath>{}</m:oMath></m:oMathPara>"#,
        r("𝑎"),
        r("𝑏")
    ));
    assert!(eq.display);
    assert_eq!(eq.justify, Justify::Left);
    assert_eq!(to_latex(&eq), r"a \\ b");
    let inline = read_eq(&format!(r#"<m:oMath xmlns:m="{M}">{}</m:oMath>"#, r("𝑎")));
    assert!(!inline.display);
    assert_eq!(inline.justify, Justify::CenterGroup);
}

#[test]
fn reads_run_formatting_for_typesetting() {
    let xml = format!(
        r#"<a14:m xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><m:oMath xmlns:m="{M}"><m:r><a:rPr lang="en-US" sz="3200"/><m:t>𝑥</m:t></m:r></m:oMath></a14:m>"#
    );
    let doc = XmlDoc::parse(xml.as_bytes(), "m").unwrap();
    let seen = std::cell::Cell::new(0);
    let eq = read_equation(&doc, doc.root(), &|rpr| {
        seen.set(seen.get() + 1);
        assert_eq!(doc.attr(rpr, "sz"), Some("3200"));
        None
    });
    assert_eq!(seen.get(), 1);
    assert_eq!(eq.lines[0].len(), 1);
}
