use super::{rgba, viewport};
use crate::images::ImageStore;
use crate::model::{Guid, NodeType};
use crate::render::{RenderOptions, render};
use crate::testing::{SCHEMA, V, fig_file_with, node, size, solid, translate};
use crate::{Document, Scene};
use std::sync::Arc;

#[test]
fn resize_to_fit_groups_do_not_clip_children_to_the_stored_frame_box() {
    let schema = SCHEMA.replace(
        "message NodeChange guid:GUID",
        "message NodeChange resizeToFit:bool frameMaskDisabled:bool guid:GUID",
    );
    let container = |id, x, group| {
        node(
            id,
            Some((1, "!")),
            "FRAME",
            "Container",
            vec![
                ("size", size(20.0, 20.0)),
                ("transform", translate(x, 20.0)),
                ("resizeToFit", V::Bool(group)),
                ("frameMaskDisabled", V::Bool(false)),
            ],
        )
    };
    let child = |id, parent| {
        node(
            id,
            Some((parent, "!")),
            "RECTANGLE",
            "Content beyond the stored box",
            vec![
                ("size", size(10.0, 40.0)),
                ("transform", translate(5.0, -10.0)),
                ("fillPaints", V::List(vec![solid(0.0, 1.0, 0.0)])),
            ],
        )
    };
    let bytes = Arc::new(fig_file_with(
        &schema,
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(1, Some((0, "!")), "CANVAS", "Page", vec![]),
            container(2, 10.0, true),
            child(3, 2),
            container(4, 50.0, false),
            child(5, 4),
        ],
        vec![],
    ));
    for doc in [
        Document::open(&bytes).unwrap(),
        Document::open_lazy(&bytes).unwrap(),
    ] {
        let group = doc
            .find(Guid {
                session: 1,
                local: 2,
            })
            .unwrap();
        assert_eq!(doc.props(group).node_type(), NodeType::Group);
        let scene = Scene::build(&doc, doc.pages[0]);
        let pixmap = render(
            &doc,
            &scene,
            &mut ImageStore::default(),
            &viewport(0.0, 0.0, 1.0, 90, 60),
            RenderOptions {
                outline: false,
                background: Some(crate::model::Color::BLACK),
            },
        )
        .unwrap();
        assert_eq!(rgba(&pixmap, 20, 15), [0, 255, 0, 255]);
        assert_eq!(rgba(&pixmap, 20, 45), [0, 255, 0, 255]);
        assert_eq!(rgba(&pixmap, 60, 15), [0, 0, 0, 255]);
        assert_eq!(rgba(&pixmap, 60, 45), [0, 0, 0, 255]);
        assert_eq!(rgba(&pixmap, 60, 30), [0, 255, 0, 255]);
    }
}
