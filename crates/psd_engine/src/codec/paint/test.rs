use super::*;
use crate::binary::{Reader, Writer};

fn close(a: Rgb, b: Rgb) -> bool {
    (a.r - b.r).abs() < 0.01 && (a.g - b.g).abs() < 0.01 && (a.b - b.b).abs() < 0.01
}

#[test]
fn every_blend_mode_round_trips() {
    for mode in BlendMode::ALL {
        let Value::Enum(ty, id) = blend_value(mode) else {
            panic!("not an enum");
        };
        assert_eq!(ty, "BlnM");
        assert_eq!(blend_mode(&id), mode, "{id}");
    }
    assert_eq!(blend_mode("linearDodge"), BlendMode::LinearDodge);
    assert_eq!(blend_mode("H   "), BlendMode::Hue);
    assert_eq!(blend_mode("unknown"), BlendMode::Normal);
}

#[test]
fn reads_every_color_class() {
    let rgbc = Descriptor::new("RGBC")
        .with("Rd  ", Value::Double(255.0))
        .with("Grn ", Value::Double(127.5))
        .with("Bl  ", Value::Integer(0));
    assert!(close(
        color::from_descriptor(&rgbc),
        Rgb::new(1.0, 0.5, 0.0)
    ));

    let float = Descriptor::new("RGBC")
        .with("redFloat", Value::Double(1.000_002))
        .with("greenFloat", Value::Double(0.25))
        .with("blueFloat", Value::Double(-0.1));
    assert_eq!(color::from_descriptor(&float), Rgb::new(1.0, 0.25, 0.0));

    let hsb = Descriptor::new("HSBC")
        .with("H   ", Value::UnitDouble("#Ang".into(), 120.0))
        .with("Strt", Value::Double(100.0))
        .with("Brgh", Value::Double(100.0));
    assert!(close(color::from_descriptor(&hsb), Rgb::new(0.0, 1.0, 0.0)));

    let cmyk = Descriptor::new("CMYC")
        .with("Cyn ", Value::Double(100.0))
        .with("Mgnt", Value::Double(0.0))
        .with("Ylw ", Value::Double(0.0))
        .with("Blck", Value::Double(0.0));
    assert!(close(
        color::from_descriptor(&cmyk),
        Rgb::new(0.0, 1.0, 1.0)
    ));

    let lab = Descriptor::new("LbCl")
        .with("Lmnc", Value::Double(100.0))
        .with("A   ", Value::Double(0.0))
        .with("B   ", Value::Double(0.0));
    assert!(close(color::from_descriptor(&lab), Rgb::WHITE));
    let red = color::lab_to_rgb(54.29, 80.81, 69.89);
    assert!(red.r > 0.95 && red.g < 0.1 && red.b < 0.1, "{red:?}");

    let gray = Descriptor::new("Grsc").with("Gry ", Value::Double(25.0));
    assert!(close(
        color::from_descriptor(&gray),
        Rgb::new(0.75, 0.75, 0.75)
    ));

    let book = Descriptor::new("BkCl").with("Bk  ", Value::Text("PANTONE".into()));
    assert_eq!(color::from_descriptor(&book), Rgb::BLACK);
}

#[test]
fn binary_colors_round_trip() {
    let c = Rgb::new(1.0, 0.5, 0.25);
    let mut w = Writer::new();
    color::write_binary(&mut w, c);
    let bytes = w.into_bytes();
    assert_eq!(bytes.len(), 10);
    let back = color::read_binary(&mut Reader::new(&bytes)).expect("reads");
    assert!(close(back, c));
    // Lab white, grayscale black, CMYK with no ink.
    assert!(close(color::from_binary(7, [10000, 0, 0, 0]), Rgb::WHITE));
    assert!(close(color::from_binary(8, [10000, 0, 0, 0]), Rgb::BLACK));
    assert!(close(
        color::from_binary(2, [65535, 65535, 65535, 65535]),
        Rgb::WHITE
    ));
}

#[test]
fn colors_keep_their_stored_form_until_changed() {
    let hsb = Descriptor::new("HSBC")
        .with("H   ", Value::UnitDouble("#Ang".into(), 0.0))
        .with("Strt", Value::Double(100.0))
        .with("Brgh", Value::Double(100.0));
    let mut d = Descriptor::new("SoFi").with("Clr ", Value::Descriptor(hsb.clone()));
    let red = color(&d, "Clr ").expect("color");
    put_color(&mut d, "Clr ", red);
    assert_eq!(d.object("Clr "), Some(&hsb));
    put_color(&mut d, "Clr ", Rgb::new(0.0, 0.0, 1.0));
    assert_eq!(d.object("Clr ").map(|c| c.class.as_str()), Some("RGBC"));
    assert_eq!(color(&d, "Clr "), Some(Rgb::new(0.0, 0.0, 1.0)));

    let mut d = Descriptor::new("x").with("Opct", Value::Integer(75));
    put_percent(&mut d, "Opct", 0.75);
    assert_eq!(d.get("Opct"), Some(&Value::Integer(75)));
    put_percent(&mut d, "Opct", 0.5);
    assert_eq!(d.unit("Opct"), Some(("#Prc", 50.0)));
}

fn sample_gradient() -> Gradient {
    Gradient {
        name: "Custom".into(),
        kind: GradientKind::Radial,
        angle: 33.0,
        scale: 1.5,
        reverse: true,
        dither: true,
        align_with_layer: false,
        offset: (0.1, -0.2),
        smoothness: 0.5,
        method: GradientMethod::Perceptual,
        colors: vec![
            ColorStop {
                location: 0.0,
                midpoint: 0.5,
                color: Rgb::new(1.0, 0.0, 0.0),
            },
            ColorStop {
                location: 0.25,
                midpoint: 0.37,
                color: Rgb::new(0.0, 0.0, 1.0),
            },
        ],
        opacities: vec![OpacityStop {
            location: 1.0,
            midpoint: 0.5,
            opacity: 0.5,
        }],
    }
}

#[test]
fn gradients_round_trip_through_descriptors() {
    let g = sample_gradient();
    let mut d = Descriptor::new("GrFl");
    put_gradient(&mut d, &g);
    assert_eq!(gradient(&d), Some(g.clone()));
    let grad = d.object("Grad").expect("object");
    assert_eq!(grad.number("Intr"), Some(2048.0));
    assert_eq!(grad.enumeration("GrdF"), Some("CstS"));
    assert_eq!(d.enumeration("gradientsInterpolationMethod"), Some("Perc"));

    // Unchanged stops keep the stored object.
    let before = d.clone();
    put_gradient(&mut d, &g);
    assert_eq!(d, before);
}

#[test]
fn interpolation_methods_in_effects_and_fill_layers() {
    let method = |key: &str, id: &str| {
        let mut d = Descriptor::new("GrFl");
        d.set(key, enum_value(METHOD_TYPE, id));
        gradient_method(&d)
    };
    assert_eq!(method("gs99", "Lnr "), GradientMethod::Linear);
    assert_eq!(
        method("gradientsInterpolationMethod", "Smoo"),
        GradientMethod::Smooth
    );
    assert_eq!(method("gs99", "Perc"), GradientMethod::Perceptual);
    assert_eq!(method("gs99", "Gcls"), GradientMethod::Classic);

    // A method the engine doesn't know reads as classic and stays.
    let mut d = Descriptor::new("GrFl");
    d.set("gs99", enum_value(METHOD_TYPE, "Stps"));
    put_gradient_method(&mut d, GradientMethod::Classic);
    assert_eq!(d.enumeration("gs99"), Some("Stps"));
    put_gradient_method(&mut d, GradientMethod::Smooth);
    assert_eq!(d.enumeration("gs99"), Some("Smoo"));

    // Descriptors from before the methods get one only when it isn't
    // classic: `gs99` in effects, the long key in fill layers.
    let mut effect = Descriptor::new("GrFl").with("enab", Value::Bool(true));
    put_gradient_method(&mut effect, GradientMethod::Classic);
    assert!(!effect.has("gs99"));
    put_gradient_method(&mut effect, GradientMethod::Linear);
    assert_eq!(effect.enumeration("gs99"), Some("Lnr "));
    let mut fill = Descriptor::new("null");
    put_gradient_method(&mut fill, GradientMethod::Smooth);
    assert_eq!(
        fill.enumeration("gradientsInterpolationMethod"),
        Some("Smoo")
    );
    assert!(!fill.has("gs99"));
}

#[test]
fn approximates_noise_gradients_deterministically() {
    let ranges = |v: i32| Value::List(vec![Value::Integer(v); 4]);
    let noise = Descriptor::new("Grdn")
        .with("GrdF", enum_value("GrdF", "ClNs"))
        .with("Nm  ", Value::Text("Noise".into()))
        .with("ShTr", Value::Bool(false))
        .with("ClrS", enum_value("ClrS", "RGBC"))
        .with("RndS", Value::Integer(12345))
        .with("Smth", Value::Integer(4096))
        .with("Mnm ", ranges(0))
        .with("Mxm ", ranges(100));
    let a = gradient_object(&noise);
    assert_eq!(a, gradient_object(&noise));
    assert_eq!(a.colors.len(), 16);
    assert_eq!(a.opacities.len(), 2);
    assert!(a.colors.windows(2).all(|w| w[0].location < w[1].location));
    // An unchanged noise gradient keeps its object.
    assert_eq!(gradient_object_descriptor(&a, Some(&noise)), noise);
}

#[test]
fn patterns_and_contours_round_trip() {
    let p = PatternFill {
        pattern: "b2b8b7c0-1".into(),
        name: "Tile".into(),
        scale: 0.5,
        angle: 15.0,
        align_with_layer: false,
        phase: (3.0, -4.0),
    };
    for key in ["Algn", "Lnkd"] {
        let mut d = Descriptor::new("x");
        put_pattern(&mut d, &p, key);
        assert!(d.has(key));
        assert_eq!(pattern(&d), Some(p.clone()));
    }

    let c = Contour {
        name: "Cone".into(),
        points: vec![(0.0, 0.0), (0.5, 1.0), (1.0, 0.0)],
    };
    let d = contour_descriptor(&c);
    assert_eq!(contour(&d), c);
    assert_eq!(contour(&Descriptor::new("ShpC")), Contour::default());
}

#[test]
fn reads_lengths_in_other_units() {
    let d = Descriptor::new("x")
        .with("a", Value::UnitDouble("#Pxl".into(), 3.0))
        .with("b", Value::UnitDouble("#Pnt".into(), 36.0))
        .with("c", Value::UnitDouble("RrIn".into(), 1.0))
        .with("d", Value::Double(2.5));
    assert_eq!(pixels(&d, "a"), Some(3.0));
    assert_eq!(pixels(&d, "b"), Some(36.0));
    assert_eq!(pixels(&d, "c"), Some(72.0));
    assert_eq!(pixels(&d, "d"), Some(2.5));
    assert_eq!(length_to_pixels("#Pnt", 72.0, 300.0), 300.0);
}
