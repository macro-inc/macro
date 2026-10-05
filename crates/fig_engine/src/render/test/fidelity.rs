//! Rendering rules matched against how Figma draws: FigJam objects, text
//! truncation, and the other cases of the fidelity work, on constructed
//! files.

use super::{rgba, viewport};
use crate::document::Document;
use crate::images::ImageStore;
use crate::render::{RenderOptions, Viewport, render};
use crate::scene::Scene;
use crate::testing::{V, color, fig_file_with, node, path_blob, size, solid, translate};
use tiny_skia::Pixmap;

/// The common test schema plus FigJam's generated layers and derived text.
const SCHEMA: &str = "
enum NodeType DOCUMENT CANVAS GROUP FRAME RECTANGLE ROUNDED_RECTANGLE ELLIPSE VECTOR TEXT SYMBOL INSTANCE SECTION STICKY SHAPE_WITH_TEXT CONNECTOR
enum NodePhase CREATED REMOVED
enum PaintType SOLID GRADIENT_LINEAR GRADIENT_RADIAL GRADIENT_ANGULAR GRADIENT_DIAMOND IMAGE
enum BlendMode PASS_THROUGH NORMAL MULTIPLY SCREEN
enum StrokeAlign CENTER INSIDE OUTSIDE
enum WindingRule NONZERO ODD
enum EffectType INNER_SHADOW DROP_SHADOW FOREGROUND_BLUR BACKGROUND_BLUR
enum ImageScaleMode STRETCH FIT FILL TILE
struct GUID sessionID:uint localID:uint
struct Color r:float g:float b:float a:float
struct Vector x:float y:float
struct Matrix m00:float m01:float m02:float m10:float m11:float m12:float
message ParentIndex guid:GUID position:string
message ColorStop color:Color position:float
message Image hash:byte[] name:string dataBlob:uint
message PaintFilterMessage exposure:float contrast:float vibrance:float temperature:float tint:float highlights:float shadows:float
message Paint type:PaintType color:Color opacity:float visible:bool blendMode:BlendMode stops:ColorStop[] transform:Matrix image:Image imageScaleMode:ImageScaleMode paintFilter:PaintFilterMessage
message Path windingRule:WindingRule commandsBlob:uint
message Effect type:EffectType color:Color offset:Vector radius:float spread:float visible:bool
message GUIDPath guids:GUID[]
message SymbolData symbolID:GUID symbolOverrides:NodeChange[] uniformScaleFactor:float
message Glyph commandsBlob:uint position:Vector fontSize:float firstCharacter:uint advance:float
message DerivedTextData layoutSize:Vector glyphs:Glyph[] truncationStartIndex:int
message NodeGenerationData overrides:NodeChange[]
message DerivedImmutableFrameData overrides:NodeChange[]
message NodeChange guid:GUID phase:NodePhase parentIndex:ParentIndex type:NodeType name:string visible:bool locked:bool opacity:float size:Vector transform:Matrix fillPaints:Paint[] strokePaints:Paint[] strokeWeight:float strokeAlign:StrokeAlign fillGeometry:Path[] strokeGeometry:Path[] effects:Effect[] cornerRadius:float backgroundColor:Color symbolData:SymbolData guidPath:GUIDPath overrideKey:GUID internalOnly:bool derivedTextData:DerivedTextData nodeGenerationData:NodeGenerationData derivedImmutableFrameData:DerivedImmutableFrameData
message Blob bytes:byte[]
message Message nodeChanges:NodeChange[] blobs:Blob[]
";

fn file(nodes: Vec<V>, blobs: Vec<Vec<u8>>) -> Vec<u8> {
    let mut all = vec![
        node(0, None, "DOCUMENT", "Document", vec![]),
        node(
            1,
            Some((0, "!")),
            "CANVAS",
            "Page",
            vec![("backgroundColor", color(1.0, 1.0, 1.0, 1.0))],
        ),
    ];
    all.extend(nodes);
    fig_file_with(SCHEMA, all, blobs)
}

fn draw(bytes: &[u8], vp: Viewport) -> Pixmap {
    let doc = Document::open(bytes).unwrap();
    let scene = Scene::build(&doc, doc.pages[0]);
    let opts = RenderOptions {
        outline: false,
        background: Some(doc.page_background(doc.pages[0])),
    };
    render(&doc, &scene, &mut ImageStore::default(), &vp, opts).unwrap()
}

/// A guid path to one of a FigJam object's generated layers.
fn layer_path(k: u32) -> V {
    V::Msg(vec![(
        "guids",
        V::List(vec![V::Msg(vec![
            ("sessionID", V::Uint(40_000_000)),
            ("localID", V::Uint(k)),
        ])]),
    )])
}

fn square(x: f32, y: f32, w: f32, h: f32) -> Vec<u8> {
    path_blob(&[
        (1, &[x, y]),
        (2, &[x + w, y]),
        (2, &[x + w, y + h]),
        (2, &[x, y + h]),
        (0, &[]),
    ])
}

fn fill_geometry(blob: u32) -> V {
    V::List(vec![V::Msg(vec![
        ("windingRule", V::Enum("NONZERO")),
        ("commandsBlob", V::Uint(blob)),
    ])])
}

/// A 100×100 sticky at (10, 10): its background layer is drawn from the
/// generation data's yellow fill and the derived layout's geometry.
#[test]
fn draws_a_stickys_generated_background() {
    let bytes = file(
        vec![node(
            2,
            Some((1, "!")),
            "STICKY",
            "Note",
            vec![
                ("size", size(100.0, 100.0)),
                ("transform", translate(10.0, 10.0)),
                (
                    "nodeGenerationData",
                    V::Msg(vec![(
                        "overrides",
                        V::List(vec![V::Msg(vec![
                            ("guidPath", layer_path(0)),
                            ("fillPaints", V::List(vec![solid(1.0, 0.9, 0.0)])),
                        ])]),
                    )]),
                ),
                (
                    "derivedImmutableFrameData",
                    V::Msg(vec![(
                        "overrides",
                        V::List(vec![V::Msg(vec![
                            ("guidPath", layer_path(0)),
                            ("size", size(100.0, 100.0)),
                            ("transform", translate(0.0, 0.0)),
                            ("fillGeometry", fill_geometry(0)),
                        ])]),
                    )]),
                ),
            ],
        )],
        vec![square(0.0, 0.0, 100.0, 100.0)],
    );
    let doc = Document::open(&bytes).unwrap();
    let scene = Scene::build(&doc, doc.pages[0]);
    let sticky = scene.find(&doc, "1:2").unwrap();
    assert!(scene.node(sticky).children.is_empty(), "no document layers");
    assert_eq!(scene.node(sticky).generated.len(), 1);
    let b = scene.node(sticky).bounds;
    assert_eq!((b.x, b.y, b.w, b.h), (10.0, 10.0, 100.0, 100.0));

    let p = draw(&bytes, viewport(0.0, 0.0, 1.0, 120, 120));
    assert_eq!(rgba(&p, 60, 60), [255, 230, 0, 255], "the sticky");
    assert_eq!(rgba(&p, 5, 5), [255, 255, 255, 255], "the page");
}

/// A glyph: a unit square outline (in em units, y up) at `x`.
fn glyph(x: f32, first: u32) -> V {
    V::Msg(vec![
        ("commandsBlob", V::Uint(0)),
        (
            "position",
            V::Msg(vec![("x", V::Float(x)), ("y", V::Float(20.0))]),
        ),
        ("fontSize", V::Float(10.0)),
        ("firstCharacter", V::Uint(first)),
        ("advance", V::Float(1.0)),
    ])
}

/// A connector's label text sits in its label box (layer 2), and text cut
/// off by Figma's truncation is not drawn.
#[test]
fn places_connector_labels_and_truncates_text() {
    let bytes = file(
        vec![node(
            2,
            Some((1, "!")),
            "CONNECTOR",
            "Arrow",
            vec![
                ("size", size(200.0, 50.0)),
                ("transform", translate(0.0, 0.0)),
                (
                    "nodeGenerationData",
                    V::Msg(vec![(
                        "overrides",
                        V::List(vec![V::Msg(vec![
                            ("guidPath", layer_path(1)),
                            ("fillPaints", V::List(vec![solid(0.0, 0.0, 0.0)])),
                        ])]),
                    )]),
                ),
                (
                    "derivedImmutableFrameData",
                    V::Msg(vec![(
                        "overrides",
                        V::List(vec![
                            V::Msg(vec![
                                ("guidPath", layer_path(1)),
                                ("size", size(40.0, 20.0)),
                                ("transform", translate(5.0, 5.0)),
                                (
                                    "derivedTextData",
                                    V::Msg(vec![
                                        ("layoutSize", size(40.0, 20.0)),
                                        (
                                            "glyphs",
                                            V::List(vec![
                                                glyph(0.0, 0),
                                                glyph(10.0, 1),
                                                glyph(20.0, 2),
                                            ]),
                                        ),
                                        ("truncationStartIndex", V::Uint(2)),
                                    ]),
                                ),
                            ]),
                            V::Msg(vec![
                                ("guidPath", layer_path(2)),
                                ("size", size(50.0, 30.0)),
                                ("transform", translate(100.0, 10.0)),
                            ]),
                        ]),
                    )]),
                ),
            ],
        )],
        vec![square(0.0, 0.0, 1.0, 1.0)],
    );
    let p = draw(&bytes, viewport(0.0, 0.0, 1.0, 200, 60));
    // Text layer at (5, 5) inside the label box at (100, 10): glyphs
    // span y 15..25 (baseline 20 + 15, one em up).
    assert_eq!(rgba(&p, 110, 30), [0, 0, 0, 255], "the first glyph");
    assert_eq!(rgba(&p, 120, 30), [0, 0, 0, 255], "the second glyph");
    assert_eq!(
        rgba(&p, 9, 30),
        [255, 255, 255, 255],
        "not at the connector's origin"
    );
    // The third glyph (from character 2) is cut; dots follow the second.
    assert_eq!(rgba(&p, 130, 28), [255, 255, 255, 255], "the cut glyph");
    let ink: u32 = (125..135)
        .map(|x| 255 - u32::from(rgba(&p, x, 34)[0]))
        .sum();
    assert!(ink > 100, "an ellipsis after the kept glyphs ({ink})");
}

/// Older files carry image fills in the message's blobs (`Image.dataBlob`)
/// rather than as files beside the document.
#[test]
fn draws_images_stored_in_blobs() {
    let mut red = Pixmap::new(2, 2).unwrap();
    red.fill(tiny_skia::Color::from_rgba8(255, 0, 0, 255));
    let png = crate::images::encode_png(&red);
    let image = V::Msg(vec![
        ("type", V::Enum("IMAGE")),
        ("opacity", V::Float(1.0)),
        ("visible", V::Bool(true)),
        ("imageScaleMode", V::Enum("FILL")),
        (
            "image",
            V::Msg(vec![
                ("hash", V::Bytes(vec![0xab; 20])),
                ("dataBlob", V::Uint(1)),
            ]),
        ),
    ]);
    let bytes = file(
        vec![node(
            2,
            Some((1, "!")),
            "RECTANGLE",
            "Photo",
            vec![
                ("size", size(40.0, 40.0)),
                ("transform", translate(10.0, 10.0)),
                ("fillPaints", V::List(vec![image])),
                ("fillGeometry", fill_geometry(0)),
            ],
        )],
        vec![square(0.0, 0.0, 40.0, 40.0), png],
    );
    let doc = Document::open(&bytes).unwrap();
    assert!(doc.images.contains_key(&"ab".repeat(20)));
    let p = draw(&bytes, viewport(0.0, 0.0, 1.0, 60, 60));
    assert_eq!(rgba(&p, 30, 30), [255, 0, 0, 255]);
}
