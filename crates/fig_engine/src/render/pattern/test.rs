use crate::document::Document;
use crate::images::ImageStore;
use crate::model::{PaintKind, PatternAlign};
use crate::render::{RenderOptions, Viewport, render};
use crate::scene::Scene;
use crate::testing::{V, fig_file_with, guid, node, size, solid, translate};
use std::sync::Arc;

fn fixture(spacing: f32, scale: f32, cyclic: bool) -> Vec<u8> {
    fixture_layout(spacing, scale, cyclic, "RECTANGULAR")
}

fn fixture_layout(spacing: f32, scale: f32, cyclic: bool, layout: &'static str) -> Vec<u8> {
    let schema = crate::testing::SCHEMA
        .replace("GRADIENT_DIAMOND IMAGE", "GRADIENT_DIAMOND IMAGE PATTERN")
        .replace("message Paint type:PaintType", "enum PatternTileType RECTANGULAR HORIZONTAL_HEXAGONAL VERTICAL_HEXAGONAL\nenum PatternAlignment START CENTER END\nmessage Paint sourceNodeId:GUID scale:float patternSpacing:Vector patternTileType:PatternTileType horizontalAlignment:PatternAlignment verticalAlignment:PatternAlignment type:PaintType");
    let pattern = || {
        V::List(vec![V::Msg(vec![
            ("type", V::Enum("PATTERN")),
            ("sourceNodeId", guid(3)),
            ("scale", V::Float(scale)),
            ("patternSpacing", size(spacing, 0.0)),
            ("patternTileType", V::Enum(layout)),
        ])])
    };
    fig_file_with(
        &schema,
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(1, Some((0, "!")), "CANVAS", "Destination", vec![]),
            node(2, Some((0, "#")), "CANVAS", "Source page", vec![]),
            node(
                3,
                Some((2, "!")),
                "RECTANGLE",
                "Tile",
                vec![
                    ("size", size(4.0, 4.0)),
                    ("transform", translate(100.0, 100.0)),
                    (
                        "fillPaints",
                        if cyclic {
                            pattern()
                        } else {
                            V::List(vec![solid(1.0, 0.0, 0.0)])
                        },
                    ),
                ],
            ),
            node(
                4,
                Some((1, "!")),
                "RECTANGLE",
                "Pattern",
                vec![
                    ("size", size(20.0, 8.0)),
                    ("transform", translate(0.0, 0.0)),
                    ("fillPaints", pattern()),
                ],
            ),
        ],
        vec![],
    )
}

fn draw(doc: &Document) -> tiny_skia::Pixmap {
    let scene = Scene::build(doc, doc.pages[0]);
    render(
        doc,
        &scene,
        &mut ImageStore::default(),
        &Viewport {
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            width: 24,
            height: 12,
        },
        RenderOptions::default(),
    )
    .unwrap()
}

#[test]
fn rectangular_pattern_loads_its_source_and_tiles_with_spacing() {
    let bytes = Arc::new(fixture(0.5, 1.0, false));
    for doc in [
        Document::open(&bytes).unwrap(),
        Document::open_lazy(&bytes).unwrap(),
    ] {
        let pixels = draw(&doc);
        for x in [1, 7, 13, 19] {
            assert_eq!(pixels.pixel(x, 1).unwrap().red(), 255);
        }
        for x in [4, 5, 10, 11, 16, 17, 20] {
            assert_eq!(pixels.pixel(x, 1).unwrap().alpha(), 0);
        }
        assert_eq!(
            pixels.pixel(1, 8).unwrap().alpha(),
            0,
            "clip to destination"
        );
    }
}

#[test]
fn pattern_negative_spacing_and_scale_render_without_gaps() {
    let doc = Document::open(&fixture(-0.2, 2.0, false)).unwrap();
    let pixels = draw(&doc);
    for x in 0..20 {
        assert_eq!(pixels.pixel(x, 1).unwrap().alpha(), 255, "x={x}");
    }
}

#[test]
fn pattern_alignment_and_opacity_are_applied_to_the_repeated_source() {
    let mut doc = Document::open(&fixture(0.5, 1.0, false)).unwrap();
    let target = doc
        .find(crate::model::Guid {
            session: 1,
            local: 4,
        })
        .unwrap();
    let paints = Arc::make_mut(doc.nodes[target as usize].props.fills.as_mut().unwrap());
    let PaintKind::Pattern(pattern) = &mut paints[0].kind else {
        panic!("pattern")
    };
    pattern.horizontal = PatternAlign::End;
    paints[0].opacity = 0.5;
    let pixels = draw(&doc);
    assert_eq!(pixels.pixel(13, 1).unwrap().alpha(), 128);
    assert_eq!(pixels.pixel(14, 1).unwrap().alpha(), 0);
    assert_eq!(pixels.pixel(17, 1).unwrap().alpha(), 128);
}

#[test]
fn cyclic_patterns_are_transparent_and_terminate() {
    let doc = Document::open(&fixture(0.0, 1.0, true)).unwrap();
    assert!(draw(&doc).pixels().iter().all(|p| p.alpha() == 0));
}

#[test]
fn saving_an_edited_pattern_keeps_the_source_and_tile_settings() {
    let bytes = fixture_layout(-0.2, 1.5, false, "HORIZONTAL_HEXAGONAL");
    let mut doc = Document::open(&bytes).unwrap();
    let target = doc
        .find(crate::model::Guid {
            session: 1,
            local: 4,
        })
        .unwrap();
    let paints = Arc::make_mut(doc.nodes[target as usize].props.fills.as_mut().unwrap());
    paints[0].opacity = 0.5;
    let PaintKind::Pattern(pattern) = &mut paints[0].kind else {
        panic!("pattern")
    };
    pattern.horizontal = PatternAlign::End;
    pattern.vertical = PatternAlign::Center;
    doc.nodes[target as usize].edits |= crate::edit::flags::FILLS;
    let saved = crate::save::save(&doc, &bytes).unwrap();
    let reopened = Document::open(&saved).unwrap();
    assert_eq!(doc.props(target).fills(), reopened.props(target).fills());
    assert_eq!(draw(&doc).data(), draw(&reopened).data());
}

#[test]
fn svg_embeds_a_repeating_pattern_tile() {
    let doc = Document::open(&fixture_layout(0.5, 1.5, false, "HORIZONTAL_HEXAGONAL")).unwrap();
    let scene = Scene::build(&doc, doc.pages[0]);
    let node = scene.find(&doc, "1:4").unwrap();
    let svg = crate::svg::export(&doc, &scene, node).unwrap();
    assert!(svg.contains("<pattern "));
    assert!(svg.contains("data:image/png;base64,"));
    assert!(svg.contains("fill=\"url(#pattern"));
}

#[test]
fn horizontal_hex_patterns_stagger_alternate_rows_by_half_a_cell() {
    let bytes = Arc::new(fixture_layout(0.5, 1.0, false, "HORIZONTAL_HEXAGONAL"));
    for doc in [
        Document::open(&bytes).unwrap(),
        Document::open_lazy(&bytes).unwrap(),
    ] {
        let pixels = draw(&doc);
        assert_eq!(pixels.pixel(2, 1).unwrap().alpha(), 255);
        assert_eq!(pixels.pixel(4, 1).unwrap().alpha(), 0);
        assert_eq!(pixels.pixel(2, 5).unwrap().alpha(), 0);
        assert_eq!(pixels.pixel(4, 5).unwrap().alpha(), 255);
        assert_eq!(pixels.pixel(8, 5).unwrap().alpha(), 0);
        assert_eq!(pixels.pixel(10, 5).unwrap().alpha(), 255);
    }
}
