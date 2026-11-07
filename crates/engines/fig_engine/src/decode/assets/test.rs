use crate::images::ImageStore;
use crate::model::{EffectKind, Guid};
use crate::render::{RenderOptions, Viewport, render};
use crate::testing::{SCHEMA, V, color, fig_file_with, node, size, solid, translate};
use crate::{Document, Scene};
use std::sync::Arc;

#[test]
fn imported_effect_style_draws_its_glow_in_eager_and_lazy_documents() {
    let schema = SCHEMA.replace(
        "message NodeChange guid:GUID",
        "message AssetRef key:string\nmessage StyleId guid:GUID assetRef:AssetRef\nmessage NodeChange key:string styleIdForEffect:StyleId guid:GUID",
    );
    let bytes = Arc::new(fig_file_with(
        &schema,
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(
                1,
                Some((0, "!")),
                "CANVAS",
                "Page",
                vec![("backgroundColor", color(0.0, 0.0, 0.0, 1.0))],
            ),
            node(
                2,
                Some((1, "!")),
                "RECTANGLE",
                "Button",
                vec![
                    ("size", size(40.0, 20.0)),
                    ("transform", translate(30.0, 30.0)),
                    ("fillPaints", V::List(vec![solid(0.0, 1.0, 0.0)])),
                    (
                        "styleIdForEffect",
                        V::Msg(vec![(
                            "assetRef",
                            V::Msg(vec![("key", V::Str("library-glow".into()))]),
                        )]),
                    ),
                ],
            ),
            // The imported style occurs after the layer that references it.
            node(
                3,
                Some((0, "~")),
                "RECTANGLE",
                "Glow",
                vec![
                    ("key", V::Str("library-glow".into())),
                    ("visible", V::Bool(false)),
                    (
                        "effects",
                        V::List(vec![V::Msg(vec![
                            ("type", V::Enum("DROP_SHADOW")),
                            ("color", color(0.0, 1.0, 0.0, 1.0)),
                            ("radius", V::Float(12.0)),
                        ])]),
                    ),
                ],
            ),
        ],
        vec![],
    ));
    for doc in [
        Document::open(&bytes).unwrap(),
        Document::open_lazy(&bytes).unwrap(),
    ] {
        let button = doc
            .find(Guid {
                session: 1,
                local: 2,
            })
            .unwrap();
        let props = doc.props(button);
        assert_eq!(
            props.effect_style,
            Some(Guid {
                session: 1,
                local: 3
            })
        );
        assert_eq!(props.effects().len(), 1);
        assert_eq!(props.effects()[0].kind, EffectKind::DropShadow);
        let scene = Scene::build(&doc, doc.pages[0]);
        let pixmap = render(
            &doc,
            &scene,
            &mut ImageStore::default(),
            &Viewport {
                x: 0.0,
                y: 0.0,
                scale: 1.0,
                width: 100,
                height: 80,
            },
            RenderOptions {
                outline: false,
                background: Some(doc.page_background(doc.pages[0])),
            },
        )
        .unwrap();
        let glow = pixmap.pixel(25, 40).unwrap().demultiply();
        assert!(glow.green() > 20, "the style draws outside the button");
        assert_eq!(glow.red(), 0);
        assert_eq!(glow.blue(), 0);
    }
}
