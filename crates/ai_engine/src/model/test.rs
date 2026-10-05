use super::*;

fn tree() -> (Document, NodeIdx, NodeIdx, NodeIdx) {
    let mut doc = Document::new();
    let layer = doc.push(Node::new(
        1,
        NodeKind::Layer {
            color: [0, 0, 0],
            printable: true,
        },
    ));
    doc.layers.push(layer);
    let group = doc.push(Node::new(
        2,
        NodeKind::Group {
            clip: None,
            isolated: false,
            knockout: false,
        },
    ));
    let path = doc.push(Node::new(
        3,
        NodeKind::Path(PathNode {
            data: PathData::rect(Rect::new(0.0, 0.0, 1.0, 1.0)),
            fill: None,
            even_odd: false,
            stroke: None,
        }),
    ));
    doc.node_mut(layer).children.push(group);
    doc.node_mut(group).parent = Some(layer);
    doc.node_mut(group).children.push(path);
    doc.node_mut(path).parent = Some(group);
    (doc, layer, group, path)
}

#[test]
fn tree_queries() {
    let (mut doc, layer, group, path) = tree();
    assert_eq!(doc.paint_order(), [layer, group, path]);
    assert_eq!(doc.layer_of(path), layer);
    assert!(doc.is_within(path, group) && !doc.is_within(group, path));
    assert!(doc.is_shown(path));
    doc.node_mut(group).hidden = true;
    assert!(!doc.is_shown(path));
    doc.node_mut(layer).locked = true;
    assert!(doc.is_locked(path));
    assert_eq!(doc.find(3), Some(path));
    assert_eq!(doc.siblings(path), [path]);
}

#[test]
fn colors_and_blend_modes() {
    assert_eq!(
        Color::Cmyk {
            c: 0.0,
            m: 1.0,
            y: 1.0,
            k: 0.0
        }
        .hex(),
        "#ff0000"
    );
    assert_eq!(Color::Gray { g: 1.0 }.to_rgb(), [1.0, 1.0, 1.0]);
    for m in BlendMode::ALL {
        assert_eq!(BlendMode::from_pdf(m.pdf_name()), m);
    }
    assert_eq!(BlendMode::from_pdf("Compatible"), BlendMode::Normal);
    let json = serde_json::to_string(&Paint::Solid {
        color: Color::Rgb {
            r: 1.0,
            g: 0.5,
            b: 0.0,
        },
    })
    .expect("serializes");
    assert_eq!(
        json,
        r#"{"type":"solid","color":{"space":"rgb","r":1.0,"g":0.5,"b":0.0}}"#
    );
}
