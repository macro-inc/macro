use super::*;
use crate::pdf::Pdf;
use crate::testing::{PdfBuilder, dict, helvetica};

/// What a sink saw.
#[derive(Default)]
struct Record {
    paths: Vec<(PathData, bool, bool, usize, Vec<u8>)>,
    glyphs: Vec<(String, Affine)>,
    marks: Vec<String>,
    groups: usize,
}

impl Sink for Record {
    fn path(&mut self, e: &PathEvent<'_>) {
        self.paths.push((
            e.path.transform(&e.gs.ctm),
            e.fill,
            e.stroke,
            e.gs.clips.len(),
            e.ops.iter().flat_map(|o| o.operator.clone()).collect(),
        ));
    }
    fn show(&mut self, e: &ShowEvent<'_>) {
        for g in &e.glyphs {
            self.glyphs.push((g.text.clone(), g.trm));
        }
    }
    fn image(&mut self, _: &ImageEvent<'_>) {}
    fn shading(&mut self, _: &ShadingEvent<'_>) {}
    fn begin_group(&mut self, _: &GroupEvent<'_>) -> Descend {
        self.groups += 1;
        Descend::Into
    }
    fn begin_marked(&mut self, tag: &Name, _: Option<&Object>, _: &GState) {
        self.marks.push(tag.as_str().into_owned());
    }
}

fn run(content: &str, resources: Dict) -> Record {
    let mut b = PdfBuilder::new();
    b.page(100.0, 100.0, "", Dict::new());
    let pdf = Pdf::open(b.finish().into()).expect("opens");
    let mut fonts = FontCache::default();
    let mut sink = Record::default();
    let ops = crate::pdf::content::parse(content.as_bytes());
    let res = Resources::new(&pdf, resources);
    Interp::new(&pdf, &mut fonts).run(&ops, &res, GState::default(), &mut sink);
    sink
}

#[test]
fn paths_in_the_transform_with_their_operators() {
    let r = run(
        "q 2 0 0 2 10 10 cm 0 0 m 5 0 l 5 5 l h f Q 0 0 1 1 re S",
        Dict::new(),
    );
    assert_eq!(r.paths.len(), 2);
    let (p, fill, stroke, _, ops) = &r.paths[0];
    assert_eq!(
        p.bounds(),
        Some(crate::geom::Rect::new(10.0, 10.0, 20.0, 20.0))
    );
    assert!(*fill && !*stroke);
    assert_eq!(ops, b"mllhf");
    assert_eq!(
        r.paths[1].0.bounds(),
        Some(crate::geom::Rect::new(0.0, 0.0, 1.0, 1.0))
    );
}

#[test]
fn clips_apply_after_the_painting_and_end_with_q() {
    let r = run(
        "q 0 0 10 10 re W n 0 0 5 5 re f Q 0 0 5 5 re f q 0 0 1 1 re W 0 0 1 1 re f 0 0 2 2 re f Q",
        Dict::new(),
    );
    let clips: Vec<usize> = r.paths.iter().map(|p| p.3).collect();
    // `re W f` fills before its clip applies.
    assert_eq!(clips, [1, 0, 0, 1]);
}

#[test]
fn text_advances_with_spacing_and_adjustments() {
    let resources = dict(vec![(
        "Font",
        Object::Dict(dict(vec![("F1", helvetica())])),
    )]);
    let r = run("BT /F1 10 Tf 2 Tc 5 5 Td [(A) -1000 (B)] TJ ET", resources);
    let text: String = r.glyphs.iter().map(|g| g.0.as_str()).collect();
    assert_eq!(text, "AB");
    let (a, b) = (r.glyphs[0].1, r.glyphs[1].1);
    assert_eq!((a.0[4], a.0[5]), (5.0, 5.0));
    assert_eq!(a.0[0], 10.0);
    // Helvetica's A is 667/1000 em; +2 spacing; +10 for the adjustment.
    assert!(
        (b.0[4] - (5.0 + 6.67 + 2.0 + 10.0)).abs() < 1e-6,
        "{}",
        b.0[4]
    );
}

#[test]
fn marked_content_balances() {
    let r = run("/Span BMC /P <</MCID 0>> BDC EMC", Dict::new());
    assert_eq!(r.marks, ["Span", "P"]);
}
