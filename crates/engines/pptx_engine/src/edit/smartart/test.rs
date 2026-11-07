//! SmartArt tests: inserting each layout, editing nodes, colors, styles,
//! converting, saving, and reading PowerPoint's own diagrams.

use super::catalog::LAYOUTS;
use crate::edit::{EditOp, NewShape, SmartArtEdit, SmartArtItem, SmartArtPosition, SmartArtTarget};
use crate::inspect::{ShapeOutline, SmartArtOutline};
use crate::model::presentation::Presentation;
use crate::test_support::{deck, fonts};
use crate::xml::{Ns, XmlDoc};

/// PowerPoint's default SmartArt box on a 16:9 slide (points).
const BOX: [f32; 4] = [160.0, 56.7, 640.0, 426.7];

fn items(spec: &[(u8, &str)]) -> Vec<SmartArtItem> {
    spec.iter()
        .map(|(level, text)| SmartArtItem {
            text: (*text).to_owned(),
            level: *level,
        })
        .collect()
}

/// A one-slide deck with a new SmartArt graphic; returns it and the frame id.
fn insert(layout: &str, nodes: Option<&[(u8, &str)]>) -> (Presentation, u32) {
    let mut pres = Presentation::open(deck(&[""])).unwrap();
    let result = pres
        .apply(
            &[EditOp::AddShape {
                slide: 256,
                shape: NewShape::SmartArt {
                    layout: layout.into(),
                    items: nodes.map(items),
                    colors: None,
                    style: None,
                },
                x: BOX[0],
                y: BOX[1],
                w: BOX[2],
                h: BOX[3],
            }],
            fonts(),
        )
        .unwrap();
    let id = result.created[0].shape.unwrap();
    (pres, id)
}

fn shape(pres: &mut Presentation, id: u32) -> ShapeOutline {
    let outline = pres.slide_outline_with_fonts(0, fonts()).unwrap();
    outline.shapes.into_iter().find(|s| s.id == id).unwrap()
}

fn smart(pres: &mut Presentation, id: u32) -> SmartArtOutline {
    shape(pres, id).smart_art.expect("a SmartArt outline")
}

fn edit(pres: &mut Presentation, id: u32, edit: SmartArtEdit) -> crate::error::Result<()> {
    pres.apply(
        &[EditOp::EditSmartArt {
            slide: 256,
            shape: id,
            edit,
        }],
        fonts(),
    )
    .map(|_| ())
}

/// The drawing part's XML of the frame `id`.
fn drawing(pres: &mut Presentation, id: u32) -> std::sync::Arc<XmlDoc> {
    let part = pres.slide_part(256).unwrap();
    let doc = pres.xml(&part).unwrap();
    let frame = crate::edit::xmlutil::find_shape(&doc, id).unwrap();
    let parts = super::parts_of(pres, &part, frame).unwrap();
    pres.xml(&parts.drawing.unwrap()).unwrap()
}

/// `(x, y, w, h)` of every drawing shape, and whether it has text.
fn drawn(pres: &mut Presentation, id: u32) -> Vec<([f32; 4], String)> {
    let doc = drawing(pres, id);
    doc.descendants(doc.root())
        .into_iter()
        .filter(|&n| doc.ns(n) == Ns::DSP && doc.local(n) == "sp")
        .map(|sp| {
            let x = doc
                .child(sp, Ns::DSP, "spPr")
                .and_then(|s| doc.child(s, Ns::A, "xfrm"))
                .map(|x| crate::model::shape::Xfrm::parse(&doc, x))
                .unwrap();
            let text = doc
                .child(sp, Ns::DSP, "txBody")
                .map(|b| super::data::plain_text(&doc, b))
                .unwrap_or_default();
            ([x.x, x.y, x.w, x.h], text)
        })
        .collect()
}

#[test]
fn every_supported_layout_inserts_with_sample_nodes() {
    for info in LAYOUTS.iter().filter(|l| l.kind.is_some()) {
        let (mut pres, id) = insert(info.short, None);
        let s = smart(&mut pres, id);
        assert_eq!(s.layout.id, info.id(), "{}", info.short);
        assert_eq!(s.layout.name, info.name);
        assert!(s.layout.supported);
        assert!(!s.nodes.is_empty(), "{}", info.short);
        assert!(s.colors.ends_with("/accent1_2"));
        assert!(s.style.ends_with("/simple1"));
        let shapes = drawn(&mut pres, id);
        assert!(!shapes.is_empty(), "{} drew nothing", info.short);
        // Everything stays inside the frame.
        for ([x, y, w, h], _) in &shapes {
            assert!(
                *x >= -0.5 && *y >= -0.5 && x + w <= BOX[2] + 0.5 && y + h <= BOX[3] + 0.5,
                "{}: shape at {x},{y} {w}x{h} leaves the frame",
                info.short
            );
        }
        // Each top-level node of a simple layout has a frame for editing.
        for n in s.nodes.iter().filter(|n| n.level == 1).take(1) {
            assert!(n.frame.is_some(), "{} node without a frame", info.short);
        }
    }
}

fn texts(s: &SmartArtOutline) -> Vec<(u8, String)> {
    s.nodes.iter().map(|n| (n.level, n.text.clone())).collect()
}

fn node_id(s: &SmartArtOutline, text: &str) -> String {
    s.nodes.iter().find(|n| n.text == text).unwrap().id.clone()
}

/// The data part's XML of the frame `id`, as text.
fn data_xml(pres: &mut Presentation, id: u32) -> String {
    let part = pres.slide_part(256).unwrap();
    let doc = pres.xml(&part).unwrap();
    let frame = crate::edit::xmlutil::find_shape(&doc, id).unwrap();
    let parts = super::parts_of(pres, &part, frame).unwrap();
    String::from_utf8(pres.xml(&parts.data).unwrap().to_bytes()).unwrap()
}

#[test]
fn text_edits_change_the_data_and_the_drawing() {
    let (mut pres, id) = insert("process1", Some(&[(1, "Plan"), (1, "Build"), (1, "Ship")]));
    let s = smart(&mut pres, id);
    assert_eq!(
        texts(&s),
        [(1, "Plan".into()), (1, "Build".into()), (1, "Ship".into())]
    );
    let build = node_id(&s, "Build");
    let before = drawn(&mut pres, id);
    edit(
        &mut pres,
        id,
        SmartArtEdit::SetText {
            node: build.clone(),
            text: "Build and test everything thoroughly".into(),
        },
    )
    .unwrap();
    assert!(data_xml(&mut pres, id).contains("Build and test everything thoroughly"));
    let after = drawn(&mut pres, id);
    assert!(
        after
            .iter()
            .any(|(_, t)| t == "Build and test everything thoroughly")
    );
    // The longer text shrinks every node's text together.
    let s = smart(&mut pres, id);
    let sizes: Vec<f32> = s.nodes.iter().filter_map(|n| n.font_size).collect();
    assert_eq!(sizes.len(), 3);
    assert!(sizes.iter().all(|&z| z == sizes[0]));
    assert_eq!(before.len(), after.len());
    // The node keeps its id and its frame.
    assert!(s.nodes.iter().any(|n| n.id == build && n.frame.is_some()));
}

#[test]
fn nodes_are_added_deleted_promoted_demoted_and_moved() {
    let (mut pres, id) = insert("vList2", Some(&[(1, "A"), (2, "a1"), (1, "B")]));
    let s = smart(&mut pres, id);
    let (a, b) = (node_id(&s, "A"), node_id(&s, "B"));
    let add = |node: &str, position: SmartArtPosition, text: &str| SmartArtEdit::AddNode {
        node: Some(node.to_owned()),
        position,
        text: text.to_owned(),
    };
    edit(&mut pres, id, add(&a, SmartArtPosition::After, "after A")).unwrap();
    edit(&mut pres, id, add(&a, SmartArtPosition::Before, "before A")).unwrap();
    edit(&mut pres, id, add(&b, SmartArtPosition::Below, "under B")).unwrap();
    edit(&mut pres, id, add(&b, SmartArtPosition::Above, "over B")).unwrap();
    let s = smart(&mut pres, id);
    assert_eq!(
        texts(&s),
        [
            (1, "before A".into()),
            (1, "A".into()),
            (2, "a1".into()),
            (1, "after A".into()),
            (1, "over B".into()),
            (2, "B".into()),
            (3, "under B".into()),
        ]
    );
    // Promote, demote, move, delete.
    edit(&mut pres, id, SmartArtEdit::Promote { node: b.clone() }).unwrap();
    edit(
        &mut pres,
        id,
        SmartArtEdit::Demote {
            node: node_id(&s, "after A"),
        },
    )
    .unwrap();
    edit(
        &mut pres,
        id,
        SmartArtEdit::MoveUp {
            node: node_id(&s, "A"),
        },
    )
    .unwrap();
    edit(
        &mut pres,
        id,
        SmartArtEdit::DeleteNode {
            node: node_id(&s, "over B"),
        },
    )
    .unwrap();
    let s = smart(&mut pres, id);
    assert_eq!(
        texts(&s),
        [
            (1, "A".into()),
            (2, "a1".into()),
            (2, "after A".into()),
            (1, "before A".into()),
            (1, "B".into()),
            (2, "under B".into()),
        ]
    );
    // A new node without text shows the prompt and fits like "[Text]".
    edit(
        &mut pres,
        id,
        SmartArtEdit::AddNode {
            node: None,
            position: SmartArtPosition::After,
            text: String::new(),
        },
    )
    .unwrap();
    let s = smart(&mut pres, id);
    let last = s.nodes.last().unwrap();
    assert_eq!((last.level, last.text.as_str()), (1, ""));
    assert!(last.frame.is_some() && last.font_size.is_some());
    // Bad moves are refused and change nothing.
    assert!(edit(&mut pres, id, SmartArtEdit::Promote { node: a.clone() }).is_err());
    assert!(
        edit(
            &mut pres,
            id,
            SmartArtEdit::DeleteNode {
                node: "{nope}".into()
            }
        )
        .is_err()
    );
    // Undo-friendly: the drawing has one bar per top-level node.
    let bars = drawn(&mut pres, id).len();
    assert!(bars >= 4);
}

#[test]
fn set_nodes_replaces_the_outline_reusing_nodes() {
    let (mut pres, id) = insert("default", None);
    let first = smart(&mut pres, id).nodes[0].id.clone();
    edit(
        &mut pres,
        id,
        SmartArtEdit::SetNodes {
            items: items(&[(1, "North"), (1, "South"), (2, "Coast"), (1, "West")]),
        },
    )
    .unwrap();
    let s = smart(&mut pres, id);
    assert_eq!(
        texts(&s),
        [
            (1, "North".into()),
            (1, "South".into()),
            (2, "Coast".into()),
            (1, "West".into())
        ]
    );
    assert_eq!(s.nodes[0].id, first);
    assert_eq!(drawn(&mut pres, id).len(), 3);
}

#[test]
fn layout_colors_and_style_change() {
    let (mut pres, id) = insert("process1", Some(&[(1, "A"), (1, "B"), (1, "C")]));
    edit(
        &mut pres,
        id,
        SmartArtEdit::SetLayout {
            layout: "Basic Cycle".into(),
        },
    )
    .unwrap();
    let s = smart(&mut pres, id);
    assert!(s.layout.id.ends_with("/cycle2"));
    assert_eq!(s.layout.name, "Basic Cycle");
    assert_eq!(texts(&s).len(), 3);
    let doc = drawing(&mut pres, id);
    let geoms: Vec<&str> = doc
        .descendants(doc.root())
        .into_iter()
        .filter(|&n| doc.local(n) == "prstGeom")
        .filter_map(|n| doc.attr(n, "prst"))
        .collect();
    assert_eq!(geoms.iter().filter(|g| **g == "ellipse").count(), 3);
    // Colorful: each node a different accent.
    edit(
        &mut pres,
        id,
        SmartArtEdit::SetColors {
            colors: "colorful1".into(),
        },
    )
    .unwrap();
    let s = smart(&mut pres, id);
    assert!(s.colors.ends_with("/colorful1"));
    assert_eq!(s.colors_name.as_deref(), Some("Colorful - Accent Colors"));
    let doc = drawing(&mut pres, id);
    let fills: std::collections::HashSet<String> = doc
        .descendants(doc.root())
        .into_iter()
        .filter(|&n| doc.local(n) == "solidFill")
        .filter_map(|n| doc.first_child(n))
        .filter_map(|c| doc.attr(c, "val").map(str::to_owned))
        .collect();
    assert!(fills.contains("accent2") && fills.contains("accent3") && fills.contains("accent4"));
    // Gradient range: offsets interpolate between the ends.
    edit(
        &mut pres,
        id,
        SmartArtEdit::SetColors {
            colors: "accent2_3".into(),
        },
    )
    .unwrap();
    let xml = String::from_utf8(drawing(&mut pres, id).to_bytes()).unwrap();
    assert!(xml.contains("accent2") && xml.contains("lumOff val=\"") && !xml.contains("colorful"));
    edit(
        &mut pres,
        id,
        SmartArtEdit::SetStyle {
            style: "simple5".into(),
        },
    )
    .unwrap();
    let s = smart(&mut pres, id);
    assert_eq!(s.style_name.as_deref(), Some("Intense Effect"));
    assert!(data_xml(&mut pres, id).contains("quickstyle/simple5"));
    assert!(
        edit(
            &mut pres,
            id,
            SmartArtEdit::SetLayout {
                layout: "nope".into()
            }
        )
        .is_err()
    );
    assert!(
        edit(
            &mut pres,
            id,
            SmartArtEdit::SetColors {
                colors: "pink".into()
            }
        )
        .is_err()
    );
    // The replaced definitions are not left behind.
    let names: Vec<String> = pres
        .package()
        .part_names()
        .filter(|n| n.starts_with("/ppt/diagrams/"))
        .map(str::to_owned)
        .collect();
    assert_eq!(names.len(), 5, "{names:?}");
}

#[test]
fn reset_graphic_drops_customizations() {
    let (mut pres, id) = insert("default", Some(&[(1, "A"), (1, "B")]));
    // Customize like PowerPoint: a presentation point with a custom size.
    let part = pres.slide_part(256).unwrap();
    let doc = pres.xml(&part).unwrap();
    let frame = crate::edit::xmlutil::find_shape(&doc, id).unwrap();
    let parts = super::parts_of(&mut pres, &part, frame).unwrap();
    {
        let data = pres.xml_mut(&parts.data).unwrap();
        let list = data.child(data.root(), Ns::DGM, "ptLst").unwrap();
        let pt = super::data::import(
            data,
            "<dgm:pt modelId=\"{P}\" type=\"pres\"><dgm:prSet presName=\"node\" custScaleX=\"50000\"/><dgm:spPr/></dgm:pt>",
        )
        .unwrap();
        data.append_child(list, pt);
    }
    assert!(!smart(&mut pres, id).layout.id.is_empty());
    edit(&mut pres, id, SmartArtEdit::Reset).unwrap();
    assert!(!data_xml(&mut pres, id).contains("custScaleX"));
}

#[test]
fn converts_to_shapes_and_to_text() {
    let (mut pres, id) = insert("process1", Some(&[(1, "Plan"), (2, "Scope"), (1, "Ship")]));
    let drawn_count = drawn(&mut pres, id).len();
    let result = pres
        .apply(
            &[EditOp::ConvertSmartArt {
                slide: 256,
                shape: id,
                to: SmartArtTarget::Shapes,
            }],
            fonts(),
        )
        .unwrap();
    let group = result.created[0].shape.unwrap();
    let outline = pres.slide_outline_with_fonts(0, fonts()).unwrap();
    assert!(outline.shapes.iter().all(|s| s.id != id));
    let g = outline.shapes.iter().find(|s| s.id == group).unwrap();
    assert_eq!(g.children.len(), drawn_count);
    assert!((g.x - BOX[0]).abs() < 0.1 && (g.w - BOX[2]).abs() < 0.1);
    let text: Vec<String> = g
        .children
        .iter()
        .flat_map(|c| c.paragraphs.iter().map(|p| p.text.clone()))
        .collect();
    assert!(text.contains(&"Plan".to_owned()) && text.contains(&"Scope".to_owned()));
    // The diagram's parts are gone with it.
    assert!(
        !pres
            .package()
            .part_names()
            .any(|n| n.starts_with("/ppt/diagrams/"))
    );
    let (mut pres, id) = insert("process1", Some(&[(1, "Plan"), (2, "Scope"), (1, "Ship")]));
    let result = pres
        .apply(
            &[EditOp::ConvertSmartArt {
                slide: 256,
                shape: id,
                to: SmartArtTarget::Text,
            }],
            fonts(),
        )
        .unwrap();
    let tb = shape(&mut pres, result.created[0].shape.unwrap());
    let paras: Vec<(u8, String)> = tb
        .paragraphs
        .iter()
        .map(|p| (p.level, p.text.clone()))
        .collect();
    assert_eq!(
        paras,
        [(0, "Plan".into()), (1, "Scope".into()), (0, "Ship".into())]
    );
}

#[test]
fn new_smart_art_saves_and_reopens() {
    let (mut pres, id) = insert("orgChart1", None);
    let before = smart(&mut pres, id);
    assert!(before.nodes.iter().any(|n| n.assistant));
    let bytes = pres.save().unwrap();
    let mut again = Presentation::open(bytes.clone()).unwrap();
    let after = smart(&mut again, id);
    assert_eq!(before, after);
    // Every diagram part has its content type and relationship.
    let pkg = crate::opc::Package::open(bytes).unwrap();
    let ct = pkg.content_types();
    for (prefix, ty) in [
        ("/ppt/diagrams/data", super::content_types::DATA),
        ("/ppt/diagrams/layout", super::content_types::LAYOUT),
        ("/ppt/diagrams/quickStyle", super::content_types::STYLE),
        ("/ppt/diagrams/colors", super::content_types::COLORS),
        ("/ppt/diagrams/drawing", super::content_types::DRAWING),
    ] {
        let name = pkg
            .part_names()
            .find(|n| n.starts_with(prefix))
            .unwrap_or_else(|| panic!("no {prefix} part"))
            .to_owned();
        assert_eq!(ct.lookup(&name), Some(ty));
    }
    let rels = pkg.rels("/ppt/slides/slide1.xml").unwrap();
    let data = rels
        .iter()
        .find(|r| r.rel_type == super::rels::DATA)
        .unwrap();
    let drawing_rel = rels
        .iter()
        .find(|r| r.rel_type == crate::opc::rel_type::DIAGRAM_DRAWING)
        .unwrap();
    let data_xml = String::from_utf8(pkg.read(&rels.resolve(data)).unwrap().into_owned()).unwrap();
    assert!(data_xml.contains(&format!("relId=\"{}\"", drawing_rel.id)));
    assert!(
        data_xml
            .contains("loTypeId=\"urn:microsoft.com/office/officeart/2005/8/layout/orgChart1\"")
    );
}

#[test]
fn resizing_lays_the_diagram_out_again() {
    let (mut pres, id) = insert("default", Some(&[(1, "A"), (1, "B"), (1, "C")]));
    pres.apply(
        &[EditOp::SetTransform {
            slide: 256,
            shape: id,
            x: None,
            y: None,
            w: Some(300.0),
            h: Some(400.0),
            rotation: None,
            flip_h: None,
            flip_v: None,
        }],
        fonts(),
    )
    .unwrap();
    for ([x, y, w, h], _) in drawn(&mut pres, id) {
        assert!(x >= -0.5 && y >= -0.5 && x + w <= 300.5 && y + h <= 400.5);
    }
}

/// A corpus deck, unless it is still a Git LFS pointer.
fn corpus(name: &str) -> Option<Vec<u8>> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/corpus/wild")
        .join(name);
    let bytes = std::fs::read(path).ok()?;
    (!crate::fidelity::corpus::is_lfs_pointer(&bytes)).then_some(bytes)
}

#[test]
fn galleries_list_and_preview_every_choice() {
    let catalog = crate::edit::smart_art_catalog();
    assert_eq!(catalog.layouts.len(), 11);
    assert_eq!(catalog.colors.len(), 3 + 5 + 6 * 5);
    assert_eq!(catalog.styles.len(), 5);
    let spec = |layout: &str, colors: &str| crate::edit::SmartArtPreviewSpec {
        layout: layout.into(),
        colors: Some(colors.into()),
        width: 120.0,
        height: 80.0,
        ..Default::default()
    };
    for l in &catalog.layouts {
        let paths = crate::edit::smart_art_preview(&spec(&l.short, "accent1_2")).unwrap();
        assert!(paths.iter().any(|p| p.fill.is_some()), "{}", l.short);
    }
    // Colorful previews use several accents; the theme can be the deck's.
    let fills = |colors: &str| {
        crate::edit::smart_art_preview(&spec("process1", colors))
            .unwrap()
            .into_iter()
            .filter_map(|p| p.fill)
            .collect::<std::collections::HashSet<_>>()
    };
    assert!(fills("colorful1").len() >= 3);
    let mut themed = spec("default", "accent1_2");
    themed.theme.insert("accent1".into(), "#112233".into());
    assert!(
        crate::edit::smart_art_preview(&themed)
            .unwrap()
            .iter()
            .any(|p| p.fill.as_deref() == Some("#112233"))
    );
    assert!(crate::edit::smart_art_preview(&spec("nope", "accent1_2")).is_none());
}

/// Every SmartArt outline of a deck: (slide index, shape id, outline).
fn smart_arts(pres: &mut Presentation) -> Vec<(usize, u32, SmartArtOutline)> {
    let mut out = Vec::new();
    for i in 0..pres.slides().len() {
        let outline = pres.slide_outline(i).unwrap();
        for s in outline.shapes {
            if let Some(sa) = s.smart_art {
                out.push((i, s.id, sa));
            }
        }
    }
    out
}

#[test]
fn reads_powerpoint_diagrams_from_the_corpus() {
    let Some(bytes) = corpus("mesa-fy2017-proposed-budget-summary.pptx") else {
        return;
    };
    let mut pres = Presentation::open(bytes).unwrap();
    let all = smart_arts(&mut pres);
    assert_eq!(all.len(), 2);
    let (_, _, chevron) = &all[0];
    assert_eq!(chevron.layout.name, "Vertical Chevron List");
    assert!(!chevron.layout.supported);
    assert!(chevron.nodes.iter().any(|n| n.level == 2));
    let (_, _, blocks) = &all[1];
    assert_eq!(blocks.layout.name, "Basic Block List");
    assert!(blocks.layout.supported);
    let names: Vec<&str> = blocks.nodes.iter().map(|n| n.text.as_str()).collect();
    assert_eq!(
        names,
        [
            "Sustainable Economy",
            "Workplace Development",
            "Public Safety",
            "Transforming Neighborhoods",
            "Placemaking"
        ]
    );
    assert_eq!(
        blocks.colors_name.as_deref(),
        Some("Colored Fill - Accent 1")
    );
    assert_eq!(blocks.style_name.as_deref(), Some("Simple Fill"));
    // PowerPoint's drawing shapes map to the nodes they show.
    assert!(
        blocks
            .nodes
            .iter()
            .all(|n| n.frame.is_some() && n.font_size == Some(23.0))
    );

    let Some(bytes) = corpus("san-antonio-prek4sa-fy2015-midyear-budget.pptx") else {
        return;
    };
    let mut pres = Presentation::open(bytes).unwrap();
    let (_, _, org) = smart_arts(&mut pres).remove(0);
    assert_eq!(org.layout.name, "Organization Chart");
    let root = &org.nodes[0];
    assert_eq!(root.level, 1);
    assert!(org.nodes.iter().skip(1).all(|n| n.level >= 2));
    assert_eq!(
        root.children.len(),
        org.nodes.iter().filter(|n| n.level == 2).count()
    );
}

#[test]
fn powerpoint_diagrams_take_text_colors_and_styles_in_place() {
    let Some(bytes) = corpus("alexandria-fy2014-proposed-budget.pptx") else {
        return;
    };
    let mut pres = Presentation::open(bytes).unwrap();
    // hList6 (Horizontal Bullet List with arrows): a layout of PowerPoint's own.
    let (index, id, sa) = smart_arts(&mut pres)
        .into_iter()
        .find(|(_, _, s)| s.layout.id.ends_with("/hList6"))
        .unwrap();
    let slide = pres.slides()[index].id;
    let node = sa.nodes[1].id.clone();
    let op = |edit: SmartArtEdit| EditOp::EditSmartArt {
        slide,
        shape: id,
        edit,
    };
    pres.apply(
        &[op(SmartArtEdit::SetText {
            node: node.clone(),
            text: "Fund balance stays above 10%".into(),
        })],
        fonts(),
    )
    .unwrap();
    let part = pres.slides()[index].part.clone();
    let doc = pres.xml(&part).unwrap();
    let frame = crate::edit::xmlutil::find_shape(&doc, id).unwrap();
    let parts = super::parts_of(&mut pres, &part, frame).unwrap();
    let drawing_xml = String::from_utf8(
        pres.xml(parts.drawing.as_deref().unwrap())
            .unwrap()
            .to_bytes(),
    )
    .unwrap();
    assert!(drawing_xml.contains("Fund balance stays above 10%"));
    // The rest of PowerPoint's drawing is untouched.
    assert!(drawing_xml.contains("flowChartManualOperation"));
    // Node changes need the engine's own layouts.
    let err = pres
        .apply(&[op(SmartArtEdit::DeleteNode { node })], fonts())
        .unwrap_err();
    assert!(
        err.to_string()
            .contains("this layout's structure can't be changed here")
    );
    // Colors repaint PowerPoint's shapes by their style labels.
    pres.apply(
        &[op(SmartArtEdit::SetColors {
            colors: "accent6_2".into(),
        })],
        fonts(),
    )
    .unwrap();
    let drawing_xml = String::from_utf8(
        pres.xml(parts.drawing.as_deref().unwrap())
            .unwrap()
            .to_bytes(),
    )
    .unwrap();
    assert!(drawing_xml.contains("accent6"));
    // And a supported layout makes it fully editable.
    pres.apply(
        &[op(SmartArtEdit::SetLayout {
            layout: "vList2".into(),
        })],
        fonts(),
    )
    .unwrap();
    let outline = pres.slide_outline(index).unwrap();
    let sa = outline
        .shapes
        .iter()
        .find(|s| s.id == id)
        .and_then(|s| s.smart_art.clone())
        .unwrap();
    assert!(sa.layout.supported);
    assert!(
        sa.nodes
            .iter()
            .any(|n| n.text == "Fund balance stays above 10%")
    );
}

#[test]
#[ignore = "needs LibreOffice (soffice)"]
fn libreoffice_opens_every_layout() {
    let bytes = every_layout_deck().save().unwrap();
    let dir = std::env::temp_dir().join(format!("pptx-smartart-lo-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let deck = dir.join("smartart.pptx");
    std::fs::write(&deck, bytes).unwrap();
    let profile = format!(
        "-env:UserInstallation=file://{}",
        dir.join("profile").display()
    );
    let status = std::process::Command::new("soffice")
        .args([
            profile.as_str(),
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
        ])
        .arg(&dir)
        .arg(&deck)
        .status()
        .expect("soffice runs");
    assert!(status.success());
    let pdf = std::fs::read(dir.join("smartart.pdf")).expect("a PDF");
    assert!(pdf.starts_with(b"%PDF") && pdf.len() > 1000);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "writes renders to the temp dir for review"]
fn corpus_shots() {
    let dir = std::env::temp_dir().join("smartart-shots");
    std::fs::create_dir_all(&dir).unwrap();
    for (deck, slide) in [
        ("alexandria-fy2014-proposed-budget.pptx", 5),
        ("census-fesac-2010-hogue-blumerman.pptx", 11),
        ("mesa-fy2017-proposed-budget-summary.pptx", 2),
        ("dallasfed-fiscal-policy.pptx", 21),
        ("dallasfed-fiscal-policy.pptx", 26),
        ("san-antonio-prek4sa-fy2015-midyear-budget.pptx", 3),
    ] {
        let Some(bytes) = corpus(deck) else {
            continue;
        };
        let mut pres = Presentation::open(bytes).unwrap();
        let png = pres.render_slide(slide - 1, 960, fonts()).unwrap().to_png();
        std::fs::write(dir.join(format!("corpus-{deck}-{slide}.png")), png).unwrap();
        let width = crate::fidelity::corpus::FINGERPRINT_WIDTH;
        let raster = pres.render_slide(slide - 1, width, fonts()).unwrap();
        println!(
            "FINGERPRINT wild/{deck} {slide} {}",
            crate::fidelity::fingerprint(&raster)
        );
    }
}

/// A deck with one slide per supported layout (sample text on each).
fn every_layout_deck() -> Presentation {
    let supported: Vec<_> = LAYOUTS.iter().filter(|l| l.kind.is_some()).collect();
    let mut pres = Presentation::open(deck(&vec![""; supported.len()])).unwrap();
    for (k, info) in supported.iter().enumerate() {
        pres.apply(
            &[EditOp::AddShape {
                slide: 256 + k as u32,
                shape: NewShape::SmartArt {
                    layout: info.short.into(),
                    items: Some(items(&[
                        (1, "Plan"),
                        (2, "Scope"),
                        (1, "Build"),
                        (2, "Code"),
                        (1, "Ship"),
                    ])),
                    colors: None,
                    style: None,
                },
                x: BOX[0],
                y: BOX[1],
                w: BOX[2],
                h: BOX[3],
            }],
            fonts(),
        )
        .unwrap();
    }
    pres
}

#[test]
#[ignore = "writes a deck to the temp dir for review"]
fn write_every_layout_deck() {
    let dir = std::env::temp_dir().join("smartart-shots");
    std::fs::create_dir_all(&dir).unwrap();
    let bytes = every_layout_deck().save().unwrap();
    std::fs::write(dir.join("every-layout.pptx"), bytes).unwrap();
}

#[test]
#[ignore = "writes renders to the temp dir for review"]
fn shots() {
    let dir = std::env::temp_dir().join("smartart-shots");
    std::fs::create_dir_all(&dir).unwrap();
    for info in LAYOUTS.iter().filter(|l| l.kind.is_some()) {
        for (suffix, nodes) in [
            ("sample", None),
            (
                "text",
                Some(
                    &[
                        (1u8, "Plan the work"),
                        (2, "Scope"),
                        (1, "Build"),
                        (2, "Code"),
                        (2, "Test"),
                        (1, "Ship it to customers"),
                    ][..],
                ),
            ),
        ] {
            let (mut pres, id) = insert(info.short, nodes);
            let sizes: Vec<Option<f32>> = smart(&mut pres, id)
                .nodes
                .iter()
                .map(|n| n.font_size)
                .collect();
            println!("{} {suffix}: {sizes:?}", info.short);
            let png = pres.render_slide(0, 960, fonts()).unwrap().to_png();
            std::fs::write(dir.join(format!("{}-{suffix}.png", info.short)), png).unwrap();
        }
    }
}
