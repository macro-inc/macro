//! A small clickable prototype, built from scratch: the browser fixture's
//! `prototype.fig` and the engine's prototype tests.
//!
//! One page, "Flow": `Start` (a flow starting point) goes to `Details`
//! with a dissolve and opens the `Menu` overlay; `Details` goes back and on
//! to `Done` with a slide; the menu closes itself; `Done` links out and,
//! through the legacy connection fields, back to the start. `Unlinked` is
//! a frame no flow reaches.

use super::{SCHEMA, V, color, fig_file_with, guid, node, size, solid, translate};

/// [`SCHEMA`] with Figma's prototype types and fields (and one field the
/// engine does not model, `extraScrollOffset`, to check saving keeps it).
pub fn prototype_schema() -> String {
    let types = "
enum InteractionType ON_CLICK AFTER_TIMEOUT MOUSE_IN MOUSE_OUT ON_HOVER MOUSE_DOWN MOUSE_UP ON_PRESS NONE DRAG
enum TransitionType INSTANT_TRANSITION DISSOLVE FADE SLIDE_FROM_LEFT SLIDE_FROM_RIGHT SLIDE_FROM_TOP SLIDE_FROM_BOTTOM PUSH_FROM_LEFT PUSH_FROM_RIGHT PUSH_FROM_TOP PUSH_FROM_BOTTOM MOVE_FROM_LEFT MOVE_FROM_RIGHT MOVE_FROM_TOP MOVE_FROM_BOTTOM SLIDE_OUT_TO_LEFT SLIDE_OUT_TO_RIGHT MOVE_OUT_TO_LEFT MOVE_OUT_TO_RIGHT SMART_ANIMATE
enum EasingType IN_CUBIC OUT_CUBIC INOUT_CUBIC LINEAR
enum ConnectionType NONE INTERNAL_NODE URL BACK CLOSE
enum NavigationType NAVIGATE OVERLAY SWAP SWAP_STATE SCROLL_TO
enum OverlayPositionType CENTER TOP_LEFT TOP_CENTER TOP_RIGHT BOTTOM_LEFT BOTTOM_CENTER BOTTOM_RIGHT MANUAL
enum OverlayBackgroundInteraction NONE CLOSE_ON_CLICK_OUTSIDE
enum OverlayBackgroundType NONE SOLID_COLOR
message OverlayBackgroundAppearance backgroundType:OverlayBackgroundType backgroundColor:Color
message PrototypeEvent interactionType:InteractionType transitionTimeout:float
message PrototypeAction transitionNodeID:GUID transitionType:TransitionType transitionDuration:float easingType:EasingType connectionType:ConnectionType connectionURL:string navigationType:NavigationType overlayRelativePosition:Vector openUrlInNewTab:bool extraScrollOffset:Vector
message PrototypeInteraction id:GUID event:PrototypeEvent actions:PrototypeAction[] isDeleted:bool
message PrototypeStartingPoint name:string description:string position:string
";
    let fields = " prototypeInteractions:PrototypeInteraction[] prototypeStartingPoint:PrototypeStartingPoint prototypeStartNodeID:GUID transitionNodeID:GUID connectionType:ConnectionType transitionType:TransitionType overlayPositionType:OverlayPositionType overlayBackgroundInteraction:OverlayBackgroundInteraction overlayBackgroundAppearance:OverlayBackgroundAppearance";
    let mut out = String::new();
    for line in SCHEMA.lines() {
        out.push_str(line);
        if line.starts_with("message NodeChange ") {
            out.push_str(fields);
        }
        out.push('\n');
    }
    out.push_str(types);
    out
}

/// One interaction: `trigger` runs `actions`.
pub fn interaction(local: u32, trigger: &'static str, actions: Vec<V>) -> V {
    V::Msg(vec![
        ("id", guid(local)),
        ("event", V::Msg(vec![("interactionType", V::Enum(trigger))])),
        ("actions", V::List(actions)),
        ("isDeleted", V::Bool(false)),
    ])
}

/// An action going to node `local`.
pub fn go(local: u32, navigation: &'static str, transition: &'static str) -> V {
    V::Msg(vec![
        ("transitionNodeID", guid(local)),
        ("transitionType", V::Enum(transition)),
        ("transitionDuration", V::Float(0.3)),
        ("easingType", V::Enum("OUT_CUBIC")),
        ("connectionType", V::Enum("INTERNAL_NODE")),
        ("navigationType", V::Enum(navigation)),
        ("extraScrollOffset", size(0.0, 12.0)),
    ])
}

fn connection(kind: &'static str) -> V {
    V::Msg(vec![("connectionType", V::Enum(kind))])
}

fn frame(
    local: u32,
    position: &str,
    name: &str,
    at: (f32, f32),
    wh: (f32, f32),
    rgb: (f32, f32, f32),
    mut rest: Vec<(&'static str, V)>,
) -> V {
    let mut fields = vec![
        ("size", size(wh.0, wh.1)),
        ("transform", translate(at.0, at.1)),
        ("fillPaints", V::List(vec![solid(rgb.0, rgb.1, rgb.2)])),
    ];
    fields.append(&mut rest);
    node(local, Some((1, position)), "FRAME", name, fields)
}

fn button(
    local: u32,
    parent: u32,
    position: &str,
    name: &str,
    at: (f32, f32),
    interactions: Vec<V>,
) -> V {
    let mut fields = vec![
        ("size", size(120.0, 40.0)),
        ("transform", translate(at.0, at.1)),
        ("cornerRadius", V::Float(8.0)),
        ("fillPaints", V::List(vec![solid(0.1, 0.1, 0.1)])),
    ];
    if !interactions.is_empty() {
        fields.push(("prototypeInteractions", V::List(interactions)));
    }
    node(local, Some((parent, position)), "RECTANGLE", name, fields)
}

pub fn prototype_file() -> Vec<u8> {
    fig_file_with(
        &prototype_schema(),
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(
                1,
                Some((0, "a")),
                "CANVAS",
                "Flow",
                vec![("backgroundColor", color(0.9, 0.9, 0.9, 1.0))],
            ),
            frame(
                10,
                "a",
                "Start",
                (0.0, 0.0),
                (320.0, 480.0),
                (0.2, 0.4, 0.9),
                vec![(
                    "prototypeStartingPoint",
                    V::Msg(vec![
                        ("name", V::Str("Onboarding".into())),
                        ("description", V::Str("From the start".into())),
                        ("position", V::Str("!".into())),
                    ]),
                )],
            ),
            button(
                11,
                10,
                "a",
                "Next",
                (100.0, 400.0),
                vec![interaction(
                    111,
                    "ON_CLICK",
                    vec![go(20, "NAVIGATE", "DISSOLVE")],
                )],
            ),
            button(
                12,
                10,
                "b",
                "Open menu",
                (20.0, 20.0),
                vec![interaction(
                    112,
                    "ON_CLICK",
                    vec![go(30, "OVERLAY", "INSTANT_TRANSITION")],
                )],
            ),
            frame(
                20,
                "b",
                "Details",
                (400.0, 0.0),
                (320.0, 480.0),
                (0.2, 0.7, 0.3),
                vec![],
            ),
            button(
                21,
                20,
                "a",
                "Back",
                (20.0, 20.0),
                vec![interaction(121, "ON_CLICK", vec![connection("BACK")])],
            ),
            button(
                22,
                20,
                "b",
                "Finish",
                (100.0, 400.0),
                vec![interaction(
                    122,
                    "ON_CLICK",
                    vec![go(40, "NAVIGATE", "MOVE_FROM_RIGHT")],
                )],
            ),
            frame(
                30,
                "c",
                "Menu",
                (800.0, 0.0),
                (240.0, 300.0),
                (1.0, 1.0, 1.0),
                vec![
                    ("overlayPositionType", V::Enum("CENTER")),
                    (
                        "overlayBackgroundInteraction",
                        V::Enum("CLOSE_ON_CLICK_OUTSIDE"),
                    ),
                    (
                        "overlayBackgroundAppearance",
                        V::Msg(vec![
                            ("backgroundType", V::Enum("SOLID_COLOR")),
                            ("backgroundColor", color(0.0, 0.0, 0.0, 0.5)),
                        ]),
                    ),
                ],
            ),
            button(
                31,
                30,
                "a",
                "Close",
                (60.0, 240.0),
                vec![interaction(131, "ON_CLICK", vec![connection("CLOSE")])],
            ),
            frame(
                40,
                "d",
                "Done",
                (1100.0, 0.0),
                (320.0, 480.0),
                (0.95, 0.55, 0.15),
                vec![],
            ),
            button(
                41,
                40,
                "a",
                "Site",
                (100.0, 400.0),
                vec![interaction(
                    141,
                    "ON_CLICK",
                    vec![V::Msg(vec![
                        ("connectionType", V::Enum("URL")),
                        ("connectionURL", V::Str("https://example.com/".into())),
                    ])],
                )],
            ),
            // A connection in the fields files had before interactions.
            node(
                42,
                Some((40, "b")),
                "RECTANGLE",
                "Restart",
                vec![
                    ("size", size(120.0, 40.0)),
                    ("transform", translate(100.0, 20.0)),
                    ("fillPaints", V::List(vec![solid(0.1, 0.1, 0.1)])),
                    ("transitionNodeID", guid(10)),
                    ("connectionType", V::Enum("INTERNAL_NODE")),
                    ("transitionType", V::Enum("DISSOLVE")),
                ],
            ),
            frame(
                50,
                "e",
                "Unlinked",
                (0.0, 600.0),
                (320.0, 200.0),
                (0.6, 0.6, 0.6),
                vec![],
            ),
        ],
        vec![],
    )
}

/// The committed fixture must match what [`prototype_file`] writes; run
/// `cargo test -p fig_engine --lib write_prototype_fixture -- --ignored`
/// after changing it.
#[test]
fn prototype_fixture_is_current() {
    let committed = include_bytes!("../../tests/fixtures/prototype.fig");
    assert!(
        committed.as_slice() == prototype_file().as_slice(),
        "tests/fixtures/prototype.fig is stale; regenerate it (see the doc comment)"
    );
}

#[test]
#[ignore = "writes tests/fixtures/prototype.fig"]
fn write_prototype_fixture() {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/prototype.fig");
    std::fs::write(path, prototype_file()).unwrap();
}
