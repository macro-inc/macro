use super::axis::{Fixed, Scale, auto_scale};
use super::numfmt::{format, general};
use super::style::{Palette, lum};
use crate::model::color::{ColorContext, ColorMap, ColorScheme, Rgba};
use crate::model::presentation::Presentation;
use crate::path::Rect;
use crate::render::scene::{Node, Paint};
use crate::test_support::{deck_with_media, fonts};

// ---- number formats --------------------------------------------------------

#[test]
fn number_formats() {
    let f = |v: f64, code: &str| format(v, code, false);
    assert_eq!(f(1_234_567.0, "#,##0"), "1,234,567");
    assert_eq!(f(0.1234, "0.0%"), "12.3%");
    assert_eq!(f(-5.0, "$#,##0;($#,##0)"), "($5)");
    assert_eq!(f(5.0, "$#,##0;($#,##0)"), "$5");
    assert_eq!(f(45292.0, "mmm-yy"), "Jan-24");
    assert_eq!(f(45292.0, "[$-409]mmm-yy;@"), "Jan-24");
    assert_eq!(f(45306.0, "m/d/yyyy"), "1/15/2024");
    assert_eq!(f(45306.0, "yyyy"), "2024");
    assert_eq!(f(3.24159, "0"), "3");
    assert_eq!(f(2.5, "0"), "3", "rounds half away from zero");
    assert_eq!(f(1.005, "0.00"), "1.01", "decimal rounding, not binary");
    assert_eq!(f(3.24159, "0.0"), "3.2");
    assert_eq!(f(1234.5, "#,##0.00"), "1,234.50");
    assert_eq!(f(0.25, "0%"), "25%");
    assert_eq!(f(1234.0, "$#,##0"), "$1,234");
    assert_eq!(f(-1234.0, "$#,##0"), "-$1,234");
    assert_eq!(f(1234.56, "\"$\"#,##0.0"), "$1,234.6");
    assert_eq!(f(-1234.0, "#,##0;(#,##0)"), "(1,234)");
    assert_eq!(f(0.0, "#,##0;(#,##0);\"-\""), "-");
    assert_eq!(f(12345.0, "0.00E+00"), "1.23E+04");
    assert_eq!(f(0.000123, "0.0E+00"), "1.2E-04");
    assert_eq!(
        f(99999.0, "0.0E+00"),
        "1.0E+05",
        "mantissa carry renormalizes"
    );
    assert_eq!(f(42.0, "0\" units\""), "42 units");
    assert_eq!(f(42.0, "0\\x"), "42x");
    assert_eq!(f(42.0, "#,##0_);(#,##0)"), "42 ");
    assert_eq!(f(2_500_000.0, "\"$\"#,##0.0,,\"M\""), "$2.5M");
    assert_eq!(f(12_500.0, "#,##0,\"K\""), "13K");
    assert_eq!(
        f(1_500_000.0, "[>=1000000]0.0,,\"M\";[>=1000]0,\"K\";0"),
        "1.5M"
    );
    assert_eq!(f(2_000.0, "[>=1000000]0.0,,\"M\";[>=1000]0,\"K\";0"), "2K");
    assert_eq!(f(12.0, "[>=1000000]0.0,,\"M\";[>=1000]0,\"K\";0"), "12");
    assert_eq!(f(7.0, "[Red]0.0"), "7.0");
    assert_eq!(f(0.5, "#.00"), ".50");
    assert_eq!(f(12.0, "00000"), "00012");
    assert_eq!(f(1234.5678, "General"), "1234.5678");
    assert_eq!(f(f64::NAN, "0"), "");
}

#[test]
fn general_format() {
    assert_eq!(general(0.1 + 0.2), "0.3");
    assert_eq!(general(1.0 / 3.0), "0.333333333");
    assert_eq!(general(-42.0), "-42");
    assert_eq!(general(123_456_789_012.0), "1.23457E+11");
    assert_eq!(general(0.000_001_5), "1.5E-06");
    assert_eq!(general(1e20), "1E+20");
}

#[test]
fn date_formats() {
    let f = |v: f64, code: &str| format(v, code, false);
    assert_eq!(f(44927.75, "d-mmm-yy h:mm AM/PM"), "1-Jan-23 6:00 PM");
    assert_eq!(f(44927.0, "dddd, mmmm d"), "Sunday, January 1");
    assert_eq!(
        f(60.0, "m/d/yyyy"),
        "2/29/1900",
        "Excel's fictitious leap day"
    );
    assert_eq!(f(61.0, "m/d/yyyy"), "3/1/1900");
    assert_eq!(f(0.0, "mmm-yy"), "Jan-00");
    assert_eq!(format(0.0, "m/d/yyyy", true), "1/1/1904");
    assert_eq!(f(0.5, "hh:mm:ss"), "12:00:00");
}

// ---- axis scaling ----------------------------------------------------------

fn scale(lo: f64, hi: f64) -> Scale {
    auto_scale(Some((lo, hi)), Fixed::default(), false, 10, &|_| true)
}

#[test]
fn axis_scaling() {
    let s = scale(0.0, 97.0);
    assert_eq!((s.min, s.max, s.major), (0.0, 120.0, 20.0));
    let s = scale(-35.0, 80.0);
    assert_eq!((s.min, s.max, s.major), (-40.0, 100.0, 20.0));
    let s = scale(0.0, 100.0);
    assert_eq!(
        (s.min, s.max, s.major),
        (0.0, 120.0, 20.0),
        "headroom above an exact maximum"
    );
    let s = scale(1.0, 3.0);
    assert_eq!((s.min, s.max, s.major), (0.0, 3.5, 0.5));
    // Bunched values do not start at zero.
    let s = scale(90.0, 100.0);
    assert!(s.min > 0.0 && s.min <= 90.0 && s.max >= 100.0, "{s:?}");
    // All negative values end at zero.
    let s = scale(-97.0, -10.0);
    assert_eq!((s.min, s.max, s.major), (-120.0, 0.0, 20.0));
    // Percent-stacked data spans exactly 0..100%.
    let s = auto_scale(Some((0.0, 1.0)), Fixed::default(), true, 10, &|_| true);
    assert_eq!((s.min, s.max, s.major), (0.0, 1.0, 0.1));
    let s = auto_scale(Some((0.0, 1.0)), Fixed::default(), true, 5, &|_| true);
    assert_eq!(
        (s.min, s.max, s.major),
        (0.0, 1.0, 0.2),
        "fewer intervals on a short axis"
    );
    // No data at all still yields a usable axis.
    let s = auto_scale(None, Fixed::default(), false, 10, &|_| true);
    assert!(s.max > s.min);
}

#[test]
fn axis_scaling_with_fixed_bounds() {
    let fixed = Fixed {
        min: Some(15_000.0),
        ..Fixed::default()
    };
    let s = auto_scale(Some((23_000.0, 33_500.0)), fixed, false, 10, &|_| true);
    assert_eq!(
        (s.min, s.max, s.major),
        (15_000.0, 35_000.0, 2_000.0),
        "ticks step from the fixed minimum"
    );
    assert_eq!(s.ticks().first(), Some(&15_000.0));
    let fixed = Fixed {
        min: Some(0.0),
        max: Some(10.0),
        major: Some(2.5),
        ..Fixed::default()
    };
    let s = auto_scale(Some((1.0, 9.0)), fixed, false, 10, &|_| true);
    assert_eq!(s.ticks(), vec![0.0, 2.5, 5.0, 7.5, 10.0]);
    // Logarithmic axes span whole decades.
    let fixed = Fixed {
        log_base: Some(10.0),
        ..Fixed::default()
    };
    let s = auto_scale(Some((3.0, 4200.0)), fixed, false, 10, &|_| true);
    assert_eq!((s.min, s.max), (1.0, 10_000.0));
    assert_eq!(s.ticks().len(), 5);
    assert!((s.norm(100.0) - 0.5).abs() < 1e-9);
    // A crowded axis takes a coarser unit when labels do not fit.
    let s = auto_scale(
        Some((0.0, 45.0)),
        Fixed::default(),
        false,
        10,
        &|s: &Scale| s.major >= 10.0,
    );
    assert_eq!((s.min, s.max, s.major), (0.0, 50.0, 10.0));
}

// ---- palette ---------------------------------------------------------------

#[test]
fn default_series_colors() {
    let scheme = ColorScheme::default();
    let map = ColorMap::default();
    let p = Palette::new(&ColorContext {
        scheme: &scheme,
        map: &map,
        ph_clr: None,
    });
    let accent1 = Rgba::from_hex("4472C4").unwrap();
    let accent6 = Rgba::from_hex("70AD47").unwrap();
    assert_eq!(p.series(0), accent1);
    assert_eq!(p.series(5), accent6);
    assert_eq!(
        p.series(6),
        lum(accent1, 0.6, 0.0),
        "series 7 is accent 1 darkened"
    );
    assert_eq!(
        p.series(12),
        lum(accent1, 0.8, 0.2),
        "series 13 is accent 1 lightened"
    );
    let dark = p.series(6);
    assert!(dark.r + dark.g + dark.b < accent1.r + accent1.g + accent1.b);
}

// ---- rendering -------------------------------------------------------------

const C_NS: &str = r#"xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;

fn ser(idx: u32, name: &str, color: &str, cats: &[&str], vals: &[f64]) -> String {
    let pts: String = cats
        .iter()
        .enumerate()
        .map(|(i, c)| format!(r#"<c:pt idx="{i}"><c:v>{c}</c:v></c:pt>"#))
        .collect();
    let vs: String = vals
        .iter()
        .enumerate()
        .map(|(i, v)| format!(r#"<c:pt idx="{i}"><c:v>{v}</c:v></c:pt>"#))
        .collect();
    let fill = if color.is_empty() {
        String::new()
    } else {
        format!(r#"<c:spPr><a:solidFill><a:srgbClr val="{color}"/></a:solidFill></c:spPr>"#)
    };
    format!(
        r#"<c:ser><c:idx val="{idx}"/><c:order val="{idx}"/><c:tx><c:v>{name}</c:v></c:tx>{fill}<c:cat><c:strRef><c:f>S!A</c:f><c:strCache><c:ptCount val="{}"/>{pts}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>S!B</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="{}"/>{vs}</c:numCache></c:numRef></c:val></c:ser>"#,
        cats.len(),
        vals.len()
    )
}

/// A chart part around `plot` (plot area content after the manual layout).
fn chart(plot: &str, legend: bool) -> String {
    let legend = if legend {
        "<c:legend><c:legendPos val=\"r\"/><c:overlay val=\"0\"/></c:legend>"
    } else {
        ""
    };
    format!(
        r#"<c:chartSpace {C_NS}><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout><c:manualLayout><c:layoutTarget val="inner"/><c:xMode val="edge"/><c:yMode val="edge"/><c:x val="0.1"/><c:y val="0.1"/><c:w val="0.8"/><c:h val="0.8"/></c:manualLayout></c:layout>{plot}</c:plotArea>{legend}<c:plotVisOnly val="1"/></c:chart></c:chartSpace>"#
    )
}

const AXES: &str = r#"<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorTickMark val="out"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/><c:crosses val="autoZero"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/><c:max val="100"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:majorTickMark val="out"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/><c:crosses val="autoZero"/><c:crossBetween val="between"/><c:majorUnit val="20"/></c:valAx>"#;

/// Renders a 400×300 pt chart frame at the slide origin; returns the display list.
fn render(chart_xml: &str) -> Vec<Node> {
    let frame = r#"<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Chart 3"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="5080000" cy="3810000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId10"/></a:graphicData></a:graphic></p:graphicFrame>"#;
    let bytes = deck_with_media(&[frame], &[("chart1.xml", chart_xml.as_bytes())]);
    let mut p = Presentation::open(bytes).unwrap();
    p.slide_display_list(0, fonts()).unwrap()
}

/// Bounds of every solid fill of `color`, in drawing order.
fn fills(nodes: &[Node], color: &str) -> Vec<Rect> {
    let want = Rgba::from_hex(color).unwrap();
    let mut out = Vec::new();
    for n in nodes {
        match n {
            Node::Fill {
                path,
                paint: Paint::Solid(c),
                ..
            } if (c.r - want.r).abs() + (c.g - want.g).abs() + (c.b - want.b).abs() < 0.01 => {
                out.extend(path.bounds());
            }
            Node::Group(g) => out.extend(fills(&g.children, color)),
            _ => {}
        }
    }
    out
}

fn near(r: Rect, x: f32, y: f32, w: f32, h: f32) -> bool {
    (r.x - x).abs() < 0.2 && (r.y - y).abs() < 0.2 && (r.w - w).abs() < 0.2 && (r.h - h).abs() < 0.2
}

#[test]
fn clustered_bars_follow_excel_geometry() {
    let cats = ["A", "B", "C"];
    let plot = format!(
        r#"<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>{}{}<c:gapWidth val="100"/><c:axId val="1"/><c:axId val="2"/></c:barChart>{AXES}"#,
        ser(0, "Red", "FF0000", &cats, &[50.0, 20.0, 80.0]),
        ser(1, "Blue", "0000FF", &cats, &[30.0, 60.0, 100.0]),
    );
    let nodes = render(&chart(&plot, false));
    // Plot area: (40, 30) 320×240. Slot 106.67; bar width = slot / (2 + 100%) = 35.56.
    let slot = 320.0 / 3.0;
    let bar = slot / 3.0;
    let red = fills(&nodes, "FF0000");
    let blue = fills(&nodes, "0000FF");
    assert_eq!((red.len(), blue.len()), (3, 3), "one bar per point");
    for (i, (r, b)) in red.iter().zip(&blue).enumerate() {
        let left = 40.0 + slot * i as f32 + slot / 2.0 - bar;
        let red_v = [50.0, 20.0, 80.0][i] / 100.0 * 240.0;
        let blue_v = [30.0, 60.0, 100.0][i] / 100.0 * 240.0;
        assert!(
            near(*r, left, 270.0 - red_v, bar, red_v),
            "red bar {i}: {r:?}"
        );
        assert!(
            near(*b, left + bar, 270.0 - blue_v, bar, blue_v),
            "blue bar {i}: {b:?}"
        );
    }
}

#[test]
fn stacked_bars_and_overlap() {
    let cats = ["A", "B"];
    let plot = format!(
        r#"<c:barChart><c:barDir val="bar"/><c:grouping val="stacked"/><c:varyColors val="0"/>{}{}<c:gapWidth val="50"/><c:overlap val="100"/><c:axId val="1"/><c:axId val="2"/></c:barChart>{}"#,
        ser(0, "Red", "FF0000", &cats, &[20.0, 40.0]),
        ser(1, "Blue", "0000FF", &cats, &[30.0, 10.0]),
        AXES.replace("<c:axPos val=\"b\"/>", "<c:axPos val=\"l\"/>")
            .replace(
                "<c:axPos val=\"l\"/><c:majorGridlines/>",
                "<c:axPos val=\"b\"/><c:majorGridlines/>"
            ),
    );
    let nodes = render(&chart(&plot, false));
    let red = fills(&nodes, "FF0000");
    let blue = fills(&nodes, "0000FF");
    assert_eq!((red.len(), blue.len()), (2, 2));
    // Horizontal bars grow from x = 40; category A sits at the bottom.
    let thick = 120.0 / 1.5;
    assert!(
        near(red[0], 40.0, 30.0 + 120.0 + 20.0, 64.0, thick),
        "{:?}",
        red[0]
    );
    assert!(
        near(blue[0], 104.0, 30.0 + 120.0 + 20.0, 96.0, thick),
        "stacked after red: {:?}",
        blue[0]
    );
    assert!(near(red[1], 40.0, 50.0, 128.0, thick), "{:?}", red[1]);
}

#[test]
fn default_colors_and_varied_points() {
    let cats = ["A", "B", "C"];
    // No explicit fill and no `c:varyColors`: a single series varies by point.
    let plot = format!(
        r#"<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>{}<c:axId val="1"/><c:axId val="2"/></c:barChart>{AXES}"#,
        ser(0, "S", "", &cats, &[10.0, 20.0, 30.0]),
    );
    let nodes = render(&chart(&plot, true));
    // The test theme's accents 1-3, each once in the plot and once in the legend.
    for accent in ["4472C4", "ED7D31", "A5A5A5"] {
        assert_eq!(fills(&nodes, accent).len(), 2, "{accent}");
    }
}

#[test]
fn pie_starts_at_twelve_oclock() {
    let plot = format!(
        r#"<c:pieChart><c:varyColors val="1"/>{}<c:firstSliceAng val="0"/></c:pieChart>"#,
        ser(0, "S", "", &["Big", "Small"], &[75.0, 25.0]),
    );
    let nodes = render(&chart(&plot, false));
    let big = fills(&nodes, "4472C4");
    let small = fills(&nodes, "ED7D31");
    assert_eq!((big.len(), small.len()), (1, 1));
    // The plot is 320×240 at (40, 30): the pie (r = 120) is centered at (200, 150).
    let s = small[0];
    assert!(
        s.right() <= 200.5 && s.bottom() <= 150.5,
        "the last quarter is the upper-left one: {s:?}"
    );
    assert!(
        (s.x - 80.0).abs() < 1.0 && (s.y - 30.0).abs() < 1.0,
        "{s:?}"
    );
    let b = big[0];
    assert!(
        (b.w - 240.0).abs() < 1.0 && (b.h - 240.0).abs() < 1.0,
        "{b:?}"
    );
}

#[test]
fn line_markers_and_labels() {
    let cats = ["A", "B", "C"];
    let ser = ser(0, "L", "", &cats, &[10.0, 50.0, 90.0]).replace(
        "<c:cat>",
        r#"<c:marker><c:symbol val="square"/><c:size val="8"/><c:spPr><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></c:spPr></c:marker><c:dLbls><c:showVal val="1"/><c:dLblPos val="t"/></c:dLbls><c:cat>"#,
    );
    let plot = format!(
        r#"<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>{ser}<c:marker val="1"/><c:axId val="1"/><c:axId val="2"/></c:lineChart>{AXES}"#
    );
    let nodes = render(&chart(&plot, false));
    let marks = fills(&nodes, "00FF00");
    assert_eq!(marks.len(), 3, "a marker per point");
    let slot = 320.0 / 3.0;
    for (i, m) in marks.iter().enumerate() {
        let cx = 40.0 + slot * (i as f32 + 0.5);
        let cy = 270.0 - [10.0, 50.0, 90.0][i] / 100.0 * 240.0;
        assert!(near(*m, cx - 4.0, cy - 4.0, 8.0, 8.0), "marker {i}: {m:?}");
    }
}

#[test]
fn malformed_charts_do_not_panic() {
    let cases = [
        "<c:chartSpace/>".to_owned(),
        format!("<c:chartSpace {C_NS}/>"),
        format!("<c:chartSpace {C_NS}><c:chart/></c:chartSpace>"),
        chart("<c:barChart><c:ser/></c:barChart>", true),
        chart(
            "<c:barChart><c:ser><c:val><c:numRef><c:numCache><c:ptCount val=\"999999999\"/><c:pt idx=\"-3\"><c:v>NaN</c:v></c:pt><c:pt idx=\"7\"><c:v>inf</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val=\"1\"/></c:barChart>",
            true,
        ),
        chart(
            &format!(
                "<c:lineChart>{}<c:axId val=\"1\"/><c:axId val=\"2\"/></c:lineChart>{AXES}",
                ser(0, "x", "", &[], &[])
            ),
            true,
        ),
        chart(
            &format!(
                "<c:scatterChart>{}</c:scatterChart>",
                ser(0, "x", "", &["a"], &[1e308])
            ),
            true,
        ),
        chart(
            &format!(
                "<c:pieChart>{}</c:pieChart>",
                ser(0, "x", "", &["a", "b"], &[0.0, -0.0])
            ),
            true,
        ),
        chart(
            &format!(
                "<c:doughnutChart>{}<c:holeSize val=\"-5\"/></c:doughnutChart>",
                ser(0, "x", "", &["a"], &[-4.0])
            ),
            true,
        ),
        chart(
            &format!(
                "<c:radarChart>{}</c:radarChart>",
                ser(0, "x", "", &["a"], &[3.0])
            ),
            true,
        ),
        chart(
            &format!(
                "<c:bubbleChart>{}</c:bubbleChart>",
                ser(0, "x", "", &["1"], &[2.0])
            ),
            true,
        ),
        chart(
            &format!(
                "<c:barChart>{}<c:axId val=\"1\"/><c:axId val=\"2\"/></c:barChart>{}",
                ser(0, "x", "", &["a"], &[5.0]),
                AXES.replace(
                    "<c:max val=\"100\"/><c:min val=\"0\"/>",
                    "<c:max val=\"-1\"/><c:min val=\"1e300\"/><c:logBase val=\"10\"/>"
                )
            ),
            true,
        ),
        chart(
            &format!(
                "<c:scatterChart>{}</c:scatterChart>",
                ser(0, "x", "", &["1", "1", "1e300"], &[1e300, -1e300, 0.0]).replace(
                    "<c:cat>",
                    "<c:trendline><c:trendlineType val=\"poly\"/><c:order val=\"99\"/><c:forward val=\"1e308\"/><c:dispEq/></c:trendline><c:trendline><c:trendlineType val=\"movingAvg\"/><c:period val=\"0\"/></c:trendline><c:trendline><c:trendlineType val=\"power\"/><c:intercept val=\"NaN\"/></c:trendline><c:trendline><c:trendlineType val=\"bogus\"/></c:trendline><c:cat>"
                )
            ),
            true,
        ),
    ];
    for xml in &cases {
        let _ = render(xml);
    }
}

#[test]
fn series_and_point_caps() {
    let cats: Vec<String> = (0..300).map(|i| format!("c{i}")).collect();
    let cat_refs: Vec<&str> = cats.iter().map(String::as_str).collect();
    let vals: Vec<f64> = (0..300).map(f64::from).collect();
    let many: String = (0..300)
        .map(|i| ser(i, "s", "", &cat_refs[..3], &vals[..3]))
        .collect();
    let plot = format!(
        r#"<c:lineChart><c:grouping val="standard"/>{many}<c:axId val="1"/><c:axId val="2"/></c:lineChart>{AXES}"#
    );
    let doc = crate::xml::XmlDoc::parse(chart(&plot, true).as_bytes(), "chart").unwrap();
    let part = crate::model::presentation::PartRef {
        name: "chart".into(),
        doc: std::sync::Arc::new(doc),
        rels: std::sync::Arc::new(crate::opc::Relationships::empty("chart")),
    };
    let bytes = deck_with_media(&[], &[]);
    let mut p = Presentation::open(bytes).unwrap();
    let ctx = p.slide_context(0).ok();
    if let Some(ctx) = ctx {
        let m = super::parse::parse(&part, &ctx, None).unwrap();
        assert_eq!(m.groups[0].series.len(), super::model::MAX_SERIES);
    }
}

// ---- related parts, labels, dates, multi-level categories -------------------

const FRAME: &str = r#"<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Chart 3"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="5080000" cy="3810000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId10"/></a:graphicData></a:graphic></p:graphicFrame>"#;

/// Renders a chart whose part has extra related parts: `(file under ppt/, xml, relationship type)`.
fn render_related(chart_xml: &str, related: &[(&str, &str, &str)]) -> Vec<Node> {
    use crate::zip::{Archive, WriteData, Writer};
    let deck = deck_with_media(&[FRAME], &[("chart1.xml", chart_xml.as_bytes())]);
    let archive = Archive::parse(&deck).unwrap();
    let mut w = Writer::new();
    for e in archive.entries() {
        w.add(
            &e.name,
            WriteData::Raw {
                entry: e,
                raw: archive.raw_data(e),
            },
        )
        .unwrap();
    }
    let mut rels = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
    );
    for (k, (file, xml, ty)) in related.iter().enumerate() {
        rels.push_str(&format!(
            r#"<Relationship Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/{ty}" Target="../{file}"/>"#,
            k + 1
        ));
        w.add(
            &format!("ppt/{file}"),
            WriteData::Fresh {
                data: xml.as_bytes(),
                compress: true,
            },
        )
        .unwrap();
    }
    rels.push_str("</Relationships>");
    w.add(
        "ppt/media/_rels/chart1.xml.rels",
        WriteData::Fresh {
            data: rels.as_bytes(),
            compress: true,
        },
    )
    .unwrap();
    let mut p = Presentation::open(w.finish().unwrap()).unwrap();
    p.slide_display_list(0, fonts()).unwrap()
}

#[test]
fn user_shapes_follow_their_anchors() {
    let chart_xml = chart("", false).replace(
        "</c:chartSpace>",
        r#"<c:userShapes r:id="rId1"/></c:chartSpace>"#,
    );
    let drawing = r#"<c:userShapes xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:cdr="http://schemas.openxmlformats.org/drawingml/2006/chartDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><cdr:relSizeAnchor><cdr:from><cdr:x>0.5</cdr:x><cdr:y>0.5</cdr:y></cdr:from><cdr:to><cdr:x>0.75</cdr:x><cdr:y>0.75</cdr:y></cdr:to><cdr:sp macro="" textlink=""><cdr:nvSpPr><cdr:cNvPr id="2" name="Box"/><cdr:cNvSpPr/></cdr:nvSpPr><cdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12700" cy="12700"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="123456"/></a:solidFill></cdr:spPr></cdr:sp></cdr:relSizeAnchor></c:userShapes>"#;
    let nodes = render_related(
        &chart_xml,
        &[("drawings/drawing1.xml", drawing, "chartUserShapes")],
    );
    let boxes = fills(&nodes, "123456");
    assert_eq!(boxes.len(), 1);
    assert!(near(boxes[0], 200.0, 150.0, 100.0, 75.0), "{:?}", boxes[0]);
}

#[test]
fn theme_override_recolors_series() {
    let cats = ["A", "B"];
    let plot = format!(
        r#"<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>{}<c:axId val="1"/><c:axId val="2"/></c:barChart>{AXES}"#,
        ser(0, "S", "", &cats, &[10.0, 20.0]),
    );
    let theme = r#"<a:themeOverride xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:clrScheme name="Mine"><a:accent1><a:srgbClr val="00AA11"/></a:accent1></a:clrScheme></a:themeOverride>"#;
    let nodes = render_related(
        &chart(&plot, false),
        &[("theme/themeOverride1.xml", theme, "themeOverride")],
    );
    assert_eq!(
        fills(&nodes, "00AA11").len(),
        2,
        "accent 1 comes from the override"
    );
    assert!(fills(&nodes, "4472C4").is_empty());
}

/// Parses a chart part against the test deck's theme.
fn model(chart_xml: &str) -> super::model::ChartModel {
    let doc = crate::xml::XmlDoc::parse(chart_xml.as_bytes(), "chart").unwrap();
    let part = crate::model::presentation::PartRef {
        name: "/ppt/charts/chart1.xml".into(),
        doc: std::sync::Arc::new(doc),
        rels: std::sync::Arc::new(crate::opc::Relationships::empty("/ppt/charts/chart1.xml")),
    };
    let mut p = Presentation::open(deck_with_media(&[""], &[])).unwrap();
    let ctx = p.slide_context(0).unwrap();
    super::parse::parse(&part, &ctx, None).unwrap()
}

#[test]
fn data_label_text() {
    use super::dlabel::{compose, effective};
    let pie_ser = ser(0, "S", "", &["Big", "Small"], &[75.0, 25.0])
        .replace("<c:cat>", r#"<c:dLbls><c:showVal val="0"/><c:showCatName val="1"/><c:showPercent val="1"/></c:dLbls><c:cat>"#);
    let m = model(&chart(
        &format!("<c:pieChart>{pie_ser}</c:pieChart>"),
        false,
    ));
    let (g, s) = (&m.groups[0], &m.groups[0].series[0]);
    let l = effective(g, s, 0).unwrap();
    assert_eq!(
        compose(&m, g, s, 0, &l, Some(0.75)).unwrap(),
        "Big\n75%",
        "pies put the percentage on its own line"
    );

    let bar_ser = ser(0, "Sales", "", &["Q1"], &[0.5]).replace(
        "<c:cat>",
        r#"<c:dLbls><c:dLbl><c:idx val="0"/><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Now: </a:t></a:r><a:fld id="{1}" type="VALUE"><a:t>[VALUE]</a:t></a:fld></a:p></c:rich></c:tx><c:showVal val="1"/></c:dLbl><c:numFmt formatCode="0.0%" sourceLinked="0"/><c:showVal val="1"/><c:showSerName val="1"/></c:dLbls><c:cat>"#,
    );
    let plain = ser(1, "Plan", "", &["Q1"], &[0.25])
        .replace("<c:cat>", r#"<c:dLbls><c:numFmt formatCode="0.0%" sourceLinked="0"/><c:showVal val="1"/><c:showSerName val="1"/></c:dLbls><c:cat>"#);
    let plot = format!(
        r#"<c:barChart><c:barDir val="col"/>{bar_ser}{plain}<c:axId val="1"/><c:axId val="2"/></c:barChart>{AXES}"#
    );
    let m = model(&chart(&plot, false));
    let g = &m.groups[0];
    let l = effective(g, &g.series[1], 0).unwrap();
    assert_eq!(
        compose(&m, g, &g.series[1], 0, &l, None).unwrap(),
        "Plan, 25.0%"
    );
    let l = effective(g, &g.series[0], 0).unwrap();
    assert_eq!(
        compose(&m, g, &g.series[0], 0, &l, None).unwrap(),
        "Now: 50.0%",
        "field runs show live values"
    );
}

/// Lays out the first axis-based plot of a chart in a 400×300 frame.
fn laid_out(m: &super::model::ChartModel) -> super::plot::Plot<'_> {
    struct NoImages;
    impl crate::render::paint::ImageSource for NoImages {
        fn raster(&mut self, _: &str) -> Option<std::sync::Arc<crate::render::scene::Raster>> {
            None
        }
    }
    let mut images = NoImages;
    let frame = Rect::from_xywh(0.0, 0.0, 400.0, 300.0);
    let cv = super::canvas::Canvas {
        fonts: fonts(),
        images: &mut images,
        world: crate::path::Affine::IDENTITY,
        chart: frame,
        out: Vec::new(),
    };
    let mut p = super::plot::Plot::new(m).unwrap();
    p.layout(&cv, frame, None);
    p
}

fn label_texts(p: &super::plot::Plot<'_>, axis: usize) -> Vec<String> {
    p.axes[axis]
        .labels
        .iter()
        .map(|l| {
            l.block
                .lines
                .iter()
                .flat_map(|line| line.spans.iter())
                .map(|s| s.text.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect()
}

#[test]
fn date_axis_labels_step_by_time_unit() {
    // Monthly data from Jan 2020 (serial 43831) for two years.
    let months: Vec<String> = (0..24)
        .map(|k| {
            let (y, m) = (2020 + k / 12, k % 12 + 1);
            let days = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
            let mut s = 43831 + if y == 2021 { 366 } else { 0 };
            for mm in 1..m {
                s += if y == 2021 && mm == 2 {
                    28
                } else {
                    days[mm as usize]
                };
            }
            s.to_string()
        })
        .collect();
    let pts: String = months
        .iter()
        .enumerate()
        .map(|(i, v)| format!(r#"<c:pt idx="{i}"><c:v>{v}</c:v></c:pt>"#))
        .collect();
    let vals: String = (0..24)
        .map(|i| format!(r#"<c:pt idx="{i}"><c:v>{}</c:v></c:pt>"#, i * 2))
        .collect();
    let ser = format!(
        r#"<c:ser><c:idx val="0"/><c:order val="0"/><c:cat><c:numRef><c:numCache><c:formatCode>mmm-yy</c:formatCode><c:ptCount val="24"/>{pts}</c:numCache></c:numRef></c:cat><c:val><c:numRef><c:numCache><c:ptCount val="24"/>{vals}</c:numCache></c:numRef></c:val></c:ser>"#
    );
    let axes = AXES
        .replace("<c:catAx>", "<c:dateAx>")
        .replace("</c:catAx>", r#"<c:baseTimeUnit val="months"/><c:majorUnit val="6"/><c:majorTimeUnit val="months"/></c:dateAx>"#);
    let m = model(&chart(
        &format!(
            r#"<c:lineChart><c:grouping val="standard"/>{ser}<c:axId val="1"/><c:axId val="2"/></c:lineChart>{axes}"#
        ),
        false,
    ));
    let p = laid_out(&m);
    assert_eq!(label_texts(&p, 0), ["Jan-20", "Jul-20", "Jan-21", "Jul-21"]);
    // Points sit mid-slot of their month ("between" axis): 24 monthly slots.
    assert!(
        (p.cat_t(0, 6.0) - 6.5 / 24.0).abs() < 1e-9,
        "{}",
        p.cat_t(0, 6.0)
    );
}

#[test]
fn multi_level_categories_group_outer_labels() {
    let lvl = |vals: &[(usize, &str)]| {
        vals.iter()
            .map(|(i, v)| format!(r#"<c:pt idx="{i}"><c:v>{v}</c:v></c:pt>"#))
            .collect::<String>()
    };
    let cat = format!(
        r#"<c:cat><c:multiLvlStrRef><c:multiLvlStrCache><c:ptCount val="4"/><c:lvl>{}</c:lvl><c:lvl>{}</c:lvl></c:multiLvlStrCache></c:multiLvlStrRef></c:cat>"#,
        lvl(&[(0, "Q1"), (1, "Q2"), (2, "Q1"), (3, "Q2")]),
        lvl(&[(0, "2023"), (2, "2024")]),
    );
    let ser = format!(
        r#"<c:ser><c:idx val="0"/><c:order val="0"/>{cat}<c:val><c:numLit><c:ptCount val="4"/>{}</c:numLit></c:val></c:ser>"#,
        lvl(&[(0, "1"), (1, "2"), (2, "3"), (3, "4")])
    );
    let m = model(&chart(
        &format!(
            r#"<c:barChart><c:barDir val="col"/><c:varyColors val="0"/>{ser}<c:axId val="1"/><c:axId val="2"/></c:barChart>{AXES}"#
        ),
        false,
    ));
    let p = laid_out(&m);
    assert_eq!(label_texts(&p, 0), ["Q1", "Q2", "Q1", "Q2"]);
    let outer = &p.axes[0].outer;
    assert_eq!(outer.len(), 1);
    let spans: Vec<(f64, f64)> = outer[0].iter().map(|(a, b, _)| (*a, *b)).collect();
    assert_eq!(
        spans,
        [(0.0, 0.5), (0.5, 1.0)],
        "each year spans its two quarters"
    );
}

#[test]
fn category_labels_use_neighbour_room_then_wrap_then_rotate() {
    let laid = |cats: &[&str]| {
        let vals: Vec<f64> = (1..=cats.len()).map(|v| v as f64).collect();
        let s = ser(0, "S", "", cats, &vals);
        model(&chart(
            &format!(
                r#"<c:barChart><c:barDir val="col"/>{s}<c:axId val="1"/><c:axId val="2"/></c:barChart>{AXES}"#
            ),
            false,
        ))
    };
    // An unbreakable word wider than its slot borrows room from short neighbours.
    let m = laid(&["A", "B", "Extraordinarily", "C", "D", "E", "F", "G"]);
    let p = laid_out(&m);
    let (a, slot) = (&p.axes[0], p.inner.w / 8.0);
    assert_eq!(a.rot, 0.0);
    assert_eq!(a.labels.len(), 8, "no label is skipped");
    assert!(a.labels.iter().any(|l| l.block.width > slot));

    // Phrases wider than their slot wrap onto more lines.
    let phrases = [
        "North America",
        "South America",
        "Western Europe",
        "Eastern Europe",
        "Middle East",
        "Southeast Asia",
    ];
    let m = laid(&phrases);
    let p = laid_out(&m);
    let a = &p.axes[0];
    assert_eq!(a.rot, 0.0);
    assert!(a.labels.iter().any(|l| l.block.lines.len() > 1), "wrapped");

    // Labels that do not fit even wrapped turn 45° and stay inside the chart.
    let names: Vec<String> = (0..12)
        .map(|i| format!("Red Mountain High School {i}"))
        .collect();
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    let m = laid(&names);
    let p = laid_out(&m);
    let a = &p.axes[0];
    assert_eq!(a.rot, -45.0);
    for l in &a.labels {
        let x =
            p.coord(0, l.t) + super::axes::label_shift(&l.block, a.rot, super::plot::Edge::Bottom);
        let left = x - l.block.rotated_size(a.rot).0 / 2.0;
        assert!(left >= -0.5, "rotated label clipped at {left}");
    }
}

#[test]
fn trendline_fits_and_equations() {
    use super::model::TrendKind;
    use super::trend::{equation, fit};
    let close = |a: f64, b: f64| (a - b).abs() < 1e-9;

    let (f, r2) = fit(
        TrendKind::Linear,
        &[(1.0, 1.0), (2.0, 3.0), (3.0, 2.0)],
        None,
    )
    .unwrap();
    assert!(close(f.eval(0.0).unwrap(), 1.0) && close(f.eval(2.0).unwrap(), 2.0));
    assert!(close(r2, 0.25), "{r2}");
    assert_eq!(equation(&f, None, false), "y = 0.5x + 1");

    // A forced intercept fits the slope alone.
    let (f, _) = fit(TrendKind::Linear, &[(1.0, 3.0), (2.0, 5.0)], Some(1.0)).unwrap();
    assert_eq!(equation(&f, None, false), "y = 2x + 1");

    let pts: Vec<(f64, f64)> = (-1..=2)
        .map(|x| (f64::from(x), f64::from(x * x) - 2.0))
        .collect();
    let (f, r2) = fit(TrendKind::Poly(2), &pts, None).unwrap();
    assert!(close(r2, 1.0));
    assert_eq!(equation(&f, None, false), "y = x² - 2");

    let e = std::f64::consts::E;
    let (f, r2) = fit(
        TrendKind::Exp,
        &[(0.0, 2.0), (1.0, 2.0 * e), (2.0, 2.0 * e * e)],
        None,
    )
    .unwrap();
    assert!(close(f.eval(3.0).unwrap(), 2.0 * e.powi(3)) && close(r2, 1.0));
    assert_eq!(equation(&f, None, false), "y = 2e^(1x)");
    assert!(
        fit(TrendKind::Exp, &[(0.0, 1.0), (1.0, -1.0)], None).is_none(),
        "needs y > 0"
    );
    assert!(
        fit(TrendKind::Poly(3), &pts[..3], None).is_none(),
        "needs more points than the order"
    );

    let (f, _) = fit(
        TrendKind::Power,
        &[(1.0, 3.0), (2.0, 12.0), (4.0, 48.0)],
        None,
    )
    .unwrap();
    assert_eq!(equation(&f, None, false), "y = 3x^2");
    let (f, _) = fit(TrendKind::Log, &[(1.0, 1.0), (e, 3.0), (e * e, 5.0)], None).unwrap();
    assert_eq!(equation(&f, None, false), "y = 2ln(x) + 1");
}

#[test]
fn trendlines_draw_over_their_series_with_a_legend_entry() {
    let s = ser(0, "S", "4472C4", &["a", "b", "c", "d"], &[10.0, 30.0, 20.0, 40.0]).replace(
        "<c:cat>",
        r#"<c:trendline><c:spPr><a:ln w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:prstDash val="sysDot"/></a:ln></c:spPr><c:trendlineType val="linear"/><c:dispRSqr val="1"/><c:dispEq val="1"/></c:trendline><c:cat>"#,
    );
    let xml = chart(
        &format!(
            r#"<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>{s}<c:axId val="1"/><c:axId val="2"/></c:lineChart>{AXES}"#
        ),
        true,
    );
    let m = model(&xml);
    let legend = m.legend.clone().unwrap();
    let texts: Vec<String> = super::legend::entries(&m, &legend)
        .into_iter()
        .map(|e| e.text)
        .collect();
    assert_eq!(texts, ["S", "Linear (S)"]);

    fn red_dashes(nodes: &[Node], out: &mut Vec<Rect>) {
        for n in nodes {
            match n {
                Node::Stroke {
                    path,
                    paint: Paint::Solid(c),
                    stroke,
                } if c.r > 0.99 && c.g < 0.01 && stroke.dash.is_some() => out.extend(path.bounds()),
                Node::Group(g) => red_dashes(&g.children, out),
                _ => {}
            }
        }
    }
    let mut lines = Vec::new();
    red_dashes(&render(&xml), &mut lines);
    // The plot spans x 40..360, y 30..270 (manual inner layout); the fit
    // y = 8x + 5 rises over categories 1..4 (x 80..320) from 13 to 37.
    assert!(!lines.is_empty(), "trendline and legend key drawn");
    let trend = lines
        .iter()
        .copied()
        .max_by(|a, b| a.w.total_cmp(&b.w))
        .unwrap();
    assert!(
        (trend.x - 80.0).abs() < 1.0 && (trend.w - 240.0).abs() < 1.0,
        "{trend:?}"
    );
    assert!(
        (trend.bottom() - (270.0 - 0.13 * 240.0)).abs() < 1.0,
        "{trend:?}"
    );
    assert!((trend.y - (270.0 - 0.37 * 240.0)).abs() < 1.0, "{trend:?}");
}

#[test]
fn data_tables_replace_category_labels() {
    let s0 = ser(0, "Plan", "", &["North", "South"], &[39050.0, 49457.0]);
    let s1 = ser(1, "Actual", "", &["North", "South"], &[35958.0, 49769.0]);
    let m = model(&chart(
        &format!(
            r#"<c:barChart><c:barDir val="col"/><c:varyColors val="0"/>{s0}{s1}<c:axId val="1"/><c:axId val="2"/></c:barChart>{AXES}<c:dTable><c:showHorzBorder val="1"/><c:showVertBorder val="1"/><c:showOutline val="1"/><c:showKeys val="1"/></c:dTable>"#
        ),
        false,
    ));
    assert!(m.data_table.as_ref().is_some_and(|d| d.keys && d.outline));
    let p = laid_out(&m);
    let t = p.table.as_ref().expect("table laid out");
    assert_eq!(t.axis, 0);
    assert!(
        p.axes[0].labels.is_empty(),
        "the header row replaces the labels"
    );
    // Header plus two series rows fit under the plot; names fit left of it.
    assert!(t.height() > 30.0, "{}", t.height());
    assert!(p.inner.bottom() + t.height() <= 300.0 + 0.5);
    assert!(
        t.head_w > 20.0 && p.inner.x >= t.head_w - 0.5,
        "{} {:?}",
        t.head_w,
        p.inner
    );
}

#[test]
fn bar_3d_charts_draw_boxes_in_depth() {
    let s = ser(0, "S", "C00000", &["a", "b", "c"], &[20.0, 60.0, 40.0]);
    let plot = format!(
        r#"<c:bar3DChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>{s}<c:gapWidth val="150"/><c:shape val="box"/><c:axId val="1"/><c:axId val="2"/></c:bar3DChart>{AXES}"#
    );
    let xml = chart(&plot, false).replace(
        "<c:autoTitleDeleted val=\"1\"/>",
        r#"<c:autoTitleDeleted val="1"/><c:view3D><c:rotX val="15"/><c:rotY val="20"/><c:rAngAx val="1"/></c:view3D><c:backWall><c:spPr><a:solidFill><a:srgbClr val="00B050"/></a:solidFill></c:spPr></c:backWall>"#,
    );
    let m = model(&xml);
    let p = laid_out(&m);
    let d = p.depth.expect("3-D bars recede");
    assert!(
        d.dx > 1.0 && d.dy > 1.0 && d.z0 > 0.0 && d.z1 < 1.0,
        "{d:?}"
    );
    let nodes = render(&xml);
    // One front face per bar in the series color, and the back wall.
    assert_eq!(fills(&nodes, "C00000").len(), 3);
    let wall = fills(&nodes, "00B050");
    assert_eq!(wall.len(), 1);
    // The manual inner layout (40, 30)–(360, 270) holds the whole box: the
    // back wall reaches its top and right edges and recedes from the others.
    let w = wall[0];
    assert!(
        (w.y - 30.0).abs() < 0.5 && (w.right() - 360.0).abs() < 0.5,
        "{w:?}"
    );
    assert!(w.x > 45.0 && w.bottom() < 265.0, "{w:?}");
}
