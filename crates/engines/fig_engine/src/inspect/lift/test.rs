use super::*;
use crate::edit::{History, Op};
use crate::images::ImageStore;
use crate::model::{Guid, Vec2};
use crate::render::{Layers, RenderOptions, Viewport, render, render_layers};
use tiny_skia::{FillRule, Mask, Pixmap, PixmapPaint, Transform};

/// A blank design edited with `ops` (JSON); returns it and the created ids.
fn design(ops: &str) -> (Document, Vec<String>) {
    let original = crate::save::blank("Lift");
    let mut doc = Document::open(&original).unwrap();
    let ops: Vec<Op> = serde_json::from_str(ops).unwrap();
    let created = History::default()
        .apply(&mut doc, &ops, None)
        .unwrap()
        .created;
    (doc, created)
}

fn rect(parent: &str, name: &str, x: f64, y: f64, w: f64, h: f64, props: &str) -> String {
    format!(
        r#"{{"op":"create","parent":"{parent}","node":{{"type":"RECTANGLE","name":"{name}","x":{x},"y":{y},"width":{w},"height":{h},"props":{props}}}}}"#
    )
}

fn frame(parent: &str, name: &str, x: f64, y: f64, w: f64, h: f64, props: &str) -> String {
    format!(
        r#"{{"op":"create","parent":"{parent}","node":{{"type":"FRAME","name":"{name}","x":{x},"y":{y},"width":{w},"height":{h},"props":{props}}}}}"#
    )
}

fn scene_of(doc: &Document) -> Scene {
    Scene::build(doc, doc.pages[0])
}

fn plan(doc: &Document, ids: &[&str]) -> LiftPlan {
    let ids: Vec<String> = ids.iter().map(|s| s.to_string()).collect();
    lift_plan(doc, &scene_of(doc), &ids)
}

const VP: Viewport = Viewport {
    x: -10.0,
    y: -10.0,
    scale: 2.0,
    width: 900,
    height: 700,
};

fn opts(background: Option<crate::model::Color>) -> RenderOptions {
    RenderOptions {
        outline: false,
        background,
    }
}

/// The clip a run shows through: its clipping ancestors' shapes, where they
/// are on the page.
fn clip_mask(doc: &Document, scene: &Scene, first: SceneIdx, vp: &Viewport) -> Option<Mask> {
    let base = crate::model::Affine::scale(vp.scale, vp.scale)
        .mul(&crate::model::Affine::translate(-vp.x, -vp.y));
    let mut mask: Option<Mask> = None;
    let mut at = scene.node(first).parent;
    while let Some(p) = at {
        if p == scene.root() {
            break;
        }
        let props = scene.props(doc, p);
        if props.clips_content() {
            let ts = base.mul(&scene.node(p).world).to_skia();
            for shape in crate::render::fill_shapes(doc, props) {
                match &mut mask {
                    None => {
                        let mut m = Mask::new(vp.width, vp.height).unwrap();
                        m.fill_path(shape.path(), FillRule::Winding, true, ts);
                        mask = Some(m);
                    }
                    Some(m) => m.intersect_path(shape.path(), FillRule::Winding, true, ts),
                }
            }
        }
        at = scene.node(p).parent;
    }
    mask
}

/// What the editor shows while the plan's layers are moved by `(dx, dy)`:
/// below, then each run (moved, clipped where it was) and what paints
/// above it.
fn composite(doc: &Document, scene: &Scene, plan: &LiftPlan, (dx, dy): (f64, f64)) -> Pixmap {
    let mut images = ImageStore::default();
    let node = |id: &String| scene.find(doc, id).unwrap();
    let first = node(&plan.runs[0].ids[0]);
    let background = Some(doc.page_background(scene.page));
    let below = Layers::Window {
        after: None,
        before: Some(first),
    };
    let mut out = render_layers(doc, scene, &mut images, &VP, opts(background), &below).unwrap();
    for (k, run) in plan.runs.iter().enumerate() {
        let nodes: Vec<SceneIdx> = run.ids.iter().map(node).collect();
        let sprite = render_layers(
            doc,
            scene,
            &mut images,
            &VP,
            opts(None),
            &Layers::Only {
                nodes: nodes.clone(),
                shift: Vec2::new(0.0, 0.0),
            },
        )
        .unwrap();
        let clip = clip_mask(doc, scene, nodes[0], &VP);
        out.draw_pixmap(
            (dx * VP.scale) as i32,
            (dy * VP.scale) as i32,
            sprite.as_ref(),
            &PixmapPaint::default(),
            Transform::identity(),
            clip.as_ref(),
        );
        let above = Layers::Window {
            after: Some(*nodes.last().unwrap()),
            before: plan.runs.get(k + 1).map(|r| node(&r.ids[0])),
        };
        let above = render_layers(doc, scene, &mut images, &VP, opts(None), &above).unwrap();
        out.draw_pixmap(
            0,
            0,
            above.as_ref(),
            &PixmapPaint::default(),
            Transform::identity(),
            None,
        );
    }
    out
}

/// The page rendered after moving `ids` by `(dx, dy)`.
fn moved(doc: &mut Document, ids: &[String], (dx, dy): (f64, f64)) -> Pixmap {
    let op: Op = serde_json::from_str(&format!(
        r#"{{"op":"translate","ids":{},"dx":{dx},"dy":{dy}}}"#,
        serde_json::to_string(ids).unwrap()
    ))
    .unwrap();
    History::default().apply(doc, &[op], None).unwrap();
    let scene = scene_of(doc);
    let background = Some(doc.page_background(scene.page));
    render(
        doc,
        &scene,
        &mut ImageStore::default(),
        &VP,
        opts(background),
    )
    .unwrap()
}

/// The largest difference in any channel between two renders, and where.
fn difference(a: &Pixmap, b: &Pixmap) -> (u8, u32, u32) {
    let mut worst = (0, 0, 0);
    for y in 0..a.height() {
        for x in 0..a.width() {
            let (p, q) = (a.pixel(x, y).unwrap(), b.pixel(x, y).unwrap());
            let d = [
                p.red().abs_diff(q.red()),
                p.green().abs_diff(q.green()),
                p.blue().abs_diff(q.blue()),
                p.alpha().abs_diff(q.alpha()),
            ]
            .into_iter()
            .max()
            .unwrap();
            if d > worst.0 {
                worst = (d, x, y);
            }
        }
    }
    worst
}

/// Lifts `ids`, composites them moved by `offset`, and checks the result
/// against the page rendered after the move.
fn assert_lift_matches(mut doc: Document, ids: &[String], offset: (f64, f64)) -> LiftPlan {
    let scene = scene_of(&doc);
    let plan = lift_plan(&doc, &scene, ids);
    assert_eq!(plan.refused, None, "{plan:?}");
    let shown = composite(&doc, &scene, &plan, offset);
    let expected = moved(&mut doc, ids, offset);
    let (d, x, y) = difference(&shown, &expected);
    // Anti-aliased edges round once more when composited.
    assert!(d <= 3, "differs by {d} at ({x}, {y})");
    plan
}

/// A design with a picture-like background, a clipping frame with a
/// stroke holding layers below and above the one that moves, a
/// half-transparent layer over it, and a layer above the frame.
fn layered() -> (Document, Vec<String>) {
    let (mut doc, mut ids) = design(&format!(
        "[{},{}]",
        rect(
            "0:1",
            "Backdrop",
            0.0,
            0.0,
            420.0,
            320.0,
            r#"{"fills":[{"color":"3366AA"}]}"#
        ),
        frame(
            "0:1",
            "Frame",
            20.0,
            20.0,
            300.0,
            220.0,
            r#"{"fills":[{"color":"FFFFFF"}],"strokes":[{"color":"000000"}],"strokeWeight":3,"cornerRadius":12}"#
        ),
    ));
    let f = ids[1].clone();
    let inner = {
        let ops: Vec<Op> = serde_json::from_str(&format!(
            "[{},{},{},{},{}]",
            rect(&f, "Below", 40.0, 40.0, 90.0, 60.0, r#"{"fills":[{"color":"2255FF"}]}"#),
            rect(
                &f,
                "Moving",
                110.0,
                70.0,
                60.0,
                50.0,
                r#"{"fills":[{"color":"FF0000"}],"strokes":[{"color":"00AA00"}],"strokeWeight":4,"effects":[{"type":"DROP_SHADOW","color":"00000080","x":3,"y":4,"radius":6}]}"#
            ),
            rect(&f, "Neighbor", 180.0, 70.0, 40.0, 40.0, r#"{"fills":[{"color":"FF9900"}]}"#),
            rect(
                &f,
                "Glass",
                150.0,
                95.0,
                70.0,
                60.0,
                r#"{"fills":[{"color":"FFFF00"}],"opacity":0.5}"#
            ),
            rect(
                "0:1",
                "Top",
                240.0,
                150.0,
                90.0,
                90.0,
                r#"{"fills":[{"color":"8800CC"}],"cornerRadius":45}"#
            ),
        ))
        .unwrap();
        History::default()
            .apply(&mut doc, &ops, None)
            .unwrap()
            .created
    };
    ids.extend(inner);
    (doc, ids)
}

#[test]
fn window_of_everything_is_the_page() {
    let (doc, _) = layered();
    let scene = scene_of(&doc);
    let background = Some(doc.page_background(scene.page));
    let mut images = ImageStore::default();
    let all = render(&doc, &scene, &mut images, &VP, opts(background)).unwrap();
    let window = Layers::Window {
        after: None,
        before: None,
    };
    let windowed =
        render_layers(&doc, &scene, &mut images, &VP, opts(background), &window).unwrap();
    assert_eq!(difference(&all, &windowed).0, 0);
}

#[test]
fn lifted_layer_composites_like_the_moved_page() {
    // In place; over its neighbor and under the glass and the top layer;
    // partly out of the frame (clipped) in either direction.
    for offset in [(0.0, 0.0), (40.0, 20.0), (-60.0, 90.0), (150.0, -30.0)] {
        let (doc, ids) = layered();
        let moving = ids[3].clone();
        let plan = assert_lift_matches(doc, std::slice::from_ref(&moving), offset);
        assert_eq!(plan.runs.len(), 1);
        assert_eq!(plan.runs[0].ids, vec![moving]);
        assert_eq!(plan.runs[0].clips.len(), 1, "the frame clips it");
    }
}

#[test]
fn lists_what_paints_above() {
    let (doc, ids) = layered();
    let p = plan(&doc, &[ids[3].as_str()]);
    let above = &p.runs[0].above;
    let scene = scene_of(&doc);
    let bounds = |id: &str| scene.node(scene.find(&doc, id).unwrap()).bounds;
    // The neighbor, the glass, the frame's stroke (drawn over its
    // children), and the top layer; not the backdrop or the layer below.
    for id in [&ids[4], &ids[5], &ids[6]] {
        assert!(above.contains(&bounds(id)), "{id} in {above:?}");
    }
    assert!(!above.contains(&bounds(&ids[0])));
    assert!(!above.contains(&bounds(&ids[2])));
    let f = scene.own_bounds(&doc, scene.find(&doc, &ids[1]).unwrap());
    assert!(above.contains(&f), "the frame's stroke");
    // The clip is the frame's rounded outline on the page.
    assert!(p.runs[0].clips[0].starts_with('M'), "{:?}", p.runs[0].clips);
}

#[test]
fn layers_with_one_between_lift_as_two_runs() {
    let (doc, ids) = layered();
    // Below and Neighbor, with Moving between them.
    let lifted = [ids[2].clone(), ids[4].clone()];
    let plan = assert_lift_matches(doc, &lifted, (30.0, 40.0));
    assert_eq!(plan.runs.len(), 2);
    assert_eq!(plan.runs[0].ids, vec![ids[2].clone()]);
    assert_eq!(plan.runs[1].ids, vec![ids[4].clone()]);
}

#[test]
fn adjacent_layers_lift_as_one_run() {
    let (doc, ids) = layered();
    let lifted = [ids[3].clone(), ids[4].clone()];
    let plan = assert_lift_matches(doc, &lifted, (-25.0, 35.0));
    assert_eq!(plan.runs.len(), 1);
    assert_eq!(plan.runs[0].ids, lifted.to_vec());
}

#[test]
fn a_frame_lifts_with_what_it_holds() {
    let (doc, ids) = layered();
    // The frame and one of its children: the child moves with the frame.
    let lifted = [ids[1].clone(), ids[3].clone()];
    let plan = assert_lift_matches(doc, &lifted, (35.0, -15.0));
    assert_eq!(plan.runs.len(), 1);
    assert_eq!(plan.runs[0].ids, vec![ids[1].clone()]);
    assert!(plan.runs[0].clips.is_empty());
}

#[test]
fn lifts_top_level_layers_under_others() {
    let (doc, ids) = layered();
    let plan = assert_lift_matches(doc, std::slice::from_ref(&ids[0]), (70.0, 50.0));
    assert!(!plan.runs[0].above.is_empty());
}

fn refused(doc: &Document, id: &str) -> Option<&'static str> {
    plan(doc, &[id]).refused
}

#[test]
fn refuses_layers_auto_layout_places() {
    let (mut doc, ids) = layered();
    let f = ids[1].clone();
    let op: Vec<Op> = serde_json::from_str(&format!(
        r#"[{{"op":"set","ids":["{f}"],"props":{{"layoutMode":"HORIZONTAL"}}}}]"#
    ))
    .unwrap();
    History::default().apply(&mut doc, &op, None).unwrap();
    assert_eq!(refused(&doc, &ids[3]), Some("auto layout"));
    // A layer placed freely in it can move on its own.
    let op: Vec<Op> = serde_json::from_str(&format!(
        r#"[{{"op":"set","ids":["{}"],"props":{{"layoutPositioning":"ABSOLUTE"}}}}]"#,
        ids[3]
    ))
    .unwrap();
    History::default().apply(&mut doc, &op, None).unwrap();
    assert_eq!(refused(&doc, &ids[3]), None);
}

#[test]
fn refuses_layers_in_components() {
    let (mut doc, ids) = layered();
    let op: Vec<Op> = serde_json::from_str(&format!(
        r#"[{{"op":"createComponent","ids":["{}"]}}]"#,
        ids[1]
    ))
    .unwrap();
    History::default().apply(&mut doc, &op, None).unwrap();
    assert_eq!(refused(&doc, &ids[3]), Some("in a component"));
    // The component itself moves like any layer.
    assert_eq!(refused(&doc, &ids[1]), None);
}

#[test]
fn refuses_what_composites_with_its_backdrop() {
    let set = |doc: &mut Document, id: &str, props: &str| {
        let op: Vec<Op> = serde_json::from_str(&format!(
            r#"[{{"op":"set","ids":["{id}"],"props":{props}}}]"#
        ))
        .unwrap();
        History::default().apply(doc, &op, None).unwrap();
    };
    let (mut doc, ids) = layered();
    set(&mut doc, &ids[3], r#"{"blendMode":"MULTIPLY"}"#);
    assert_eq!(refused(&doc, &ids[3]), Some("blend mode"));

    let (mut doc, ids) = layered();
    set(
        &mut doc,
        &ids[3],
        r#"{"effects":[{"type":"BACKGROUND_BLUR","radius":8}]}"#,
    );
    assert_eq!(refused(&doc, &ids[3]), Some("background blur"));

    // Above it: the glass multiplies what is under it.
    let (mut doc, ids) = layered();
    set(&mut doc, &ids[5], r#"{"blendMode":"MULTIPLY"}"#);
    assert_eq!(refused(&doc, &ids[3]), Some("blend mode"));
    // Below it nothing reads the moving layer.
    assert_eq!(refused(&doc, &ids[6]), None);

    // The frame fades its children together.
    let (mut doc, ids) = layered();
    set(&mut doc, &ids[1], r#"{"opacity":0.5}"#);
    assert_eq!(refused(&doc, &ids[3]), Some("ancestor composites"));
}

#[test]
fn refuses_masks_and_what_they_mask() {
    let (mut doc, ids) = layered();
    let below = doc.find(Guid::parse(&ids[2]).unwrap()).unwrap();
    doc.nodes[below as usize].props.mask = Some(true);
    assert_eq!(refused(&doc, &ids[2]), Some("mask"));
    assert_eq!(refused(&doc, &ids[3]), Some("masked"));
    // Layers before the mask are not masked.
    assert_eq!(refused(&doc, &ids[1]), None);
}

#[test]
fn refuses_unknown_and_hidden_layers() {
    let (mut doc, ids) = layered();
    assert_eq!(refused(&doc, "9:999"), Some("missing"));
    let op: Vec<Op> = serde_json::from_str(&format!(
        r#"[{{"op":"set","ids":["{}"],"props":{{"visible":false}}}}]"#,
        ids[3]
    ))
    .unwrap();
    History::default().apply(&mut doc, &op, None).unwrap();
    assert_eq!(refused(&doc, &ids[3]), Some("nothing drawn"));
}

#[test]
fn straight_alpha_unpremultiplies() {
    let mut px = [64, 32, 0, 128, 10, 20, 30, 255, 0, 0, 0, 0];
    crate::render::straight_alpha(&mut px);
    assert_eq!(px, [128, 64, 0, 128, 10, 20, 30, 255, 0, 0, 0, 0]);
}

#[test]
fn anchored_runs_render_where_the_lift_started() {
    let (mut doc, ids) = layered();
    let moving = ids[3].clone();
    let scene = scene_of(&doc);
    let plan = lift_plan(&doc, &scene, std::slice::from_ref(&moving));
    let run = &plan.runs[0];
    let only = |doc: &Document, scene: &Scene, shift: Vec2| {
        let n = scene.find(doc, &moving).unwrap();
        let layers = Layers::Only {
            nodes: vec![n],
            shift,
        };
        render_layers(
            doc,
            scene,
            &mut ImageStore::default(),
            &VP,
            opts(None),
            &layers,
        )
        .unwrap()
    };
    let before = only(&doc, &scene, Vec2::new(0.0, 0.0));
    // The document moves the layer while it is dragged …
    moved(&mut doc, std::slice::from_ref(&moving), (37.0, -12.0));
    let scene = scene_of(&doc);
    let n = scene.find(&doc, &moving).unwrap();
    let world = scene.node(n).world;
    // … and drawn from the plan's origin, it renders as it did.
    let shift = Vec2::new(run.origin.x - world.m02, run.origin.y - world.m12);
    assert_eq!((shift.x, shift.y), (-37.0, 12.0));
    assert_eq!(difference(&before, &only(&doc, &scene, shift)).0, 0);
}

#[test]
fn skipping_lifted_layers_draws_the_rest_of_the_page() {
    let (mut doc, ids) = layered();
    let moving = ids[3].clone();
    let scene = scene_of(&doc);
    let n = scene.find(&doc, &moving).unwrap();
    let background = Some(doc.page_background(scene.page));
    let skipped = render_layers(
        &doc,
        &scene,
        &mut ImageStore::default(),
        &VP,
        opts(background),
        &Layers::Skip(vec![n]),
    )
    .unwrap();
    let op: Vec<Op> = serde_json::from_str(&format!(
        r#"[{{"op":"set","ids":["{moving}"],"props":{{"visible":false}}}}]"#
    ))
    .unwrap();
    History::default().apply(&mut doc, &op, None).unwrap();
    let scene = scene_of(&doc);
    let hidden = render(
        &doc,
        &scene,
        &mut ImageStore::default(),
        &VP,
        opts(background),
    )
    .unwrap();
    assert_eq!(difference(&skipped, &hidden).0, 0);
}
