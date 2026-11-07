//! Paints written as operators: colors in their spaces, gradients as
//! shading patterns (their stops' opacities as soft masks), strokes, and
//! opacity and blending as graphics states.

use super::objects::Objects;
use super::resources::Resources;
use crate::geom::{Affine, Rect};
use crate::model::{BlendMode, Color, Gradient, LineCap, LineJoin, Paint, Stroke};
use crate::pdf::content::Op;
use crate::pdf::{Dict, Name, Object, Stream};

fn nums(v: &[f64]) -> Vec<Object> {
    v.iter().map(|&x| Object::number(x)).collect()
}

fn op(name: &str, operands: Vec<Object>) -> Op {
    Op::new(name, operands)
}

/// A spot color's full-strength RGB from its RGB at a tint.
fn full_tint(rgb: [f32; 3], tint: f32) -> [f32; 3] {
    if tint <= 1e-3 {
        return rgb;
    }
    rgb.map(|c| (1.0 - (1.0 - c) / tint).clamp(0.0, 1.0))
}

/// Operators setting a color for filling (or stroking).
pub fn color_ops(color: &Color, stroke: bool, res: &mut Resources) -> Vec<Op> {
    let pick = |fill: &str, strk: &str| {
        if stroke {
            strk.to_string()
        } else {
            fill.to_string()
        }
    };
    match color {
        Color::Gray { g } => vec![op(&pick("g", "G"), nums(&[f64::from(*g)]))],
        Color::Rgb { r, g, b } => vec![op(
            &pick("rg", "RG"),
            nums(&[f64::from(*r), f64::from(*g), f64::from(*b)]),
        )],
        Color::Cmyk { c, m, y, k } => vec![op(
            &pick("k", "K"),
            nums(&[f64::from(*c), f64::from(*m), f64::from(*y), f64::from(*k)]),
        )],
        Color::Spot { name, tint, rgb } => {
            let full = full_tint(*rgb, *tint);
            let mut f = Dict::new();
            f.set("FunctionType", 2);
            f.set("Domain", Object::Array(nums(&[0.0, 1.0])));
            f.set("C0", Object::Array(nums(&[1.0, 1.0, 1.0])));
            f.set(
                "C1",
                Object::Array(full.iter().map(|&v| Object::number(f64::from(v))).collect()),
            );
            f.set("N", 1);
            let space = Object::Array(vec![
                Object::name("Separation"),
                Object::Name(Name::new(name)),
                Object::name("DeviceRGB"),
                Object::Dict(f),
            ]);
            let n = res.name("ColorSpace", space);
            vec![
                op(&pick("cs", "CS"), vec![Object::Name(n)]),
                op(&pick("scn", "SCN"), nums(&[f64::from(*tint)])),
            ]
        }
    }
}

/// A gradient's colors as a function of `t` in `0..=1`.
fn gradient_function(g: &Gradient) -> Object {
    stops_function(
        g.stops
            .iter()
            .map(|s| (f64::from(s.offset), s.color.to_rgb().to_vec()))
            .collect(),
    )
}

/// A gradient's stop opacities as a function of `t` in `0..=1`.
fn opacity_function(g: &Gradient) -> Object {
    stops_function(
        g.stops
            .iter()
            .map(|s| (f64::from(s.offset), vec![s.opacity.clamp(0.0, 1.0)]))
            .collect(),
    )
}

/// Values at stops (by offset, `0..=1`) as a function of `t` in `0..=1`:
/// linear between stops, constant past the first and last.
fn stops_function(mut stops: Vec<(f64, Vec<f32>)>) -> Object {
    for s in &mut stops {
        s.0 = s.0.clamp(0.0, 1.0);
    }
    stops.sort_by(|a, b| a.0.total_cmp(&b.0));
    if stops.is_empty() {
        stops.push((0.0, vec![0.0; 3]));
    }
    if stops[0].0 > 0.0 {
        stops.insert(0, (0.0, stops[0].1.clone()));
    }
    let last = stops.last().expect("not empty").clone();
    if last.0 < 1.0 {
        stops.push((1.0, last.1));
    }
    if stops.len() == 1 {
        stops.push((1.0, stops[0].1.clone()));
    }
    let segment = |a: &[f32], b: &[f32]| {
        let mut f = Dict::new();
        f.set("FunctionType", 2);
        f.set("Domain", Object::Array(nums(&[0.0, 1.0])));
        f.set(
            "C0",
            Object::Array(a.iter().map(|&v| Object::number(f64::from(v))).collect()),
        );
        f.set(
            "C1",
            Object::Array(b.iter().map(|&v| Object::number(f64::from(v))).collect()),
        );
        f.set("N", 1);
        Object::Dict(f)
    };
    if stops.len() == 2 {
        return segment(&stops[0].1, &stops[1].1);
    }
    let mut functions = Vec::new();
    let mut bounds = Vec::new();
    let mut encode = Vec::new();
    for w in stops.windows(2) {
        functions.push(segment(&w[0].1, &w[1].1));
        encode.extend([0.0, 1.0]);
    }
    for s in &stops[1..stops.len() - 1] {
        bounds.push(s.0);
    }
    let mut f = Dict::new();
    f.set("FunctionType", 3);
    f.set("Domain", Object::Array(nums(&[0.0, 1.0])));
    f.set("Functions", Object::Array(functions));
    f.set("Bounds", Object::Array(nums(&bounds)));
    f.set("Encode", Object::Array(nums(&encode)));
    Object::Dict(f)
}

/// A shading of a gradient's geometry with `function` in `space`.
fn shading(g: &Gradient, space: &str, function: Object) -> Dict {
    let mut sh = Dict::new();
    if g.radial {
        sh.set("ShadingType", 3);
        sh.set(
            "Coords",
            Object::Array(nums(&[
                g.start.x,
                g.start.y,
                g.start_radius,
                g.end.x,
                g.end.y,
                g.end_radius,
            ])),
        );
    } else {
        sh.set("ShadingType", 2);
        sh.set(
            "Coords",
            Object::Array(nums(&[g.start.x, g.start.y, g.end.x, g.end.y])),
        );
    }
    sh.set("ColorSpace", Object::name(space));
    sh.set("Function", function);
    sh.set(
        "Extend",
        Object::Array(vec![Object::Bool(g.extend[0]), Object::Bool(g.extend[1])]),
    );
    sh
}

/// A shading pattern painting a gradient; `to_page` maps the object's
/// space to the content's space.
fn gradient_pattern(g: &Gradient, to_page: &Affine) -> Object {
    let sh = shading(g, "DeviceRGB", gradient_function(g));
    let m = g.transform.followed_by(to_page);
    let mut p = Dict::new();
    p.set("Type", Object::name("Pattern"));
    p.set("PatternType", 2);
    p.set("Shading", Object::Dict(sh));
    p.set("Matrix", Object::Array(nums(&m.0)));
    Object::Dict(p)
}

/// Operators setting a paint for filling (or stroking); `to_page` maps
/// the object's space to the content's space (gradients are placed
/// there).
pub fn paint_ops(
    paint: &Paint,
    stroke: bool,
    to_page: &Affine,
    res: &mut Resources,
    objects: &mut Objects,
) -> Vec<Op> {
    match paint {
        Paint::Solid { color } => color_ops(color, stroke, res),
        Paint::Gradient { gradient } => {
            let pattern = objects.add(gradient_pattern(gradient, to_page));
            let n = res.name("Pattern", Object::Ref(pattern));
            vec![
                op(
                    if stroke { "CS" } else { "cs" },
                    vec![Object::name("Pattern")],
                ),
                op(if stroke { "SCN" } else { "scn" }, vec![Object::Name(n)]),
            ]
        }
    }
}

/// Operators setting a stroke's paint and line settings.
pub fn stroke_ops(
    s: &Stroke,
    to_page: &Affine,
    res: &mut Resources,
    objects: &mut Objects,
) -> Vec<Op> {
    let mut out = paint_ops(&s.paint, true, to_page, res, objects);
    out.push(op("w", nums(&[s.width])));
    out.push(op(
        "J",
        vec![Object::Int(match s.cap {
            LineCap::Butt => 0,
            LineCap::Round => 1,
            LineCap::Square => 2,
        })],
    ));
    out.push(op(
        "j",
        vec![Object::Int(match s.join {
            LineJoin::Miter => 0,
            LineJoin::Round => 1,
            LineJoin::Bevel => 2,
        })],
    ));
    out.push(op("M", nums(&[s.miter_limit])));
    out.push(op(
        "d",
        vec![Object::Array(nums(&s.dash)), Object::number(s.dash_offset)],
    ));
    out
}

/// Whether a paint is a gradient with stops that aren't opaque.
pub fn has_alpha(paint: &Paint) -> bool {
    matches!(paint, Paint::Gradient { gradient } if gradient.stops.iter().any(|s| s.opacity < 1.0))
}

/// A graphics state whose soft mask is a gradient's stop opacities, for
/// painting `bounds` (in the object's space, which the current
/// transformation maps to the page): Illustrator's form for gradients
/// with transparent stops. None for other paints.
pub fn alpha_mask_ops(
    paint: &Paint,
    bounds: Rect,
    res: &mut Resources,
    objects: &mut Objects,
) -> Vec<Op> {
    let Paint::Gradient { gradient: g } = paint else {
        return Vec::new();
    };
    if !has_alpha(paint) {
        return Vec::new();
    }
    // The mask draws in gradient space, which its matrix maps to the
    // object's.
    let Some(inverse) = g.transform.invert() else {
        return Vec::new();
    };
    let area = bounds.transform(&inverse).outset(1.0);
    let mut shadings = Dict::new();
    shadings.set(
        "Sh0",
        Object::Dict(shading(g, "DeviceGray", opacity_function(g))),
    );
    let mut resources = Dict::new();
    resources.set("Shading", Object::Dict(shadings));
    let mut group = Dict::new();
    group.set("Type", Object::name("Group"));
    group.set("S", Object::name("Transparency"));
    group.set("CS", Object::name("DeviceGray"));
    let mut form = Dict::new();
    form.set("Type", Object::name("XObject"));
    form.set("Subtype", Object::name("Form"));
    form.set(
        "BBox",
        Object::Array(nums(&[area.x0, area.y0, area.x1, area.y1])),
    );
    form.set("Matrix", Object::Array(nums(&g.transform.0)));
    form.set("Group", Object::Dict(group));
    form.set("Resources", Object::Dict(resources));
    let form = objects.add(Object::Stream(Stream::new(form, b"/Sh0 sh".to_vec())));
    let mut mask = Dict::new();
    mask.set("Type", Object::name("Mask"));
    mask.set("S", Object::name("Luminosity"));
    mask.set("G", Object::Ref(form));
    let mut gs = Dict::new();
    gs.set("Type", Object::name("ExtGState"));
    gs.set("SMask", Object::Dict(mask));
    let n = res.name("ExtGState", Object::Dict(gs));
    vec![op("gs", vec![Object::Name(n)])]
}

/// A graphics state setting opacity and blending (none when both are
/// the defaults).
pub fn alpha_ops(opacity: f32, blend: BlendMode, res: &mut Resources) -> Vec<Op> {
    if opacity >= 1.0 && blend == BlendMode::Normal {
        return Vec::new();
    }
    let mut gs = Dict::new();
    gs.set("Type", Object::name("ExtGState"));
    gs.set("ca", Object::number(f64::from(opacity.clamp(0.0, 1.0))));
    gs.set("CA", Object::number(f64::from(opacity.clamp(0.0, 1.0))));
    gs.set("BM", Object::name(blend.pdf_name()));
    let n = res.name("ExtGState", Object::Dict(gs));
    vec![op("gs", vec![Object::Name(n)])]
}

/// A `cm` operator.
pub fn cm(m: &Affine) -> Op {
    op("cm", nums(&m.0))
}
