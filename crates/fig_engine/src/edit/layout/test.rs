use super::super::{History, Op};
use crate::document::{Document, NodeIdx};
use crate::model::{Guid, LayoutChild, Vec2};
use crate::save::{blank, save};

fn apply(doc: &mut Document, h: &mut History, json: &str) -> Vec<String> {
    let ops: Vec<Op> = serde_json::from_str(json).unwrap();
    h.apply(doc, &ops, None).unwrap().created
}

fn idx(doc: &Document, id: &str) -> NodeIdx {
    doc.find(Guid::parse(id).unwrap()).unwrap()
}

/// `(x, y, w, h)` in the parent's space.
fn bounds(doc: &Document, id: &str) -> (f64, f64, f64, f64) {
    let p = doc.props(idx(doc, id));
    let t = p.transform();
    (t.m02, t.m12, p.size().x, p.size().y)
}

/// A frame at (100, 100) holding three rectangles, 40, 60, and 20 wide.
fn row(doc: &mut Document, h: &mut History) -> (String, Vec<String>) {
    let frame = apply(
        doc,
        h,
        r#"[{"op":"create","parent":"0:1","node":{"type":"FRAME","name":"Row","x":100,"y":100,"width":300,"height":100}}]"#,
    )[0]
    .clone();
    let mut kids = Vec::new();
    for (k, w) in [40, 60, 20].into_iter().enumerate() {
        let x = 110 + 80 * k;
        kids.push(
            apply(
                doc,
                h,
                &format!(
                    r#"[{{"op":"create","parent":"{frame}","node":{{"type":"RECTANGLE","x":{x},"y":110,"width":{w},"height":{}}}}}]"#,
                    20 + 10 * k
                ),
            )[0]
            .clone(),
        );
    }
    (frame, kids)
}

fn stack(doc: &mut Document, h: &mut History) -> (String, Vec<String>) {
    let (frame, kids) = row(doc, h);
    apply(
        doc,
        h,
        &format!(r#"[{{"op":"autoLayout","ids":["{frame}"]}}]"#),
    );
    (frame, kids)
}

#[test]
fn adds_auto_layout_from_the_arrangement() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let (frame, kids) = stack(&mut doc, &mut h);
    let al = doc.props(idx(&doc, &frame)).auto_layout.clone().unwrap();
    assert_eq!(al.mode, "HORIZONTAL");
    // Gaps were 40 and 20: the average.
    assert_eq!(al.spacing, 30.0);
    assert_eq!((al.padding_left, al.padding_top), (10.0, 10.0));
    // The frame hugs: 10 + 40 + 30 + 60 + 30 + 20 + 10 wide, and its
    // tallest child plus padding high.
    assert_eq!(bounds(&doc, &frame), (100.0, 100.0, 200.0, 60.0));
    assert_eq!(bounds(&doc, &kids[1]).0, 80.0);
    assert_eq!(bounds(&doc, &kids[2]).0, 170.0);
}

#[test]
fn reflows_when_a_child_changes() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let (frame, kids) = stack(&mut doc, &mut h);
    apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"set","ids":["{}"],"props":{{"width":100}}}}]"#,
            kids[0]
        ),
    );
    assert_eq!(bounds(&doc, &kids[1]).0, 140.0, "pushed along");
    assert_eq!(bounds(&doc, &frame).2, 260.0, "the frame grew");
    apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"delete","ids":["{}"]}}]"#, kids[1]),
    );
    assert_eq!(bounds(&doc, &kids[2]).0, 140.0, "closed the gap");
    assert_eq!(bounds(&doc, &frame).2, 170.0);
    // Undo restores the whole layout in one step.
    h.undo(&mut doc).unwrap();
    assert_eq!(bounds(&doc, &frame).2, 260.0);
    assert_eq!(bounds(&doc, &kids[2]).0, 230.0);
}

#[test]
fn fills_and_stretches_in_a_fixed_frame() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let (frame, kids) = stack(&mut doc, &mut h);
    apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"set","ids":["{frame}"],"props":{{"width":400,"height":100}}}},
                {{"op":"set","ids":["{}"],"props":{{"sizingHorizontal":"FILL","sizingVertical":"FILL"}}}}]"#,
            kids[1]
        ),
    );
    let f = doc.props(idx(&doc, &frame));
    let al = f.auto_layout.clone().unwrap();
    assert!(
        !al.hugs_primary() && !al.hugs_counter(),
        "resizing fixed it"
    );
    assert_eq!(f.size(), Vec2::new(400.0, 100.0));
    // 400 - 20 padding - 60 gaps - 40 - 20 = 260 to fill; 80 high inside.
    assert_eq!(bounds(&doc, &kids[1]), (80.0, 10.0, 260.0, 80.0));
    assert_eq!(bounds(&doc, &kids[2]).0, 370.0);
    assert_eq!(super::axis_sizing(&doc, idx(&doc, &kids[1]), true), "FILL");
    assert_eq!(super::axis_sizing(&doc, idx(&doc, &frame), true), "FIXED");
    apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"set","ids":["{frame}"],"props":{{"primaryAlign":"CENTER","counterAlign":"MAX","sizingHorizontal":"HUG"}}}}]"#
        ),
    );
    // Hugging, the fill child keeps its size; the others sit at the bottom.
    assert_eq!(bounds(&doc, &frame).2, 400.0);
    assert_eq!(bounds(&doc, &kids[2]).1, 90.0 - 40.0);
}

#[test]
fn drags_reorder_the_flow() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let (frame, kids) = stack(&mut doc, &mut h);
    let ops = |dx: f64| {
        format!(
            r#"[{{"op":"translate","ids":["{}"],"dx":{dx},"dy":0}}]"#,
            kids[0]
        )
    };
    let drag: Vec<Op> = serde_json::from_str(&ops(100.0)).unwrap();
    h.apply(&mut doc, &drag, Some("drag")).unwrap();
    // While dragged it stays where it was put; the others make room.
    assert_eq!(bounds(&doc, &kids[0]).0, 110.0);
    assert_eq!(bounds(&doc, &kids[1]).0, 10.0);
    let settle: Vec<Op> =
        serde_json::from_str(&format!(r#"[{{"op":"reflow","ids":["{}"]}}]"#, kids[0])).unwrap();
    h.apply(&mut doc, &settle, Some("drag")).unwrap();
    let f = idx(&doc, &frame);
    let order: Vec<NodeIdx> = doc.node(f).children.clone();
    assert_eq!(order[1], idx(&doc, &kids[0]), "now second");
    assert_eq!(bounds(&doc, &kids[0]).0, 100.0);
    // One undo step for the whole drag.
    h.undo(&mut doc).unwrap();
    assert_eq!(doc.node(f).children[0], idx(&doc, &kids[0]));
    assert_eq!(bounds(&doc, &kids[0]).0, 10.0);
}

#[test]
fn moving_a_stack_keeps_its_children() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let (frame, kids) = stack(&mut doc, &mut h);
    // Children placed where Figma put them, not where the engine would.
    let k = idx(&doc, &kids[0]);
    doc.nodes[k as usize].props.transform.as_mut().unwrap().m12 = 13.0;
    apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"translate","ids":["{frame}"],"dx":50,"dy":0}}]"#),
    );
    assert_eq!(bounds(&doc, &kids[0]).1, 13.0);
}

#[test]
fn text_grows_its_button_and_the_buttons_row() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let (row_frame, _) = stack(&mut doc, &mut h);
    let button = apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"create","parent":"{row_frame}","node":{{"type":"FRAME","name":"Button","x":400,"y":110,"width":10,"height":10}}}}]"#
        ),
    )[0]
    .clone();
    let label = apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"create","parent":"{button}","node":{{"type":"TEXT","x":400,"y":110,"width":1,"height":1,"props":{{"characters":"OK","fontSize":14}}}}}},
                {{"op":"set","ids":["{button}"],"props":{{"layoutMode":"HORIZONTAL","paddingLeft":12,"paddingRight":12,"paddingTop":8,"paddingBottom":8,"sizingHorizontal":"HUG","sizingVertical":"HUG"}}}}]"#
        ),
    )[0]
    .clone();
    let before_button = bounds(&doc, &button).2;
    let before_row = bounds(&doc, &row_frame).2;
    let label_w = bounds(&doc, &label).2;
    assert_eq!(before_button, label_w + 24.0);
    apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"set","ids":["{label}"],"props":{{"characters":"Continue"}}}}]"#),
    );
    let grown = bounds(&doc, &button).2 - before_button;
    assert!(grown > 20.0, "{grown}");
    assert!((bounds(&doc, &row_frame).2 - before_row - grown).abs() < 1e-6);
}

#[test]
fn saves_auto_layout() {
    let original = blank("x");
    let mut doc = Document::open(&original).unwrap();
    let mut h = History::default();
    let (frame, kids) = stack(&mut doc, &mut h);
    apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"set","ids":["{frame}"],"props":{{"width":400,"primaryAlign":"SPACE_BETWEEN"}}}},
                {{"op":"set","ids":["{}"],"props":{{"sizingVertical":"FILL","layoutPositioning":"AUTO"}}}}]"#,
            kids[0]
        ),
    );
    let reopened = Document::open(&save(&doc, &original).unwrap()).unwrap();
    let f = reopened.props(idx(&reopened, &frame));
    assert_eq!(f.auto_layout, doc.props(idx(&doc, &frame)).auto_layout);
    let child = reopened.props(idx(&reopened, &kids[0]));
    assert!(child.layout_child.as_ref().unwrap().stretches());
    assert_eq!(bounds(&reopened, &kids[2]), bounds(&doc, &kids[2]));
}

#[test]
fn wraps_layers_in_a_hugging_stack() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let (_, kids) = row(&mut doc, &mut h);
    let created = apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"autoLayout","ids":["{}","{}"]}}]"#,
            kids[0], kids[1]
        ),
    );
    let frame = idx(&doc, &created[0]);
    assert_eq!(super::axis_sizing(&doc, frame, true), "HUG");
    assert_eq!(super::axis_sizing(&doc, frame, false), "HUG");
    assert_eq!(doc.node(frame).children.len(), 2);
    // 40 + 40 gap + 60 wide, as tall as the taller one.
    assert_eq!(doc.props(frame).size(), Vec2::new(140.0, 30.0));
}

#[test]
fn children_follow_their_constraints() {
    let original = blank("x");
    let mut doc = Document::open(&original).unwrap();
    let mut h = History::default();
    let (frame, kids) = row(&mut doc, &mut h);
    // Kids at x 10, 90, 170 (widths 40, 60, 20) in a 300 wide frame.
    apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"set","ids":["{}"],"props":{{"constraintHorizontal":"MAX"}}}},
                {{"op":"set","ids":["{}"],"props":{{"constraintHorizontal":"STRETCH","constraintVertical":"CENTER"}}}},
                {{"op":"set","ids":["{}"],"props":{{"constraintHorizontal":"SCALE"}}}}]"#,
            kids[0], kids[1], kids[2]
        ),
    );
    apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"set","ids":["{frame}"],"props":{{"width":600,"height":200}}}}]"#),
    );
    assert_eq!(bounds(&doc, &kids[0]).0, 310.0);
    let (x, y, w, _) = bounds(&doc, &kids[1]);
    assert_eq!((x, w), (90.0, 360.0));
    assert_eq!(y, 60.0, "centred: 10 + 100 / 2");
    let (x, _, w, _) = bounds(&doc, &kids[2]);
    assert_eq!((x, w), (340.0, 40.0));
    let reopened = Document::open(&save(&doc, &original).unwrap()).unwrap();
    let c = reopened
        .props(idx(&reopened, &kids[1]))
        .constraints
        .clone()
        .unwrap();
    assert_eq!((&*c.0, &*c.1), ("STRETCH", "CENTER"));
}

#[test]
fn groups_scale_their_layers() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let (_, kids) = row(&mut doc, &mut h);
    let group = apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"group","ids":["{}","{}"]}}]"#, kids[0], kids[1]),
    )[0]
    .clone();
    let (_, _, gw, _) = bounds(&doc, &group);
    assert_eq!(gw, 140.0);
    apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"set","ids":["{group}"],"props":{{"width":280}}}}]"#),
    );
    assert_eq!(bounds(&doc, &kids[1]).2, 120.0);
}

/// Creates a layer in `parent` from a `create` op's node JSON; returns its id.
fn make(doc: &mut Document, h: &mut History, parent: &str, node: &str) -> String {
    apply(
        doc,
        h,
        &format!(r#"[{{"op":"create","parent":"{parent}","node":{node}}}]"#),
    )[0]
    .clone()
}

fn set(doc: &mut Document, h: &mut History, id: &str, props: &str) {
    apply(
        doc,
        h,
        &format!(r#"[{{"op":"set","ids":["{id}"],"props":{props}}}]"#),
    );
}

#[test]
fn hidden_frames_keep_their_layout_until_shown() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let (frame, kids) = stack(&mut doc, &mut h);
    set(&mut doc, &mut h, &frame, r#"{"visible":false}"#);
    set(&mut doc, &mut h, &kids[0], r#"{"width":100}"#);
    // Figma leaves a hidden frame's layout as it was.
    assert_eq!(bounds(&doc, &kids[1]).0, 80.0);
    assert_eq!(bounds(&doc, &frame).2, 200.0);
    set(&mut doc, &mut h, &frame, r#"{"visible":true}"#);
    assert_eq!(bounds(&doc, &kids[1]).0, 140.0);
    assert_eq!(bounds(&doc, &frame).2, 260.0);
}

#[test]
fn the_auto_gap_centres_a_lone_child() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let frame = make(
        &mut doc,
        &mut h,
        "0:1",
        r#"{"type":"FRAME","x":0,"y":0,"width":200,"height":100}"#,
    );
    let kid = make(
        &mut doc,
        &mut h,
        &frame,
        r#"{"type":"RECTANGLE","x":0,"y":0,"width":40,"height":20}"#,
    );
    set(
        &mut doc,
        &mut h,
        &frame,
        r#"{"layoutMode":"HORIZONTAL","primaryAlign":"SPACE_EVENLY","sizingHorizontal":"FIXED","sizingVertical":"FIXED"}"#,
    );
    assert_eq!(bounds(&doc, &kid).0, 80.0);
    // Space between leaves it at the start.
    set(
        &mut doc,
        &mut h,
        &frame,
        r#"{"primaryAlign":"SPACE_BETWEEN","paddingLeft":4}"#,
    );
    assert_eq!(bounds(&doc, &kid).0, 4.0);
}

#[test]
fn overflowing_children_touch_with_space_between_and_overlap_with_the_auto_gap() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let (frame, kids) = stack(&mut doc, &mut h);
    // 40 + 60 + 20 = 120 in 100 less 20 of padding: 40 too much.
    set(
        &mut doc,
        &mut h,
        &frame,
        r#"{"primaryAlign":"SPACE_BETWEEN","sizingHorizontal":"FIXED","width":100}"#,
    );
    assert_eq!(bounds(&doc, &kids[1]).0, 50.0);
    assert_eq!(bounds(&doc, &kids[2]).0, 110.0);
    set(
        &mut doc,
        &mut h,
        &frame,
        r#"{"primaryAlign":"SPACE_EVENLY"}"#,
    );
    assert_eq!(bounds(&doc, &kids[1]).0, 30.0);
    assert_eq!(bounds(&doc, &kids[2]).0, 70.0);
}

#[test]
fn hugging_respects_the_frames_own_limits() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    // A badge: at least 16 wide, hugging a digit 8 wide with 2 each side.
    let badge = make(
        &mut doc,
        &mut h,
        "0:1",
        r#"{"type":"FRAME","x":0,"y":0,"width":16,"height":16}"#,
    );
    let digit = make(
        &mut doc,
        &mut h,
        &badge,
        r#"{"type":"RECTANGLE","x":0,"y":0,"width":8,"height":16}"#,
    );
    let b = idx(&doc, &badge) as usize;
    doc.nodes[b].props.layout_child = Some(LayoutChild {
        min_size: Some(Vec2::new(16.0, 0.0)),
        ..LayoutChild::default()
    });
    set(
        &mut doc,
        &mut h,
        &badge,
        r#"{"layoutMode":"HORIZONTAL","primaryAlign":"CENTER","paddingLeft":2,"paddingRight":2,"sizingHorizontal":"HUG","sizingVertical":"HUG"}"#,
    );
    // Centred in the 16 the frame keeps, not the 12 it would hug.
    assert_eq!(bounds(&doc, &badge).2, 16.0);
    assert_eq!(bounds(&doc, &digit).0, 4.0);
}

#[test]
fn children_align_against_padding_wider_than_the_frame() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    // A key: 34 wide with 22 of padding on each side.
    let frame = make(
        &mut doc,
        &mut h,
        "0:1",
        r#"{"type":"FRAME","x":0,"y":0,"width":34,"height":46}"#,
    );
    let kid = make(
        &mut doc,
        &mut h,
        &frame,
        r#"{"type":"RECTANGLE","x":0,"y":0,"width":11,"height":24}"#,
    );
    set(
        &mut doc,
        &mut h,
        &frame,
        r#"{"layoutMode":"VERTICAL","primaryAlign":"CENTER","counterAlign":"CENTER","paddingLeft":22,"paddingRight":22,"sizingHorizontal":"FIXED","sizingVertical":"FIXED"}"#,
    );
    // Centred on the 10 px the padding overlaps by: 22 + (-10 - 11) / 2.
    assert_eq!(bounds(&doc, &kid).0, 11.5);
    assert_eq!(bounds(&doc, &kid).1, 11.0);
}

#[test]
fn lines_keep_no_thickness_when_filling() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let frame = make(
        &mut doc,
        &mut h,
        "0:1",
        r#"{"type":"FRAME","x":0,"y":0,"width":600,"height":20}"#,
    );
    let line = make(
        &mut doc,
        &mut h,
        &frame,
        r#"{"type":"LINE","x":0,"y":0,"width":100,"height":0}"#,
    );
    let avatar = make(
        &mut doc,
        &mut h,
        &frame,
        r#"{"type":"RECTANGLE","x":200,"y":0,"width":20,"height":20}"#,
    );
    set(
        &mut doc,
        &mut h,
        &frame,
        r#"{"layoutMode":"HORIZONTAL","sizingHorizontal":"FIXED","sizingVertical":"FIXED"}"#,
    );
    set(
        &mut doc,
        &mut h,
        &line,
        r#"{"sizingHorizontal":"FILL","sizingVertical":"FILL"}"#,
    );
    // Stretched across, a line stays flat in the middle of the frame; along
    // the flow it fills as usual.
    assert_eq!(bounds(&doc, &line), (0.0, 10.0, 580.0, 0.0));
    assert_eq!(bounds(&doc, &avatar).0, 580.0);

    // Filling down a column it cannot get taller: it sits in the middle of
    // its share.
    let column = make(
        &mut doc,
        &mut h,
        "0:1",
        r#"{"type":"FRAME","x":0,"y":100,"width":200,"height":31}"#,
    );
    let rule = make(
        &mut doc,
        &mut h,
        &column,
        r#"{"type":"LINE","x":0,"y":100,"width":200,"height":0}"#,
    );
    set(
        &mut doc,
        &mut h,
        &column,
        r#"{"layoutMode":"VERTICAL","primaryAlign":"MAX","sizingHorizontal":"FIXED","sizingVertical":"FIXED"}"#,
    );
    set(&mut doc, &mut h, &rule, r#"{"sizingVertical":"FILL"}"#);
    assert_eq!(bounds(&doc, &rule), (0.0, 15.5, 200.0, 0.0));
}

#[test]
fn turned_lines_fill_like_flat_ones() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let row = make(
        &mut doc,
        &mut h,
        "0:1",
        r#"{"type":"FRAME","x":0,"y":0,"width":31,"height":100}"#,
    );
    let line = make(
        &mut doc,
        &mut h,
        &row,
        r#"{"type":"LINE","x":0,"y":0,"width":100,"height":0}"#,
    );
    // Turned a quarter, with the rounding a file stores.
    let tiny = -8.4e-8;
    let l = idx(&doc, &line) as usize;
    let t = doc.nodes[l].props.transform.as_mut().unwrap();
    (t.m00, t.m01, t.m10, t.m11) = (tiny, -1.0, 1.0, tiny);
    set(
        &mut doc,
        &mut h,
        &row,
        r#"{"layoutMode":"HORIZONTAL","primaryAlign":"MAX","sizingHorizontal":"FIXED","sizingVertical":"FIXED"}"#,
    );
    set(&mut doc, &mut h, &line, r#"{"sizingHorizontal":"FILL"}"#);
    let p = doc.props(idx(&doc, &line));
    assert_eq!(p.size(), Vec2::new(100.0, 0.0));
    assert!((p.transform().m02 - 15.5).abs() < 1e-3);
}

#[test]
fn turned_layers_stretched_across_keep_their_size_in_the_middle() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let column = make(
        &mut doc,
        &mut h,
        "0:1",
        r#"{"type":"FRAME","x":0,"y":0,"width":200,"height":200}"#,
    );
    let tile = make(
        &mut doc,
        &mut h,
        &column,
        r#"{"type":"RECTANGLE","x":0,"y":0,"width":100,"height":20}"#,
    );
    set(&mut doc, &mut h, &tile, r#"{"rotation":45}"#);
    set(
        &mut doc,
        &mut h,
        &column,
        r#"{"layoutMode":"VERTICAL","sizingHorizontal":"FIXED","sizingVertical":"FIXED"}"#,
    );
    set(&mut doc, &mut h, &tile, r#"{"sizingHorizontal":"FILL"}"#);
    let p = doc.props(idx(&doc, &tile));
    assert_eq!(p.size(), Vec2::new(100.0, 20.0));
    let s = p.size();
    let b = p
        .transform()
        .map_rect(&crate::model::Rect::new(0.0, 0.0, s.x, s.y));
    assert!((b.x - (200.0 - b.w) / 2.0).abs() < 1e-6, "{b:?}");
    assert!(b.y.abs() < 1e-6, "{b:?}");
}

#[test]
fn stretched_stacks_count_when_hugging() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let list = make(
        &mut doc,
        &mut h,
        "0:1",
        r#"{"type":"FRAME","x":0,"y":0,"width":100,"height":100}"#,
    );
    let title = make(
        &mut doc,
        &mut h,
        &list,
        r#"{"type":"RECTANGLE","x":0,"y":0,"width":73,"height":30}"#,
    );
    let row = make(
        &mut doc,
        &mut h,
        &list,
        r#"{"type":"FRAME","x":0,"y":40,"width":50,"height":20}"#,
    );
    for (x, w) in [(0, 256), (256, 157)] {
        make(
            &mut doc,
            &mut h,
            &row,
            &format!(r#"{{"type":"RECTANGLE","x":{x},"y":40,"width":{w},"height":20}}"#),
        );
    }
    set(
        &mut doc,
        &mut h,
        &row,
        r#"{"layoutMode":"HORIZONTAL","sizingHorizontal":"HUG"}"#,
    );
    set(
        &mut doc,
        &mut h,
        &list,
        r#"{"layoutMode":"VERTICAL","sizingHorizontal":"HUG","sizingVertical":"HUG"}"#,
    );
    set(&mut doc, &mut h, &row, r#"{"sizingHorizontal":"FILL"}"#);
    // Filling, the row keeps a fixed width, and the list is as wide as it,
    // 256 + 157, not as its title.
    assert_eq!(super::axis_sizing(&doc, idx(&doc, &row), true), "FILL");
    let row_al = doc.props(idx(&doc, &row)).auto_layout.clone().unwrap();
    assert!(!row_al.hugs_primary());
    assert_eq!(bounds(&doc, &list).2, 413.0);
    assert_eq!(bounds(&doc, &row).2, 413.0);
    assert_eq!(bounds(&doc, &title).2, 73.0);

    // A stretched stack that still hugs (as files can have it) needs its
    // content rather than its size.
    let r = idx(&doc, &row) as usize;
    let mut al = (*row_al).clone();
    al.primary_sizing = None;
    doc.nodes[r].props.auto_layout = Some(std::sync::Arc::new(al));
    doc.nodes[r].props.size = Some(Vec2::new(600.0, 20.0));
    set(&mut doc, &mut h, &title, r#"{"width":80}"#);
    assert_eq!(bounds(&doc, &list).2, 413.0);
}

#[test]
fn rows_align_baselines() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let row = make(
        &mut doc,
        &mut h,
        "0:1",
        r#"{"type":"FRAME","x":0,"y":0,"width":200,"height":100}"#,
    );
    let icon = make(
        &mut doc,
        &mut h,
        &row,
        r#"{"type":"RECTANGLE","x":0,"y":0,"width":20,"height":20}"#,
    );
    let label = make(
        &mut doc,
        &mut h,
        &row,
        r#"{"type":"TEXT","x":30,"y":0,"width":1,"height":1,"props":{"characters":"Days","fontSize":14}}"#,
    );
    set(
        &mut doc,
        &mut h,
        &row,
        r#"{"layoutMode":"HORIZONTAL","counterAlign":"BASELINE","sizingHorizontal":"HUG","sizingVertical":"HUG"}"#,
    );
    // The label's baseline sits on the icon's bottom.
    let p = doc.props(idx(&doc, &label));
    let base = f64::from(p.text_layout.as_ref().unwrap().glyphs[0].y);
    assert!(base < 20.0);
    assert_eq!(bounds(&doc, &icon).1, 0.0);
    assert!((bounds(&doc, &label).1 + base - 20.0).abs() < 1e-4);
    let below = bounds(&doc, &label).1 + bounds(&doc, &label).3;
    assert!((bounds(&doc, &row).3 - below.max(20.0)).abs() < 1e-4);
}

#[test]
fn strokes_take_space_when_the_frame_includes_them() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let frame = make(
        &mut doc,
        &mut h,
        "0:1",
        r#"{"type":"FRAME","x":0,"y":0,"width":400,"height":200}"#,
    );
    let mut kids = Vec::new();
    for x in [0, 100] {
        kids.push(make(
            &mut doc,
            &mut h,
            &frame,
            &format!(r#"{{"type":"RECTANGLE","x":{x},"y":0,"width":80,"height":80}}"#),
        ));
    }
    let outline = r#"{"strokes":[{"color":"000000"}],"strokeWeight":8,"strokeAlign":"OUTSIDE"}"#;
    for k in &kids {
        set(&mut doc, &mut h, k, outline);
    }
    set(
        &mut doc,
        &mut h,
        &frame,
        r#"{"strokes":[{"color":"000000"}],"strokeWeight":4,"strokeAlign":"INSIDE","layoutMode":"HORIZONTAL","sizingHorizontal":"HUG","sizingVertical":"HUG"}"#,
    );
    // Without the option strokes take no room.
    assert_eq!(bounds(&doc, &kids[1]).0, 80.0);
    let f = idx(&doc, &frame) as usize;
    let mut al = (**doc.nodes[f].props.auto_layout.as_ref().unwrap()).clone();
    al.strokes_in_layout = true;
    doc.nodes[f].props.auto_layout = Some(std::sync::Arc::new(al));
    set(&mut doc, &mut h, &frame, r#"{"itemSpacing":32}"#);
    // The frame's inner stroke pads it; each child takes 8 more a side.
    assert_eq!(bounds(&doc, &kids[0]).0, 12.0);
    assert_eq!(bounds(&doc, &kids[1]).0, 140.0);
    assert_eq!(bounds(&doc, &kids[1]).1, 12.0);
    assert_eq!(bounds(&doc, &frame).2, 4.0 + 96.0 + 32.0 + 96.0 + 4.0);
    assert_eq!(bounds(&doc, &frame).3, 104.0);

    // A divider: a line takes its stroke's thickness, above it.
    let column = make(
        &mut doc,
        &mut h,
        "0:1",
        r#"{"type":"FRAME","x":0,"y":300,"width":320,"height":10}"#,
    );
    let line = make(
        &mut doc,
        &mut h,
        &column,
        r#"{"type":"LINE","x":0,"y":300,"width":320,"height":0}"#,
    );
    set(
        &mut doc,
        &mut h,
        &line,
        r#"{"strokes":[{"color":"000000"}],"strokeWeight":1}"#,
    );
    set(
        &mut doc,
        &mut h,
        &column,
        r#"{"layoutMode":"VERTICAL","sizingHorizontal":"FIXED","sizingVertical":"HUG"}"#,
    );
    let c = idx(&doc, &column) as usize;
    let mut al = (**doc.nodes[c].props.auto_layout.as_ref().unwrap()).clone();
    al.strokes_in_layout = true;
    doc.nodes[c].props.auto_layout = Some(std::sync::Arc::new(al));
    set(&mut doc, &mut h, &line, r#"{"sizingHorizontal":"FILL"}"#);
    assert_eq!(bounds(&doc, &column).3, 1.0);
    assert_eq!(bounds(&doc, &line), (0.0, 1.0, 320.0, 0.0));
}
