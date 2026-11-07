use super::*;
use crate::edit::{EditOp, EditResult, Editor, RunPatch};
use crate::inspect::ShapeOutline;
use crate::render::scene::{Effect, Node};
use crate::test_support::{deck, fonts, text_box};
use serde_json::json;

const SLIDE: u32 = 256;

/// A filled rectangle at (100, 100) pt, 200 × 100 pt.
fn shape(id: u32, sp_pr_tail: &str, style: &str) -> String {
    format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="Shape {id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1270000" y="1270000"/><a:ext cx="2540000" cy="1270000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>{sp_pr_tail}</p:spPr>{style}</p:sp>"#
    )
}

/// A style whose effect reference is the test theme's third effect style
/// (an outer shadow: blur 4.5 pt, distance 1.5 pt, straight down, 63% opaque).
const THEME_SHADOW_STYLE: &str = r#"<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="3"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>"#;

const TABLE: &str = r#"<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="Table 9"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="370840"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="914400"/></a:tblGrid><a:tr h="370840"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>"#;

fn open(shapes: &str) -> Presentation {
    Presentation::open(deck(&[shapes])).unwrap()
}

/// A `setShapeEffects` operation from JSON fields (as the editor and AI send them).
fn effects_op(shapes: &[u32], fields: serde_json::Value) -> EditOp {
    let mut op = json!({"op": "setShapeEffects", "slide": SLIDE, "shapes": shapes});
    for (k, v) in fields.as_object().unwrap() {
        op[k] = v.clone();
    }
    serde_json::from_value(op).unwrap()
}

fn apply(pres: &mut Presentation, op: EditOp) -> EditResult {
    pres.apply(&[op], fonts()).unwrap()
}

fn outline(pres: &mut Presentation, id: u32) -> ShapeOutline {
    let slide = pres.slide_outline(0).unwrap();
    slide.shapes.into_iter().find(|s| s.id == id).unwrap()
}

fn slide_xml(pres: &mut Presentation) -> String {
    pres.flush();
    let part = pres.slides()[0].part.clone();
    String::from_utf8(pres.package().read(&part).unwrap().into_owned()).unwrap()
}

/// The `a:effectLst` markup of the first shape that has one.
fn effect_list(pres: &mut Presentation) -> String {
    let xml = slide_xml(pres);
    let start = xml.find("<a:effectLst").expect("an effect list");
    let end = xml[start..].find("</a:effectLst>").map_or_else(
        || start + xml[start..].find("/>").unwrap() + 2,
        |e| start + e + 14,
    );
    xml[start..end].to_owned()
}

fn assert_reopens(pres: &mut Presentation) -> Presentation {
    let mut reopened = Presentation::open(pres.save().unwrap()).unwrap();
    let problems = reopened.integrity_problems().unwrap();
    assert!(problems.is_empty(), "{problems:#?}");
    reopened
}

#[test]
fn every_shadow_preset_writes_and_reads_back_by_name() {
    let mut pres = open(&shape(2, "", ""));
    for preset in SHADOW_PRESETS {
        apply(&mut pres, effects_op(&[2], json!({"shadow": preset.name})));
        let shadow = outline(&mut pres, 2).effects.unwrap().shadow.unwrap();
        assert_eq!(shadow.preset, Some(preset.name));
        assert_eq!(shadow.kind, if preset.inner { "inner" } else { "outer" });
        assert_eq!(shadow.color, "#000000");
        assert!((shadow.transparency - (1.0 - preset.alpha as f32)).abs() < 1e-3);
        assert!((shadow.blur_pt - preset.blur as f32).abs() < 1e-3);
        assert!((shadow.distance_pt - preset.dist as f32).abs() < 1e-3);
        // One shadow at a time.
        let list = effect_list(&mut pres);
        assert_eq!(list.matches("Shdw").count(), 2, "{list}");
    }
    let mut reopened = assert_reopens(&mut pres);
    let shadow = outline(&mut reopened, 2).effects.unwrap().shadow.unwrap();
    assert_eq!(shadow.preset, Some("perspectiveLowerRight"));
}

#[test]
fn gallery_shadow_markup_matches_powerpoint() {
    let mut pres = open(&shape(2, "", ""));
    apply(
        &mut pres,
        effects_op(&[2], json!({"shadow": "outerBottomRight"})),
    );
    assert_eq!(
        effect_list(&mut pres),
        r#"<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000" algn="tl" rotWithShape="0"><a:prstClr val="black"><a:alpha val="40000"/></a:prstClr></a:outerShdw></a:effectLst>"#
    );
    apply(&mut pres, effects_op(&[2], json!({"shadow": "innerTop"})));
    assert_eq!(
        effect_list(&mut pres),
        r#"<a:effectLst><a:innerShdw blurRad="63500" dist="50800" dir="5400000"><a:prstClr val="black"><a:alpha val="50000"/></a:prstClr></a:innerShdw></a:effectLst>"#
    );
}

#[test]
fn options_change_the_current_shadow() {
    let mut pres = open(&shape(2, "", ""));
    apply(
        &mut pres,
        effects_op(&[2], json!({"shadow": "outerBottom"})),
    );
    apply(
        &mut pres,
        effects_op(
            &[2],
            json!({"shadow": {"color": "C00000", "transparency": 0.25, "sizePct": 110,
                              "blurPt": 8, "distancePt": 6, "angleDeg": -45, "preset": null}}),
        ),
    );
    let shadow = outline(&mut pres, 2).effects.unwrap().shadow.unwrap();
    assert_eq!(shadow.preset, None, "custom values match no preset");
    assert_eq!(shadow.color, "#C00000");
    assert_eq!(shadow.transparency, 0.25);
    assert_eq!(shadow.size_pct, 110.0);
    assert_eq!(shadow.blur_pt, 8.0);
    assert_eq!(shadow.distance_pt, 6.0);
    assert_eq!(shadow.angle_deg, 315.0);
    // A new color keeps the transparency; a preset starts over from black.
    apply(
        &mut pres,
        effects_op(&[2], json!({"shadow": {"color": "accent2"}})),
    );
    let list = effect_list(&mut pres);
    assert!(
        list.contains(r#"<a:schemeClr val="accent2"><a:alpha val="75000"/></a:schemeClr>"#),
        "{list}"
    );
    apply(
        &mut pres,
        effects_op(
            &[2],
            json!({"shadow": {"preset": "innerCenter", "blurPt": 3}}),
        ),
    );
    let shadow = outline(&mut pres, 2).effects.unwrap().shadow.unwrap();
    assert_eq!((shadow.kind, shadow.blur_pt), ("inner", 3.0));
    assert_eq!(shadow.color, "#000000");
    // Options without a current shadow start from outerBottomRight.
    let mut fresh = open(&shape(2, "", ""));
    apply(
        &mut fresh,
        effects_op(&[2], json!({"shadow": {"transparency": 0.6}})),
    );
    let shadow = outline(&mut fresh, 2).effects.unwrap().shadow.unwrap();
    assert_eq!(shadow.preset, Some("outerBottomRight"));
}

#[test]
fn glow_soft_edge_and_reflection_are_written_in_schema_order() {
    let mut pres = open(&shape(2, "", ""));
    apply(
        &mut pres,
        effects_op(
            &[2],
            json!({"reflection": "half4pt", "softEdge": {"sizePt": 2.5},
                   "glow": {"color": "accent2", "sizePt": 8, "transparency": 0.6},
                   "shadow": "outerTop"}),
        ),
    );
    let list = effect_list(&mut pres);
    let at = |s: &str| {
        list.find(s)
            .unwrap_or_else(|| panic!("{s} missing: {list}"))
    };
    // glow, innerShdw, outerShdw, prstShdw, reflection, softEdge.
    assert!(at("<a:glow") < at("<a:outerShdw"));
    assert!(at("<a:outerShdw") < at("<a:reflection"));
    assert!(at("<a:reflection") < at("<a:softEdge"));
    assert!(list.contains(r#"<a:glow rad="101600"><a:schemeClr val="accent2"><a:satMod val="175000"/><a:alpha val="40000"/></a:schemeClr></a:glow>"#), "{list}");
    assert!(list.contains(r#"<a:softEdge rad="31750"/>"#), "{list}");
    assert!(list.contains(r#"<a:reflection blurRad="6350" stA="50000" endA="300" endPos="55000" dist="50800" dir="5400000" sy="-100000" algn="bl" rotWithShape="0"/>"#), "{list}");
    let fx = outline(&mut pres, 2).effects.unwrap();
    assert!(!fx.inherited);
    let glow = fx.glow.unwrap();
    assert_eq!((glow.size_pt, glow.transparency), (8.0, 0.6));
    assert_eq!(fx.soft_edge.unwrap().size_pt, 2.5);
    let reflection = fx.reflection.unwrap();
    assert_eq!(reflection.preset, Some("half4pt"));
    assert_eq!(
        (
            reflection.size_pct,
            reflection.distance_pt,
            reflection.transparency
        ),
        (55.0, 4.0, 0.5)
    );
    // Reflection options adjust the current reflection.
    apply(
        &mut pres,
        effects_op(
            &[2],
            json!({"reflection": {"sizePct": 80, "transparency": 0.3}}),
        ),
    );
    let reflection = outline(&mut pres, 2).effects.unwrap().reflection.unwrap();
    assert_eq!((reflection.size_pct, reflection.transparency), (80.0, 0.3));
    assert_eq!(reflection.preset, None);
    let mut reopened = assert_reopens(&mut pres);
    assert_eq!(
        outline(&mut reopened, 2).effects,
        outline(&mut pres, 2).effects
    );
}

#[test]
fn none_removes_effects_and_omitted_ones_stay() {
    let mut pres = open(&shape(2, "", ""));
    apply(
        &mut pres,
        effects_op(
            &[2],
            json!({"shadow": "outerBottom", "glow": {"sizePt": 5}}),
        ),
    );
    apply(
        &mut pres,
        effects_op(
            &[2],
            json!({"shadow": "none", "glow": null, "softEdge": null}),
        ),
    );
    let fx = outline(&mut pres, 2).effects.unwrap();
    assert!(fx.shadow.is_none());
    assert_eq!(fx.glow.unwrap().size_pt, 5.0, "null keeps the glow");
    apply(
        &mut pres,
        effects_op(&[2], json!({"glow": "none", "softEdge": {"sizePt": 0}})),
    );
    assert!(outline(&mut pres, 2).effects.is_none());
    assert!(
        !slide_xml(&mut pres).contains("effectLst"),
        "an emptied list that overrides nothing is removed"
    );
}

#[test]
fn theme_effects_are_reported_and_copied_before_changes() {
    let mut pres = open(&shape(2, "", THEME_SHADOW_STYLE));
    let fx = outline(&mut pres, 2).effects.unwrap();
    assert!(fx.inherited);
    let shadow = fx.shadow.unwrap();
    assert_eq!((shadow.blur_pt, shadow.distance_pt), (4.5, 1.5));
    assert_eq!(shadow.angle_deg, 90.0);
    assert_eq!(shadow.transparency, 0.37);
    // Adding a glow keeps the theme's shadow, now on the shape itself.
    apply(&mut pres, effects_op(&[2], json!({"glow": {"sizePt": 5}})));
    let fx = outline(&mut pres, 2).effects.unwrap();
    assert!(!fx.inherited);
    assert_eq!(fx.shadow.unwrap().blur_pt, 4.5);
    assert!(fx.glow.is_some());
    // Removing everything leaves an empty list that overrides the theme's.
    apply(
        &mut pres,
        effects_op(&[2], json!({"glow": "none", "shadow": "none"})),
    );
    assert!(outline(&mut pres, 2).effects.is_none());
    assert!(slide_xml(&mut pres).contains("<a:effectLst/>"));
}

#[test]
fn style_placeholder_colors_take_the_reference_color() {
    let mut pres = open(&shape(2, "", THEME_SHADOW_STYLE));
    // A theme whose effect style uses the style color (phClr).
    let theme = "/ppt/theme/theme1.xml";
    let xml = String::from_utf8(pres.package().read(theme).unwrap().into_owned()).unwrap();
    let xml = xml.replace(
        r#"<a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw>"#,
        r#"<a:schemeClr val="phClr"><a:alpha val="63000"/></a:schemeClr></a:outerShdw>"#,
    );
    let mut package = crate::opc::Package::open(pres.save().unwrap()).unwrap();
    package.write(theme, xml.into_bytes(), None);
    let mut pres = Presentation::open(package.save().unwrap()).unwrap();
    apply(&mut pres, effects_op(&[2], json!({"glow": {"sizePt": 5}})));
    let list = effect_list(&mut pres);
    assert!(
        list.contains(r#"<a:schemeClr val="accent1"><a:alpha val="63000"/></a:schemeClr>"#),
        "{list}"
    );
    assert!(!list.contains("phClr"));
}

#[test]
fn several_shapes_change_together_and_undo_restores_them() {
    let shapes = shape(2, "", "") + &shape(3, "", "");
    let mut ed = Editor::new(open(&shapes));
    let before = ed.presentation_mut().save().unwrap();
    let result = ed
        .apply(
            &[effects_op(&[2, 3], json!({"shadow": "outerCenter"}))],
            None,
            fonts(),
        )
        .unwrap();
    assert_eq!(result.changed_slides, vec![SLIDE]);
    for id in [2, 3] {
        let shadow = outline(ed.presentation_mut(), id).effects.unwrap().shadow;
        assert_eq!(shadow.unwrap().preset, Some("outerCenter"));
    }
    ed.undo().unwrap();
    assert!(outline(ed.presentation_mut(), 2).effects.is_none());
    assert_eq!(ed.presentation_mut().save().unwrap(), before);
}

#[test]
fn bad_requests_are_refused_with_reasons() {
    let mut pres = open(&(shape(2, "", "") + TABLE));
    let err =
        |pres: &mut Presentation, op: EditOp| pres.apply(&[op], fonts()).unwrap_err().to_string();
    assert!(
        err(&mut pres, effects_op(&[9], json!({"shadow": "outerTop"}))).contains("graphic frame")
    );
    assert!(
        err(&mut pres, effects_op(&[2], json!({"shadow": "dropShadow"})))
            .contains("unknown shadow")
    );
    assert!(
        err(&mut pres, effects_op(&[2], json!({"reflection": "mirror"})))
            .contains("unknown reflection")
    );
    assert!(err(&mut pres, effects_op(&[2], json!({"glow": "accent1"}))).contains("unknown glow"));
    assert!(
        err(
            &mut pres,
            effects_op(&[2], json!({"shadow": {"transparency": 1.5}}))
        )
        .contains("out of range")
    );
    assert!(
        err(
            &mut pres,
            effects_op(
                &[2],
                json!({"shadow": {"preset": "innerTop", "sizePct": 120}})
            )
        )
        .contains("inner shadows have no size")
    );
    assert!(err(&mut pres, effects_op(&[], json!({"shadow": "none"}))).contains("at least one"));
    // A wrong option name is reported by name.
    let bad = serde_json::from_value::<EditOp>(json!({
        "op": "setShapeEffects", "slide": SLIDE, "shapes": [2], "glow": {"radius": 5}
    }))
    .unwrap_err()
    .to_string();
    assert!(bad.contains("radius"), "{bad}");
    // Nothing changed.
    assert!(!slide_xml(&mut pres).contains("effectLst"));
}

#[test]
fn text_shadow_and_glow_go_on_runs() {
    let body = r#"<a:p><a:r><a:rPr lang="en-US" sz="4000"/><a:t>WordArt</a:t></a:r></a:p>"#;
    let mut pres = open(&text_box(2, 0, 0, 5_080_000, 1_270_000, body));
    let op: EditOp = serde_json::from_value(json!({
        "op": "formatText", "slide": SLIDE, "shape": 2,
        "props": {"shadow": "outerBottomRight", "glow": {"color": "FFC000", "sizePt": 5}}
    }))
    .unwrap();
    apply(&mut pres, op);
    let xml = slide_xml(&mut pres);
    let rpr = &xml[xml.find("<a:rPr").unwrap()..xml.find("</a:rPr>").unwrap()];
    assert!(rpr.contains("<a:effectLst><a:glow"), "{rpr}");
    let layout = pres.text_layout(0, 2, None, fonts()).unwrap().unwrap();
    let fx = layout.styles[0].runs[0].effects.clone().unwrap();
    assert_eq!(fx.shadow.unwrap().preset, Some("outerBottomRight"));
    assert_eq!(fx.glow.unwrap().color, "#FFC000");
    // Removing both leaves the run without a list.
    let op = EditOp::FormatText {
        slide: SLIDE,
        shape: 2,
        cell: None,
        start: None,
        end: None,
        props: RunPatch {
            shadow: Some(EffectSpec::Preset("none".into())),
            glow: Some(EffectSpec::Preset("none".into())),
            ..RunPatch::default()
        },
    };
    apply(&mut pres, op);
    let layout = pres.text_layout(0, 2, None, fonts()).unwrap().unwrap();
    assert!(layout.styles[0].runs[0].effects.is_none());
    assert_reopens(&mut pres);
}

/// The layer effects the renderer gives a shape.
fn layer_effects(pres: &mut Presentation) -> Vec<Effect> {
    let nodes = pres.slide_display_list(0, fonts()).unwrap();
    nodes
        .iter()
        .find_map(|n| match n {
            Node::Group(g) if !g.effects.is_empty() => Some(g.effects.clone()),
            _ => None,
        })
        .unwrap_or_default()
}

#[test]
fn renderer_gets_each_effect_with_its_parameters() {
    let mut pres = open(&shape(2, "", ""));
    apply(
        &mut pres,
        effects_op(
            &[2],
            json!({"shadow": "outerBottomRight", "glow": {"color": "FF0000", "sizePt": 8, "transparency": 0.5},
                   "softEdge": {"sizePt": 5}, "reflection": "full8pt"}),
        ),
    );
    let effects = layer_effects(&mut pres);
    assert_eq!(effects.len(), 4, "{effects:?}");
    let mut seen = 0;
    for e in &effects {
        match e {
            Effect::OuterShadow {
                color,
                blur,
                offset,
                ..
            } => {
                seen += 1;
                assert!((blur - 4.0).abs() < 1e-3);
                // 3 pt at 45°.
                let d = 3.0 / 2f32.sqrt();
                assert!(
                    (offset.x - d).abs() < 1e-3 && (offset.y - d).abs() < 1e-3,
                    "{offset:?}"
                );
                assert!((color.a - 0.4).abs() < 1e-3);
            }
            Effect::Glow { color, radius } => {
                seen += 1;
                assert_eq!(*radius, 8.0);
                assert!((color.r - 1.0).abs() < 1e-3 && (color.a - 0.5).abs() < 1e-3);
            }
            Effect::SoftEdge { radius } => {
                seen += 1;
                assert_eq!(*radius, 5.0);
            }
            Effect::Reflection {
                axis,
                dist,
                end_pos,
                start_alpha,
                ..
            } => {
                seen += 1;
                // The shape's bottom edge is at 200 pt.
                assert!((axis - 200.0).abs() < 1e-3);
                assert_eq!((*dist, *end_pos, *start_alpha), (8.0, 0.9, 0.5));
            }
            other => panic!("unexpected {other:?}"),
        }
    }
    assert_eq!(seen, 4);
}

/// Pixel `(x, y)` of a slide rendered at one pixel per point.
fn pixel(pres: &mut Presentation, x: u32, y: u32) -> [u8; 4] {
    let r = pres.render_slide(0, 960, fonts()).unwrap();
    let i = ((y * r.width + x) * 4) as usize;
    [
        r.pixels[i],
        r.pixels[i + 1],
        r.pixels[i + 2],
        r.pixels[i + 3],
    ]
}

#[test]
fn rendered_effects_draw_where_powerpoint_draws_them() {
    let white = [255, 255, 255, 255];
    // The shape spans (100, 100)-(300, 200) pt.
    let mut pres = open(&shape(2, "", ""));
    assert_eq!(pixel(&mut pres, 150, 215), white);
    apply(
        &mut pres,
        effects_op(&[2], json!({"shadow": "outerBottom"})),
    );
    let shaded = pixel(&mut pres, 200, 202);
    assert!(shaded[0] < 230, "an outer shadow falls below: {shaded:?}");
    apply(
        &mut pres,
        effects_op(
            &[2],
            json!({"shadow": "none", "glow": {"color": "FF0000", "sizePt": 10, "transparency": 0}}),
        ),
    );
    let glow = pixel(&mut pres, 200, 204);
    assert!(
        glow[0] > 200 && glow[1] < 150,
        "a red glow surrounds it: {glow:?}"
    );
    apply(
        &mut pres,
        effects_op(&[2], json!({"glow": "none", "reflection": "fullTouching"})),
    );
    let reflected = pixel(&mut pres, 200, 205);
    assert!(
        reflected[2] > reflected[0] + 30,
        "a blue reflection: {reflected:?}"
    );
    let faded = pixel(&mut pres, 200, 299);
    assert!(faded.iter().all(|&c| c > 250), "it fades out: {faded:?}");
    apply(
        &mut pres,
        effects_op(
            &[2],
            json!({"reflection": "none", "softEdge": {"sizePt": 10}}),
        ),
    );
    let edge = pixel(&mut pres, 101, 150);
    let middle = pixel(&mut pres, 200, 150);
    assert!(
        edge[0] > middle[0] + 50,
        "soft edges fade to the background: {edge:?} {middle:?}"
    );
    apply(
        &mut pres,
        effects_op(
            &[2],
            json!({"softEdge": "none", "shadow": {"preset": "innerTopLeft", "transparency": 0}}),
        ),
    );
    let inner = pixel(&mut pres, 102, 102);
    assert!(
        inner[2] < middle[2] - 40,
        "an inner shadow darkens the top left: {inner:?}"
    );
}

#[test]
fn shadows_are_cast_by_the_shape_alone_and_inner_shadows_stay_inside() {
    let mut pres = open(&shape(2, "", ""));
    apply(
        &mut pres,
        effects_op(
            &[2],
            json!({"shadow": {"preset": "outerBottomRight", "transparency": 0, "blurPt": 0, "distancePt": 20},
                   "glow": {"color": "00FF00", "sizePt": 4, "transparency": 0}}),
        ),
    );
    // The shadow is offset about 14 pt right and down: it ends at x ≈ 314.
    let shadow = pixel(&mut pres, 310, 210);
    assert!(shadow.iter().take(3).all(|&c| c < 40), "{shadow:?}");
    // The glow casts no shadow of its own.
    let beyond = pixel(&mut pres, 318, 210);
    assert!(beyond.iter().all(|&c| c > 250), "{beyond:?}");

    // An inner shadow shades only the shape, not the outer shadow beside it.
    let outer = r#"<a:outerShdw blurRad="0" dist="254000" dir="0" algn="l" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="50000"/></a:srgbClr></a:outerShdw>"#;
    let inner = r#"<a:innerShdw blurRad="0" dist="127000" dir="10800000"><a:srgbClr val="000000"/></a:innerShdw>"#;
    let mut alone = open(&shape(
        2,
        &format!("<a:effectLst>{outer}</a:effectLst>"),
        "",
    ));
    let mut both = open(&shape(
        2,
        &format!("<a:effectLst>{inner}{outer}</a:effectLst>"),
        "",
    ));
    assert_eq!(pixel(&mut both, 310, 150), pixel(&mut alone, 310, 150));
    assert_eq!(pixel(&mut both, 295, 150), [0, 0, 0, 255], "shaded inside");
}
