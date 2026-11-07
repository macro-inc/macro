use super::*;
use crate::collab::Entries;
use crate::edit::{EditOp, EditResult, NewShape};
use crate::inspect::{ShapeKindName, ShapeOutline, SlideOutline};
use crate::opc::content_type;
use crate::test_support::{deck, fonts, text_box};

const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const SLIDE: u32 = 256;

fn corpus(name: &str) -> Presentation {
    let path = format!(
        "{}/tests/corpus/generated/{name}.pptx",
        env!("CARGO_MANIFEST_DIR")
    );
    Presentation::open(std::fs::read(path).unwrap()).unwrap()
}

fn para(text: &str) -> String {
    format!("<a:p><a:r><a:rPr lang=\"en-US\" sz=\"2000\"/><a:t>{text}</a:t></a:r></a:p>")
}

fn blank() -> Presentation {
    Presentation::open(deck(&[&text_box(
        2,
        0,
        0,
        1_270_000,
        635_000,
        &para("Destination"),
    )]))
    .unwrap()
}

fn apply(pres: &mut Presentation, ops: Vec<EditOp>) -> EditResult {
    pres.apply(&ops, fonts()).unwrap()
}

fn json(payload: &ClipboardPayload) -> String {
    serde_json::to_string(payload).unwrap()
}

fn paste(pres: &mut Presentation, payload: &ClipboardPayload, dx: f32, dy: f32) -> Vec<u32> {
    let r = apply(
        pres,
        vec![EditOp::PasteShapes {
            slide: pres.slides()[0].id,
            payload: json(payload),
            dx,
            dy,
        }],
    );
    r.created.iter().filter_map(|c| c.shape).collect()
}

fn assert_integrity(pres: &mut Presentation) {
    let mut reopened = Presentation::open(pres.save().unwrap()).unwrap();
    let problems = reopened.integrity_problems().unwrap();
    assert!(problems.is_empty(), "{problems:#?}");
}

fn shape(s: &SlideOutline, id: u32) -> &ShapeOutline {
    s.shapes
        .iter()
        .find(|x| x.id == id)
        .unwrap_or_else(|| panic!("shape {id} in {:?}", s.shapes))
}

fn parts_under(pres: &Presentation, prefix: &str) -> Vec<String> {
    pres.package()
        .part_names()
        .filter(|n| n.starts_with(prefix) && !n.ends_with(".rels"))
        .map(str::to_owned)
        .collect()
}

fn close(a: f32, b: f32) -> bool {
    (a - b).abs() < 0.05
}

/// A deck with a picture, a hyperlinked text box, and a group.
fn source() -> Presentation {
    let mut pres = blank();
    apply(
        &mut pres,
        vec![
            EditOp::AddShape {
                slide: SLIDE,
                shape: NewShape::Image {
                    data: PNG_1X1.into(),
                    description: "dot".into(),
                },
                x: 300.0,
                y: 100.0,
                w: 40.0,
                h: 40.0,
            },
            EditOp::AddShape {
                slide: SLIDE,
                shape: NewShape::TextBox {
                    text: "Linked".into(),
                },
                x: 50.0,
                y: 200.0,
                w: 120.0,
                h: 30.0,
            },
            EditOp::FormatText {
                slide: SLIDE,
                shape: 4,
                cell: None,
                start: None,
                end: None,
                props: crate::edit::RunPatch {
                    link: Some("https://macro.com/".into()),
                    ..Default::default()
                },
            },
            EditOp::AddShape {
                slide: SLIDE,
                shape: NewShape::Shape {
                    preset: "ellipse".into(),
                    text: String::new(),
                },
                x: 400.0,
                y: 300.0,
                w: 50.0,
                h: 50.0,
            },
            EditOp::AddShape {
                slide: SLIDE,
                shape: NewShape::Shape {
                    preset: "rect".into(),
                    text: "Grouped".into(),
                },
                x: 500.0,
                y: 300.0,
                w: 80.0,
                h: 50.0,
            },
            EditOp::GroupShapes {
                slide: SLIDE,
                shapes: vec![5, 6],
            },
        ],
    );
    pres
}

#[test]
fn shapes_paste_into_the_same_slide_with_fresh_ids_and_shared_media() {
    let mut pres = source();
    let before = pres.slide_outline(0).unwrap();
    let payload = pres.copy_shapes(0, &[7, 3, 4]).unwrap();
    // Back to front, with the picture's part and the link's target.
    assert_eq!(payload.shapes.len(), 3);
    assert!(payload.shapes[0].contains("<p:pic"));
    assert_eq!(payload.parts.len(), 1);
    assert!(
        payload
            .rels
            .iter()
            .any(|r| r.external && r.target == "https://macro.com/")
    );
    assert_eq!(payload.theme_colors.len(), 12);
    let media = parts_under(&pres, "/ppt/media/");

    let created = paste(&mut pres, &payload, 10.0, 20.0);
    assert_eq!(created.len(), 3);
    let after = pres.slide_outline(0).unwrap();
    assert_eq!(after.shapes.len(), before.shapes.len() + 3);
    let old_ids: Vec<u32> = before.shapes.iter().map(|s| s.id).collect();
    for (&new, old) in created.iter().zip([3, 4, 7]) {
        assert!(!old_ids.contains(&new));
        let (a, b) = (shape(&after, new), shape(&before, old));
        assert!(close(a.x, b.x + 10.0) && close(a.y, b.y + 20.0), "{a:?}");
        assert_eq!(a.kind, b.kind);
    }
    // Group members get fresh ids too.
    let group = shape(&after, created[2]);
    assert_eq!(group.children.len(), 2);
    let all: Vec<u32> = after
        .shapes
        .iter()
        .flat_map(|s| std::iter::once(s.id).chain(s.children.iter().map(|c| c.id)))
        .collect();
    let mut unique = all.clone();
    unique.sort_unstable();
    unique.dedup();
    assert_eq!(unique.len(), all.len(), "{all:?}");
    // The identical picture is shared, the hyperlink kept.
    assert_eq!(parts_under(&pres, "/ppt/media/"), media);
    let rels = pres.part_rels("/ppt/slides/slide1.xml").unwrap();
    assert_eq!(
        rels.iter()
            .filter(|r| r.rel_type == rel_type::HYPERLINK)
            .count(),
        1,
        "the same link is reused"
    );
    assert_eq!(shape(&after, created[1]).paragraphs[0].text, "Linked");
    assert_integrity(&mut pres);
}

#[test]
fn shapes_paste_into_another_deck_with_their_parts() {
    let mut from = source();
    let payload = from.copy_shapes(0, &[3, 4]).unwrap();
    let mut to = Presentation::open(deck(&[
        &text_box(2, 0, 0, 100, 100, &para("One")),
        &text_box(2, 0, 0, 100, 100, &para("Two")),
    ]))
    .unwrap();
    let r = apply(
        &mut to,
        vec![EditOp::PasteShapes {
            slide: 257,
            payload: json(&payload),
            dx: 0.0,
            dy: 0.0,
        }],
    );
    assert_eq!(r.changed_slides, vec![257]);
    let pasted: Vec<u32> = r.created.iter().filter_map(|c| c.shape).collect();
    let slide = to.slide_outline(1).unwrap();
    assert_eq!(shape(&slide, pasted[0]).kind, ShapeKindName::Picture);
    assert_eq!(shape(&slide, pasted[0]).alt_text, "dot");
    assert_eq!(parts_under(&to, "/ppt/media/").len(), 1);
    let rels = to.part_rels("/ppt/slides/slide2.xml").unwrap();
    assert!(
        rels.iter()
            .any(|r| r.rel_type == rel_type::HYPERLINK && r.target == "https://macro.com/")
    );
    // Pasting again shares the picture part.
    apply(
        &mut to,
        vec![EditOp::PasteShapes {
            slide: 256,
            payload: json(&payload),
            dx: 0.0,
            dy: 0.0,
        }],
    );
    assert_eq!(parts_under(&to, "/ppt/media/").len(), 1);
    assert_integrity(&mut to);
}

#[test]
fn charts_travel_with_their_workbooks() {
    let mut from = corpus("charts-basic");
    let charts: Vec<u32> = from.slide_outline(0).unwrap().shapes[1..]
        .iter()
        .map(|s| s.id)
        .collect();
    let payload = from.copy_shapes(0, &charts).unwrap();
    assert!(payload.parts.iter().any(|p| p.name.ends_with(".xlsx")));
    let mut to = blank();
    let charts_before = parts_under(&to, "/ppt/charts/").len();
    let pasted = paste(&mut to, &payload, 0.0, 0.0);
    assert_eq!(pasted.len(), 2);
    let slide = to.slide_outline(0).unwrap();
    for id in &pasted {
        assert_eq!(shape(&slide, *id).kind, ShapeKindName::Chart);
    }
    assert_eq!(parts_under(&to, "/ppt/charts/").len(), charts_before + 2);
    let workbooks = parts_under(&to, "/ppt/embeddings/");
    assert_eq!(workbooks.len(), 2, "{workbooks:?}");
    assert_eq!(
        to.package().content_type(&workbooks[0]),
        Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    );
    // Both charts draw in the new deck.
    let raster = to.render_slide(0, 480, fonts()).unwrap();
    let inked = raster
        .pixels
        .chunks_exact(4)
        .filter(|p| p[0] < 200 || p[1] < 200 || p[2] < 200)
        .count();
    assert!(inked > 5_000, "{inked}");
    assert_integrity(&mut to);
}

#[test]
fn placeholders_paste_as_shapes_that_look_the_same() {
    let mut from = corpus("placeholders-all-layouts");
    let source_slide = from.slide_outline(1).unwrap();
    let ids: Vec<u32> = source_slide.shapes.iter().map(|s| s.id).collect();
    let layouts: Vec<_> = ids
        .iter()
        .map(|&id| from.text_layout(1, id, None, fonts()).unwrap().unwrap())
        .collect();
    let payload = from.copy_shapes(1, &ids).unwrap();
    assert!(payload.shapes.iter().all(|s| !s.contains("<p:ph")));
    let mut to = blank();
    let pasted = paste(&mut to, &payload, 0.0, 0.0);
    let slide = to.slide_outline(0).unwrap();
    for ((new, old), old_layout) in pasted.iter().zip(&source_slide.shapes).zip(&layouts) {
        let s = shape(&slide, *new);
        assert_eq!(s.placeholder, None);
        assert_eq!(s.kind, ShapeKindName::Text);
        assert!(
            close(s.x, old.x) && close(s.y, old.y) && close(s.w, old.w) && close(s.h, old.h),
            "{s:?} vs {old:?}"
        );
        assert_eq!(s.paragraphs, old.paragraphs);
        // Same sizes, bullets, and line breaks as in the source deck (theme
        // fonts follow this deck's theme, as with PowerPoint's default paste).
        let index = to.slides().iter().position(|e| e.id == SLIDE).unwrap();
        let layout = to.text_layout(index, *new, None, fonts()).unwrap().unwrap();
        for (a, b) in layout.styles.iter().zip(&old_layout.styles) {
            assert_eq!((a.bullet, a.level, a.align), (b.bullet, b.level, b.align));
            assert!(
                close(a.end.size, b.end.size),
                "{} vs {}",
                a.end.size,
                b.end.size
            );
            for (ra, rb) in a.runs.iter().zip(&b.runs) {
                assert!(close(ra.size, rb.size));
                assert_eq!((ra.bold, &ra.color), (rb.bold, &rb.color));
            }
        }
        assert_eq!(layout.lines.len(), old_layout.lines.len());
    }
    assert_integrity(&mut to);
}

#[test]
fn group_members_copy_in_slide_space() {
    let member = r#"<p:sp><p:nvSpPr><p:cNvPr id="3" name="M"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2540000" cy="2540000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:grpFill/></p:spPr></p:sp>"#;
    let group = format!(
        r#"<p:grpSp><p:nvGrpSpPr><p:cNvPr id="2" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm rot="5400000"><a:off x="1270000" y="1270000"/><a:ext cx="1270000" cy="1270000"/><a:chOff x="0" y="0"/><a:chExt cx="2540000" cy="2540000"/></a:xfrm><a:solidFill><a:srgbClr val="FF8800"/></a:solidFill></p:grpSpPr>{member}</p:grpSp>"#
    );
    let mut from = Presentation::open(deck(&[&group])).unwrap();
    let member_outline = from.slide_outline(0).unwrap().shapes[0].children[0].clone();
    let payload = from.copy_shapes(0, &[3]).unwrap();
    let mut to = blank();
    let pasted = paste(&mut to, &payload, 0.0, 0.0);
    let slide = to.slide_outline(0).unwrap();
    let s = shape(&slide, pasted[0]);
    assert!(
        close(s.x, member_outline.x) && close(s.w, member_outline.w),
        "{s:?}"
    );
    assert!(close(s.rotation, 90.0));
    assert_eq!(s.fill.as_deref(), Some("#FF8800"));
    // Copying a group and one of its members copies the group once.
    let payload = from.copy_shapes(0, &[3, 2]).unwrap();
    assert_eq!(payload.shapes.len(), 1);
}

#[test]
fn slides_paste_across_decks_with_notes_and_layouts() {
    let mut from = corpus("placeholders-all-layouts");
    let ids: Vec<u32> = from.slides().iter().map(|s| s.id).collect();
    // Slide 2 uses "Title and Content", slide 4 "Two Content".
    apply(
        &mut from,
        vec![EditOp::SetNotes {
            slide: ids[1],
            text: "Speaker notes\nSecond line".into(),
        }],
    );
    let copied = [ids[3], ids[1]];
    let originals: Vec<SlideOutline> = [1, 3]
        .iter()
        .map(|&i| from.slide_outline(i).unwrap())
        .collect();
    let payload = from.copy_slides(&copied).unwrap();
    assert_eq!(payload.slides.len(), 2);
    assert_eq!(payload.slides[0].id, ids[1], "deck order");
    assert!(payload.slides[0].notes.is_some());

    let mut to = blank();
    let r = apply(
        &mut to,
        vec![EditOp::PasteSlides {
            after: None,
            payload: json(&payload),
        }],
    );
    assert!(r.structure_changed);
    let new: Vec<u32> = r.created.iter().map(|c| c.slide).collect();
    assert_eq!(new.len(), 2);
    assert_eq!(
        to.slides().iter().map(|s| s.id).collect::<Vec<_>>(),
        [vec![SLIDE], new.clone()].concat()
    );
    let pasted: Vec<SlideOutline> = (1..3).map(|i| to.slide_outline(i).unwrap()).collect();
    // Same layout name: placeholders take its positions; text and notes come along.
    assert_eq!(pasted[0].layout, "Title and Content");
    assert_eq!(pasted[0].title, originals[0].title);
    assert_eq!(
        pasted[0].notes.as_deref(),
        Some("Speaker notes\nSecond line")
    );
    assert_eq!(
        pasted[0].shapes[1].paragraphs,
        originals[0].shapes[1].paragraphs
    );
    // No "Two Content" here: the fallback layout's placeholders bind, and the
    // second content placeholder keeps the place it had.
    assert_eq!(pasted[1].layout, "Title and Content");
    let right = &originals[1].shapes[2];
    let kept = pasted[1].shapes.iter().find(|s| s.id == right.id).unwrap();
    assert!(
        close(kept.x, right.x) && close(kept.y, right.y) && close(kept.w, right.w),
        "{kept:?} vs {right:?}"
    );
    assert_integrity(&mut to);
}

#[test]
fn slides_paste_after_a_slide_in_the_same_deck_keeping_links_between_them() {
    let mut pres = Presentation::open(deck(&[
        &text_box(2, 0, 0, 100, 100, &para("One")),
        &text_box(2, 0, 0, 100, 100, &para("Two")),
    ]))
    .unwrap();
    // Slide one links to slide two.
    let link = pres
        .rels_mut("/ppt/slides/slide1.xml")
        .unwrap()
        .add_internal(rel_type::SLIDE, "/ppt/slides/slide2.xml");
    {
        let doc = pres.xml_mut("/ppt/slides/slide1.xml").unwrap();
        let rpr = doc
            .descendants(doc.root())
            .into_iter()
            .find(|&n| doc.local(n) == "rPr")
            .unwrap();
        let h = doc.create_element(Ns::A, "hlinkClick");
        doc.set_attr_ns(h, Ns::R, "id", &link);
        doc.set_attr(h, "action", "ppaction://hlinksldjump");
        doc.append_child(rpr, h);
    }
    pres.flush();
    let payload = pres.copy_slides(&[256, 257]).unwrap();
    let alone = pres.copy_slides(&[256]).unwrap();
    let r = apply(
        &mut pres,
        vec![
            EditOp::PasteSlides {
                after: Some(256),
                payload: json(&payload),
            },
            EditOp::PasteSlides {
                after: None,
                payload: json(&alone),
            },
        ],
    );
    let new: Vec<u32> = r.created.iter().map(|c| c.slide).collect();
    assert_eq!(
        pres.slides().iter().map(|s| s.id).collect::<Vec<_>>(),
        vec![256, new[0], new[1], 257, new[2]]
    );
    // The pasted copy of slide one links to the pasted copy of slide two.
    let copy_one = pres.slides()[1].part.clone();
    let copy_two = pres.slides()[2].part.clone();
    let rels = pres.part_rels(&copy_one).unwrap();
    let jump = rels
        .iter()
        .find(|r| r.rel_type == rel_type::SLIDE)
        .expect("the link survives");
    assert_eq!(rels.resolve(jump), copy_two);
    // Pasted alone, the link has nothing to point at and is dropped.
    let last = pres.slides()[4].part.clone();
    let doc = pres.xml(&last).unwrap();
    assert!(
        !doc.descendants(doc.root())
            .iter()
            .any(|&n| doc.local(n) == "hlinkClick")
    );
    assert_eq!(
        pres.package().content_type(&last),
        Some(content_type::SLIDE)
    );
    assert_integrity(&mut pres);
}

#[test]
fn pasting_reaches_collaborators_with_its_parts() {
    let mut seeding = blank();
    seeding.enable_collab(1);
    let entries = Entries::from_changes(&seeding.collab_changes().unwrap());
    let mut a = Presentation::from_entries(entries.clone(), 2).unwrap();
    let mut b = Presentation::from_entries(entries, 3).unwrap();
    let payload = source().copy_shapes(0, &[3, 7]).unwrap();
    let slides = corpus("charts-basic").copy_slides(&[256]).unwrap();
    let created = paste(&mut a, &payload, 5.0, 5.0);
    apply(
        &mut a,
        vec![EditOp::PasteSlides {
            after: None,
            payload: json(&slides),
        }],
    );
    let changes = a.collab_changes().unwrap();
    b.apply_collab_changes(&changes).unwrap();
    let outline = b.outline().unwrap();
    assert_eq!(outline.slides.len(), 2);
    let ids: Vec<u32> = outline.slides[0].shapes.iter().map(|s| s.id).collect();
    assert!(created.iter().all(|id| ids.contains(id)), "{ids:?}");
    assert_eq!(parts_under(&b, "/ppt/media/").len(), 1);
    assert!(
        outline.slides[1]
            .shapes
            .iter()
            .filter(|s| s.kind == ShapeKindName::Chart)
            .count()
            == 2
    );
    assert_eq!(a.collab_entries(), b.collab_entries());
    assert_integrity(&mut b);
}

#[test]
fn bad_payloads_are_rejected_without_changes() {
    let mut pres = source();
    let good = pres.copy_shapes(0, &[3]).unwrap();
    let mut wrong_format = good.clone();
    wrong_format.format = "something/else".into();
    let mut missing_part = good.clone();
    missing_part.parts.clear();
    let mut bad_name = good.clone();
    bad_name.parts[0].name = "/[Content_Types].xml".into();
    let mut not_a_shape = good.clone();
    not_a_shape.shapes = vec![format!("<p:sld {}/>", crate::test_support::NS)];
    for payload in [wrong_format, missing_part, bad_name, not_a_shape] {
        let op = EditOp::PasteShapes {
            slide: SLIDE,
            payload: json(&payload),
            dx: 0.0,
            dy: 0.0,
        };
        assert!(matches!(
            pres.apply(&[op], fonts()),
            Err(Error::InvalidEdit(_))
        ));
    }
    let slides_as_shapes = EditOp::PasteSlides {
        after: None,
        payload: json(&good),
    };
    assert!(pres.apply(&[slides_as_shapes], fonts()).is_err());
    assert!(
        pres.apply(
            &[EditOp::PasteShapes {
                slide: SLIDE,
                payload: "not json".into(),
                dx: 0.0,
                dy: 0.0,
            }],
            fonts()
        )
        .is_err()
    );
    assert!(matches!(
        pres.copy_shapes(0, &[99]),
        Err(Error::NotFound(_))
    ));
    assert!(pres.copy_slides(&[]).is_err());
}
