use super::*;
use crate::opc::rel_type;
use crate::test_support::{deck, deck_with_media, fonts, text_box};
use crate::xml::Ns;
use base64::Engine;

fn para(text: &str) -> String {
    format!("<a:p><a:r><a:rPr lang=\"en-US\" b=\"1\" sz=\"2000\"/><a:t>{text}</a:t></a:r></a:p>")
}

fn open(slides: &[&str]) -> Presentation {
    Presentation::open(deck(slides)).unwrap()
}

/// Text of a shape's paragraphs (or of a table cell).
fn shape_text(pres: &mut Presentation, slide: u32, shape: u32) -> String {
    let part = pres.slide_part(slide).unwrap();
    let doc = pres.xml(&part).unwrap();
    let node = shapes::find(&doc, shape).unwrap();
    let body = doc
        .children(node)
        .find(|&c| doc.local(c) == "txBody")
        .unwrap();
    text::paragraphs(&doc, body)
        .iter()
        .map(|&p| text::para_text(&doc, p))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Saves, reopens, and checks package integrity.
fn assert_integrity(pres: &mut Presentation) {
    let bytes = pres.save().unwrap();
    let mut reopened = Presentation::open(bytes).unwrap();
    let problems = reopened.integrity_problems().unwrap();
    assert!(problems.is_empty(), "{problems:#?}");
}

fn apply(pres: &mut Presentation, ops: Vec<EditOp>) -> EditResult {
    pres.apply(&ops, fonts()).unwrap()
}

const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

#[test]
fn insert_and_delete_text_across_runs_and_paragraphs() {
    let mut pres = open(&[&text_box(
        2,
        0,
        0,
        3_000_000,
        1_000_000,
        &(para("Hello") + &para("World")),
    )]);
    apply(
        &mut pres,
        vec![EditOp::InsertText {
            slide: 256,
            shape: 2,
            cell: None,
            at: TextPos {
                paragraph: 0,
                offset: 5,
            },
            text: ", big".into(),
        }],
    );
    assert_eq!(shape_text(&mut pres, 256, 2), "Hello, big\nWorld");
    // Splitting a paragraph keeps formatting on both halves.
    apply(
        &mut pres,
        vec![EditOp::InsertText {
            slide: 256,
            shape: 2,
            cell: None,
            at: TextPos {
                paragraph: 0,
                offset: 6,
            },
            text: "\nthe".into(),
        }],
    );
    assert_eq!(shape_text(&mut pres, 256, 2), "Hello,\nthe big\nWorld");
    // Deleting across a paragraph boundary joins paragraphs.
    apply(
        &mut pres,
        vec![EditOp::DeleteText {
            slide: 256,
            shape: 2,
            cell: None,
            start: TextPos {
                paragraph: 1,
                offset: 3,
            },
            end: TextPos {
                paragraph: 2,
                offset: 0,
            },
        }],
    );
    assert_eq!(shape_text(&mut pres, 256, 2), "Hello,\ntheWorld");
    let part = pres.slide_part(256).unwrap();
    let xml = String::from_utf8(pres.pkg.read(&part).unwrap().into_owned()).unwrap();
    assert!(xml.contains("b=\"1\""), "run formatting survives: {xml}");
    assert_integrity(&mut pres);
}

#[test]
fn line_breaks_count_as_one_character() {
    let mut pres = open(&[&text_box(2, 0, 0, 3_000_000, 1_000_000, &para("ab"))]);
    apply(
        &mut pres,
        vec![EditOp::InsertText {
            slide: 256,
            shape: 2,
            cell: None,
            at: TextPos {
                paragraph: 0,
                offset: 1,
            },
            text: "\u{b}".into(),
        }],
    );
    assert_eq!(shape_text(&mut pres, 256, 2), "a\u{b}b");
    apply(
        &mut pres,
        vec![EditOp::InsertText {
            slide: 256,
            shape: 2,
            cell: None,
            at: TextPos {
                paragraph: 0,
                offset: 3,
            },
            text: "c".into(),
        }],
    );
    assert_eq!(shape_text(&mut pres, 256, 2), "a\u{b}bc");
}

#[test]
fn format_text_splits_runs_and_formats_only_the_range() {
    let mut pres = open(&[&text_box(
        2,
        0,
        0,
        3_000_000,
        1_000_000,
        &para("Hello World"),
    )]);
    let props = RunPatch {
        italic: Some(true),
        color: Some("FF0000".into()),
        ..RunPatch::default()
    };
    apply(
        &mut pres,
        vec![EditOp::FormatText {
            slide: 256,
            shape: 2,
            cell: None,
            start: Some(TextPos {
                paragraph: 0,
                offset: 6,
            }),
            end: Some(TextPos {
                paragraph: 0,
                offset: 11,
            }),
            props,
        }],
    );
    let part = pres.slide_part(256).unwrap();
    let doc = pres.xml(&part).unwrap();
    let runs: Vec<_> = doc
        .descendants(doc.root())
        .into_iter()
        .filter(|&n| doc.local(n) == "r")
        .collect();
    assert_eq!(runs.len(), 2);
    let italic: Vec<bool> = runs
        .iter()
        .map(|&r| {
            doc.child(r, Ns::A, "rPr")
                .and_then(|p| doc.attr_bool(p, "i"))
                .unwrap_or(false)
        })
        .collect();
    assert_eq!(italic, vec![false, true]);
    assert_eq!(shape_text(&mut pres, 256, 2), "Hello World");
}

#[test]
fn hyperlinks_add_and_prune_relationships() {
    let mut pres = open(&[&text_box(2, 0, 0, 3_000_000, 1_000_000, &para("Link"))]);
    let link = |url: &str| RunPatch {
        link: Some(url.into()),
        ..RunPatch::default()
    };
    apply(
        &mut pres,
        vec![EditOp::FormatText {
            slide: 256,
            shape: 2,
            cell: None,
            start: None,
            end: None,
            props: link("https://macro.com"),
        }],
    );
    let part = pres.slide_part(256).unwrap();
    let count = |p: &mut Presentation| {
        p.part_rels(&part)
            .unwrap()
            .iter()
            .filter(|r| r.rel_type == rel_type::HYPERLINK)
            .count()
    };
    assert_eq!(count(&mut pres), 1);
    assert_integrity(&mut pres);
    apply(
        &mut pres,
        vec![EditOp::FormatText {
            slide: 256,
            shape: 2,
            cell: None,
            start: None,
            end: None,
            props: link(""),
        }],
    );
    assert_eq!(count(&mut pres), 0);
}

#[test]
fn untouched_parts_keep_their_bytes() {
    let source = deck(&[
        &text_box(2, 0, 0, 3_000_000, 1_000_000, &para("A")),
        &text_box(2, 0, 0, 1, 1, &para("B")),
    ]);
    let mut pres = Presentation::open(source.clone()).unwrap();
    apply(
        &mut pres,
        vec![EditOp::SetText {
            slide: 256,
            shape: 2,
            cell: None,
            text: "Changed".into(),
        }],
    );
    let saved = pres.save().unwrap();
    let before = crate::opc::Package::open(source).unwrap();
    let after = crate::opc::Package::open(saved).unwrap();
    for name in before.part_names() {
        if name == "/ppt/slides/slide1.xml" {
            continue;
        }
        assert_eq!(
            before.read(name).unwrap(),
            after.read(name).unwrap(),
            "{name} changed"
        );
    }
    let slide =
        String::from_utf8(after.read("/ppt/slides/slide1.xml").unwrap().into_owned()).unwrap();
    assert!(slide.contains("Changed"));
}

#[test]
fn failed_batches_roll_back() {
    let mut pres = open(&[&text_box(2, 0, 0, 3_000_000, 1_000_000, &para("Keep"))]);
    let ops = vec![
        EditOp::SetText {
            slide: 256,
            shape: 2,
            cell: None,
            text: "Gone".into(),
        },
        EditOp::DeleteShape {
            slide: 256,
            shape: 99,
        },
    ];
    assert!(matches!(pres.apply(&ops, fonts()), Err(Error::NotFound(_))));
    assert_eq!(shape_text(&mut pres, 256, 2), "Keep");
    assert!(!pres.pkg.is_modified("/ppt/slides/slide1.xml"));
}

#[test]
fn undo_redo_and_typing_groups() {
    let mut ed = Editor::new(open(&[&text_box(
        2,
        0,
        0,
        3_000_000,
        1_000_000,
        &para("A"),
    )]));
    for (i, ch) in ["b", "c", "d"].iter().enumerate() {
        let op = EditOp::InsertText {
            slide: 256,
            shape: 2,
            cell: None,
            at: TextPos {
                paragraph: 0,
                offset: 1 + i,
            },
            text: (*ch).into(),
        };
        let r = ed.apply(&[op], Some("typing"), fonts()).unwrap();
        assert_eq!(r.changed_slides, vec![256]);
    }
    ed.apply(
        &[EditOp::SetTransform {
            slide: 256,
            shape: 2,
            x: Some(10.0),
            y: None,
            w: None,
            h: None,
            rotation: None,
            flip_h: None,
            flip_v: None,
        }],
        None,
        fonts(),
    )
    .unwrap();
    assert_eq!(shape_text(ed.presentation_mut(), 256, 2), "Abcd");
    // The move is one step, the typing burst another.
    ed.undo().unwrap();
    assert_eq!(shape_text(ed.presentation_mut(), 256, 2), "Abcd");
    let r = ed.undo().unwrap();
    assert_eq!(r.changed_slides, vec![256]);
    assert_eq!(shape_text(ed.presentation_mut(), 256, 2), "A");
    assert!(!ed.can_undo());
    ed.redo().unwrap();
    assert_eq!(shape_text(ed.presentation_mut(), 256, 2), "Abcd");
    assert!(ed.can_redo());
}

#[test]
fn shapes_add_move_duplicate_reorder_delete() {
    let mut pres = open(&[&text_box(2, 0, 0, 3_000_000, 1_000_000, &para("A"))]);
    let r = apply(
        &mut pres,
        vec![
            EditOp::AddShape {
                slide: 256,
                shape: NewShape::Shape {
                    preset: "roundRect".into(),
                    text: "Box".into(),
                },
                x: 100.0,
                y: 100.0,
                w: 200.0,
                h: 100.0,
            },
            EditOp::AddShape {
                slide: 256,
                shape: NewShape::Line { arrow: true },
                x: 0.0,
                y: 0.0,
                w: 100.0,
                h: 0.0,
            },
            EditOp::AddShape {
                slide: 256,
                shape: NewShape::TextBox {
                    text: "Note".into(),
                },
                x: 10.0,
                y: 300.0,
                w: 300.0,
                h: 40.0,
            },
        ],
    );
    let ids: Vec<u32> = r.created.iter().filter_map(|c| c.shape).collect();
    assert_eq!(ids, vec![3, 4, 5]);
    assert_eq!(shape_text(&mut pres, 256, 3), "Box");
    let r = apply(
        &mut pres,
        vec![EditOp::DuplicateShape {
            slide: 256,
            shape: 3,
            dx: 20.0,
            dy: 20.0,
        }],
    );
    let copy = r.created[0].shape.unwrap();
    assert_eq!(copy, 6);
    let x = shapes::effective_xfrm(&mut pres, "/ppt/slides/slide1.xml", copy).unwrap();
    assert!(
        (x.x - 120.0).abs() < 0.01 && (x.y - 120.0).abs() < 0.01,
        "{x:?}"
    );
    apply(
        &mut pres,
        vec![
            EditOp::SetTransform {
                slide: 256,
                shape: 3,
                x: Some(50.0),
                y: None,
                w: Some(80.0),
                h: None,
                rotation: Some(30.0),
                flip_h: Some(true),
                flip_v: None,
            },
            EditOp::SetFill {
                slide: 256,
                shape: 3,
                fill: FillSpec::Gradient {
                    colors: vec!["accent1".into(), "FFFFFF".into()],
                    angle: 90.0,
                },
            },
            EditOp::SetLine {
                slide: 256,
                shape: 3,
                line: LinePatch {
                    width: Some(3.0),
                    dash: Some("dash".into()),
                    ..LinePatch::default()
                },
            },
            EditOp::SetGeometry {
                slide: 256,
                shape: 3,
                preset: "ellipse".into(),
            },
            EditOp::ReorderShape {
                slide: 256,
                shape: 3,
                to: ZOrder::Back,
            },
        ],
    );
    let x = shapes::effective_xfrm(&mut pres, "/ppt/slides/slide1.xml", 3).unwrap();
    assert!(
        (x.x - 50.0).abs() < 0.01
            && (x.w - 80.0).abs() < 0.01
            && (x.rot - 30.0).abs() < 0.01
            && x.flip_h
    );
    let doc = pres.xml("/ppt/slides/slide1.xml").unwrap();
    let tree = crate::model::shape::sp_tree(&doc).unwrap();
    let order: Vec<i64> = doc
        .children(tree)
        .filter_map(|c| crate::model::shape::c_nv_pr(&doc, c).and_then(|p| doc.attr_i64(p, "id")))
        .collect();
    assert_eq!(
        order,
        vec![1, 3, 2, 6, 4, 5]
            .into_iter()
            .filter(|&i| i != 1)
            .collect::<Vec<_>>()
    );
    apply(
        &mut pres,
        vec![EditOp::DeleteShape {
            slide: 256,
            shape: 6,
        }],
    );
    let doc = pres.xml("/ppt/slides/slide1.xml").unwrap();
    assert!(xmlutil::find_shape(&doc, 6).is_none());
    assert!(matches!(
        pres.apply(
            &[EditOp::SetGeometry {
                slide: 256,
                shape: 3,
                preset: "nope".into()
            }],
            fonts()
        ),
        Err(Error::InvalidEdit(_))
    ));
    assert_integrity(&mut pres);
}

#[test]
fn pictures_are_stored_deduplicated_and_collected() {
    let mut pres = open(&[&text_box(2, 0, 0, 3_000_000, 1_000_000, &para("A"))]);
    let r = apply(
        &mut pres,
        vec![
            EditOp::AddShape {
                slide: 256,
                shape: NewShape::Image {
                    data: PNG_1X1.into(),
                    description: "dot".into(),
                },
                x: 0.0,
                y: 0.0,
                w: 0.0,
                h: 0.0,
            },
            EditOp::AddShape {
                slide: 256,
                shape: NewShape::Image {
                    data: PNG_1X1.into(),
                    description: "dot".into(),
                },
                x: 50.0,
                y: 0.0,
                w: 10.0,
                h: 0.0,
            },
        ],
    );
    let media: Vec<String> = pres
        .pkg
        .part_names()
        .filter(|n| n.starts_with("/ppt/media/"))
        .map(str::to_owned)
        .collect();
    assert_eq!(media.len(), 1, "identical pictures share a part");
    let first = r.created[0].shape.unwrap();
    let x = shapes::effective_xfrm(&mut pres, "/ppt/slides/slide1.xml", first).unwrap();
    assert!((x.w - 0.75).abs() < 0.01, "natural size at 96 dpi: {x:?}");
    let second = r.created[1].shape.unwrap();
    let x = shapes::effective_xfrm(&mut pres, "/ppt/slides/slide1.xml", second).unwrap();
    assert!((x.h - 10.0).abs() < 0.01, "aspect ratio kept: {x:?}");
    assert_integrity(&mut pres);
    apply(
        &mut pres,
        vec![
            EditOp::DeleteShape {
                slide: 256,
                shape: first,
            },
            EditOp::DeleteShape {
                slide: 256,
                shape: second,
            },
        ],
    );
    assert!(
        !pres.pkg.has_part(&media[0]),
        "the unused picture part is removed"
    );
    assert_integrity(&mut pres);
}

#[test]
fn replace_image_swaps_the_blip() {
    let png: Vec<u8> = base64::engine::general_purpose::STANDARD
        .decode(PNG_1X1)
        .unwrap();
    let pic = r#"<p:pic><p:nvPicPr><p:cNvPr id="2" name="Picture 1"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId10"><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"/></a:extLst></a:blip><a:srcRect l="10000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>"#;
    let mut pres = Presentation::open(deck_with_media(&[pic], &[("old.png", &png)])).unwrap();
    let mut other = png.clone();
    other.extend_from_slice(b"trailing bytes make a different file");
    let data = base64::engine::general_purpose::STANDARD.encode(&other);
    apply(
        &mut pres,
        vec![EditOp::ReplaceImage {
            slide: 256,
            shape: 2,
            data,
        }],
    );
    let doc = pres.xml("/ppt/slides/slide1.xml").unwrap();
    let blip = doc
        .descendants(doc.root())
        .into_iter()
        .find(|&n| doc.local(n) == "blip")
        .unwrap();
    assert_ne!(doc.attr_ns(blip, Ns::R, "embed"), Some("rId10"));
    assert!(doc.child(blip, Ns::A, "extLst").is_none());
    assert!(
        !doc.descendants(doc.root())
            .iter()
            .any(|&n| doc.local(n) == "srcRect")
    );
    assert!(
        !pres.pkg.has_part("/ppt/media/old.png"),
        "the replaced picture is collected"
    );
    assert_integrity(&mut pres);
}

#[test]
fn slides_add_duplicate_move_delete() {
    let mut pres = open(&[
        &text_box(2, 0, 0, 3_000_000, 1_000_000, &para("One")),
        &text_box(2, 0, 0, 1, 1, &para("Two")),
    ]);
    let r = apply(
        &mut pres,
        vec![EditOp::AddSlide {
            layout: Some("Title and Content".into()),
            after: Some(256),
            title: Some("New".into()),
            body: Some("a\nb".into()),
        }],
    );
    let added = r.created[0].slide;
    assert!(r.structure_changed);
    assert_eq!(
        pres.slides().iter().map(|s| s.id).collect::<Vec<_>>(),
        vec![256, added, 257]
    );
    apply(
        &mut pres,
        vec![EditOp::SetNotes {
            slide: added,
            text: "Speaker notes".into(),
        }],
    );
    assert_eq!(
        notes_text(&mut pres, added).unwrap().as_deref(),
        Some("Speaker notes")
    );
    let r = apply(&mut pres, vec![EditOp::DuplicateSlide { slide: added }]);
    let dup = r.created[0].slide;
    assert_eq!(
        pres.slides().iter().map(|s| s.id).collect::<Vec<_>>(),
        vec![256, added, dup, 257]
    );
    assert_eq!(
        notes_text(&mut pres, dup).unwrap().as_deref(),
        Some("Speaker notes")
    );
    // Editing the copy's notes leaves the original alone.
    apply(
        &mut pres,
        vec![EditOp::SetNotes {
            slide: dup,
            text: "Copy".into(),
        }],
    );
    assert_eq!(
        notes_text(&mut pres, added).unwrap().as_deref(),
        Some("Speaker notes")
    );
    apply(&mut pres, vec![EditOp::MoveSlide { slide: 256, to: 3 }]);
    assert_eq!(
        pres.slides().iter().map(|s| s.id).collect::<Vec<_>>(),
        vec![added, dup, 257, 256]
    );
    assert_integrity(&mut pres);
    let parts_before = pres.pkg.part_names().count();
    apply(&mut pres, vec![EditOp::DeleteSlide { slide: dup }]);
    assert_eq!(pres.slides().len(), 3);
    // The slide, its rels, and its notes slide (and rels) are gone.
    assert_eq!(pres.pkg.part_names().count(), parts_before - 4);
    assert_integrity(&mut pres);
    apply(
        &mut pres,
        vec![
            EditOp::SetSlideHidden {
                slide: 257,
                hidden: true,
            },
            EditOp::SetBackground {
                slide: 257,
                fill: Some(FillSpec::Solid {
                    color: "112233".into(),
                    alpha: None,
                }),
            },
        ],
    );
    assert_integrity(&mut pres);
}

#[test]
fn tables_insert_and_delete_rows_and_columns() {
    let mut pres = open(&[&text_box(2, 0, 0, 3_000_000, 1_000_000, &para("A"))]);
    let cells = vec![
        vec!["Revenue".to_owned(), "100".to_owned()],
        vec!["Cost".to_owned(), "60".to_owned()],
    ];
    let r = apply(
        &mut pres,
        vec![EditOp::AddShape {
            slide: 256,
            shape: NewShape::Table { cells },
            x: 50.0,
            y: 50.0,
            w: 400.0,
            h: 80.0,
        }],
    );
    let t = r.created[0].shape.unwrap();
    apply(
        &mut pres,
        vec![
            EditOp::InsertTableRow {
                slide: 256,
                shape: t,
                at: 2,
            },
            EditOp::SetCellText {
                slide: 256,
                shape: t,
                row: 2,
                col: 0,
                text: "Profit".into(),
            },
            EditOp::InsertTableColumn {
                slide: 256,
                shape: t,
                at: 1,
            },
            EditOp::SetCellText {
                slide: 256,
                shape: t,
                row: 0,
                col: 1,
                text: "Q1".into(),
            },
        ],
    );
    let read = |pres: &mut Presentation, row: usize, col: usize| {
        let doc = pres.xml("/ppt/slides/slide1.xml").unwrap();
        let mut d = (*doc).clone();
        let frame = shapes::find(&d, t).unwrap();
        let body = table::cell_body(&mut d, frame, CellRef { row, col }).unwrap();
        text::paragraphs(&d, body)
            .iter()
            .map(|&p| text::para_text(&d, p))
            .collect::<Vec<_>>()
            .join("\n")
    };
    assert_eq!(read(&mut pres, 2, 0), "Profit");
    assert_eq!(read(&mut pres, 0, 1), "Q1");
    assert_eq!(read(&mut pres, 0, 2), "100");
    let x = shapes::effective_xfrm(&mut pres, "/ppt/slides/slide1.xml", t).unwrap();
    assert!(
        (x.w - 600.0).abs() < 0.1 && (x.h - 120.0).abs() < 0.1,
        "{x:?}"
    );
    apply(
        &mut pres,
        vec![
            EditOp::DeleteTableRow {
                slide: 256,
                shape: t,
                row: 0,
            },
            EditOp::DeleteTableColumn {
                slide: 256,
                shape: t,
                col: 0,
            },
        ],
    );
    assert_eq!(read(&mut pres, 0, 1), "60");
    assert!(matches!(
        pres.apply(
            &[EditOp::DeleteTableColumn {
                slide: 256,
                shape: t,
                col: 5
            }],
            fonts()
        ),
        Err(Error::InvalidEdit(_))
    ));
    assert_integrity(&mut pres);
}

#[test]
fn shrink_on_overflow_recomputes_font_scale() {
    // A body placeholder inheriting normAutofit from the master.
    let ph = r#"<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Short</a:t></a:r></a:p></p:txBody></p:sp>"#;
    let mut pres = open(&[ph]);
    let long = (0..30)
        .map(|i| format!("Bullet point number {i}"))
        .collect::<Vec<_>>()
        .join("\n");
    apply(
        &mut pres,
        vec![EditOp::SetText {
            slide: 256,
            shape: 3,
            cell: None,
            text: long,
        }],
    );
    let doc = pres.xml("/ppt/slides/slide1.xml").unwrap();
    let fit = doc
        .descendants(doc.root())
        .into_iter()
        .find(|&n| doc.local(n) == "normAutofit")
        .expect("normAutofit written");
    let scale = doc.attr_i64(fit, "fontScale").unwrap();
    assert!(scale < 100_000, "scale {scale}");
    apply(
        &mut pres,
        vec![EditOp::SetText {
            slide: 256,
            shape: 3,
            cell: None,
            text: "Short again".into(),
        }],
    );
    let doc = pres.xml("/ppt/slides/slide1.xml").unwrap();
    let fit = doc
        .descendants(doc.root())
        .into_iter()
        .find(|&n| doc.local(n) == "normAutofit")
        .unwrap();
    assert_eq!(doc.attr(fit, "fontScale"), None);
}

#[test]
fn text_boxes_grow_to_fit() {
    let mut pres = open(&[&text_box(2, 0, 0, 3_000_000, 300_000, &para("One line"))]);
    let before = shapes::effective_xfrm(&mut pres, "/ppt/slides/slide1.xml", 2).unwrap();
    apply(
        &mut pres,
        vec![EditOp::SetText {
            slide: 256,
            shape: 2,
            cell: None,
            text: "One\nTwo\nThree\nFour".into(),
        }],
    );
    let after = shapes::effective_xfrm(&mut pres, "/ppt/slides/slide1.xml", 2).unwrap();
    assert!(after.h > before.h * 2.5, "{before:?} → {after:?}");
}

#[test]
fn ops_round_trip_through_json() {
    let json = r#"[{"op":"insertText","slide":256,"shape":2,"at":{"paragraph":0,"offset":1},"text":"x"},
        {"op":"formatText","slide":256,"shape":2,"props":{"bold":true}},
        {"op":"setFill","slide":256,"shape":2,"fill":{"kind":"solid","color":"accent2"}},
        {"op":"addShape","slide":256,"shape":{"kind":"shape","preset":"rect"},"x":1,"y":2,"w":3,"h":4}]"#;
    let ops: Vec<EditOp> = serde_json::from_str(json).unwrap();
    assert_eq!(ops.len(), 4);
    let mut pres = open(&[&text_box(2, 0, 0, 3_000_000, 1_000_000, &para("A"))]);
    let r = apply(&mut pres, ops);
    assert_eq!(serde_json::to_value(&r).unwrap()["created"][0]["shape"], 3);
}

#[test]
fn ops_read_null_as_omitted_and_reject_unknown_fields() {
    let op: EditOp = serde_json::from_str(
        r#"{"op":"addShape","slide":256,"shape":{"kind":"textBox","text":null},"x":1,"y":2,"w":3,"h":4}"#,
    )
    .unwrap();
    assert!(
        matches!(op, EditOp::AddShape { shape: NewShape::TextBox { ref text }, .. } if text.is_empty())
    );
    let op: EditOp =
        serde_json::from_str(r#"{"op":"duplicateShape","slide":256,"shape":2,"dx":null,"dy":12}"#)
            .unwrap();
    assert!(matches!(op, EditOp::DuplicateShape { dx, dy, .. } if dx == 0.0 && dy == 12.0));
    let op: EditOp = serde_json::from_str(
        r#"{"op":"setLine","slide":256,"shape":2,"line":{"none":null,"color":"FF0000","width":null,"dash":null,"tail":null,"head":null}}"#,
    )
    .unwrap();
    assert!(
        matches!(op, EditOp::SetLine { ref line, .. } if !line.none && line.color.as_deref() == Some("FF0000"))
    );
    let op: EditOp = serde_json::from_str(
        r#"{"op":"formatParagraphs","slide":256,"shape":2,"cell":null,"from":null,"to":null,"props":{"bullet":{"kind":"number","scheme":"arabicPeriod","start":null}}}"#,
    )
    .unwrap();
    assert!(
        matches!(op, EditOp::FormatParagraphs { ref props, .. } if props.bullet == Some(BulletSpec::Number { scheme: "arabicPeriod".into(), start: 1 }))
    );

    let misspelled = serde_json::from_str::<EditOp>(
        r#"{"op":"formatText","slide":256,"shape":2,"props":{"fontSize":12}}"#,
    );
    assert!(misspelled.unwrap_err().to_string().contains("fontSize"));
    let stray = serde_json::from_str::<EditOp>(
        r#"{"op":"deleteShape","slide":256,"shape":2,"slideNumber":1}"#,
    );
    assert!(stray.is_err());
}

#[test]
fn op_fields_are_camel_case() {
    let op: EditOp =
        serde_json::from_str(r#"{"op":"setTransform","slide":256,"shape":2,"flipH":true}"#)
            .unwrap();
    assert!(
        matches!(
            op,
            EditOp::SetTransform {
                flip_h: Some(true),
                flip_v: None,
                ..
            }
        ),
        "{op:?}"
    );
    let json = serde_json::to_value(&op).unwrap();
    assert_eq!(json["flipH"], true);
}

#[test]
fn edits_land_on_the_rendered_alternate_content_branch() {
    let choice = text_box(7, 0, 0, 3_000_000, 1_000_000, &para("Choice"));
    let fallback = text_box(7, 0, 0, 3_000_000, 1_000_000, &para("Fallback"));
    let slide = format!(
        r#"<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><mc:Choice Requires="p14">{choice}</mc:Choice><mc:Fallback>{fallback}</mc:Fallback></mc:AlternateContent>"#
    );
    let mut pres = open(&[&slide]);
    apply(
        &mut pres,
        vec![EditOp::SetText {
            slide: 256,
            shape: 7,
            cell: None,
            text: "Edited".into(),
        }],
    );
    let outline = pres.outline().unwrap();
    let shape = &outline.slides[0].shapes[0];
    assert_eq!(shape.paragraphs[0].text, "Edited");
    let part = pres.slide_part(256).unwrap();
    let doc = pres.xml(&part).unwrap();
    let text_of = |branch: &str| {
        let node = doc
            .descendants(doc.root())
            .into_iter()
            .find(|&n| doc.local(n) == branch)
            .unwrap();
        doc.descendants(node)
            .into_iter()
            .filter(|&n| doc.local(n) == "t")
            .map(|n| doc.text(n))
            .collect::<String>()
    };
    assert_eq!(text_of("Choice"), "Edited");
    assert_eq!(text_of("Fallback"), "Fallback");
    assert_integrity(&mut pres);
}
