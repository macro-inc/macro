//! Writing export presets, layout grids, and guides.
//!
//! Entries are patched in place where the record already had one at the
//! same index, so fields the engine does not model (an export's color
//! profile and sampler, say) survive.

use super::{Build, NewDef};
use crate::kiwi::{Kind, Msg, Schema, Value};
use crate::model::{Axis, ExportFormat, ExportSetting, GridPattern, Guide, LayoutGrid, Props};

/// The messages of a list field, and the type of its entries.
fn entries(b: &Build, m: &Msg, field: &str) -> Option<(u32, Vec<Msg>)> {
    let def = b.sub(m.def, field)?;
    let old = match m.get(b.schema, field) {
        Some(Value::List(l)) => l
            .iter()
            .filter_map(|v| match v {
                Value::Msg(m) => Some((**m).clone()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    };
    Some((def, old))
}

fn axis_name(a: Axis) -> &'static str {
    match a {
        Axis::X => "X",
        Axis::Y => "Y",
    }
}

impl Build<'_> {
    /// Writes `list` into `field`, each entry built from the record's entry
    /// at its index (or a new one) by `fill`.
    fn patch_list<T>(
        &self,
        m: &mut Msg,
        field: &str,
        list: &[T],
        fill: impl Fn(&Self, &mut Msg, &T),
    ) {
        let Some((def, old)) = entries(self, m, field) else {
            return;
        };
        let items: Vec<Value> = list
            .iter()
            .enumerate()
            .map(|(k, item)| {
                let mut e = old.get(k).cloned().unwrap_or_else(|| Msg::new(def));
                fill(self, &mut e, item);
                Value::Msg(Box::new(e))
            })
            .collect();
        if items.is_empty() {
            m.remove(self.schema, field);
        } else {
            m.set(self.schema, field, Value::List(items));
        }
    }

    fn export_setting(&self, e: &mut Msg, s: &ExportSetting) {
        let schema = self.schema;
        e.set(schema, "suffix", Value::Str(s.suffix.as_str().into()));
        self.set_enum(e, "imageType", s.format.name());
        self.msg_field(e, "constraint", |b, c| {
            b.set_enum(c, "type", s.constraint.name());
            c.set(b.schema, "value", Value::Float(s.value));
        });
        e.set(schema, "contentsOnly", Value::Bool(s.contents_only));
        e.set(
            schema,
            "useAbsoluteBounds",
            Value::Bool(s.use_absolute_bounds),
        );
        if s.format == ExportFormat::Svg {
            e.set(schema, "svgOutlineText", Value::Bool(s.svg_outline_text));
            self.set_enum(
                e,
                "svgIDMode",
                if s.svg_include_id {
                    "ALWAYS"
                } else {
                    "IF_NEEDED"
                },
            );
        }
        if s.format == ExportFormat::Jpeg {
            e.set(
                schema,
                "quality",
                Value::Float(f32::from(s.quality.clamp(1, 100)) / 100.0),
            );
        }
    }

    fn layout_grid(&self, e: &mut Msg, g: &LayoutGrid) {
        let schema = self.schema;
        // Values typed in the panel replace variables bound to them.
        for f in [
            "numSectionsVar",
            "offsetVar",
            "sectionSizeVar",
            "gutterSizeVar",
        ] {
            e.remove(schema, f);
        }
        self.set_enum(
            e,
            "pattern",
            match g.pattern {
                GridPattern::Grid => "GRID",
                GridPattern::Stripes => "STRIPES",
            },
        );
        self.set_enum(e, "axis", axis_name(g.axis));
        self.set_enum(e, "type", g.align.name());
        e.set(schema, "visible", Value::Bool(g.visible));
        e.set(schema, "numSections", Value::Int(g.count));
        e.set(schema, "offset", Value::Float(g.offset));
        e.set(schema, "sectionSize", Value::Float(g.section_size));
        e.set(schema, "gutterSize", Value::Float(g.gutter));
        self.color(e, "color", g.color);
    }

    fn guide(&self, e: &mut Msg, g: &Guide) {
        self.set_enum(e, "axis", axis_name(g.axis));
        e.set(self.schema, "offset", Value::Float(g.offset));
        if let Some(id) = g.guid {
            self.guid_field(e, "guid", id);
        }
    }

    pub(super) fn export_settings(&self, m: &mut Msg, p: &Props) {
        let list = p.export_settings.as_deref().unwrap_or(&[]);
        self.patch_list(m, "exportSettings", list, Self::export_setting);
    }

    pub(super) fn layout_grids(&self, m: &mut Msg, p: &Props) {
        let list = p.layout_grids.as_deref().unwrap_or(&[]);
        self.patch_list(m, "layoutGrids", list, Self::layout_grid);
    }

    pub(super) fn guides(&self, m: &mut Msg, p: &Props) {
        let list = p.guides.as_deref().unwrap_or(&[]);
        self.patch_list(m, "guides", list, Self::guide);
    }
}

const BOOL: i32 = -1;
const INT: i32 = -3;
const FLOAT: i32 = -5;
const STRING: i32 = -6;

/// The types and `NodeChange` fields a schema without export presets,
/// layout grids, or guides gets (files made in Macro before it wrote them),
/// named and shaped as in Figma's schema. Types the schema already has are
/// used as they are.
pub(super) fn schema_additions(
    schema: &Schema,
    has: &dyn Fn(&str) -> bool,
    count: u32,
    added: &mut Vec<NewDef<'static>>,
    fields: &mut Vec<(&'static str, i32, bool)>,
) {
    let (Some(color), Some(guid)) = (schema.def_index("Color"), schema.def_index("GUID")) else {
        return;
    };
    let mut def = |name: &'static str, kind: Kind, items: Vec<(&'static str, i32)>| -> i32 {
        if let Some(d) = schema.def_index(name) {
            return d as i32;
        }
        added.push((name, kind, items));
        (count + added.len() as u32 - 1) as i32
    };
    let image_type = def(
        "ImageType",
        Kind::Enum,
        vec![("PNG", 0), ("JPEG", 1), ("SVG", 2), ("PDF", 3)],
    );
    let constraint_type = def(
        "ExportConstraintType",
        Kind::Enum,
        vec![
            ("CONTENT_SCALE", 0),
            ("CONTENT_WIDTH", 1),
            ("CONTENT_HEIGHT", 2),
        ],
    );
    let constraint = def(
        "ExportConstraint",
        Kind::Struct,
        vec![("type", constraint_type), ("value", FLOAT)],
    );
    let id_mode = def(
        "ExportSVGIDMode",
        Kind::Enum,
        vec![("IF_NEEDED", 0), ("ALWAYS", 1)],
    );
    let export = def(
        "ExportSettings",
        Kind::Message,
        vec![
            ("suffix", STRING),
            ("imageType", image_type),
            ("constraint", constraint),
            ("svgIDMode", id_mode),
            ("svgOutlineText", BOOL),
            ("contentsOnly", BOOL),
            ("useAbsoluteBounds", BOOL),
            ("quality", FLOAT),
        ],
    );
    let axis = def("Axis", Kind::Enum, vec![("X", 0), ("Y", 1)]);
    let grid_type = def(
        "LayoutGridType",
        Kind::Enum,
        vec![("MIN", 0), ("CENTER", 1), ("STRETCH", 2), ("MAX", 3)],
    );
    let pattern = def(
        "LayoutGridPattern",
        Kind::Enum,
        vec![("STRIPES", 0), ("GRID", 1)],
    );
    let grid = def(
        "LayoutGrid",
        Kind::Message,
        vec![
            ("type", grid_type),
            ("axis", axis),
            ("visible", BOOL),
            ("numSections", INT),
            ("offset", FLOAT),
            ("sectionSize", FLOAT),
            ("gutterSize", FLOAT),
            ("color", color as i32),
            ("pattern", pattern),
        ],
    );
    let guide = def(
        "Guide",
        Kind::Message,
        vec![("axis", axis), ("offset", FLOAT), ("guid", guid as i32)],
    );
    for (name, ty) in [
        ("exportSettings", export),
        ("layoutGrids", grid),
        ("guides", guide),
    ] {
        if !has(name) {
            fields.push((name, ty, true));
        }
    }
}
