//! Linear format and OMML conversion round trips.

use super::super::omml::math_xml;
use super::*;
use crate::xml::XmlDoc;

fn parse(s: &str) -> List {
    parse_latex(s, false)
        .unwrap_or_else(|e| panic!("{s}: {e}"))
        .lines
        .remove(0)
}

fn run(text: &str) -> Node {
    Node::Run(Run::new(text))
}

/// Writes an equation as OMML and reads it back (without formatting).
fn through_omml(eq: &Equation) -> Equation {
    let xml = math_xml(eq, &RunTemplate::default());
    let wrapped =
        format!(r#"<w xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">{xml}</w>"#);
    let doc = XmlDoc::parse(wrapped.as_bytes(), "math").expect("well-formed OMML");
    let root = doc.first_child(doc.root()).unwrap();
    let mut back = read_equation(&doc, root, &|_| None);
    back.lines.iter_mut().for_each(strip_props);
    back
}

#[test]
fn parses_fractions_scripts_and_radicals() {
    assert_eq!(
        parse(r"\frac{a}{b}"),
        vec![Node::Frac {
            kind: FracKind::Bar,
            num: vec![run("a")],
            den: vec![run("b")],
            props: None,
        }]
    );
    assert_eq!(
        parse("x^2_i"),
        vec![Node::Scripts {
            base: vec![run("x")],
            sub: Some(vec![run("i")]),
            sup: Some(vec![run("2")]),
        }]
    );
    // A number is one base; TeX takes one digit after `^`.
    assert_eq!(
        parse("10^23"),
        vec![
            Node::Scripts {
                base: vec![run("10")],
                sub: None,
                sup: Some(vec![run("2")]),
            },
            run("3"),
        ]
    );
    assert_eq!(
        parse(r"\sqrt[3]{x}"),
        vec![Node::Radical {
            degree: Some(vec![run("3")]),
            body: vec![run("x")],
            props: None,
        }]
    );
    assert_eq!(
        parse(r"\frac12"),
        parse(r"\frac{1}{2}"),
        "one digit per argument"
    );
    assert!(matches!(
        &parse(r"\sfrac{1}{2}")[0],
        Node::Frac {
            kind: FracKind::Skewed,
            ..
        }
    ));
    assert!(matches!(
        &parse(r"\lfrac{1}{2}")[0],
        Node::Frac {
            kind: FracKind::Linear,
            ..
        }
    ));
    assert!(matches!(
        &parse(r"{a \over b}")[0],
        Node::Frac {
            kind: FracKind::Bar,
            ..
        }
    ));
}

#[test]
fn large_operators_take_their_operand() {
    let list = parse(r"\sum_{i=1}^{n} i^2 = x");
    let Node::Nary {
        op,
        limits,
        sub,
        sup,
        body,
        ..
    } = &list[0]
    else {
        panic!("{list:?}");
    };
    assert_eq!((*op, *limits), ('∑', LimLoc::Auto));
    assert_eq!(sub.as_deref(), Some(&[run("i=1")][..]));
    assert_eq!(sup.as_deref(), Some(&[run("n")][..]));
    // The operand stops at the relation.
    assert!(matches!(body.as_slice(), [Node::Scripts { .. }]));
    assert_eq!(list[1..], [run("=x")]);
    // An integral's operand runs to the end, spaces included.
    let list = parse(r"\int_0^1 f(x)\,dx");
    let Node::Nary { op, body, .. } = &list[0] else {
        panic!("{list:?}");
    };
    assert_eq!(*op, '∫');
    assert_eq!(body.len(), 3, "{body:?}");
    // An explicit placement is kept only where it is not the default.
    assert!(matches!(
        &parse(r"\sum\limits_a")[0],
        Node::Nary {
            limits: LimLoc::Auto,
            ..
        }
    ));
    assert!(matches!(
        &parse(r"\sum\nolimits_a")[0],
        Node::Nary {
            limits: LimLoc::SubSup,
            ..
        }
    ));
    assert!(matches!(
        &parse(r"\int\limits_a")[0],
        Node::Nary {
            limits: LimLoc::UnderOver,
            ..
        }
    ));
}

#[test]
fn functions_and_limits() {
    let list = parse(r"\sin x + \cos y");
    assert!(matches!(&list[0], Node::Func { body, .. } if body == &[run("x")]));
    assert_eq!(list[1], run("+"));
    assert!(matches!(&list[2], Node::Func { .. }));
    let list = parse(r"\lim_{x\to 0} f(x)");
    let Node::Func { name, body } = &list[0] else {
        panic!("{list:?}");
    };
    assert!(matches!(&name[0], Node::Limit { upper: false, limit, .. } if limit == &[run("x→0")]));
    assert_eq!(body.len(), 2);
    let list = parse(r"\log_2 n");
    assert!(matches!(&list[0], Node::Func { name, .. } if matches!(name[0], Node::Scripts { .. })));
}

#[test]
fn brackets_pair_into_growing_delimiters() {
    let list = parse(r"(x+1)[0,1)\left\{a \middle| b\right.");
    assert!(matches!(
        &list[0],
        Node::Delim {
            open: Some('('),
            close: Some(')'),
            grow: true,
            ..
        }
    ));
    assert!(matches!(
        &list[1],
        Node::Delim {
            open: Some('['),
            close: Some(')'),
            ..
        }
    ));
    let Node::Delim {
        open,
        close,
        items,
        sep,
        ..
    } = &list[2]
    else {
        panic!("{list:?}");
    };
    assert_eq!(
        (*open, *close, *sep, items.len()),
        (Some('{'), None, '|', 2)
    );
    // An unclosed bracket stays a character.
    assert_eq!(parse("(a"), vec![run("(a")]);
    assert_eq!(parse("a)"), vec![run("a)")]);
}

#[test]
fn environments_accents_and_styles() {
    let list = parse(r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}");
    let Node::Delim { open, items, .. } = &list[0] else {
        panic!("{list:?}");
    };
    assert_eq!(*open, Some('('));
    assert!(matches!(&items[0][0], Node::Matrix(rows) if rows.len() == 2 && rows[1].len() == 2));
    let list = parse(r"\begin{cases} x & x\ge 0 \\ -x & x<0 \end{cases}");
    assert!(matches!(
        &list[0],
        Node::Delim {
            open: Some('{'),
            close: None,
            ..
        }
    ));
    assert!(matches!(
        &parse(r"\hat{x}")[0],
        Node::Accent { chr: '\u{302}', .. }
    ));
    assert!(matches!(
        &parse(r"\overline{AB}")[0],
        Node::Bar { top: true, .. }
    ));
    assert!(
        matches!(&parse(r"\underbrace{a+b}_{n}")[0], Node::Limit { upper: false, base, .. } if matches!(base[0], Node::GroupChr { top: false, .. }))
    );
    assert_eq!(
        parse(r"\mathbb{R}"),
        vec![Node::Run(Run {
            alphabet: Some(Alphabet::DoubleStruck),
            ..Run::new("R")
        })]
    );
    assert_eq!(
        parse(r"\mathrm{d}x"),
        vec![
            Node::Run(Run {
                style: Some(Style::Plain),
                ..Run::new("d")
            }),
            run("x")
        ]
    );
    assert_eq!(
        parse(r"\text{if } x"),
        vec![
            Node::Run(Run {
                normal: true,
                ..Run::new("if ")
            }),
            run("x")
        ]
    );
    assert_eq!(
        parse(r"\alpha\Omega\infty\pm\le\to\partial\nabla"),
        vec![run("αΩ∞±≤→∂∇")]
    );
    assert_eq!(
        parse("f'"),
        vec![Node::Scripts {
            base: vec![run("f")],
            sub: None,
            sup: Some(vec![run("′")])
        }]
    );
    assert!(matches!(&parse(r"\boxed{x}")[0], Node::BorderBox { .. }));
    assert!(matches!(
        &parse(r"\phantom{x}")[0],
        Node::Phantom { show: false, .. }
    ));
    assert!(matches!(&parse(r"{}_{1}^{2}X")[0], Node::PreScripts { .. }));
}

#[test]
fn reports_errors() {
    for bad in [
        r"\frac{a}",
        r"\nope",
        r"x^",
        r"{x",
        r"x}",
        r"\left( x",
        r"x \right)",
        r"\begin{matrix} a",
        r"\begin{nope} a \end{nope}",
        r"x_1_2",
    ] {
        assert!(parse_latex(bad, false).is_err(), "{bad} should fail");
    }
    let e = parse_latex(r"\nope", false).unwrap_err();
    assert!(e.message.contains("\\nope"), "{e}");
}

/// Linear text that writes back as itself.
const CANONICAL: &[&str] = &[
    r"x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}",
    r"A=\pi r^2",
    r"(x+a)^n=\sum_{k=0}^n\binom{n}{k}x^k a^{n-k}",
    r"\int_0^1 x^2\,dx",
    r"\oint_C\vec{F}\cdot d\vec{r}",
    r"\lim_{x\to0}\frac{\sin x}{x}=1",
    r"\begin{pmatrix}a & b \\ c & d\end{pmatrix}",
    r"\begin{bmatrix}1 \\ 0\end{bmatrix}",
    r"\begin{vmatrix}a & b \\ c & d\end{vmatrix}",
    r"\hat{x}+\bar{y}+\dot{a}+\ddot{b}+\tilde{n}+\check{c}",
    r"\overline{AB}+\underline{CD}",
    r"\underbrace{a+b}_{n}+\overbrace{c}^{m}",
    r"\sqrt[3]{x+1}",
    r"e^{i\pi}+1=0",
    r"\mathbb{R}\mathcal{L}\mathfrak{g}\mathbf{v}\mathrm{d}x",
    r"f(x)=\begin{cases}x & x\ge0 \\ -x & x<0\end{cases}",
    r"[\frac{1}{2})",
    r"\left|x\right|",
    r"\sin^2\theta+\cos^2\theta=1",
    r"\log_2 n",
    r"\sum\nolimits_a^b{}",
    r"\int\limits_a^b{}",
    r"\prod_{i=1}^n x_i",
    r"\boxed{E=mc^2}",
    r"\frac{d}{dx}f'(x)",
    r"\text{area }=\pi r^2",
    r"\sfrac{1}{2}+\lfrac{3}{4}",
    r"\begin{aligned}a & =b \\ c & =d\end{aligned}",
    r"\langle x\rangle+\lfloor y\rfloor+\lceil z\rceil",
    r"\overset{def}{=}\underset{n}{\to}",
    r"{}_{1}^{2}X",
    r"\phantom{x}\hphantom{y}\vphantom{z}",
    r"\cancel{x}\bcancel{y}\xcancel{z}",
];

#[test]
fn linear_text_round_trips() {
    for src in CANONICAL {
        let eq = parse_latex(src, false).unwrap_or_else(|e| panic!("{src}: {e}"));
        let written = to_latex(&eq);
        let again = parse_latex(&written, false).unwrap_or_else(|e| panic!("{written}: {e}"));
        assert_eq!(again, eq, "{src} → {written}");
        assert_eq!(&written, src, "canonical form of {src}");
    }
}

#[test]
fn display_lines_round_trip() {
    let eq = parse_latex(r"a=b \\ c=d", true).unwrap();
    assert_eq!(eq.lines.len(), 2);
    assert_eq!(to_latex(&eq), r"a=b \\ c=d");
    // Inline equations have one line.
    assert_eq!(parse_latex(r"a \\ b", false).unwrap().lines.len(), 1);
}

#[test]
fn omml_round_trips_every_structure() {
    for src in CANONICAL {
        for display in [false, true] {
            let eq = parse_latex(src, display).unwrap();
            assert_eq!(through_omml(&eq), eq, "{src} through OMML");
        }
    }
}

#[test]
fn writes_letters_as_math_alphanumerics() {
    let eq = parse_latex(
        r"x+\alpha+\Gamma+\mathbb{R}+h+\mathrm{sin}+\mathbf{v}",
        false,
    )
    .unwrap();
    let xml = math_xml(&eq, &RunTemplate::default());
    // Italic letters and Greek as PowerPoint stores them; capital Greek upright.
    for expected in ["𝑥", "𝛼", "Γ", "ℝ", "ℎ"] {
        assert!(xml.contains(expected), "{expected} in {xml}");
    }
    assert!(xml.contains(r#"<m:sty m:val="p"/>"#), "{xml}");
    assert!(xml.contains("𝐯"), "bold v: {xml}");
    assert!(xml.contains(r#"<a:latin typeface="Cambria Math""#));
}

#[test]
fn plain_text_fallback() {
    let eq = parse_latex(r"x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}", true).unwrap();
    assert_eq!(plain_text(&eq), "x=(−b±√(b^2−4ac))/2a");
    let eq = parse_latex(r"\sum_{i=1}^{n}i", true).unwrap();
    assert_eq!(plain_text(&eq), "∑_(i=1)^n i");
}
