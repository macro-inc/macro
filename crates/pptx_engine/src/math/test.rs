//! Tests of equations: OMML, the linear format, and typesetting.

use super::omml::{RunTemplate, alternate_content_xml};
use super::*;
use crate::test_support::{deck, fonts, text_box};

mod convert;
mod layout_metrics;
mod omml_read;

/// A paragraph holding an equation written from linear text, as the
/// engine writes them (`sz` in hundredths of a point).
pub(super) fn equation_paragraph(latex: &str, display: bool, sz: u32) -> String {
    let eq = parse_latex(latex, display).expect("valid linear text");
    let tpl = RunTemplate {
        attrs: format!(r#" sz="{sz}""#),
        fill: String::new(),
    };
    format!(
        "<a:p>{}<a:endParaRPr lang=\"en-US\" sz=\"{sz}\"/></a:p>",
        alternate_content_xml(&eq, &tpl, &plain_text(&eq))
    )
}

/// Renders equations to a PNG for looking at by eye:
/// `cargo test -p pptx_engine render_gallery -- --ignored`, then open
/// `pptx-equations.png` in the system temporary directory.
#[test]
#[ignore = "writes a picture for visual review"]
fn render_gallery() {
    let samples: &[&str] = &[
        r"x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}",
        r"A=\pi r^2",
        r"(x+a)^n=\sum_{k=0}^{n}\binom{n}{k}x^k a^{n-k}",
        r"f(x)=a_0+\sum_{n=1}^{\infty}\left(a_n\cos\frac{n\pi x}{L}+b_n\sin\frac{n\pi x}{L}\right)",
        r"\int_0^1 x^2\,dx=\frac{1}{3}\qquad \oint_C \vec{F}\cdot d\vec{r}",
        r"\lim_{x\to 0}\frac{\sin x}{x}=1",
        r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}\begin{bmatrix} 1 \\ 0 \end{bmatrix}",
        r"\hat{x}+\bar{y}+\vec{v}+\dot{a}+\tilde{n}+\overline{AB}+\underbrace{a+b}_{n}",
        r"\sqrt[3]{x+1}\quad e^{i\pi}+1=0\quad \mathbb{R}\ \mathcal{L}\ \mathfrak{g}",
        r"f(x)=\begin{cases} x & x\ge 0 \\ -x & x<0 \end{cases}",
    ];
    let mut shapes = String::new();
    for (i, latex) in samples.iter().enumerate() {
        let col = i % 2;
        let row = i / 2;
        let x = 200_000 + col as i64 * 6_000_000;
        let y = 150_000 + row as i64 * 1_330_000;
        shapes.push_str(&text_box(
            10 + i as u32,
            x,
            y,
            5_800_000,
            1_300_000,
            &equation_paragraph(latex, true, 2000),
        ));
    }
    let mut pres = crate::Presentation::open(deck(&[&shapes])).unwrap();
    let raster = pres.render_slide(0, 1600, fonts()).unwrap();
    let path = std::env::temp_dir().join("pptx-equations.png");
    std::fs::write(&path, raster.to_png()).unwrap();
    println!("{}", path.display());
}
