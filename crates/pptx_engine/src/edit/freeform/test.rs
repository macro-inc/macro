use crate::boolean::{self, Seg};
use crate::edit::{EditOp, GeometryPath, MergeMode, PathCommand, PathFillMode};
use crate::model::presentation::Presentation;
use crate::test_support::{deck, fonts, text_box};
use crate::xml::{NodeId, Ns, XmlDoc};

const SLIDE: u32 = 256;

/// A drawn preset shape with a solid fill, an outline, a shadow, and text.
fn preset_shape(id: u32, prst: &str, [x, y, w, h]: [i64; 4], extra_xfrm: &str) -> String {
    format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="Shape {id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm{extra_xfrm}><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm><a:prstGeom prst="{prst}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:ln><a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Hello {id}</a:t></a:r></a:p></p:txBody></p:sp>"#
    )
}

const PT: i64 = 12_700;

fn open(shapes: &str) -> Presentation {
    Presentation::open(deck(&[shapes])).expect("deck opens")
}

fn apply(pres: &mut Presentation, ops: &[EditOp]) -> crate::EditResult {
    pres.apply(ops, fonts()).expect("edit applies")
}

fn slide_doc(pres: &mut Presentation) -> std::sync::Arc<XmlDoc> {
    let part = pres.slide_part(SLIDE).expect("slide");
    pres.xml(&part).expect("slide xml")
}

fn shape_node(doc: &XmlDoc, id: u32) -> NodeId {
    crate::edit::shapes::find(doc, id).expect("shape")
}

/// The slide-space outline of a shape, through the engine's own read.
fn outline_loops(pres: &mut Presentation, id: u32) -> Vec<Vec<Seg>> {
    let info = pres.geometry_paths(0, id).expect("read").expect("outline");
    let [a, b, c, d, e, f] = info.transform;
    let m = |x: f32, y: f32| {
        let (x, y) = (f64::from(x), f64::from(y));
        boolean::Pt::new(a * x + c * y + e, b * x + d * y + f)
    };
    let mut loops = Vec::new();
    for p in info
        .paths
        .iter()
        .filter(|p| p.fill != Some(PathFillMode::None))
    {
        let mut cur = boolean::Pt::default();
        let mut start = cur;
        let mut lp: Vec<Seg> = Vec::new();
        for c in &p.commands {
            match *c {
                PathCommand::MoveTo { x, y } => {
                    if !lp.is_empty() {
                        loops.push(std::mem::take(&mut lp));
                    }
                    cur = m(x, y);
                    start = cur;
                }
                PathCommand::LineTo { x, y } => {
                    lp.push(Seg::Line(cur, m(x, y)));
                    cur = m(x, y);
                }
                PathCommand::CubicBezTo {
                    x1,
                    y1,
                    x2,
                    y2,
                    x,
                    y,
                } => {
                    lp.push(Seg::Cubic(cur, m(x1, y1), m(x2, y2), m(x, y)));
                    cur = m(x, y);
                }
                PathCommand::QuadBezTo { x1, y1, x, y } => {
                    lp.push(super::quad_to_cubic(cur, m(x1, y1), m(x, y)));
                    cur = m(x, y);
                }
                PathCommand::ArcTo { .. } => panic!("reads give arcs as cubics"),
                PathCommand::Close => {
                    if cur != start {
                        lp.push(Seg::Line(cur, start));
                    }
                    loops.push(std::mem::take(&mut lp));
                    cur = start;
                }
            }
        }
        if !lp.is_empty() {
            loops.push(lp);
        }
    }
    loops
}

fn area(loops: &[Vec<Seg>]) -> f64 {
    loops.iter().map(|l| boolean::area(l)).sum::<f64>().abs()
}

fn bounds(loops: &[Vec<Seg>]) -> [f64; 4] {
    let all: Vec<Seg> = loops.iter().flatten().copied().collect();
    boolean::bounds(&all).expect("bounds")
}

fn near(a: f64, b: f64, tol: f64) -> bool {
    (a - b).abs() <= tol
}

fn assert_bounds(actual: [f64; 4], expected: [f64; 4], tol: f64) {
    assert!(
        actual.iter().zip(expected).all(|(a, e)| near(*a, e, tol)),
        "bounds {actual:?}, expected {expected:?}"
    );
}

fn path(commands: Vec<PathCommand>) -> GeometryPath {
    GeometryPath {
        commands,
        fill: None,
        stroke: None,
    }
}

fn mv(x: f32, y: f32) -> PathCommand {
    PathCommand::MoveTo { x, y }
}

fn ln(x: f32, y: f32) -> PathCommand {
    PathCommand::LineTo { x, y }
}

/// Reopens the saved deck, checking it is still a valid package.
fn reopen(pres: &mut Presentation) -> Presentation {
    let bytes = pres.save().expect("saves");
    Presentation::open(bytes).expect("reopens")
}

#[test]
fn custom_geometry_round_trips() {
    let mut pres = open(&preset_shape(2, "rect", [0, 0, 100 * PT, 100 * PT], ""));
    let paths = vec![
        GeometryPath {
            commands: vec![
                mv(0.0, 0.0),
                ln(100.0, 0.0),
                PathCommand::CubicBezTo {
                    x1: 120.0,
                    y1: 30.0,
                    x2: 120.0,
                    y2: 70.0,
                    x: 100.0,
                    y: 100.0,
                },
                PathCommand::QuadBezTo {
                    x1: 50.0,
                    y1: 80.0,
                    x: 0.0,
                    y: 100.0,
                },
                PathCommand::Close,
            ],
            fill: Some(PathFillMode::Darken),
            stroke: Some(false),
        },
        path(vec![
            mv(50.0, 20.0),
            PathCommand::ArcTo {
                w_r: 10.0,
                h_r: 10.0,
                st_ang: 270.0,
                sw_ang: 360.0,
            },
            PathCommand::Close,
        ]),
    ];
    apply(
        &mut pres,
        &[EditOp::SetCustomGeometry {
            slide: SLIDE,
            shape: 2,
            paths: paths.clone(),
            fit: Some(false),
        }],
    );
    let doc = slide_doc(&mut pres);
    let node = shape_node(&doc, 2);
    let sp_pr = doc.child(node, Ns::P, "spPr").expect("spPr");
    assert!(doc.child(sp_pr, Ns::A, "prstGeom").is_none());
    let geom = doc.child(sp_pr, Ns::A, "custGeom").expect("custGeom");
    // ECMA-376 order inside custGeom and spPr.
    let kids: Vec<&str> = doc.children(geom).map(|c| doc.local(c)).collect();
    assert_eq!(
        kids,
        ["avLst", "gdLst", "ahLst", "cxnLst", "rect", "pathLst"]
    );
    let order: Vec<&str> = doc.children(sp_pr).map(|c| doc.local(c)).collect();
    assert_eq!(order, ["xfrm", "custGeom", "solidFill", "ln", "effectLst"]);
    let path_el = doc.path(geom, Ns::A, &["pathLst", "path"]).expect("path");
    assert_eq!(doc.attr(path_el, "w"), Some("1270000"));
    assert_eq!(doc.attr(path_el, "fill"), Some("darken"));
    assert_eq!(doc.attr(path_el, "stroke"), Some("0"));

    // Read back: the same commands (the quad and the arc as the engine
    // draws them), in the same place.
    let mut again = reopen(&mut pres);
    let info = again.geometry_paths(0, 2).expect("read").expect("outline");
    assert_eq!(info.preset, None);
    assert_eq!(info.paths.len(), 2);
    assert_eq!(info.paths[0].fill, Some(PathFillMode::Darken));
    assert_eq!(info.paths[0].stroke, Some(false));
    match info.paths[0].commands[2] {
        PathCommand::CubicBezTo { x1, y1, x, y, .. } => {
            assert!(near(f64::from(x1), 120.0, 0.01) && near(f64::from(y1), 30.0, 0.01));
            assert!(near(f64::from(x), 100.0, 0.01) && near(f64::from(y), 100.0, 0.01));
        }
        ref other => panic!("expected the curve, got {other:?}"),
    }
    assert!(matches!(
        info.paths[0].commands[3],
        PathCommand::QuadBezTo { .. }
    ));
    // The full-circle arc around (50, 30).
    let ring = outline_loops(&mut again, 2);
    assert_bounds(bounds(&ring[1..]), [40.0, 20.0, 60.0, 40.0], 0.05);
    // fit: false kept the box although the curve leaves it.
    let s = &again.slide_outline(0).expect("outline").shapes[0];
    assert_eq!((s.x, s.y, s.w, s.h), (0.0, 0.0, 100.0, 100.0));
}

#[test]
fn edit_points_on_a_preset_keeps_its_look() {
    // A rotated, flipped ellipse with text and a shadow.
    let mut pres = open(&preset_shape(
        2,
        "ellipse",
        [100 * PT, 50 * PT, 200 * PT, 100 * PT],
        r#" rot="1800000" flipH="1""#,
    ));
    let before = outline_loops(&mut pres, 2);
    let info = pres.geometry_paths(0, 2).expect("read").expect("outline");
    assert_eq!(info.preset.as_deref(), Some("ellipse"));
    // Unchanged paths: the outline stays exactly where it was.
    apply(
        &mut pres,
        &[EditOp::SetCustomGeometry {
            slide: SLIDE,
            shape: 2,
            paths: info.paths.clone(),
            fit: None,
        }],
    );
    let after = outline_loops(&mut pres, 2);
    assert_bounds(bounds(&after), bounds(&before), 0.01);
    assert!(near(area(&after), area(&before), 0.01));
    let doc = slide_doc(&mut pres);
    let node = shape_node(&doc, 2);
    let sp_pr = doc.child(node, Ns::P, "spPr").expect("spPr");
    let xfrm = doc.child(sp_pr, Ns::A, "xfrm").expect("xfrm");
    assert_eq!(doc.attr(xfrm, "rot"), Some("1800000"));
    assert_eq!(doc.attr(xfrm, "flipH"), Some("1"));
    assert!(doc.child(sp_pr, Ns::A, "solidFill").is_some());
    assert!(doc.child(sp_pr, Ns::A, "ln").is_some());
    assert!(doc.child(sp_pr, Ns::A, "effectLst").is_some());
    // The ellipse's text area (its inscribed rectangle) stays, as guides.
    let rect = doc
        .path(sp_pr, Ns::A, &["custGeom", "rect"])
        .expect("text rect");
    assert_eq!(doc.attr(rect, "l"), Some("txL"));
    let outline = pres.slide_outline(0).expect("outline");
    assert_eq!(outline.shapes[0].paragraphs[0].text, "Hello 2");
    assert_eq!(outline.shapes[0].geometry, None);

    // Drag the leftmost point (where the preset starts) 50 pt further out:
    // the box grows to the left in the shape's own (turned, mirrored)
    // frame, and the rest of the outline stays where it was on the slide.
    let mut paths = info.paths.clone();
    if let PathCommand::MoveTo { x, .. } = &mut paths[0].commands[0] {
        *x -= 50.0;
    }
    apply(
        &mut pres,
        &[EditOp::SetCustomGeometry {
            slide: SLIDE,
            shape: 2,
            paths,
            fit: None,
        }],
    );
    let grown = &pres.slide_outline(0).expect("outline").shapes[0];
    assert!(near(f64::from(grown.w), 250.0, 0.01), "{}", grown.w);
    assert!(near(f64::from(grown.h), 100.0, 0.01));
    assert!(near(f64::from(grown.rotation), 30.0, 1e-3));
    assert!(grown.flip_h);
    let at = |t: [f64; 6], x: f64, y: f64| (t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]);
    let now = pres.geometry_paths(0, 2).expect("read").expect("outline");
    // The rightmost point: local (200, 50) before, (250, 50) now.
    let (a, b) = (
        at(info.transform, 200.0, 50.0),
        at(now.transform, 250.0, 50.0),
    );
    assert!(
        near(a.0, b.0, 0.01) && near(a.1, b.1, 0.01),
        "{a:?} vs {b:?}"
    );
    reopen(&mut pres);
}

#[test]
fn merge_union_of_overlapping_squares() {
    let shapes = [
        preset_shape(2, "rect", [0, 0, 100 * PT, 100 * PT], ""),
        preset_shape(3, "rect", [50 * PT, 50 * PT, 100 * PT, 100 * PT], ""),
    ]
    .concat();
    let mut pres = open(&shapes);
    let result = apply(
        &mut pres,
        &[EditOp::MergeShapes {
            slide: SLIDE,
            shapes: vec![2, 3],
            mode: MergeMode::Union,
        }],
    );
    assert_eq!(result.created.len(), 1);
    assert_eq!(result.created[0].shape, Some(2));
    let outline = pres.slide_outline(0).expect("outline");
    assert_eq!(outline.shapes.len(), 1);
    let s = &outline.shapes[0];
    assert_eq!((s.x, s.y, s.w, s.h), (0.0, 0.0, 150.0, 150.0));
    assert_eq!(s.name, "Freeform: Shape 1");
    // The first shape's text and fill stay.
    assert_eq!(s.paragraphs[0].text, "Hello 2");
    assert_eq!(s.fill.as_deref(), Some("#FF0000"));
    let loops = outline_loops(&mut pres, 2);
    assert!(near(area(&loops), 17_500.0, 0.1));
    assert_eq!(loops.len(), 1);
    assert_eq!(loops[0].len(), 8);
    reopen(&mut pres);
}

#[test]
fn merge_modes_areas_and_bounds() {
    let shapes = [
        preset_shape(2, "rect", [0, 0, 100 * PT, 100 * PT], ""),
        preset_shape(3, "ellipse", [50 * PT, 0, 100 * PT, 100 * PT], ""),
    ]
    .concat();
    let disc = std::f64::consts::PI * 2500.0;
    // The right half of the circle lies outside the square.
    let cases = [
        (
            MergeMode::Union,
            10_000.0 + disc / 2.0,
            [0.0, 0.0, 150.0, 100.0],
            1,
        ),
        (
            MergeMode::Intersect,
            disc / 2.0,
            [50.0, 0.0, 100.0, 100.0],
            1,
        ),
        (
            MergeMode::Subtract,
            10_000.0 - disc / 2.0,
            [0.0, 0.0, 100.0, 100.0],
            1,
        ),
        (MergeMode::Combine, 10_000.0, [0.0, 0.0, 150.0, 100.0], 1),
        (
            MergeMode::Fragment,
            10_000.0 + disc / 2.0,
            [0.0, 0.0, 150.0, 100.0],
            3,
        ),
    ];
    for (mode, expected_area, expected_bounds, count) in cases {
        let mut pres = open(&shapes);
        let result = apply(
            &mut pres,
            &[EditOp::MergeShapes {
                slide: SLIDE,
                shapes: vec![2, 3],
                mode,
            }],
        );
        let ids: Vec<u32> = result.created.iter().filter_map(|c| c.shape).collect();
        assert_eq!(ids.len(), count, "{mode:?}");
        let loops: Vec<Vec<Seg>> = ids
            .iter()
            .flat_map(|&id| outline_loops(&mut pres, id))
            .collect();
        let total: f64 = ids
            .iter()
            .map(|&id| area(&outline_loops(&mut pres, id)))
            .sum();
        assert!(
            near(total, expected_area, expected_area * 0.002),
            "{mode:?}: area {total} vs {expected_area}"
        );
        assert_bounds(bounds(&loops), expected_bounds, 0.05);
        // The other shape is gone; only the results remain.
        let outline = pres.slide_outline(0).expect("outline");
        assert_eq!(outline.shapes.len(), count, "{mode:?}");
        assert!(outline.shapes.iter().all(|s| s.id != 3));
        reopen(&mut pres);
    }
}

#[test]
fn merge_keeps_holes_and_handles_rotation() {
    // A square with a smaller one inside: subtract leaves a frame.
    let shapes = [
        preset_shape(2, "rect", [0, 0, 100 * PT, 100 * PT], ""),
        preset_shape(3, "rect", [25 * PT, 25 * PT, 50 * PT, 50 * PT], ""),
    ]
    .concat();
    let mut pres = open(&shapes);
    apply(
        &mut pres,
        &[EditOp::MergeShapes {
            slide: SLIDE,
            shapes: vec![2, 3],
            mode: MergeMode::Subtract,
        }],
    );
    let loops = outline_loops(&mut pres, 2);
    assert_eq!(loops.len(), 2);
    assert!(near(area(&loops), 7500.0, 0.1));
    // Both loops are in one path so the inner one is a hole.
    let info = pres.geometry_paths(0, 2).expect("read").expect("outline");
    assert_eq!(info.paths.len(), 1);

    // A square turned 45° intersected with an upright one: the result keeps
    // the first shape's rotation, and its area and bounds are exact.
    let shapes = [
        preset_shape(2, "rect", [0, 0, 100 * PT, 100 * PT], r#" rot="2700000""#),
        preset_shape(3, "rect", [0, 0, 100 * PT, 100 * PT], ""),
    ]
    .concat();
    let mut pres = open(&shapes);
    apply(
        &mut pres,
        &[EditOp::MergeShapes {
            slide: SLIDE,
            shapes: vec![2, 3],
            mode: MergeMode::Intersect,
        }],
    );
    let loops = outline_loops(&mut pres, 2);
    // A regular octagon: (side 100) area 2·(√2 − 1)·100²... computed as the
    // square minus four corner triangles of legs 100 − 50√2.
    let leg = 100.0 - 50.0 * 2f64.sqrt();
    let expected = 10_000.0 - 2.0 * leg * leg;
    assert!(near(area(&loops), expected, 0.5), "{}", area(&loops));
    assert_bounds(bounds(&loops), [0.0, 0.0, 100.0, 100.0], 0.05);
    let s = &pres.slide_outline(0).expect("outline").shapes[0];
    assert!(near(f64::from(s.rotation), 45.0, 1e-3));
    reopen(&mut pres);
}

#[test]
fn merge_inside_a_group_and_with_a_picture_first() {
    // A group scaled 2× holding two overlapping squares.
    let inner = [
        preset_shape(3, "rect", [0, 0, 50 * PT, 50 * PT], ""),
        preset_shape(4, "rect", [25 * PT, 0, 50 * PT, 50 * PT], ""),
    ]
    .concat();
    let group = format!(
        r#"<p:grpSp><p:nvGrpSpPr><p:cNvPr id="2" name="Group 1"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="{}" y="0"/><a:ext cx="{}" cy="{}"/><a:chOff x="0" y="0"/><a:chExt cx="{}" cy="{}"/></a:xfrm></p:grpSpPr>{inner}<p:sp><p:nvSpPr><p:cNvPr id="5" name="Other"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{}" y="{}"/><a:ext cx="{}" cy="{}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp></p:grpSp>"#,
        100 * PT,
        300 * PT,
        200 * PT,
        150 * PT,
        100 * PT,
        100 * PT,
        50 * PT,
        50 * PT,
        50 * PT,
    );
    let mut pres = open(&group);
    apply(
        &mut pres,
        &[EditOp::MergeShapes {
            slide: SLIDE,
            shapes: vec![3, 4],
            mode: MergeMode::Union,
        }],
    );
    // In slide space: x 100..250 (75 child units × 2), y 0..100.
    let loops = outline_loops(&mut pres, 3);
    assert_bounds(bounds(&loops), [100.0, 0.0, 250.0, 100.0], 0.05);
    assert!(near(area(&loops), 15_000.0, 0.5));
    let outline = pres.slide_outline(0).expect("outline");
    let g = &outline.shapes[0];
    assert_eq!(g.children.len(), 2);

    // A picture first: the result is still a picture, its image in place.
    let pic = r#"<p:pic><p:nvPicPr><p:cNvPr id="2" name="Picture 1"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId10"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="1270000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>"#;
    let shapes = [
        pic.to_owned(),
        preset_shape(3, "ellipse", [50 * PT, 50 * PT, 100 * PT, 100 * PT], ""),
    ]
    .concat();
    let png = crate::render::scene::Raster::new(4, 4).to_png();
    let bytes = crate::test_support::deck_with_media(&[&shapes], &[("image1.png", &png)]);
    let mut pres = Presentation::open(bytes).expect("opens");
    apply(
        &mut pres,
        &[EditOp::MergeShapes {
            slide: SLIDE,
            shapes: vec![2, 3],
            mode: MergeMode::Intersect,
        }],
    );
    let doc = slide_doc(&mut pres);
    let node = shape_node(&doc, 2);
    assert_eq!(doc.local(node), "pic");
    // The box is now 50..100 on both axes: the crop moves by half the image.
    let src = doc
        .path(node, Ns::P, &["blipFill"])
        .and_then(|b| doc.child(b, Ns::A, "srcRect"))
        .expect("srcRect");
    assert_eq!(doc.attr(src, "l"), Some("50000"));
    assert_eq!(doc.attr(src, "t"), Some("50000"));
    assert_eq!(doc.attr(src, "r"), None);
    reopen(&mut pres);
}

#[test]
fn merge_refuses_what_it_cannot_merge() {
    let shapes = [
        preset_shape(2, "rect", [0, 0, 100 * PT, 100 * PT], ""),
        preset_shape(3, "rect", [500 * PT, 0, 100 * PT, 100 * PT], ""),
        text_box(4, 0, 0, 100 * PT, 100 * PT, "<a:p/>"),
    ]
    .concat();
    let mut pres = open(&shapes);
    let fails = |pres: &mut Presentation, ids: Vec<u32>, mode: MergeMode| {
        pres.apply(
            &[EditOp::MergeShapes {
                slide: SLIDE,
                shapes: ids,
                mode,
            }],
            fonts(),
        )
        .is_err()
    };
    assert!(fails(&mut pres, vec![2], MergeMode::Union));
    assert!(fails(&mut pres, vec![2, 2], MergeMode::Union));
    assert!(fails(&mut pres, vec![2, 3], MergeMode::Intersect));
    assert!(fails(&mut pres, vec![2, 99], MergeMode::Union));
    // Nothing changed.
    assert_eq!(pres.slide_outline(0).expect("outline").shapes.len(), 3);
    // A text box merges as its rectangle.
    apply(
        &mut pres,
        &[EditOp::MergeShapes {
            slide: SLIDE,
            shapes: vec![4, 2],
            mode: MergeMode::Union,
        }],
    );
    assert_eq!(pres.slide_outline(0).expect("outline").shapes.len(), 2);
}

#[test]
fn custom_geometry_ops_parse_from_json() {
    let op: EditOp = serde_json::from_str(
        r#"{"op":"setCustomGeometry","slide":256,"shape":2,"paths":[{"commands":[{"cmd":"moveTo","x":0,"y":0},{"cmd":"lineTo","x":10,"y":0},{"cmd":"cubicBezTo","x1":1,"y1":2,"x2":3,"y2":4,"x":5,"y":6},{"cmd":"arcTo","wR":5,"hR":5,"stAng":0,"swAng":90},{"cmd":"close"}],"fill":null,"stroke":null}],"fit":null}"#,
    )
    .expect("parses");
    assert!(matches!(op, EditOp::SetCustomGeometry { fit: None, .. }));
    let op: EditOp = serde_json::from_str(
        r#"{"op":"mergeShapes","slide":256,"shapes":[2,3],"mode":"fragment"}"#,
    )
    .expect("parses");
    assert!(matches!(
        op,
        EditOp::MergeShapes {
            mode: MergeMode::Fragment,
            ..
        }
    ));
    assert!(
        serde_json::from_str::<EditOp>(
            r#"{"op":"mergeShapes","slide":256,"shapes":[2,3],"mode":"xor"}"#
        )
        .is_err()
    );
}

#[test]
fn invalid_paths_are_refused() {
    let mut pres = open(&preset_shape(2, "rect", [0, 0, 100 * PT, 100 * PT], ""));
    for paths in [
        vec![],
        vec![path(vec![ln(1.0, 1.0)])],
        vec![path(vec![mv(0.0, 0.0), ln(f32::NAN, 1.0)])],
    ] {
        assert!(
            pres.apply(
                &[EditOp::SetCustomGeometry {
                    slide: SLIDE,
                    shape: 2,
                    paths,
                    fit: None,
                }],
                fonts(),
            )
            .is_err()
        );
    }
}

#[test]
fn libreoffice_opens_merged_shapes() {
    let Ok(status) = std::process::Command::new("soffice")
        .arg("--version")
        .output()
    else {
        return;
    };
    if !status.status.success() {
        return;
    }
    let shapes = [
        preset_shape(2, "rect", [0, 0, 100 * PT, 100 * PT], ""),
        preset_shape(3, "ellipse", [50 * PT, 50 * PT, 100 * PT, 100 * PT], ""),
        preset_shape(4, "star5", [300 * PT, 50 * PT, 100 * PT, 100 * PT], ""),
        preset_shape(5, "rect", [330 * PT, 80 * PT, 40 * PT, 40 * PT], ""),
    ]
    .concat();
    let mut pres = open(&shapes);
    apply(
        &mut pres,
        &[
            EditOp::MergeShapes {
                slide: SLIDE,
                shapes: vec![2, 3],
                mode: MergeMode::Fragment,
            },
            EditOp::MergeShapes {
                slide: SLIDE,
                shapes: vec![4, 5],
                mode: MergeMode::Combine,
            },
        ],
    );
    let dir = std::env::temp_dir().join(format!("pptx-merge-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let file = dir.join("merged.pptx");
    std::fs::write(&file, pres.save().expect("saves")).expect("writes");
    let out = std::process::Command::new("soffice")
        .args(["--headless", "--convert-to", "pdf", "--outdir"])
        .arg(&dir)
        .arg(&file)
        .output()
        .expect("soffice runs");
    let pdf = dir.join("merged.pdf");
    let ok = pdf.exists()
        && std::fs::metadata(&pdf)
            .map(|m| m.len() > 0)
            .unwrap_or(false);
    let _ = std::fs::remove_dir_all(&dir);
    assert!(
        ok,
        "LibreOffice did not convert: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}
