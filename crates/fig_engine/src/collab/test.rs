use super::*;
use crate::edit::{History, Op};
use crate::images::ImageStore;
use crate::render::{self, RenderOptions, Viewport};
use crate::scene::Scene;
use crate::testing::showcase_file;
use std::collections::BTreeMap;

/// One person editing: a document, its undo history, and its collaboration
/// state, exchanging entries through a [`Hub`].
struct Peer {
    id: u64,
    doc: Document,
    history: History,
    collab: Collab,
}

impl Peer {
    fn open(id: u64, bytes: &[u8], hub: &mut Hub) -> Peer {
        let mut doc = Document::open(bytes).unwrap();
        let base = hub
            .value(container::META, meta::BASE_BLOBS)
            .map(|v| v.parse().unwrap());
        let (collab, meta) = Collab::new(&mut doc, 1000 + id as u32, base);
        let mut peer = Peer {
            id,
            doc,
            history: History::default(),
            collab,
        };
        hub.write(id, &meta);
        // Everything shared so far, as a joiner reads it.
        let all = hub.all();
        peer.collab.apply(&mut peer.doc, &all);
        hub.inbox.insert(id, BTreeSet::new());
        peer
    }

    /// Applies ops as one undoable step and publishes them.
    fn edit(&mut self, hub: &mut Hub, json: &str) -> Vec<String> {
        let ops: Vec<Op> = serde_json::from_str(json).unwrap();
        let applied = self.history.apply(&mut self.doc, &ops, None).unwrap();
        let mut touched = applied.touched;
        self.collab.record(&mut self.doc, &mut touched, false);
        self.publish(hub);
        applied.created
    }

    fn undo(&mut self, hub: &mut Hub) {
        let mut touched = self.history.undo(&mut self.doc).unwrap();
        self.collab.record(&mut self.doc, &mut touched, true);
        self.publish(hub);
    }

    fn redo(&mut self, hub: &mut Hub) {
        let mut touched = self.history.redo(&mut self.doc).unwrap();
        self.collab.record(&mut self.doc, &mut touched, true);
        self.publish(hub);
    }

    fn publish(&mut self, hub: &mut Hub) {
        let changes = self.collab.changes(&self.doc);
        hub.write(self.id, &changes);
    }

    /// Applies what others wrote since the last delivery, reading the
    /// shared values as they are now (as the web app does).
    fn receive(&mut self, hub: &mut Hub) -> Remote {
        let changes = hub.take(self.id);
        self.collab.apply(&mut self.doc, &changes)
    }

    fn find(&self, id: &str) -> NodeIdx {
        self.doc.find(Guid::parse(id).unwrap()).unwrap()
    }
}

/// An in-memory stand-in for the sync service's Loro maps: last writer wins
/// per entry, and each peer is told which entries others changed.
#[derive(Default)]
struct Hub {
    values: BTreeMap<(String, String), (u64, u64, String)>,
    clock: u64,
    inbox: HashMap<u64, BTreeSet<(String, String)>>,
}

impl Hub {
    fn write(&mut self, peer: u64, changes: &[EntryChange]) {
        self.clock += 1;
        for c in changes {
            let key = (c.container.clone(), c.key.clone());
            let value = c.value.clone().expect("peers never delete entries");
            let stamp = (self.clock, peer);
            let wins = self
                .values
                .get(&key)
                .is_none_or(|(clock, by, _)| stamp > (*clock, *by));
            if wins {
                self.values.insert(key.clone(), (stamp.0, stamp.1, value));
            }
            for (other, keys) in &mut self.inbox {
                if *other != peer {
                    keys.insert(key.clone());
                }
            }
        }
    }

    fn value(&self, container: &str, key: &str) -> Option<String> {
        self.values
            .get(&(container.to_owned(), key.to_owned()))
            .map(|(_, _, v)| v.clone())
    }

    fn take(&mut self, peer: u64) -> Vec<EntryChange> {
        let keys = std::mem::take(self.inbox.entry(peer).or_default());
        keys.into_iter()
            .map(|(container, key)| EntryChange {
                value: self.value(&container, &key),
                container,
                key,
            })
            .collect()
    }

    fn all(&self) -> Vec<EntryChange> {
        self.values
            .iter()
            .map(|((container, key), (_, _, value))| EntryChange {
                container: container.clone(),
                key: key.clone(),
                value: Some(value.clone()),
            })
            .collect()
    }
}

/// Every live node of a document, comparable across peers: blobs by
/// content, parents and children by id.
fn state(doc: &Document) -> BTreeMap<Guid, String> {
    let mut out = BTreeMap::new();
    for node in &doc.nodes {
        let Some(g) = node.props.guid else { continue };
        if node.removed {
            continue;
        }
        let mut blob = |b: u32| BlobRef::Shared(blob_key(doc.blobs.bytes(b).unwrap()).into());
        let props = base64(&Writer::new(&mut blob).node(&NodeState {
            props: node.props.clone(),
            removed: false,
            listed: true,
            // Peers that lost a write may know of more edited fields; saving
            // rewrites those with the same values.
            edits: 0,
            source: None,
        }));
        let parent = node.parent.and_then(|p| doc.props(p).guid);
        let children: Vec<Guid> = node
            .children
            .iter()
            .filter_map(|&c| doc.props(c).guid)
            .collect();
        out.insert(
            g,
            format!("{props} parent={parent:?} children={children:?}"),
        );
    }
    out
}

fn pixels(doc: &Document) -> Vec<Vec<u8>> {
    doc.pages
        .iter()
        .map(|&page| {
            let scene = Scene::build(doc, page);
            render::render(
                doc,
                &scene,
                &mut ImageStore::default(),
                &Viewport {
                    x: -50.0,
                    y: -50.0,
                    scale: 0.5,
                    width: 600,
                    height: 600,
                },
                RenderOptions::default(),
            )
            .unwrap()
            .take()
        })
        .collect()
}

fn assert_same(a: &Document, b: &Document) {
    let (sa, sb) = (state(a), state(b));
    for (g, va) in &sa {
        assert_eq!(Some(va), sb.get(g), "node {g} differs");
    }
    assert_eq!(sa.len(), sb.len(), "the same nodes are live");
    assert!(pixels(a) == pixels(b), "the pages render alike");
}

#[test]
fn entries_round_trip_every_property() {
    let mut doc = Document::open(&showcase_file()).unwrap();
    let mut h = History::default();
    // Text laid out by the engine (new glyph blobs), an override, a shadow.
    let ops: Vec<Op> = serde_json::from_str(
        r#"[{"op":"create","parent":"1:10","node":{"type":"TEXT","x":30,"y":40,"width":1,"height":1,"props":{"characters":"Hello","fontSize":18}}},
            {"op":"set","ids":["1:13"],"props":{"effects":[{"type":"DROP_SHADOW","x":2,"y":3,"radius":5}]}}]"#,
    )
    .unwrap();
    let text = h.apply(&mut doc, &ops, None).unwrap().created[0].clone();
    // Character styles with every field a run holds.
    let ops: Vec<Op> = serde_json::from_str(&format!(
        r#"[{{"op":"set","ids":["{text}"],"props":{{"textRange":[1,3],"fontStyle":"Bold","fontSize":20,
            "textDecoration":"UNDERLINE","textCase":"UPPER","fills":[{{"color":"FF0000"}}],
            "letterSpacing":{{"value":5,"unit":"PERCENT"}},"lineHeight":{{"value":30,"unit":"PIXELS"}}}}}}]"#
    ))
    .unwrap();
    h.apply(&mut doc, &ops, None).unwrap();
    for node in &doc.nodes {
        // Fields the showcase leaves unset are set here, so they round-trip too.
        let mut props = node.props.clone();
        props.stroke_sides = Some([1.0, 2.0, 3.0, 4.0]);
        set_design_system_fields(&mut props);
        set_handoff_fields(&mut props);
        if let Some(a) = &mut props.auto_layout {
            Arc::make_mut(a).strokes_in_layout = true;
        }
        if let Some(t) = &mut props.text_layout {
            Arc::make_mut(t).first_baseline = Some(13.5);
            Arc::make_mut(t).truncated_at = Some(7);
        }
        if let Some(g) = &props.fill_geometry {
            props.fill_geometry = Some(
                g.iter()
                    .map(|p| crate::model::PathRef { style: 2, ..*p })
                    .collect(),
            );
        }
        props.vector_styles = Some(Arc::from([crate::model::StyleRun {
            id: 2,
            fills: props.fills.clone(),
            ..Default::default()
        }]));
        props.generated = Some(Arc::from([crate::model::Props {
            guid_path: Some(Arc::from([crate::model::Guid {
                session: 40_000_000,
                local: 1,
            }])),
            text_layout: props.text_layout.clone(),
            fills: props.fills.clone(),
            ..Default::default()
        }]));
        props.boolean_operation = Some("SUBTRACT".into());
        props.vector_data = Some(Arc::new(crate::model::VectorData {
            network_blob: Some(3),
            normalized_size: Some(crate::model::Vec2 { x: 1.5, y: 2.5 }),
        }));
        props.interactions = Some(Arc::from([
            crate::model::Interaction {
                id: Some(Guid {
                    session: 7,
                    local: 9,
                }),
                trigger: "ON_CLICK".into(),
                timeout: None,
                actions: Arc::from([crate::model::Action {
                    easing: Some("OUT_CUBIC".into()),
                    overlay_offset: Some(crate::model::Vec2 { x: 4.0, y: 5.0 }),
                    ..crate::model::Action::navigate(Guid {
                        session: 1,
                        local: 11,
                    })
                }]),
            },
            crate::model::Interaction {
                id: None,
                trigger: "AFTER_TIMEOUT".into(),
                timeout: Some(0.8),
                actions: Arc::from([crate::model::Action {
                    connection: "URL".into(),
                    destination: None,
                    url: Some("https://macro.com".into()),
                    open_in_new_tab: Some(true),
                    ..crate::model::Action::navigate(Guid::default())
                }]),
            },
        ]));
        props.flow_start = Some(Arc::new(crate::model::FlowStart {
            name: "Flow 1".into(),
            description: "Sign in".into(),
            position: "!".into(),
        }));
        props.overlay = Some(Arc::new(crate::model::OverlaySettings {
            position: "TOP_LEFT".into(),
            close_on_click_outside: true,
            background: Some(crate::model::Color {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 0.5,
            }),
        }));
        props.prototype_start = Some(Guid {
            session: 1,
            local: 10,
        });
        props.library = Some(Arc::new(crate::model::LibraryLink {
            publishable: Some(true),
            version: Some("4f2a9c".into()),
            published_version: Some("4f2a9b".into()),
            source: Some("library-doc".into()),
            publish_id: Some(Guid {
                session: 3,
                local: 4,
            }),
        }));
        props.macro_data = Some(Arc::from([(Arc::from("libraries"), Arc::from("[]"))]));
        props.arc_data = Some([0.25, 4.5, 0.75]);
        let state = NodeState {
            props,
            removed: node.removed,
            listed: true,
            edits: node.edits,
            source: node.source,
        };
        let mut blob = |b: u32| BlobRef::Shared(b.to_string().into());
        let bytes = Writer::new(&mut blob).node(&state);
        let resolve = |r: &BlobRef| match r {
            BlobRef::Shared(k) => k.parse().ok(),
            BlobRef::Base(i) => Some(*i),
        };
        let back = Reader::new(&bytes, &resolve).node().unwrap();
        assert_eq!(back, state, "{:?}", node.props.guid);
    }
}

/// Export presets, layout grids, and guides: fields the showcase leaves
/// unset, each with values off their defaults.
fn set_handoff_fields(props: &mut crate::model::Props) {
    use crate::model::{
        Axis, Color, ExportConstraint, ExportFormat, ExportSetting, GridAlign, GridPattern, Guid,
        Guide, LayoutGrid,
    };
    props.export_settings = Some(Arc::from([
        ExportSetting::default(),
        ExportSetting {
            format: ExportFormat::Svg,
            suffix: "-dark".into(),
            constraint: ExportConstraint::ContentWidth,
            value: 512.0,
            svg_outline_text: false,
            svg_include_id: true,
            contents_only: false,
            use_absolute_bounds: true,
            quality: 42,
        },
    ]));
    props.layout_grids = Some(Arc::from([
        LayoutGrid::default_grid(),
        LayoutGrid {
            pattern: GridPattern::Stripes,
            axis: Axis::Y,
            align: GridAlign::Max,
            visible: false,
            count: i32::MAX,
            offset: 8.5,
            section_size: 64.0,
            gutter: 12.0,
            color: Color {
                r: 0.1,
                g: 0.2,
                b: 0.3,
                a: 0.4,
            },
        },
    ]));
    props.guides = Some(Arc::from([
        Guide {
            axis: Axis::X,
            offset: -12.25,
            guid: Some(Guid {
                session: 3,
                local: 9,
            }),
        },
        Guide {
            axis: Axis::Y,
            offset: 300.0,
            guid: None,
        },
    ]));
}

/// Components, variants, and styles: fields the showcase leaves unset.
fn set_design_system_fields(props: &mut crate::model::Props) {
    use crate::model::{
        Guid, PropAssignment, PropDef, PropValue, StyleType, VariantOrder, VariantSpec,
    };
    let g = |local| Guid { session: 7, local };
    props.prop_defs = Some(Arc::from([
        PropDef {
            id: g(1),
            name: "Label".into(),
            kind: "TEXT".into(),
            initial: Some(PropValue::Text("Go".into())),
            preferred: Arc::from([]),
        },
        PropDef {
            id: g(2),
            name: "Icon".into(),
            kind: "INSTANCE_SWAP".into(),
            initial: Some(PropValue::Symbol(g(9))),
            preferred: Arc::from([Arc::from("abc"), Arc::from("def")]),
        },
        PropDef {
            id: g(3),
            name: "Size".into(),
            kind: "VARIANT".into(),
            initial: None,
            preferred: Arc::from([]),
        },
    ]));
    props.prop_assignments = Some(Arc::from([
        PropAssignment {
            def_id: g(4),
            value: PropValue::Bool(true),
        },
        PropAssignment {
            def_id: g(5),
            value: PropValue::Other,
        },
    ]));
    props.text_style_id = Some(g(10));
    props.key = Some("0123abcd".into());
    props.style_type = Some(StyleType::Effect);
    props.sort_position = Some("a!".into());
    props.soft_deleted = Some(false);
    props.variant_specs = Some(Arc::from([VariantSpec {
        def_id: g(3),
        value: "Large".into(),
    }]));
    props.variant_orders = Some(Arc::from([VariantOrder {
        property: "Size".into(),
        values: Arc::from([Arc::from("Small"), Arc::from("Large")]),
    }]));
    props.props_bubbled = Some(true);
    use crate::model::{Color, Variable, VariableMode, VariableType, VariableValue};
    props.variable = Some(Arc::new(Variable {
        set: Some(g(20)),
        resolved_type: VariableType::Color,
        values: Arc::from([
            (g(21), VariableValue::Color(Color::WHITE)),
            (g(22), VariableValue::Alias(g(23))),
            (g(24), VariableValue::Float(2.5)),
            (g(25), VariableValue::Text("x".into())),
            (g(26), VariableValue::Bool(true)),
            (g(27), VariableValue::Other),
        ]),
    }));
    props.variable_modes = Some(Arc::from([VariableMode {
        id: g(21),
        name: "Light".into(),
    }]));
    props.mode_by_set = Some(Arc::from([(g(20), g(21))]));
    let mut pattern = crate::model::Paint::solid(Color::BLACK);
    pattern.kind = crate::model::PaintKind::Pattern(crate::model::PatternPaint {
        layout: crate::model::PatternLayout::HorizontalHexagonal,
        source: g(28),
        scale: 1.5,
        spacing: crate::model::Vec2::new(-0.2, 3.0),
        horizontal: crate::model::PatternAlign::Center,
        vertical: crate::model::PatternAlign::End,
    });
    let mut fills = props.fills().to_vec();
    fills.push(pattern);
    props.fills = Some(fills.into());
    if let Some(fills) = &props.fills {
        let mut list = fills.to_vec();
        for p in &mut list {
            p.color_var = Some(g(23));
        }
        props.fills = Some(list.into());
    }
}

#[test]
fn base64_and_keys() {
    for data in [&b""[..], b"f", b"fo", b"foo", b"foob", b"fooba", b"foobar"] {
        assert_eq!(unbase64(&base64(data)).as_deref(), Some(data));
    }
    assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    assert_eq!(base64(b"fo"), "Zm8=");
    assert_eq!(unbase64("not base64!"), None);
    assert_eq!(blob_key(b"a"), blob_key(b"a"));
    assert_ne!(blob_key(b"a"), blob_key(b"b"));
    assert_eq!(blob_key(b"").len(), 32);
}

#[test]
fn a_peer_converges_on_anothers_edits() {
    let bytes = showcase_file();
    let mut hub = Hub::default();
    let mut a = Peer::open(1, &bytes, &mut hub);
    let mut b = Peer::open(2, &bytes, &mut hub);
    a.edit(
        &mut hub,
        r#"[{"op":"translate","ids":["1:11"],"dx":12,"dy":-4}]"#,
    );
    a.edit(
        &mut hub,
        r#"[{"op":"set","ids":["1:13"],"props":{"fills":[{"color":"FF0000"}],"cornerRadius":12,"name":"Red card"}}]"#,
    );
    // Resizing a vector scales its geometry into new blobs.
    a.edit(
        &mut hub,
        r#"[{"op":"set","ids":["1:12"],"props":{"width":120}}]"#,
    );
    let text = a.edit(
        &mut hub,
        r#"[{"op":"create","parent":"1:10","node":{"type":"TEXT","x":30,"y":40,"width":1,"height":1,"props":{"characters":"Shared","fontSize":24}}}]"#,
    );
    a.edit(
        &mut hub,
        r#"[{"op":"set","ids":["1:14"],"props":{"opacity":0.5}}]"#,
    );
    let copies = a.edit(
        &mut hub,
        r#"[{"op":"duplicate","ids":["1:13"],"dx":10,"dy":10}]"#,
    );
    a.edit(
        &mut hub,
        &format!(r#"[{{"op":"group","ids":["{}","1:11"]}}]"#, copies[0]),
    );
    a.edit(&mut hub, r#"[{"op":"delete","ids":["1:21"]}]"#);
    a.edit(
        &mut hub,
        r#"[{"op":"reorder","ids":["1:12"],"parent":"1:20","index":0}]"#,
    );
    // A layer inside an instance (an override on the instance).
    a.edit(
        &mut hub,
        r#"[{"op":"set","ids":["I1:14;1:31"],"props":{"fills":[{"color":"00AA00"}]}}]"#,
    );
    a.edit(&mut hub, r#"[{"op":"autoLayout","ids":["1:20"]}]"#);
    a.edit(
        &mut hub,
        r#"[{"op":"set","ids":["1:20"],"props":{"itemSpacing":24,"paddingLeft":16}}]"#,
    );
    a.edit(
        &mut hub,
        r#"[{"op":"create","parent":"1:0","node":{"type":"CANVAS","name":"Third","x":0,"y":0,"width":0,"height":0}}]"#,
    );
    b.receive(&mut hub);
    assert!(b.doc.find(Guid::parse(&text[0]).unwrap()).is_some());
    assert_eq!(b.doc.pages.len(), 3);
    assert_same(&a.doc, &b.doc);
    assert!(!b.history.can_undo(), "remote changes stay out of undo");
}

#[test]
fn concurrent_edits_merge_and_the_same_node_resolves_last_writer_wins() {
    let bytes = showcase_file();
    let mut hub = Hub::default();
    let mut a = Peer::open(1, &bytes, &mut hub);
    let mut b = Peer::open(2, &bytes, &mut hub);
    // Different nodes, before either hears of the other.
    a.edit(
        &mut hub,
        r#"[{"op":"translate","ids":["1:11"],"dx":5,"dy":5}]"#,
    );
    b.edit(
        &mut hub,
        r#"[{"op":"set","ids":["1:13"],"props":{"fills":[{"color":"00FF00"}]}}]"#,
    );
    // The same node.
    a.edit(
        &mut hub,
        r#"[{"op":"set","ids":["1:21"],"props":{"fills":[{"color":"0000FF"}]}}]"#,
    );
    b.edit(
        &mut hub,
        r#"[{"op":"set","ids":["1:21"],"props":{"fills":[{"color":"FFFF00"}]}}]"#,
    );
    a.receive(&mut hub);
    b.receive(&mut hub);
    assert_same(&a.doc, &b.doc);
    let fill = &a.doc.props(a.find("1:21")).fills()[0];
    assert_eq!(
        fill.kind,
        crate::model::PaintKind::Solid(crate::edit::parse_hex("FFFF00").unwrap()),
        "the later write wins"
    );
    assert_eq!(
        a.doc.props(a.find("1:11")).transform().m02,
        b.doc.props(b.find("1:11")).transform().m02
    );
}

#[test]
fn concurrent_structure_changes_converge_and_ids_never_collide() {
    let bytes = showcase_file();
    let mut hub = Hub::default();
    let mut a = Peer::open(1, &bytes, &mut hub);
    let mut b = Peer::open(2, &bytes, &mut hub);
    let ra = a.edit(
        &mut hub,
        r#"[{"op":"create","parent":"1:10","node":{"type":"RECTANGLE","x":1,"y":1,"width":10,"height":10}}]"#,
    );
    let rb = b.edit(
        &mut hub,
        r#"[{"op":"create","parent":"1:10","node":{"type":"RECTANGLE","x":2,"y":2,"width":10,"height":10}}]"#,
    );
    assert_ne!(ra, rb, "each peer creates in its own session");
    // A groups two layers while B moves one of them and reorders another.
    a.edit(&mut hub, r#"[{"op":"group","ids":["1:11","1:12"]}]"#);
    b.edit(
        &mut hub,
        r#"[{"op":"translate","ids":["1:12"],"dx":40,"dy":0}]"#,
    );
    b.edit(
        &mut hub,
        r#"[{"op":"arrange","ids":["1:13"],"how":"front"}]"#,
    );
    a.receive(&mut hub);
    b.receive(&mut hub);
    assert_same(&a.doc, &b.doc);
    for id in [&ra[0], &rb[0]] {
        let i = a.find(id);
        assert!(!a.doc.node(i).removed);
        assert!(b.doc.find(Guid::parse(id).unwrap()).is_some());
    }
    // A later joiner sees the same.
    let c = Peer::open(3, &bytes, &mut hub);
    assert_same(&a.doc, &c.doc);
}

#[test]
fn undo_after_remote_edits_keeps_them() {
    let bytes = showcase_file();
    let mut hub = Hub::default();
    let mut a = Peer::open(1, &bytes, &mut hub);
    let mut b = Peer::open(2, &bytes, &mut hub);
    let mine = a.edit(
        &mut hub,
        r#"[{"op":"create","parent":"1:20","node":{"type":"ELLIPSE","x":5,"y":5,"width":20,"height":20}}]"#,
    );
    b.receive(&mut hub);
    let theirs = b.edit(
        &mut hub,
        r#"[{"op":"create","parent":"1:20","node":{"type":"RECTANGLE","x":50,"y":50,"width":20,"height":20}}]"#,
    );
    b.edit(
        &mut hub,
        r#"[{"op":"translate","ids":["1:21"],"dx":3,"dy":3}]"#,
    );
    a.receive(&mut hub);
    // A's undo removes A's ellipse; B's rectangle stays in the frame.
    a.undo(&mut hub);
    let frame = a.find("1:20");
    let children: Vec<String> = a
        .doc
        .node(frame)
        .children
        .iter()
        .map(|&c| a.doc.props(c).guid.unwrap().to_string())
        .collect();
    assert!(children.contains(&theirs[0]), "{children:?}");
    assert!(!children.contains(&mine[0]));
    assert!(a.doc.node(a.find(&mine[0])).removed);
    b.receive(&mut hub);
    assert_same(&a.doc, &b.doc);
    a.redo(&mut hub);
    b.receive(&mut hub);
    assert_same(&a.doc, &b.doc);
    assert!(!b.doc.node(b.find(&mine[0])).removed);
}

#[test]
fn saved_files_reopen_to_the_same_design() {
    let bytes = showcase_file();
    let mut hub = Hub::default();
    let mut a = Peer::open(1, &bytes, &mut hub);
    let mut b = Peer::open(2, &bytes, &mut hub);
    a.edit(
        &mut hub,
        r#"[{"op":"create","parent":"1:10","node":{"type":"TEXT","x":30,"y":40,"width":1,"height":1,"props":{"characters":"Saved","fontSize":20}}}]"#,
    );
    a.edit(
        &mut hub,
        r#"[{"op":"set","ids":["1:12"],"props":{"width":150}}]"#,
    );
    b.receive(&mut hub);
    b.edit(
        &mut hub,
        r#"[{"op":"duplicate","ids":["1:11"],"dx":0,"dy":30}]"#,
    );
    a.receive(&mut hub);
    assert_same(&a.doc, &b.doc);

    // Either peer's save holds the merged design.
    let saved_a = crate::save::save(&a.doc, &bytes).unwrap();
    let saved_b = crate::save::save(&b.doc, &bytes).unwrap();
    let reopened_a = Document::open(&saved_a).unwrap();
    let reopened_b = Document::open(&saved_b).unwrap();
    // (Text the engine laid out reopens with Figma's stored precision, so
    // the saves are compared with each other.)
    assert!(pixels(&reopened_a) == pixels(&reopened_b));
    assert_eq!(state(&reopened_a).len(), state(&a.doc).len());

    // Someone opening the saved file applies every entry again and ends up
    // with the same design; so do edits made after that.
    let mut d = Peer::open(4, &saved_a, &mut hub);
    assert_same(&a.doc, &d.doc);
    d.edit(
        &mut hub,
        r#"[{"op":"translate","ids":["1:12"],"dx":-20,"dy":0}]"#,
    );
    a.receive(&mut hub);
    b.receive(&mut hub);
    assert_same(&a.doc, &d.doc);
    assert_same(&b.doc, &d.doc);
    // And a save by the newer peer, opened by someone on the oldest file's
    // entries, still agrees.
    let saved_d = crate::save::save(&d.doc, &saved_a).unwrap();
    let e = Peer::open(5, &saved_d, &mut hub);
    assert_same(&a.doc, &e.doc);
}

#[test]
fn design_system_edits_reach_others_and_survive_saving() {
    let bytes = crate::testing::design_system::design_system_file();
    let mut hub = Hub::default();
    let mut a = Peer::open(1, &bytes, &mut hub);
    let mut b = Peer::open(2, &bytes, &mut hub);
    let named = |doc: &Document, name: &str, t: crate::model::NodeType| {
        doc.nodes
            .iter()
            .find(|n| !n.removed && n.props.name() == name && n.props.node_type() == t)
            .and_then(|n| n.props.guid)
            .unwrap()
            .to_string()
    };
    use crate::model::NodeType;
    let screen = a.find(&named(&a.doc, "Screen", NodeType::Frame));
    let instances: Vec<String> = a.doc.node(screen).children[..2]
        .iter()
        .map(|&c| a.doc.props(c).guid.unwrap().to_string())
        .collect();
    let (card, button) = (&instances[0], &instances[1]);
    let card_component = a.find(&named(&a.doc, "Card", NodeType::Symbol));
    let defs = a.doc.props(card_component).prop_defs.clone().unwrap();
    let set = named(&a.doc, "Button", NodeType::Frame);
    let swatch = named(&a.doc, "Swatch", NodeType::Rectangle);
    let brand = a
        .doc
        .nodes
        .iter()
        .find(|n| n.props.name() == "Brand/Primary")
        .and_then(|n| n.props.guid)
        .unwrap()
        .to_string();
    a.edit(
        &mut hub,
        &format!(
            r#"[{{"op":"setProperty","ids":["{card}"],"property":"{}","value":{{"bool":false}}}},
                {{"op":"setProperty","ids":["{card}"],"property":"{}","value":{{"text":"Shared title"}}}},
                {{"op":"setProperty","ids":["{button}"],"property":"Type","value":{{"variant":"Secondary"}}}}]"#,
            defs[0].id, defs[2].id
        ),
    );
    a.edit(
        &mut hub,
        &format!(
            r#"[{{"op":"addVariant","set":"{set}"}},
                {{"op":"addComponentProperty","component":"{set}","name":"Disabled","kind":"BOOL"}},
                {{"op":"editStyle","style":"{brand}","props":{{"fills":[{{"color":"00AA88"}}]}}}},
                {{"op":"createStyle","kind":"FILL","name":"Copied","from":"{swatch}"}}]"#
        ),
    );
    b.receive(&mut hub);
    assert_same(&a.doc, &b.doc);
    a.undo(&mut hub);
    b.receive(&mut hub);
    assert_same(&a.doc, &b.doc);
    a.redo(&mut hub);
    b.receive(&mut hub);
    assert_same(&a.doc, &b.doc);
    // Either save reopens to the same design, as does a joiner.
    let saved_a = crate::save::save(&a.doc, &bytes).unwrap();
    let saved_b = crate::save::save(&b.doc, &bytes).unwrap();
    assert!(
        pixels(&Document::open(&saved_a).unwrap()) == pixels(&Document::open(&saved_b).unwrap())
    );
    let c = Peer::open(3, &saved_a, &mut hub);
    assert_same(&a.doc, &c.doc);
    assert_eq!(
        crate::inspect::local_styles(&Document::open(&saved_b).unwrap()).len(),
        4
    );
}

#[test]
fn a_deleted_component_still_shows_in_its_instances() {
    let bytes = showcase_file();
    let mut hub = Hub::default();
    let mut a = Peer::open(1, &bytes, &mut hub);
    let mut b = Peer::open(2, &bytes, &mut hub);
    // The component's layers stay listed under it (removed with it), as
    // they do for the person who deleted it.
    a.edit(&mut hub, r#"[{"op":"delete","ids":["1:30"]}]"#);
    b.receive(&mut hub);
    let component = b.find("1:30");
    assert_eq!(b.doc.node(component).children, vec![b.find("1:31")]);
    assert_same(&a.doc, &b.doc);
    a.undo(&mut hub);
    b.receive(&mut hub);
    assert_same(&a.doc, &b.doc);
}

#[test]
fn entries_wait_for_their_blobs() {
    let bytes = showcase_file();
    let mut hub = Hub::default();
    let mut a = Peer::open(1, &bytes, &mut hub);
    let mut b = Peer::open(2, &bytes, &mut hub);
    let text = a.edit(
        &mut hub,
        r#"[{"op":"create","parent":"1:10","node":{"type":"TEXT","x":30,"y":40,"width":1,"height":1,"props":{"characters":"Glyphs","fontSize":20}}}]"#,
    );
    let changes = hub.take(2);
    let (blobs, nodes): (Vec<_>, Vec<_>) = changes
        .into_iter()
        .partition(|c| c.container == container::BLOBS);
    assert!(!blobs.is_empty(), "the glyph outlines are new blobs");
    b.collab.apply(&mut b.doc, &nodes);
    let id = Guid::parse(&text[0]).unwrap();
    assert!(b.doc.find(id).is_none(), "not applied yet");
    let remote = b.collab.apply(&mut b.doc, &blobs);
    assert!(remote.touched.contains(&b.doc.find(id).unwrap()));
    assert_same(&a.doc, &b.doc);
}

#[test]
fn shares_images_added_during_the_session() {
    let bytes = showcase_file();
    let mut hub = Hub::default();
    let mut a = Peer::open(1, &bytes, &mut hub);
    let mut b = Peer::open(2, &bytes, &mut hub);
    let mut pixmap = tiny_skia::Pixmap::new(4, 2).unwrap();
    pixmap.fill(tiny_skia::Color::from_rgba8(0, 128, 255, 255));
    let png = crate::images::encode_png(&pixmap);
    let hash = "00112233445566778899aabbccddeeff00112233";
    a.doc.add_image(hash, png);
    a.edit(
        &mut hub,
        &format!(r#"[{{"op":"set","ids":["1:13"],"props":{{"fills":[{{"image":"{hash}"}}]}}}}]"#),
    );
    let remote = b.receive(&mut hub);
    assert_eq!(remote.images, vec![hash.to_owned()]);
    assert_same(&a.doc, &b.doc);
}

#[test]
fn booleans_vectors_and_pasted_layers_converge() {
    let bytes = showcase_file();
    let mut hub = Hub::default();
    let mut a = Peer::open(1, &bytes, &mut hub);
    let mut b = Peer::open(2, &bytes, &mut hub);
    let shapes = a.edit(
        &mut hub,
        r#"[{"op":"create","parent":"1:10","node":{"type":"RECTANGLE","x":10,"y":20,"width":100,"height":50}},
            {"op":"create","parent":"1:10","node":{"type":"ELLIPSE","x":60,"y":40,"width":60,"height":60}}]"#,
    );
    let boolean = a.edit(
        &mut hub,
        &format!(
            r#"[{{"op":"boolean","ids":["{}","{}"],"operation":"SUBTRACT"}}]"#,
            shapes[0], shapes[1]
        ),
    );
    a.edit(
        &mut hub,
        &format!(
            r#"[{{"op":"set","ids":["{}"],"props":{{"width":80}}}}]"#,
            shapes[1]
        ),
    );
    let vector = a.edit(
        &mut hub,
        r#"[{"op":"createVector","parent":"1:10","network":{
            "vertices":[{"x":20,"y":30},{"x":80,"y":30},{"x":80,"y":90}],
            "segments":[{"start":0,"end":1},{"start":1,"end":2,"tangentStart":{"x":20,"y":0}}]}}]"#,
    );
    a.edit(
        &mut hub,
        &format!(
            r#"[{{"op":"setVector","id":"{}","network":{{
            "vertices":[{{"x":0,"y":0}},{{"x":80,"y":30}},{{"x":80,"y":90}}],
            "segments":[{{"start":0,"end":1}},{{"start":1,"end":2}}]}}}}]"#,
            vector[0]
        ),
    );
    let flat = a.edit(
        &mut hub,
        &format!(r#"[{{"op":"flatten","ids":["{}"]}}]"#, boolean[0]),
    );
    // Layers pasted from another file, with an image the file lacks.
    let mut source = Document::open(&bytes).unwrap();
    let mut pixmap = tiny_skia::Pixmap::new(2, 2).unwrap();
    pixmap.fill(tiny_skia::Color::from_rgba8(200, 40, 10, 255));
    let hash = "fedcba9876543210fedcba9876543210fedcba98";
    source
        .add_image(hash, crate::images::encode_png(&pixmap))
        .unwrap();
    let ops: Vec<Op> = serde_json::from_str(&format!(
        r#"[{{"op":"set","ids":["1:13"],"props":{{"fills":[{{"image":"{hash}"}}]}}}}]"#
    ))
    .unwrap();
    History::default().apply(&mut source, &ops, None).unwrap();
    let ids = ["1:12", "1:13"].map(|id| source.find(Guid::parse(id).unwrap()).unwrap());
    let copied = crate::save::copy(&source, &bytes, &ids).unwrap();
    let spec: crate::edit::PasteSpec = serde_json::from_str(r#"{"parent":"1:20"}"#).unwrap();
    let applied = a
        .history
        .paste(
            &mut a.doc,
            &bytes,
            &copied.document,
            Some(&copied.images),
            &spec,
        )
        .unwrap();
    assert_eq!(applied.created.len(), 2);
    let mut touched = applied.touched;
    a.collab.record(&mut a.doc, &mut touched, false);
    a.publish(&mut hub);

    let remote = b.receive(&mut hub);
    assert_eq!(remote.images, vec![hash.to_owned()]);
    let flat = b.find(&flat[0]);
    assert_eq!(
        b.doc.props(flat).node_type(),
        crate::model::NodeType::Vector
    );
    assert!(crate::vector::node_network(&b.doc, b.doc.props(flat)).is_some());
    assert!(b.doc.node(b.find(&boolean[0])).removed);
    assert_same(&a.doc, &b.doc);
    // Undoing the paste and then the flatten brings the boolean back on both.
    a.undo(&mut hub);
    a.undo(&mut hub);
    b.receive(&mut hub);
    assert_eq!(
        b.doc.props(b.find(&boolean[0])).node_type(),
        crate::model::NodeType::BooleanOperation
    );
    assert_same(&a.doc, &b.doc);
}

#[test]
fn nothing_to_share_without_edits() {
    let bytes = showcase_file();
    let mut hub = Hub::default();
    let mut a = Peer::open(1, &bytes, &mut hub);
    assert!(a.collab.changes(&a.doc).is_empty());
    // A node created and undone before anyone saw it is never written.
    let ops: Vec<Op> = serde_json::from_str(
        r#"[{"op":"create","parent":"1:10","node":{"type":"RECTANGLE","x":1,"y":1,"width":10,"height":10}}]"#,
    )
    .unwrap();
    let mut touched = a.history.apply(&mut a.doc, &ops, None).unwrap().touched;
    a.collab.record(&mut a.doc, &mut touched, false);
    let mut touched = a.history.undo(&mut a.doc).unwrap();
    a.collab.record(&mut a.doc, &mut touched, true);
    let changes = a.collab.changes(&a.doc);
    assert!(
        changes.iter().all(|c| c.key != "1001:1"),
        "{:?}",
        changes.iter().map(|c| &c.key).collect::<Vec<_>>()
    );
}

#[test]
fn prototype_edits_reach_other_people_and_their_saves() {
    let bytes = crate::testing::prototype_file();
    let mut hub = Hub::default();
    let mut a = Peer::open(1, &bytes, &mut hub);
    let mut b = Peer::open(2, &bytes, &mut hub);
    a.edit(
        &mut hub,
        r#"[{"op":"setInteractions","id":"1:22","interactions":[
              {"id":"1:122","actions":[{"transition":"SLIDE_FROM_LEFT","duration":0.6}]},
              {"trigger":"ON_HOVER","actions":[{"destination":"1:30","navigation":"OVERLAY"}]}]},
            {"op":"setFlowStart","id":"1:50","name":"Side trip"}]"#,
    );
    b.receive(&mut hub);
    assert_same(&a.doc, &b.doc);
    let props = b.doc.props(b.find("1:22"));
    let list = props.interactions.as_deref().unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(&*list[0].actions[0].transition, "SLIDE_FROM_LEFT");
    // B stores the file; a joiner from it sees the same prototype.
    let saved = crate::save::save(&b.doc, &bytes).unwrap();
    let c = Peer::open(3, &saved, &mut hub);
    assert_same(&a.doc, &c.doc);
}

#[test]
fn reads_entries_before_arc_metadata_was_added() {
    use codec::{BlobRef, NodeState, Reader, Writer};
    let state = NodeState {
        props: crate::model::Props::default(),
        removed: false,
        listed: true,
        edits: 0,
        source: None,
    };
    let mut blobs = |index| BlobRef::Base(index);
    let mut bytes = Writer::new(&mut blobs).node(&state);
    // Version 1 ended Props after `recomputed`; version 2 appends arc_data.
    // The four final bytes are NodeState's booleans, zero edits, and no source.
    assert_eq!(bytes.remove(bytes.len() - 5), 0);
    bytes[0] = 1;
    let resolve = |_: &BlobRef| None;
    assert_eq!(Reader::new(&bytes, &resolve).node().unwrap(), state);
}
