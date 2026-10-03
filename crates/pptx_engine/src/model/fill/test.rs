use super::*;
use crate::model::color::{ColorMap, ColorScheme};

fn parse(xml: &str) -> (Fill, LineProps) {
    let src = format!(
        "<p:spPr xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">{xml}</p:spPr>"
    );
    let doc = XmlDoc::parse(src.as_bytes(), "t").unwrap();
    let scheme = ColorScheme::default();
    let map = ColorMap::default();
    let ctx = ColorContext {
        scheme: &scheme,
        map: &map,
        ph_clr: None,
    };
    let resolver = |id: &str| Some(format!("/ppt/media/{id}.png"));
    let fill = find_fill(&doc, doc.root(), &ctx, &resolver).unwrap_or(Fill::None);
    let line = doc
        .child(doc.root(), Ns::A, "ln")
        .map(|l| parse_line(&doc, l, &ctx, &resolver))
        .unwrap_or_default();
    (fill, line)
}

#[test]
fn gradient_fill() {
    let (fill, _) = parse(
        r#"<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="1"/></a:gradFill>"#,
    );
    let Fill::Gradient(g) = fill else {
        panic!("{fill:?}")
    };
    assert_eq!(g.stops[0].color.to_hex(), "FF0000", "stops are sorted");
    assert_eq!(
        g.kind,
        GradientKind::Linear {
            angle: 45.0,
            scaled: true
        }
    );
}

#[test]
fn blip_fill_with_crop_and_effects() {
    let (fill, _) = parse(
        r#"<a:blipFill><a:blip r:embed="rId7"><a:alphaModFix amt="50000"/><a:grayscl/></a:blip><a:srcRect l="10000" r="-5000"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>"#,
    );
    let Fill::Image(img) = fill else { panic!() };
    assert_eq!(img.part.as_deref(), Some("/ppt/media/rId7.png"));
    assert_eq!(img.src_rect.l, 0.1);
    assert_eq!(img.src_rect.r, -0.05);
    assert_eq!(
        img.effects,
        vec![BlipEffect::AlphaModFix(0.5), BlipEffect::Grayscale]
    );
}

#[test]
fn line_properties() {
    let (_, ln) = parse(
        r#"<a:ln w="25400" cap="rnd" cmpd="dbl"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill><a:prstDash val="dash"/><a:bevel/><a:tailEnd type="triangle" w="lg" len="sm"/></a:ln>"#,
    );
    assert_eq!(ln.width, Some(2.0));
    assert_eq!(ln.cap, Some(Cap::Round));
    assert_eq!(ln.compound, Some(Compound::Double));
    assert_eq!(ln.dash, Some(Some(vec![4.0, 3.0])));
    assert_eq!(ln.join, Some(Join::Bevel));
    let line = ln.resolve().unwrap();
    assert_eq!(line.tail.unwrap().kind, LineEndKind::Triangle);
    assert_eq!(line.tail.unwrap().w, 5.0);
    assert!(line.head.is_none());
}

#[test]
fn line_inheritance_and_no_fill() {
    let (_, mut direct) = parse(r#"<a:ln w="12700"/>"#);
    let (_, style) =
        parse(r#"<a:ln w="6350"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>"#);
    direct.inherit(&style);
    let line = direct.resolve().unwrap();
    assert_eq!(line.width, 1.0);
    assert_eq!(line.fill, Fill::Solid(Rgba::from_hex("FF0000").unwrap()));
    let (_, none) = parse(r#"<a:ln><a:noFill/></a:ln>"#);
    assert!(none.resolve().is_none());
}

#[test]
fn shadow_effect() {
    let src = r#"<a:effectLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:outerShdw blurRad="50800" dist="38100" dir="2700000" algn="tl"><a:prstClr val="black"><a:alpha val="40000"/></a:prstClr></a:outerShdw></a:effectLst>"#;
    let doc = XmlDoc::parse(src.as_bytes(), "t").unwrap();
    let scheme = ColorScheme::default();
    let map = ColorMap::default();
    let ctx = ColorContext {
        scheme: &scheme,
        map: &map,
        ph_clr: None,
    };
    let fx = parse_effects(&doc, doc.root(), &ctx);
    let s = fx.outer_shadow.unwrap();
    assert_eq!((s.blur, s.dist, s.dir), (4.0, 3.0, 45.0));
    assert!((s.color.a - 0.4).abs() < 1e-6);
}
