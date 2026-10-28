use crate::edit::{EditOp, RunPatch};
use crate::model::presentation::Presentation;
use crate::opc::rel_type;
use crate::test_support::{deck, fonts, text_box};

fn two_slides() -> Presentation {
    let shape = text_box(
        2,
        0,
        0,
        3_000_000,
        1_000_000,
        "<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>Go there</a:t></a:r></a:p>",
    );
    Presentation::open(deck(&[&shape, &shape])).unwrap()
}

fn link_text(pres: &mut Presentation, link: &str, tip: Option<&str>) -> crate::error::Result<()> {
    pres.apply(
        &[EditOp::FormatText {
            slide: 256,
            shape: 2,
            cell: None,
            start: None,
            end: None,
            props: RunPatch {
                link: Some(link.into()),
                link_tip: tip.map(str::to_owned),
                ..RunPatch::default()
            },
        }],
        fonts(),
    )
    .map(|_| ())
}

/// The link and ScreenTip of the first run of slide 256's text box.
fn run_link(pres: &mut Presentation) -> (Option<String>, Option<String>) {
    let layout = pres.text_layout(0, 2, None, fonts()).unwrap().unwrap();
    let run = &layout.styles[0].runs[0];
    (run.link.clone(), run.link_tip.clone())
}

fn rels_of_type(pres: &mut Presentation, rel: &str) -> usize {
    let part = pres.slide_part(256).unwrap();
    pres.part_rels(&part)
        .unwrap()
        .iter()
        .filter(|r| r.rel_type == rel)
        .count()
}

#[test]
fn text_links_to_another_slide_and_round_trip() {
    let mut pres = two_slides();
    link_text(&mut pres, "#slide=257", Some("Details")).unwrap();
    assert_eq!(
        run_link(&mut pres),
        (Some("#slide=257".into()), Some("Details".into()))
    );
    assert_eq!(rels_of_type(&mut pres, rel_type::SLIDE), 1);

    let mut reopened = Presentation::open(pres.save().unwrap()).unwrap();
    assert_eq!(
        run_link(&mut reopened),
        (Some("#slide=257".into()), Some("Details".into()))
    );

    // Deleting the target drops the jump with it.
    reopened
        .apply(&[EditOp::DeleteSlide { slide: 257 }], fonts())
        .unwrap();
    assert_eq!(run_link(&mut reopened), (None, None));
}

#[test]
fn show_jumps_need_no_relationship() {
    let mut pres = two_slides();
    link_text(&mut pres, "#nextslide", None).unwrap();
    assert_eq!(run_link(&mut pres), (Some("#nextslide".into()), None));
    assert_eq!(rels_of_type(&mut pres, rel_type::SLIDE), 0);
    assert_eq!(rels_of_type(&mut pres, rel_type::HYPERLINK), 0);
    let saved = pres.save().unwrap();
    let mut reopened = Presentation::open(saved).unwrap();
    assert_eq!(run_link(&mut reopened), (Some("#nextslide".into()), None));
}

#[test]
fn addresses_replace_and_remove_cleanly() {
    let mut pres = two_slides();
    link_text(&mut pres, "#slide=257", None).unwrap();
    link_text(&mut pres, "mailto:team@macro.com", Some("Write to us")).unwrap();
    assert_eq!(
        run_link(&mut pres),
        (
            Some("mailto:team@macro.com".into()),
            Some("Write to us".into())
        )
    );
    assert_eq!(rels_of_type(&mut pres, rel_type::SLIDE), 0);
    assert_eq!(rels_of_type(&mut pres, rel_type::HYPERLINK), 1);
    link_text(&mut pres, "", None).unwrap();
    assert_eq!(run_link(&mut pres), (None, None));
    assert_eq!(rels_of_type(&mut pres, rel_type::HYPERLINK), 0);
}

#[test]
fn bad_links_are_rejected() {
    let mut pres = two_slides();
    assert!(link_text(&mut pres, "#somewhere", None).is_err());
    assert!(link_text(&mut pres, "#slide=999", None).is_err());
    assert!(link_text(&mut pres, "#slide=two", None).is_err());
}

#[test]
fn shapes_take_links_of_their_own() {
    let mut pres = two_slides();
    let set = |pres: &mut Presentation, link: &str, tip: Option<&str>| {
        pres.apply(
            &[EditOp::SetShapeLink {
                slide: 256,
                shapes: vec![2],
                link: link.into(),
                tip: tip.map(str::to_owned),
            }],
            fonts(),
        )
        .unwrap();
    };
    let shape_link = |pres: &mut Presentation| {
        let outline = pres.slide_outline(0).unwrap();
        let s = &outline.shapes[0];
        (s.link.clone(), s.link_tip.clone())
    };
    set(&mut pres, "https://macro.com", Some("Macro"));
    assert_eq!(
        shape_link(&mut pres),
        (Some("https://macro.com".into()), Some("Macro".into()))
    );
    // The text itself is not linked.
    assert_eq!(run_link(&mut pres), (None, None));
    let mut reopened = Presentation::open(pres.save().unwrap()).unwrap();
    assert_eq!(
        shape_link(&mut reopened),
        (Some("https://macro.com".into()), Some("Macro".into()))
    );
    set(&mut reopened, "#lastslide", None);
    assert_eq!(shape_link(&mut reopened), (Some("#lastslide".into()), None));
    set(&mut reopened, "", None);
    assert_eq!(shape_link(&mut reopened), (None, None));
    assert_eq!(rels_of_type(&mut reopened, rel_type::HYPERLINK), 0);
}

#[test]
fn link_regions_cover_linked_text_then_linked_shapes() {
    let mut pres = two_slides();
    // Link "there" only, and the whole shape.
    pres.apply(
        &[
            EditOp::FormatText {
                slide: 256,
                shape: 2,
                cell: None,
                start: Some(crate::edit::TextPos {
                    paragraph: 0,
                    offset: 3,
                }),
                end: Some(crate::edit::TextPos {
                    paragraph: 0,
                    offset: 8,
                }),
                props: RunPatch {
                    link: Some("#slide=257".into()),
                    ..RunPatch::default()
                },
            },
            EditOp::SetShapeLink {
                slide: 256,
                shapes: vec![2],
                link: "https://macro.com".into(),
                tip: None,
            },
        ],
        fonts(),
    )
    .unwrap();
    let regions = pres.link_regions(0, fonts()).unwrap();
    assert_eq!(regions.len(), 2, "{regions:?}");
    let (text, shape) = (&regions[0], &regions[1]);
    assert_eq!((text.shape, text.link.as_str()), (2, "#slide=257"));
    assert_eq!((shape.shape, shape.link.as_str()), (2, "https://macro.com"));
    // The shape region is the text box: 3,000,000 EMU wide at the origin,
    // shrunk to its one line of text.
    let [x0, y0, x1, _, _, y2, ..] = shape.quad;
    assert!(x0.abs() < 0.01 && y0.abs() < 0.01, "{:?}", shape.quad);
    assert!((x1 - 236.22).abs() < 0.1 && y2 > 20.0, "{:?}", shape.quad);
    // "there" sits inside the box, right of "Go ", on one line.
    let [tx0, ty0, tx1, ty1, ..] = text.quad;
    assert!(tx0 > 10.0 && tx1 > tx0 && tx1 < x1, "{:?}", text.quad);
    assert!((ty1 - ty0).abs() < 0.01 && ty0 >= 0.0, "{:?}", text.quad);
    assert!(text.quad[5] <= y2 + 0.01, "{:?}", text.quad);

    // Hidden shapes have no clickable areas.
    pres.apply(
        &[EditOp::SetShapeHidden {
            slide: 256,
            shape: 2,
            hidden: true,
        }],
        fonts(),
    )
    .unwrap();
    assert!(pres.link_regions(0, fonts()).unwrap().is_empty());
}
