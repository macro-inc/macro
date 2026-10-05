//! Test support: builds `.fig` files from scratch, so tests exercise the
//! real container, schema, and message decoding without third-party files.
//!
//! The schema is a small subset of Figma's, written in a one-line-per-type
//! text form; messages are written as trees of [`V`] keyed by field name.

use crate::kiwi::{Kind, Schema, Ty};

/// A Figma-shaped schema covering what the tests use.
pub const SCHEMA: &str = "
enum NodeType DOCUMENT CANVAS GROUP FRAME RECTANGLE ROUNDED_RECTANGLE ELLIPSE VECTOR TEXT SYMBOL INSTANCE SECTION
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
message Image hash:byte[] name:string
message Paint type:PaintType color:Color opacity:float visible:bool blendMode:BlendMode stops:ColorStop[] transform:Matrix image:Image imageScaleMode:ImageScaleMode
message Path windingRule:WindingRule commandsBlob:uint
message Effect type:EffectType color:Color offset:Vector radius:float spread:float visible:bool
message GUIDPath guids:GUID[]
message SymbolData symbolID:GUID symbolOverrides:NodeChange[] uniformScaleFactor:float
message NodeChange guid:GUID phase:NodePhase parentIndex:ParentIndex type:NodeType name:string visible:bool locked:bool opacity:float size:Vector transform:Matrix fillPaints:Paint[] strokePaints:Paint[] strokeWeight:float strokeAlign:StrokeAlign fillGeometry:Path[] strokeGeometry:Path[] effects:Effect[] cornerRadius:float backgroundColor:Color symbolData:SymbolData guidPath:GUIDPath overrideKey:GUID internalOnly:bool unusedField:string
message Blob bytes:byte[]
message Message nodeChanges:NodeChange[] blobs:Blob[]
";

/// A value to encode.
#[derive(Clone, Debug)]
pub enum V {
    Uint(u32),
    Float(f32),
    Bool(bool),
    Str(String),
    /// An enum value by name.
    Enum(&'static str),
    Msg(Vec<(&'static str, V)>),
    List(Vec<V>),
    Bytes(Vec<u8>),
}

pub use crate::kiwi::{Writer, schema_from_text as encode_schema};

/// Encodes `value` as a message or struct of type `def` in `schema`.
pub fn encode(schema: &Schema, def: &str, fields: &[(&'static str, V)]) -> Vec<u8> {
    let mut w = Writer::default();
    let index = schema
        .def_index(def)
        .unwrap_or_else(|| panic!("no type {def}"));
    write_def(&mut w, schema, index, fields);
    w.bytes
}

fn write_def(w: &mut Writer, schema: &Schema, index: u32, fields: &[(&'static str, V)]) {
    let def = schema.def(index);
    match def.kind {
        Kind::Struct => {
            for field in &def.fields {
                let value = fields
                    .iter()
                    .find(|(n, _)| *n == field.name)
                    .map(|(_, v)| v);
                match value {
                    Some(v) => write_field(w, schema, field.ty, field.array, v),
                    None => write_zero(w, schema, field.ty, field.array),
                }
            }
        }
        Kind::Message => {
            for (name, value) in fields {
                let field = def
                    .fields
                    .iter()
                    .find(|f| f.name == *name)
                    .unwrap_or_else(|| panic!("{} has no field {name}", def.name));
                w.var_uint(field.id);
                write_field(w, schema, field.ty, field.array, value);
            }
            w.var_uint(0);
        }
        Kind::Enum => panic!("{} is an enum", def.name),
    }
}

fn write_field(w: &mut Writer, schema: &Schema, ty: Ty, array: bool, value: &V) {
    if array {
        match value {
            V::Bytes(bytes) => {
                w.var_uint(bytes.len() as u32);
                w.bytes.extend_from_slice(bytes);
            }
            V::List(items) => {
                w.var_uint(items.len() as u32);
                for item in items {
                    write_value(w, schema, ty, item);
                }
            }
            other => panic!("expected a list, got {other:?}"),
        }
    } else {
        write_value(w, schema, ty, value);
    }
}

fn write_value(w: &mut Writer, schema: &Schema, ty: Ty, value: &V) {
    match (ty, value) {
        (Ty::Bool, V::Bool(b)) => w.byte(u8::from(*b)),
        (Ty::Byte, V::Uint(v)) => w.byte(*v as u8),
        (Ty::Uint, V::Uint(v)) => w.var_uint(*v),
        (Ty::Int, V::Uint(v)) => w.var_int(*v as i32),
        (Ty::Float, V::Float(v)) => w.float(*v),
        (Ty::String, V::Str(s)) => w.string(s),
        (Ty::Def(i), V::Enum(name)) => {
            let def = schema.def(i);
            let field = def
                .fields
                .iter()
                .find(|f| f.name == *name)
                .unwrap_or_else(|| panic!("{} has no value {name}", def.name));
            w.var_uint(field.id);
        }
        (Ty::Def(i), V::Msg(fields)) => write_def(w, schema, i, fields),
        (ty, v) => panic!("cannot write {v:?} as {ty:?}"),
    }
}

fn write_zero(w: &mut Writer, schema: &Schema, ty: Ty, array: bool) {
    if array {
        w.var_uint(0);
        return;
    }
    match ty {
        Ty::Bool | Ty::Byte => w.byte(0),
        Ty::Int | Ty::Uint | Ty::Int64 | Ty::Uint64 => w.var_uint(0),
        Ty::Float => w.byte(0),
        Ty::String => w.byte(0),
        Ty::Def(i) => match schema.def(i).kind {
            Kind::Enum => w.var_uint(0),
            _ => write_def(w, schema, i, &[]),
        },
    }
}

// ---- documents ---------------------------------------------------------------

pub fn guid(local: u32) -> V {
    V::Msg(vec![("sessionID", V::Uint(1)), ("localID", V::Uint(local))])
}

pub fn color(r: f32, g: f32, b: f32, a: f32) -> V {
    V::Msg(vec![
        ("r", V::Float(r)),
        ("g", V::Float(g)),
        ("b", V::Float(b)),
        ("a", V::Float(a)),
    ])
}

pub fn solid(r: f32, g: f32, b: f32) -> V {
    V::Msg(vec![
        ("type", V::Enum("SOLID")),
        ("color", color(r, g, b, 1.0)),
        ("opacity", V::Float(1.0)),
        ("visible", V::Bool(true)),
    ])
}

pub fn size(w: f32, h: f32) -> V {
    V::Msg(vec![("x", V::Float(w)), ("y", V::Float(h))])
}

pub fn translate(x: f32, y: f32) -> V {
    V::Msg(vec![
        ("m00", V::Float(1.0)),
        ("m11", V::Float(1.0)),
        ("m02", V::Float(x)),
        ("m12", V::Float(y)),
    ])
}

/// A node change: `local` id, parent `local` id (0 for none), position.
pub fn node(
    local: u32,
    parent: Option<(u32, &str)>,
    ty: &'static str,
    name: &str,
    mut rest: Vec<(&'static str, V)>,
) -> V {
    let mut fields = vec![
        ("guid", guid(local)),
        ("type", V::Enum(ty)),
        ("name", V::Str(name.to_owned())),
        ("visible", V::Bool(true)),
        ("opacity", V::Float(1.0)),
    ];
    if let Some((parent, position)) = parent {
        fields.push((
            "parentIndex",
            V::Msg(vec![
                ("guid", guid(parent)),
                ("position", V::Str(position.to_owned())),
            ]),
        ));
    }
    fields.append(&mut rest);
    V::Msg(fields)
}

/// Builds a legacy-layout `.fig` (bare `fig-kiwi` document) from node
/// changes and blobs. The schema is deflated and the message deflated too.
pub fn fig_file(nodes: Vec<V>, blobs: Vec<Vec<u8>>) -> Vec<u8> {
    fig_file_with(SCHEMA, nodes, blobs)
}

/// [`fig_file`] with another schema (in [`SCHEMA`]'s text form), for tests
/// of fields the common one leaves out.
pub fn fig_file_with(schema_text: &str, nodes: Vec<V>, blobs: Vec<Vec<u8>>) -> Vec<u8> {
    let schema_bytes = encode_schema(schema_text);
    let schema = Schema::decode(&schema_bytes).expect("test schema decodes");
    let message = encode(
        &schema,
        "Message",
        &[
            ("nodeChanges", V::List(nodes)),
            (
                "blobs",
                V::List(
                    blobs
                        .into_iter()
                        .map(|b| V::Msg(vec![("bytes", V::Bytes(b))]))
                        .collect(),
                ),
            ),
        ],
    );
    let mut out = b"fig-kiwi".to_vec();
    out.extend_from_slice(&20u32.to_le_bytes());
    for chunk in [schema_bytes, message] {
        let compressed = miniz_oxide::deflate::compress_to_vec(&chunk, 6);
        out.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
        out.extend_from_slice(&compressed);
    }
    out
}

/// The same document wrapped in the current ZIP layout, with `meta.json`.
pub fn fig_zip(document: &[u8], file_name: &str) -> Vec<u8> {
    let meta = format!("{{\"file_name\":\"{file_name}\"}}");
    zip_stored(&[("canvas.fig", document), ("meta.json", meta.as_bytes())])
}

/// A minimal ZIP archive with stored (uncompressed) entries.
pub fn zip_stored(entries: &[(&str, &[u8])]) -> Vec<u8> {
    crate::zip::write_stored(entries)
}

/// A geometry blob from `(command, points)` pairs: 1 move, 2 line, 3 quad,
/// 4 cubic, 0 close.
pub fn path_blob(commands: &[(u8, &[f32])]) -> Vec<u8> {
    let mut out = Vec::new();
    for (cmd, points) in commands {
        out.push(*cmd);
        for p in *points {
            out.extend_from_slice(&p.to_le_bytes());
        }
    }
    out
}

/// A document with one page holding a red 100×50 rectangle at (10, 20)
/// inside a white 200×200 frame at the origin.
pub fn simple_file() -> Vec<u8> {
    fig_file(
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(
                1,
                Some((0, "!")),
                "CANVAS",
                "Page 1",
                vec![("backgroundColor", color(0.9, 0.9, 0.9, 1.0))],
            ),
            node(
                2,
                Some((1, "!")),
                "FRAME",
                "Frame",
                vec![
                    ("size", size(200.0, 200.0)),
                    ("transform", translate(0.0, 0.0)),
                    ("fillPaints", V::List(vec![solid(1.0, 1.0, 1.0)])),
                ],
            ),
            node(
                3,
                Some((2, "!")),
                "RECTANGLE",
                "Red",
                vec![
                    ("size", size(100.0, 50.0)),
                    ("transform", translate(10.0, 20.0)),
                    ("fillPaints", V::List(vec![solid(1.0, 0.0, 0.0)])),
                ],
            ),
        ],
        vec![],
    )
}

fn linear_gradient(from: V, to: V) -> V {
    V::Msg(vec![
        ("type", V::Enum("GRADIENT_LINEAR")),
        ("opacity", V::Float(1.0)),
        ("visible", V::Bool(true)),
        (
            "stops",
            V::List(vec![
                V::Msg(vec![("color", from), ("position", V::Float(0.0))]),
                V::Msg(vec![("color", to), ("position", V::Float(1.0))]),
            ]),
        ),
        ("transform", translate(0.0, 0.0)),
    ])
}

/// A circle of radius `r` centred in a `2r` square, as cubic commands.
fn circle_blob(r: f32) -> Vec<u8> {
    let k = 0.552_284_8 * r;
    let d = 2.0 * r;
    path_blob(&[
        (1, &[r, 0.0]),
        (4, &[r + k, 0.0, d, r - k, d, r]),
        (4, &[d, r + k, r + k, d, r, d]),
        (4, &[r - k, d, 0.0, r + k, 0.0, r]),
        (4, &[0.0, r - k, r - k, 0.0, r, 0.0]),
        (0, &[]),
    ])
}

/// The synthetic file the browser fixture and end-to-end tests open: two
/// pages, frames with a gradient, a vector circle, an inside stroke, a drop
/// shadow, and a component with an overridden instance. Every byte is
/// generated here; `tests/fixtures/showcase.fig` is this file's output.
pub fn showcase_file() -> Vec<u8> {
    let path = |blob: u32| {
        V::List(vec![V::Msg(vec![
            ("windingRule", V::Enum("NONZERO")),
            ("commandsBlob", V::Uint(blob)),
        ])])
    };
    fig_file(
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(
                1,
                Some((0, "a")),
                "CANVAS",
                "Screens",
                vec![("backgroundColor", color(0.96, 0.96, 0.96, 1.0))],
            ),
            node(
                2,
                Some((0, "b")),
                "CANVAS",
                "Components",
                vec![("backgroundColor", color(0.12, 0.12, 0.12, 1.0))],
            ),
            // Page 1: two screens.
            node(
                10,
                Some((1, "a")),
                "FRAME",
                "Home",
                vec![
                    ("size", size(360.0, 640.0)),
                    ("transform", translate(0.0, 0.0)),
                    ("fillPaints", V::List(vec![solid(1.0, 1.0, 1.0)])),
                ],
            ),
            node(
                11,
                Some((10, "a")),
                "RECTANGLE",
                "Header",
                vec![
                    ("size", size(360.0, 160.0)),
                    ("transform", translate(0.0, 0.0)),
                    (
                        "fillPaints",
                        V::List(vec![linear_gradient(
                            color(0.05, 0.6, 1.0, 1.0),
                            color(0.6, 0.28, 1.0, 1.0),
                        )]),
                    ),
                ],
            ),
            node(
                12,
                Some((10, "b")),
                "ELLIPSE",
                "Avatar",
                vec![
                    ("size", size(96.0, 96.0)),
                    ("transform", translate(132.0, 112.0)),
                    ("fillPaints", V::List(vec![solid(1.0, 0.8, 0.2)])),
                    ("strokePaints", V::List(vec![solid(1.0, 1.0, 1.0)])),
                    ("strokeWeight", V::Float(4.0)),
                    ("strokeAlign", V::Enum("INSIDE")),
                    ("fillGeometry", path(0)),
                ],
            ),
            node(
                13,
                Some((10, "c")),
                "RECTANGLE",
                "Card",
                vec![
                    ("size", size(312.0, 120.0)),
                    ("transform", translate(24.0, 260.0)),
                    ("cornerRadius", V::Float(16.0)),
                    ("fillPaints", V::List(vec![solid(1.0, 1.0, 1.0)])),
                    (
                        "effects",
                        V::List(vec![V::Msg(vec![
                            ("type", V::Enum("DROP_SHADOW")),
                            ("color", color(0.0, 0.0, 0.0, 0.25)),
                            ("offset", size(0.0, 4.0)),
                            ("radius", V::Float(12.0)),
                            ("visible", V::Bool(true)),
                        ])]),
                    ),
                ],
            ),
            node(
                14,
                Some((10, "d")),
                "INSTANCE",
                "Primary button",
                vec![
                    ("size", size(160.0, 48.0)),
                    ("transform", translate(100.0, 420.0)),
                    (
                        "symbolData",
                        V::Msg(vec![
                            ("symbolID", guid(30)),
                            (
                                "symbolOverrides",
                                V::List(vec![V::Msg(vec![
                                    ("guidPath", V::Msg(vec![("guids", V::List(vec![guid(31)]))])),
                                    ("fillPaints", V::List(vec![solid(0.95, 0.28, 0.13)])),
                                ])]),
                            ),
                        ]),
                    ),
                ],
            ),
            node(
                20,
                Some((1, "b")),
                "FRAME",
                "Settings",
                vec![
                    ("size", size(360.0, 640.0)),
                    ("transform", translate(440.0, 0.0)),
                    ("fillPaints", V::List(vec![solid(0.98, 0.98, 1.0)])),
                ],
            ),
            node(
                21,
                Some((20, "a")),
                "RECTANGLE",
                "Row",
                vec![
                    ("size", size(312.0, 56.0)),
                    ("transform", translate(24.0, 40.0)),
                    ("cornerRadius", V::Float(8.0)),
                    ("fillPaints", V::List(vec![solid(0.9, 0.92, 0.96)])),
                ],
            ),
            // Page 2: the component.
            node(
                30,
                Some((2, "a")),
                "SYMBOL",
                "Button",
                vec![
                    ("size", size(160.0, 48.0)),
                    ("transform", translate(0.0, 0.0)),
                ],
            ),
            node(
                31,
                Some((30, "a")),
                "RECTANGLE",
                "Background",
                vec![
                    ("size", size(160.0, 48.0)),
                    ("transform", translate(0.0, 0.0)),
                    ("cornerRadius", V::Float(24.0)),
                    ("fillPaints", V::List(vec![solid(0.05, 0.6, 1.0)])),
                ],
            ),
        ],
        vec![circle_blob(48.0)],
    )
}

/// The committed fixture must match what [`showcase_file`] writes; run
/// `cargo test -p fig_engine --lib write_showcase_fixture -- --ignored` after
/// changing it.
#[test]
fn showcase_fixture_is_current() {
    let committed = include_bytes!("../tests/fixtures/showcase.fig");
    assert!(
        committed.as_slice() == showcase_file().as_slice(),
        "tests/fixtures/showcase.fig is stale; regenerate it (see the doc comment)"
    );
}

#[test]
#[ignore = "writes tests/fixtures/showcase.fig"]
fn write_showcase_fixture() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/showcase.fig");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, showcase_file()).unwrap();
}
