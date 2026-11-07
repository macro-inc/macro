use super::*;
use crate::edit::{EditOp, EditResult, TextPos, ZOrder};
use crate::inspect::ShapeOutline;
use crate::render::scene::Raster;
use crate::test_support::{deck, fonts, text_box};

const SLIDE: u32 = 256;
const PART: &str = "/ppt/slides/slide1.xml";

fn open(shapes: &str) -> Presentation {
    Presentation::open(deck(&[shapes])).unwrap()
}

fn apply(pres: &mut Presentation, ops: Vec<EditOp>) -> EditResult {
    pres.apply(&ops, fonts()).unwrap()
}

fn assert_integrity(pres: &mut Presentation) {
    let mut reopened = Presentation::open(pres.save().unwrap()).unwrap();
    let problems = reopened.integrity_problems().unwrap();
    assert!(problems.is_empty(), "{problems:#?}");
}

/// A filled preset shape; `xfrm` holds extra `a:xfrm` attributes.
fn shape(id: u32, preset: &str, [x, y, w, h]: [i64; 4], color: &str, xfrm: &str) -> String {
    format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="S{id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm{xfrm}><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm><a:prstGeom prst="{preset}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="{color}"/></a:solidFill></p:spPr></p:sp>"#
    )
}

/// A group whose child space is `child` mapped onto `[off, ext]`.
fn group(id: u32, frame: [i64; 4], child: [i64; 4], xfrm: &str, members: &str) -> String {
    let [x, y, w, h] = frame;
    let [cx, cy, cw, ch] = child;
    format!(
        r#"<p:grpSp><p:nvGrpSpPr><p:cNvPr id="{id}" name="G{id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm{xfrm}><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/><a:chOff x="{cx}" y="{cy}"/><a:chExt cx="{cw}" cy="{ch}"/></a:xfrm></p:grpSpPr>{members}</p:grpSp>"#
    )
}

fn render(pres: &mut Presentation) -> Raster {
    pres.render_slide(0, 640, fonts()).unwrap()
}

/// Pixels whose color differs by more than anti-aliasing noise.
fn differing_pixels(a: &Raster, b: &Raster) -> usize {
    assert_eq!((a.width, a.height), (b.width, b.height));
    a.pixels
        .chunks_exact(4)
        .zip(b.pixels.chunks_exact(4))
        .filter(|(p, q)| p.iter().zip(q.iter()).any(|(x, y)| x.abs_diff(*y) > 48))
        .count()
}

fn assert_same_render(before: &Raster, after: &Raster) {
    let blank = Raster {
        pixels: vec![255; before.pixels.len()],
        ..*before
    };
    assert!(
        differing_pixels(before, &blank) > 800,
        "the slide should show something"
    );
    let score = crate::fidelity::compare(after, before);
    let differing = differing_pixels(before, after);
    assert!(
        score.ssim > 0.995 && differing < 40,
        "renders differ: {score:?}, {differing} pixels"
    );
}

fn outline(pres: &mut Presentation) -> Vec<ShapeOutline> {
    pres.slide_outline(0).unwrap().shapes
}

fn find_outline(shapes: &[ShapeOutline], id: u32) -> Option<&ShapeOutline> {
    shapes.iter().find_map(|s| {
        if s.id == id {
            Some(s)
        } else {
            find_outline(&s.children, id)
        }
    })
}

fn ids(shapes: &[ShapeOutline]) -> Vec<u32> {
    shapes.iter().map(|s| s.id).collect()
}

fn close(a: f32, b: f32) -> bool {
    (a - b).abs() < 0.05
}

fn assert_frame(s: &ShapeOutline, [x, y, w, h]: [f32; 4], rotation: f32) {
    let rot_ok = close(s.rotation.rem_euclid(360.0), rotation.rem_euclid(360.0));
    assert!(
        close(s.x, x) && close(s.y, y) && close(s.w, w) && close(s.h, h) && rot_ok,
        "shape {}: {:?} vs {:?} rot {rotation}",
        s.id,
        [s.x, s.y, s.w, s.h, s.rotation],
        [x, y, w, h]
    );
}

#[test]
fn grouping_keeps_order_and_place_and_ungrouping_restores_it() {
    let shapes = [
        shape(
            2,
            "rect",
            [635_000, 635_000, 1_270_000, 635_000],
            "FF0000",
            "",
        ),
        shape(
            3,
            "ellipse",
            [2_540_000, 1_270_000, 1_270_000, 1_270_000],
            "00AA00",
            "",
        ),
        shape(
            4,
            "rect",
            [1_905_000, 2_540_000, 2_540_000, 635_000],
            "0000FF",
            " rot=\"1800000\"",
        ),
    ]
    .concat();
    let mut pres = open(&shapes);
    let before = render(&mut pres);
    let r = apply(
        &mut pres,
        vec![EditOp::GroupShapes {
            slide: SLIDE,
            shapes: vec![4, 2],
        }],
    );
    let g = r.created[0].shape.unwrap();
    assert_eq!(r.changed_slides, vec![SLIDE]);
    let top = outline(&mut pres);
    // The group takes the slot of its topmost member; members keep their order.
    assert_eq!(ids(&top), vec![3, g]);
    assert_eq!(ids(&top[1].children), vec![2, 4]);
    assert_eq!(top[1].kind, crate::inspect::ShapeKindName::Group);
    // The group's box is the members' bounds, including the rotated one.
    let rotated = Frame {
        x: 150.0,
        y: 200.0,
        w: 200.0,
        h: 50.0,
        rot: 30.0,
        ..Frame::default()
    }
    .bounds();
    assert_frame(
        &top[1],
        [
            50.0,
            50.0,
            rotated[2] as f32 - 50.0,
            rotated[3] as f32 - 50.0,
        ],
        0.0,
    );
    assert_frame(&top[1].children[1], [150.0, 200.0, 200.0, 50.0], 30.0);
    assert_same_render(&before, &render(&mut pres));
    assert_integrity(&mut pres);

    let r = apply(
        &mut pres,
        vec![EditOp::UngroupShape {
            slide: SLIDE,
            shape: g,
        }],
    );
    let created: Vec<u32> = r.created.iter().filter_map(|c| c.shape).collect();
    assert_eq!(created, vec![2, 4]);
    assert_eq!(ids(&outline(&mut pres)), vec![3, 2, 4]);
    assert_same_render(&before, &render(&mut pres));
    assert_integrity(&mut pres);
}

#[test]
fn ungrouping_bakes_rotation_scale_and_flips() {
    // Child space 0..1000 × 0..1000 stretched onto 300 × 150 pt, turned 30°.
    let members = [
        shape(11, "rect", [0, 0, 400, 300], "C00000", ""),
        // A quarter turn swaps which group scale applies to width and height.
        shape(
            12,
            "ellipse",
            [500, 100, 300, 200],
            "00B050",
            " rot=\"5400000\"",
        ),
        text_box(
            13,
            100,
            600,
            800,
            300,
            "<a:p><a:r><a:rPr lang=\"en-US\" sz=\"1400\"/><a:t>Scaled text</a:t></a:r></a:p>",
        ),
    ]
    .concat();
    let stretched = group(
        10,
        [1_270_000, 1_270_000, 3_810_000, 1_905_000],
        [0, 0, 1000, 1000],
        " rot=\"1800000\"",
        &members,
    );
    // Uniformly halved, turned 200° and mirrored, with a member turned 45°.
    let inner = shape(
        21,
        "rect",
        [2_540_000, 0, 1_270_000, 635_000],
        "7030A0",
        " rot=\"2700000\"",
    );
    let other = shape(
        22,
        "triangle",
        [0, 1_270_000, 1_270_000, 1_270_000],
        "FFC000",
        " flipV=\"1\"",
    );
    let mirrored = group(
        20,
        [6_985_000, 3_175_000, 1_905_000, 1_270_000],
        [0, 0, 3_810_000, 2_540_000],
        " rot=\"12000000\" flipH=\"1\"",
        &(inner + &other),
    );
    let mut pres = open(&(stretched + &mirrored));
    let before = render(&mut pres);
    let promised: Vec<ShapeOutline> = outline(&mut pres)
        .into_iter()
        .flat_map(|g| g.children)
        .collect();
    let r = apply(
        &mut pres,
        vec![
            EditOp::UngroupShape {
                slide: SLIDE,
                shape: 10,
            },
            EditOp::UngroupShape {
                slide: SLIDE,
                shape: 20,
            },
        ],
    );
    assert_eq!(r.created.len(), 5);
    let after = outline(&mut pres);
    assert_eq!(ids(&after), vec![11, 12, 13, 21, 22]);
    // Members end up where the outline said they were (slide space).
    for (p, a) in promised.iter().zip(&after) {
        assert_frame(a, [p.x, p.y, p.w, p.h], p.rotation);
        assert_eq!((a.flip_h, a.flip_v), (p.flip_h, p.flip_v), "shape {}", a.id);
    }
    assert!(after[3].flip_h && !after[3].flip_v);
    assert!(after[4].flip_h && after[4].flip_v);
    assert_same_render(&before, &render(&mut pres));
    assert_integrity(&mut pres);
}

#[test]
fn group_members_are_edited_in_slide_space() {
    // A group showing child space 0..2000 at half size (1000 EMU per 2000 child units).
    let members = [
        shape(3, "rect", [0, 0, 1_270_000, 1_270_000], "FF0000", ""),
        text_box(
            4,
            1_270_000,
            1_270_000,
            1_270_000,
            635_000,
            "<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>Inside</a:t></a:r></a:p>",
        ),
    ]
    .concat();
    let g = group(
        2,
        [635_000, 635_000, 1_270_000, 952_500],
        [0, 0, 2_540_000, 1_905_000],
        "",
        &members,
    );
    let mut pres = open(&g);
    let top = outline(&mut pres);
    assert_frame(&top[0].children[0], [50.0, 50.0, 50.0, 50.0], 0.0);
    assert_frame(&top[0].children[1], [100.0, 100.0, 50.0, 25.0], 0.0);

    // Moving a member takes slide points; the group grows to fit it.
    apply(
        &mut pres,
        vec![EditOp::SetTransform {
            slide: SLIDE,
            shape: 3,
            x: Some(20.0),
            y: Some(30.0),
            w: Some(80.0),
            h: None,
            rotation: None,
            flip_h: None,
            flip_v: None,
        }],
    );
    let top = outline(&mut pres);
    assert_frame(&top[0].children[0], [20.0, 30.0, 80.0, 50.0], 0.0);
    assert_frame(&top[0].children[1], [100.0, 100.0, 50.0, 25.0], 0.0);
    assert_frame(&top[0], [20.0, 30.0, 130.0, 95.0], 0.0);

    // Rotating a member in a turned group keeps the slide-space angle.
    apply(
        &mut pres,
        vec![
            EditOp::SetTransform {
                slide: SLIDE,
                shape: 2,
                x: None,
                y: None,
                w: None,
                h: None,
                rotation: Some(90.0),
                flip_h: None,
                flip_v: None,
            },
            EditOp::SetTransform {
                slide: SLIDE,
                shape: 4,
                x: Some(200.0),
                y: Some(220.0),
                w: None,
                h: None,
                rotation: Some(10.0),
                flip_h: None,
                flip_v: None,
            },
        ],
    );
    let top = outline(&mut pres);
    let member = find_outline(&top, 4).unwrap();
    assert_frame(member, [200.0, 220.0, 50.0, 25.0], 10.0);

    // Duplicates offset in slide space and stay in the group.
    let r = apply(
        &mut pres,
        vec![EditOp::DuplicateShape {
            slide: SLIDE,
            shape: 4,
            dx: 10.0,
            dy: 20.0,
        }],
    );
    let copy = r.created[0].shape.unwrap();
    let top = outline(&mut pres);
    assert_eq!(top.len(), 1);
    assert_frame(
        find_outline(&top, copy).unwrap(),
        [210.0, 240.0, 50.0, 25.0],
        10.0,
    );
    assert_eq!(ids(&top[0].children), vec![3, 4, copy]);

    // Reordering, text edits, and deletion work on members.
    apply(
        &mut pres,
        vec![
            EditOp::ReorderShape {
                slide: SLIDE,
                shape: copy,
                to: ZOrder::Back,
            },
            EditOp::InsertText {
                slide: SLIDE,
                shape: 4,
                cell: None,
                at: TextPos {
                    paragraph: 0,
                    offset: 6,
                },
                text: " a group".into(),
            },
            EditOp::SetFill {
                slide: SLIDE,
                shape: 3,
                fill: crate::edit::FillSpec::Solid {
                    color: "00FF00".into(),
                    alpha: None,
                },
            },
        ],
    );
    let top = outline(&mut pres);
    assert_eq!(ids(&top[0].children), vec![copy, 3, 4]);
    assert_eq!(
        find_outline(&top, 4).unwrap().paragraphs[0].text,
        "Inside a group"
    );
    assert_eq!(
        find_outline(&top, 3).unwrap().fill.as_deref(),
        Some("#00FF00")
    );
    let kept = find_outline(&top, 3).unwrap().clone();
    apply(
        &mut pres,
        vec![
            EditOp::DeleteShape {
                slide: SLIDE,
                shape: 4,
            },
            EditOp::DeleteShape {
                slide: SLIDE,
                shape: copy,
            },
        ],
    );
    // The group shrinks to its last member, which stays where it was.
    let top = outline(&mut pres);
    assert_eq!(ids(&top[0].children), vec![3]);
    assert_frame(
        &top[0].children[0],
        [kept.x, kept.y, kept.w, kept.h],
        kept.rotation,
    );
    assert_frame(&top[0], [kept.x, kept.y, kept.w, kept.h], 90.0);
    assert_integrity(&mut pres);
}

#[test]
fn grouping_rejects_what_powerpoint_rejects() {
    let ph = r#"<p:sp><p:nvSpPr><p:cNvPr id="5" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp>"#;
    let members = shape(3, "rect", [0, 0, 100, 100], "FF0000", "")
        + &shape(4, "rect", [200, 0, 100, 100], "FF0000", "");
    let slide = [
        ph.to_owned(),
        group(2, [0, 0, 300, 100], [0, 0, 300, 100], "", &members),
        shape(6, "rect", [0, 500, 100, 100], "0000FF", ""),
    ]
    .concat();
    let mut pres = open(&slide);
    let fails = |pres: &mut Presentation, op: EditOp| {
        assert!(
            matches!(pres.apply(&[op], fonts()), Err(Error::InvalidEdit(_))),
            "should fail"
        );
    };
    let group_op = |shapes: Vec<u32>| EditOp::GroupShapes {
        slide: SLIDE,
        shapes,
    };
    fails(&mut pres, group_op(vec![6]));
    fails(&mut pres, group_op(vec![6, 6]));
    fails(&mut pres, group_op(vec![5, 6]));
    fails(&mut pres, group_op(vec![3, 6]));
    fails(
        &mut pres,
        EditOp::UngroupShape {
            slide: SLIDE,
            shape: 6,
        },
    );
    assert!(matches!(
        pres.apply(&[group_op(vec![6, 99])], fonts()),
        Err(Error::NotFound(_))
    ));
    // Members of one group can be grouped into a subgroup.
    let r = apply(&mut pres, vec![group_op(vec![3, 4])]);
    let sub = r.created[0].shape.unwrap();
    let top = outline(&mut pres);
    assert_eq!(ids(&top[1].children), vec![sub]);
    assert_eq!(ids(&top[1].children[0].children), vec![3, 4]);
    assert_integrity(&mut pres);
}

#[test]
fn ungrouping_passes_the_group_fill_to_members() {
    let member = r#"<p:sp><p:nvSpPr><p:cNvPr id="3" name="Inherits"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="635000" cy="635000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:grpFill/></p:spPr></p:sp>"#;
    let filled = r#"<p:grpSp><p:nvGrpSpPr><p:cNvPr id="2" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="635000" y="635000"/><a:ext cx="635000" cy="635000"/><a:chOff x="0" y="0"/><a:chExt cx="635000" cy="635000"/></a:xfrm><a:solidFill><a:srgbClr val="123456"/></a:solidFill></p:grpSpPr>MEMBER</p:grpSp>"#
        .replace("MEMBER", member);
    let mut pres = open(&filled);
    assert_eq!(outline(&mut pres)[0].children[0].fill.as_deref(), None);
    let before = render(&mut pres);
    apply(
        &mut pres,
        vec![EditOp::UngroupShape {
            slide: SLIDE,
            shape: 2,
        }],
    );
    assert_eq!(outline(&mut pres)[0].fill.as_deref(), Some("#123456"));
    assert_same_render(&before, &render(&mut pres));
    let doc = pres.xml(PART).unwrap();
    assert!(
        !doc.descendants(doc.root())
            .iter()
            .any(|&n| doc.local(n) == "grpFill")
    );
}

#[test]
fn frames_round_trip_through_group_spaces() {
    let space = GroupSpace::new(
        Frame {
            x: 100.0,
            y: 50.0,
            w: 300.0,
            h: 120.0,
            rot: 33.0,
            flip_h: true,
            flip_v: false,
        },
        Some([10.0, 20.0, 600.0, 200.0]),
    );
    for rot in [0.0, 12.5, 90.0, 135.0, 270.0] {
        let member = Frame {
            x: 40.0,
            y: 60.0,
            w: 80.0,
            h: 30.0,
            rot,
            flip_h: false,
            flip_v: true,
        };
        let back = space.unbake(&space.bake(&member));
        for (a, b) in [
            (back.x, member.x),
            (back.y, member.y),
            (back.w, member.w),
            (back.h, member.h),
            (back.rot, member.rot),
        ] {
            assert!((a - b).abs() < 1e-6, "{back:?} vs {member:?}");
        }
        assert_eq!((back.flip_h, back.flip_v), (false, true));
    }
}
