use super::*;
use crate::edit::EditOp;
use crate::inspect::{ShapeOutline, SlideOutline};
use crate::test_support::fonts;

/// The corpus deck with one slide per default layout (11 layouts).
fn layouts_deck() -> Presentation {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/corpus/generated/placeholders-all-layouts.pptx"
    );
    Presentation::open(std::fs::read(path).unwrap()).unwrap()
}

fn set_layout(pres: &mut Presentation, slide: u32, layout: &str) {
    pres.apply(
        &[EditOp::SetSlideLayout {
            slide,
            layout: layout.into(),
        }],
        fonts(),
    )
    .unwrap();
}

fn slide(pres: &mut Presentation, id: u32) -> SlideOutline {
    let index = pres.slides().iter().position(|s| s.id == id).unwrap();
    pres.slide_outline(index).unwrap()
}

fn shape(s: &SlideOutline, id: u32) -> &ShapeOutline {
    s.shapes.iter().find(|x| x.id == id).unwrap()
}

fn same_box(a: &ShapeOutline, b: &ShapeOutline) -> bool {
    [(a.x, b.x), (a.y, b.y), (a.w, b.w), (a.h, b.h)]
        .iter()
        .all(|(p, q)| (p - q).abs() < 0.05)
}

fn assert_integrity(pres: &mut Presentation) {
    let mut reopened = Presentation::open(pres.save().unwrap()).unwrap();
    let problems = reopened.integrity_problems().unwrap();
    assert!(problems.is_empty(), "{problems:#?}");
}

#[test]
fn the_outline_lists_every_layout_and_each_slides_layout() {
    let mut pres = layouts_deck();
    let outline = pres.outline().unwrap();
    let names: Vec<&str> = outline.layouts.iter().map(|l| l.name.as_str()).collect();
    assert_eq!(names.len(), 11, "{names:?}");
    for slide in &outline.slides {
        assert!(names.contains(&slide.layout.as_str()), "{}", slide.layout);
    }
    assert_eq!(outline.slides[1].layout, "Title and Content");
}

#[test]
fn changing_layouts_keeps_content_and_unmatched_positions() {
    let mut pres = layouts_deck();
    let id = pres.slides()[1].id;
    let before = slide(&mut pres, id);
    let body = shape(&before, 3).clone();
    assert_eq!(body.placeholder.as_deref(), Some("obj"));

    // "Title Only" has no body: it stays where it was, as a placeholder.
    set_layout(&mut pres, id, "title only");
    let only = slide(&mut pres, id);
    assert_eq!(only.layout, "Title Only");
    assert!(same_box(shape(&only, 3), &body), "{:?}", shape(&only, 3));
    assert_eq!(shape(&only, 3).paragraphs, body.paragraphs);
    assert_eq!(only.title.as_deref(), Some("Title and Content"));

    // "Two Content": the body binds to the left content placeholder (keeping
    // the position it now carries), and the right one is added empty.
    set_layout(&mut pres, id, "Two Content");
    let two = slide(&mut pres, id);
    assert_eq!(two.layout, "Two Content");
    assert_eq!(two.shapes.len(), 3);
    let added = &two.shapes[2];
    assert_eq!(added.placeholder.as_deref(), Some("obj"));
    assert!(added.paragraphs.iter().all(|p| p.text.is_empty()));
    assert!(added.x > body.x + 100.0, "the right column: {added:?}");

    // "Title Slide": title → centered title, content → subtitle (taking the
    // layout's positions); the extra content placeholder keeps its place.
    let right = added.clone();
    set_layout(&mut pres, id, "Title Slide");
    let title_slide = slide(&mut pres, id);
    assert_eq!(
        shape(&title_slide, 2).placeholder.as_deref(),
        Some("ctrTitle")
    );
    assert_eq!(
        shape(&title_slide, 3).placeholder.as_deref(),
        Some("subTitle")
    );
    assert!(same_box(shape(&title_slide, right.id), &right));
    assert_eq!(title_slide.title.as_deref(), Some("Title and Content"));
    let first = pres.slides()[0].id;
    let reference = slide(&mut pres, first);
    let ctr_title = reference
        .shapes
        .iter()
        .find(|s| s.placeholder.as_deref() == Some("ctrTitle"))
        .unwrap();
    assert!(same_box(shape(&title_slide, 2), ctr_title));
    assert_integrity(&mut pres);
}

#[test]
fn unknown_layouts_are_rejected_and_the_same_layout_is_a_no_op() {
    let mut pres = layouts_deck();
    let id = pres.slides()[1].id;
    let r = pres
        .apply(
            &[EditOp::SetSlideLayout {
                slide: id,
                layout: "Title and Content".into(),
            }],
            fonts(),
        )
        .unwrap();
    assert!(r.changed_slides.is_empty());
    for name in ["Nope", " "] {
        assert!(matches!(
            pres.apply(
                &[EditOp::SetSlideLayout {
                    slide: id,
                    layout: name.into(),
                }],
                fonts()
            ),
            Err(Error::InvalidEdit(_))
        ));
    }
}
