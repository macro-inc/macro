use super::*;

fn ctx_eval(xml: &str) -> Rgba {
    let src = format!("<a:solidFill xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\">{xml}</a:solidFill>");
    let doc = XmlDoc::parse(src.as_bytes(), "t").unwrap();
    let scheme = ColorScheme::default();
    let map = ColorMap::default();
    let ctx = ColorContext { scheme: &scheme, map: &map, ph_clr: Some(Rgba::from_hex("123456").unwrap()) };
    find_color(&doc, doc.root(), &ctx).unwrap()
}

#[test]
fn base_colors() {
    assert_eq!(ctx_eval("<a:srgbClr val=\"FF8000\"/>").to_hex(), "FF8000");
    assert_eq!(ctx_eval("<a:schemeClr val=\"accent1\"/>").to_hex(), "4472C4");
    assert_eq!(ctx_eval("<a:schemeClr val=\"tx1\"/>").to_hex(), "000000");
    assert_eq!(ctx_eval("<a:schemeClr val=\"bg1\"/>").to_hex(), "FFFFFF");
    assert_eq!(ctx_eval("<a:schemeClr val=\"phClr\"/>").to_hex(), "123456");
    assert_eq!(ctx_eval("<a:sysClr val=\"windowText\" lastClr=\"010203\"/>").to_hex(), "010203");
    assert_eq!(ctx_eval("<a:prstClr val=\"dkBlue\"/>").to_hex(), "00008B");
    assert_eq!(ctx_eval("<a:prstClr val=\"medSeaGreen\"/>").to_hex(), "3CB371");
    assert_eq!(ctx_eval("<a:hslClr hue=\"0\" sat=\"100000\" lum=\"50000\"/>").to_hex(), "FF0000");
}

#[test]
fn luminance_transforms_match_powerpoint() {
    // "Blue, Accent 1, Lighter 80%" and "Darker 25%" swatches from the Office palette.
    assert_eq!(ctx_eval("<a:schemeClr val=\"accent1\"><a:lumMod val=\"20000\"/><a:lumOff val=\"80000\"/></a:schemeClr>").to_hex(), "DAE3F3");
    assert_eq!(ctx_eval("<a:schemeClr val=\"accent1\"><a:lumMod val=\"75000\"/></a:schemeClr>").to_hex(), "2F5597");
    // White, darker 5%.
    assert_eq!(ctx_eval("<a:schemeClr val=\"bg1\"><a:lumMod val=\"95000\"/></a:schemeClr>").to_hex(), "F2F2F2");
}

#[test]
fn alpha_tint_shade() {
    let c = ctx_eval("<a:srgbClr val=\"000000\"><a:alpha val=\"40000\"/></a:srgbClr>");
    assert!((c.a - 0.4).abs() < 1e-6);
    let tinted = ctx_eval("<a:srgbClr val=\"4472C4\"><a:tint val=\"50000\"/></a:srgbClr>");
    assert!(tinted.r > 0.6 && tinted.g > 0.6, "tint lightens: {tinted:?}");
    let shaded = ctx_eval("<a:srgbClr val=\"4472C4\"><a:shade val=\"50000\"/></a:srgbClr>");
    assert!(shaded.b < 0.75 && shaded.b > 0.3, "shade darkens: {shaded:?}");
}

#[test]
fn color_map_overrides() {
    let doc = XmlDoc::parse(b"<a:clrMap xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" bg1=\"dk1\" tx1=\"lt1\"/>", "t").unwrap();
    let map = ColorMap::parse(&doc, doc.root());
    assert_eq!(map.resolve("bg1"), "dk1");
    assert_eq!(map.resolve("accent2"), "accent2");
}

#[test]
fn hsl_round_trip() {
    for hex in ["4472C4", "ED7D31", "A5A5A5", "000000", "FFFFFF", "70AD47"] {
        let c = Rgba::from_hex(hex).unwrap();
        let (h, s, l) = rgb_to_hsl(f64::from(c.r), f64::from(c.g), f64::from(c.b));
        assert_eq!(hsl_to_rgb(h, s, l).to_hex(), hex);
    }
}
