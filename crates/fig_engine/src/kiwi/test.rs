use super::*;
use crate::testing::{SCHEMA, V, Writer, encode, encode_schema, guid, solid};

fn schema() -> Schema {
    Schema::decode(&encode_schema(SCHEMA)).unwrap()
}

#[test]
fn reads_varints_floats_and_strings() {
    let mut w = Writer::default();
    for v in [0, 1, 127, 128, 300, u32::MAX] {
        w.var_uint(v);
    }
    for v in [0, -1, 1, -64, 64, i32::MIN, i32::MAX] {
        w.var_int(v);
    }
    for v in [0.0, 1.0, -2.5, 0.1, 1e30] {
        w.float(v);
    }
    w.string("héllo");
    let mut r = Reader::new(&w.bytes);
    for v in [0, 1, 127, 128, 300, u32::MAX] {
        assert_eq!(r.var_uint().unwrap(), v);
    }
    for v in [0, -1, 1, -64, 64, i32::MIN, i32::MAX] {
        assert_eq!(r.var_int().unwrap(), v);
    }
    for v in [0.0, 1.0, -2.5, 0.1, 1e30] {
        assert_eq!(r.float().unwrap(), v);
    }
    assert_eq!(r.string().unwrap(), "héllo");
    assert!(r.byte().is_err(), "reads past the end are errors");
}

#[test]
fn zero_floats_take_one_byte() {
    let mut w = Writer::default();
    w.float(0.0);
    assert_eq!(w.bytes, [0]);
}

#[test]
fn decodes_the_schema() {
    let s = schema();
    let node = s.def(s.def_index("NodeChange").unwrap());
    assert_eq!(node.kind, Kind::Message);
    let size = node.fields.iter().find(|f| f.name == "size").unwrap();
    assert_eq!(size.ty, Ty::Def(s.def_index("Vector").unwrap()));
    assert!(
        node.fields
            .iter()
            .find(|f| f.name == "fillPaints")
            .unwrap()
            .array
    );
    let node_type = s.def_index("NodeType").unwrap();
    assert_eq!(s.enum_name(node_type, 0), Some("DOCUMENT"));
    assert_eq!(s.enum_name(node_type, 9), Some("SYMBOL"));
    assert_eq!(s.enum_name(node_type, 999), None);
}

#[test]
fn decodes_messages_by_field_name() {
    let s = schema();
    let bytes = encode(
        &s,
        "NodeChange",
        &[
            ("guid", guid(7)),
            ("type", V::Enum("RECTANGLE")),
            ("name", V::Str("Box".into())),
            ("opacity", V::Float(0.5)),
            ("visible", V::Bool(false)),
            (
                "fillPaints",
                V::List(vec![solid(1.0, 0.0, 0.0), solid(0.0, 0.0, 1.0)]),
            ),
        ],
    );
    let msg = Decoder::new(&s)
        .decode(&mut Reader::new(&bytes), s.def_index("NodeChange").unwrap())
        .unwrap();
    let m = MsgRef::new(&s, &msg);
    assert_eq!(m.msg("guid").and_then(|g| g.u32("localID")), Some(7));
    assert_eq!(m.enum_name("type"), Some("RECTANGLE"));
    assert_eq!(m.str("name"), Some("Box"));
    assert_eq!(m.f32("opacity"), Some(0.5));
    assert_eq!(m.bool("visible"), Some(false));
    assert!(!m.has("size"));
    assert_eq!(m.get("noSuchField").map(|_| ()), None);
    let paints: Vec<_> = m
        .msgs("fillPaints")
        .map(|p| p.msg("color").and_then(|c| c.f32("b")))
        .collect();
    assert_eq!(paints, [Some(0.0), Some(1.0)]);
}

#[test]
fn finds_fields_written_out_of_order() {
    let s = schema();
    // Writers normally emit fields in id order; lookups must not rely on it.
    let bytes = encode(
        &s,
        "NodeChange",
        &[
            ("name", V::Str("Late".into())),
            ("opacity", V::Float(0.25)),
            ("guid", guid(3)),
        ],
    );
    let msg = Decoder::new(&s)
        .decode(&mut Reader::new(&bytes), s.def_index("NodeChange").unwrap())
        .unwrap();
    let m = MsgRef::new(&s, &msg);
    assert_eq!(m.str("name"), Some("Late"));
    assert_eq!(m.f32("opacity"), Some(0.25));
    assert_eq!(m.msg("guid").and_then(|g| g.u32("localID")), Some(3));
}

#[test]
fn skips_fields_outside_the_allowlist() {
    let mut s = schema();
    s.keep_only("NodeChange", &["guid", "name"]);
    let bytes = encode(
        &s,
        "NodeChange",
        &[
            ("unusedField", V::Str("skip me".into())),
            ("name", V::Str("Kept".into())),
            ("fillPaints", V::List(vec![solid(1.0, 1.0, 1.0)])),
            ("opacity", V::Float(0.5)),
        ],
    );
    let mut r = Reader::new(&bytes);
    let msg = Decoder::new(&s)
        .decode(&mut r, s.def_index("NodeChange").unwrap())
        .unwrap();
    assert_eq!(r.at, bytes.len(), "skipped fields are consumed");
    let m = MsgRef::new(&s, &msg);
    assert_eq!(m.str("name"), Some("Kept"));
    assert!(!m.has("fillPaints"));
    assert!(!m.has("opacity"));
    assert_eq!(msg.fields.len(), 1);
}

#[test]
fn rejects_unknown_fields_and_truncation() {
    let s = schema();
    let node = s.def_index("NodeChange").unwrap();
    // Field id 999 does not exist.
    let mut w = Writer::default();
    w.var_uint(999);
    w.var_uint(0);
    assert!(
        Decoder::new(&s)
            .decode(&mut Reader::new(&w.bytes), node)
            .is_err()
    );

    let bytes = encode(&s, "NodeChange", &[("name", V::Str("Cut".into()))]);
    let cut = &bytes[..bytes.len() - 3];
    assert!(
        Decoder::new(&s)
            .decode(&mut Reader::new(cut), node)
            .is_err()
    );
}

#[test]
fn bounds_nesting_depth() {
    // Overrides nest node changes; a hostile file nesting them without end
    // must fail rather than overflow the stack.
    let s = schema();
    let node = s.def_index("NodeChange").unwrap();
    let symbol_data = s
        .def(node)
        .fields
        .iter()
        .find(|f| f.name == "symbolData")
        .unwrap()
        .id;
    let overrides = s
        .def(s.def_index("SymbolData").unwrap())
        .fields
        .iter()
        .find(|f| f.name == "symbolOverrides")
        .unwrap()
        .id;
    let mut w = Writer::default();
    for _ in 0..400 {
        w.var_uint(symbol_data);
        w.var_uint(overrides);
        w.var_uint(1);
    }
    assert!(
        Decoder::new(&s)
            .decode(&mut Reader::new(&w.bytes), node)
            .is_err()
    );
}

#[test]
fn caches_field_lookups_per_definition() {
    let s = schema();
    let node = s.def_index("NodeChange").unwrap();
    let paint = s.def_index("Paint").unwrap();
    // The same literal name means different fields in different types.
    let a = s.field_index(node, "type").unwrap();
    let b = s.field_index(paint, "type").unwrap();
    assert_eq!(s.def(node).fields[a as usize].name, "type");
    assert_eq!(s.def(paint).fields[b as usize].name, "type");
    assert_eq!(s.field_index(node, "type"), Some(a));
    assert_eq!(s.field_index(paint, "type"), Some(b));
    assert_eq!(s.field_index(paint, "noSuchField"), None);
}
