use super::*;

const EMU: f64 = 12700.0;

#[test]
fn every_preset_evaluates() {
    let defs = presets::definitions();
    assert_eq!(defs.len(), 187);
    for name in defs.keys() {
        for (w, h) in [(100.0, 50.0), (50.0, 100.0), (1.0, 1.0), (0.0, 30.0)] {
            let g = preset(name, w * EMU, h * EMU, &[]).unwrap();
            for p in &g.paths {
                for poly in p.path.flatten(1.0) {
                    for pt in poly {
                        assert!(
                            pt.x.is_finite() && pt.y.is_finite(),
                            "{name} produced non-finite points"
                        );
                    }
                }
            }
            if w > 0.0
                && h > 0.0
                && !matches!(
                    name.as_str(),
                    "line"
                        | "lineInv"
                        | "straightConnector1"
                        | "bentConnector2"
                        | "bentConnector3"
                        | "bentConnector4"
                        | "bentConnector5"
                        | "curvedConnector2"
                        | "curvedConnector3"
                        | "curvedConnector4"
                        | "curvedConnector5"
                )
            {
                assert!(!g.paths.is_empty(), "{name} has no paths");
            }
        }
    }
}

#[test]
fn rect_and_ellipse() {
    let g = preset("rect", 100.0 * EMU, 50.0 * EMU, &[]).unwrap();
    assert_eq!(
        g.text_rect,
        crate::path::Rect::from_xywh(0.0, 0.0, 100.0, 50.0)
    );
    let b = g.paths[0].path.bounds().unwrap();
    assert_eq!((b.w, b.h), (100.0, 50.0));
    let e = preset("ellipse", 100.0 * EMU, 100.0 * EMU, &[]).unwrap();
    // Text rectangle of an ellipse is the inscribed square.
    let tr = e.text_rect;
    assert!(
        (tr.x - 14.6447).abs() < 0.01 && (tr.w - 70.7107).abs() < 0.01,
        "{tr:?}"
    );
}

#[test]
fn adjust_values_change_geometry() {
    let small = preset(
        "roundRect",
        100.0 * EMU,
        100.0 * EMU,
        &[("adj".into(), 10000.0)],
    )
    .unwrap();
    let large = preset(
        "roundRect",
        100.0 * EMU,
        100.0 * EMU,
        &[("adj".into(), 50000.0)],
    )
    .unwrap();
    // A rounder rectangle has a smaller text rectangle.
    assert!(large.text_rect.w < small.text_rect.w);
}

#[test]
fn custom_geometry_from_xml() {
    let xml = r#"<a:custGeom xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:avLst/><a:gdLst><a:gd name="mid" fmla="*/ w 1 2"/></a:gdLst>
        <a:rect l="l" t="t" r="r" b="b"/>
        <a:pathLst><a:path w="200" h="100">
          <a:moveTo><a:pt x="0" y="100"/></a:moveTo>
          <a:lnTo><a:pt x="100" y="0"/></a:lnTo>
          <a:lnTo><a:pt x="200" y="100"/></a:lnTo><a:close/>
        </a:path><a:path fill="none" stroke="0"><a:moveTo><a:pt x="mid" y="0"/></a:moveTo></a:path></a:pathLst>
      </a:custGeom>"#;
    let doc = XmlDoc::parse(xml.as_bytes(), "t").unwrap();
    let g = custom(&doc, doc.root(), 400.0 * EMU, 100.0 * EMU);
    assert_eq!(g.paths.len(), 2);
    let b = g.paths[0].path.bounds().unwrap();
    assert_eq!((b.w, b.h), (400.0, 100.0), "path space scales to the shape");
    assert_eq!(g.paths[1].fill, PathFill::None);
    assert!(!g.paths[1].stroke);
    assert_eq!(
        g.paths[1].path.els[0],
        crate::path::PathEl::MoveTo(crate::path::Point::new(200.0, 0.0))
    );
}

#[test]
fn formula_operators() {
    let g = Guides::new(1000.0, 500.0);
    assert_eq!(g.eval("*/ w 1 4"), 250.0);
    assert_eq!(g.eval("+- w h 100"), 1400.0);
    assert_eq!(g.eval("+/ w h 3"), 500.0);
    assert_eq!(g.eval("?: -1 5 7"), 7.0);
    assert_eq!(g.eval("pin 0 150 100"), 100.0);
    assert_eq!(g.eval("max w h"), 1000.0);
    assert_eq!(g.eval("mod 3 4 0"), 5.0);
    assert!((g.eval("at2 1 1") - 2_700_000.0).abs() < 1e-6);
    assert!((g.eval("cos 100 cd4")).abs() < 1e-9);
    assert!((g.eval("sin 100 cd4") - 100.0).abs() < 1e-9);
    assert_eq!(g.get("wd4"), 250.0);
    assert_eq!(g.get("ssd2"), 250.0);
}

#[test]
fn preset_svg_draws_previews() {
    let rect = super::preset_svg("rect", 10.0, 20.0).expect("rect is a preset");
    assert_eq!(rect.len(), 1);
    assert_eq!(rect[0].d, "M0.00 0.00L10.00 0.00L10.00 20.00L0.00 20.00Z");
    assert!(rect[0].fill && rect[0].stroke);
    assert!(super::preset_svg("noSuchShape", 10.0, 10.0).is_none());
    // Every preset evaluates to drawable paths.
    for name in super::presets::definitions().keys() {
        let paths = super::preset_svg(name, 32.0, 24.0).expect(name);
        assert!(paths.iter().any(|p| !p.d.is_empty()), "{name}");
    }
}
