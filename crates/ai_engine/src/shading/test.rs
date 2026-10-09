use super::{Shading, ShadingGeometry};
use crate::function::testing::{Corpus, Mock, corpus_manifest, load_png, obj, stream};
use crate::pdf::{Dict, ObjRef, Object};
use tiny_skia::{Mask, Pixmap, Transform};

const GRAY_RAMP: &str = "<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [1 1 1] /N 1 >>";

fn parse(src: &str) -> Shading {
    Shading::parse(&Mock::default(), &obj(src), &Dict::new()).expect("shading parses")
}

fn parse_stream(dict: &str, data: &[u8]) -> Shading {
    Shading::parse(
        &Mock::default(),
        &Object::Stream(stream(dict, data)),
        &Dict::new(),
    )
    .expect("shading parses")
}

fn paint(sh: &Shading, w: u32, h: u32) -> Pixmap {
    paint_with(sh, w, h, Transform::identity(), None, 1.0)
}

fn paint_with(
    sh: &Shading,
    w: u32,
    h: u32,
    transform: Transform,
    clip: Option<&Mask>,
    alpha: f32,
) -> Pixmap {
    let mut pixmap = Pixmap::new(w, h).unwrap();
    sh.paint(&mut pixmap.as_mut(), transform, clip, alpha);
    pixmap
}

/// A pixel as premultiplied RGBA.
fn px(p: &Pixmap, x: u32, y: u32) -> [u8; 4] {
    let c = p.pixel(x, y).unwrap();
    [c.red(), c.green(), c.blue(), c.alpha()]
}

#[track_caller]
fn assert_near(actual: [u8; 4], expected: [u8; 4], tolerance: u8) {
    assert!(
        actual
            .iter()
            .zip(&expected)
            .all(|(a, e)| a.abs_diff(*e) <= tolerance),
        "{actual:?} != {expected:?}"
    );
}

fn gray(v: f64) -> [u8; 4] {
    let g = (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    [g, g, g, 255]
}

const CLEAR: [u8; 4] = [0, 0, 0, 0];

#[test]
fn axial_runs_between_its_points() {
    let sh = parse(&format!(
        "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function {GRAY_RAMP} >>"
    ));
    assert_eq!(sh.shading_type(), 2);
    let p = paint(&sh, 100, 4);
    assert_near(px(&p, 0, 0), gray(0.005), 1);
    assert_near(px(&p, 50, 2), gray(0.505), 1);
    assert_near(px(&p, 99, 3), gray(0.995), 1);
}

#[test]
fn axial_extends_only_where_asked() {
    let src = |extend: &str| {
        format!(
            "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [25 0 75 0] /Extend {extend}
                /Function {GRAY_RAMP} >>"
        )
    };
    let plain = paint(&parse(&src("[false false]")), 100, 1);
    assert_eq!(px(&plain, 10, 0), CLEAR);
    assert_near(px(&plain, 50, 0), gray(0.51), 1);
    assert_eq!(px(&plain, 90, 0), CLEAR);
    let before = paint(&parse(&src("[true false]")), 100, 1);
    assert_eq!(px(&before, 10, 0), gray(0.0));
    assert_eq!(px(&before, 90, 0), CLEAR);
    let both = paint(&parse(&src("[true true]")), 100, 1);
    assert_eq!(px(&both, 10, 0), gray(0.0));
    assert_eq!(px(&both, 90, 0), gray(1.0));
}

#[test]
fn axial_through_a_transform_and_domain() {
    // A unit gradient scaled onto the pixmap, its Domain halved.
    let sh = parse(&format!(
        "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 1 0] /Domain [0 0.5]
            /Function {GRAY_RAMP} >>"
    ));
    let p = paint_with(&sh, 100, 1, Transform::from_scale(100.0, 1.0), None, 1.0);
    assert_near(px(&p, 99, 0), gray(0.4975), 1);
}

#[test]
fn radial_concentric() {
    let src = |extend: &str| {
        format!(
            "<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [50 50 0 50 50 40] /Extend {extend}
                /Function {GRAY_RAMP} >>"
        )
    };
    let p = paint(&parse(&src("[false false]")), 100, 100);
    assert_near(px(&p, 50, 50), gray(0.5f64.hypot(0.5) / 40.0), 1);
    assert_near(px(&p, 70, 50), gray(20.5f64.hypot(0.5) / 40.0), 2);
    assert_eq!(px(&p, 95, 50), CLEAR);
    let extended = paint(&parse(&src("[true true]")), 100, 100);
    assert_eq!(px(&extended, 95, 50), gray(1.0));
}

#[test]
fn radial_between_two_circles() {
    // Two circles of one radius: a tube from left to right.
    let src = |extend: &str| {
        format!(
            "<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [20 50 10 80 50 10] /Extend {extend}
                /Function {GRAY_RAMP} >>"
        )
    };
    let p = paint(&parse(&src("[false false]")), 100, 100);
    // The later (larger s) circle through the point wins.
    let s = (30.5 + 99.75f64.sqrt()) / 60.0;
    assert_near(px(&p, 50, 50), gray(s), 2);
    assert_eq!(px(&p, 50, 75), CLEAR);
    assert_eq!(px(&p, 5, 50), CLEAR);
    let extended = paint(&parse(&src("[true true]")), 100, 100);
    assert_eq!(px(&extended, 5, 50), gray(0.0));
    assert_eq!(px(&extended, 50, 75), CLEAR);
}

#[test]
fn radial_cone_with_the_focus_outside() {
    let sh = parse(&format!(
        "<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [10 50 0 60 50 20] /Extend [true true]
            /Function {GRAY_RAMP} >>"
    ));
    let p = paint(&sh, 100, 100);
    let s = (1275.0 + (1275.0f64 * 1275.0 - 2100.0 * 650.5).sqrt()) / 2100.0;
    assert_near(px(&p, 35, 50), gray(s), 2);
    // Outside the cone the circles never pass.
    assert_eq!(px(&p, 10, 80), CLEAR);
    // Behind the focus the cone does not reach (radii would be negative).
    assert_eq!(px(&p, 2, 50), CLEAR);
}

#[test]
fn function_based_shading() {
    let sh = parse(
        "<< /ShadingType 1 /ColorSpace /DeviceRGB /Domain [0 1 0 1] /Matrix [100 0 0 100 0 0]
            /Function [ << /FunctionType 2 /Domain [0 1] /N 1 >> ] >>",
    );
    assert_eq!(sh.shading_type(), 1);
    // A two-input function: r = x, g = y, b = 0.
    let mut mock = Mock::default();
    mock.add(
        1,
        Object::Stream(stream(
            "<< /FunctionType 4 /Domain [0 1 0 1] /Range [0 1 0 1 0 1] >>",
            b"{ 0 }",
        )),
    );
    let sh2 = Shading::parse(
        &mock,
        &obj("<< /ShadingType 1 /ColorSpace /DeviceRGB /Domain [0 1 0 1] /Matrix [100 0 0 100 0 0] /Function 1 0 R >>"),
        &Dict::new(),
    )
    .unwrap();
    let p = paint(&sh2, 120, 120);
    assert_near(px(&p, 25, 75), [65, 193, 0, 255], 2);
    assert_near(px(&p, 99, 0), [254, 1, 0, 255], 2);
    // Outside the domain nothing is painted.
    assert_eq!(px(&p, 110, 50), CLEAR);
    // The one-output function array draws gray in x (red only).
    let p = paint(&sh, 100, 100);
    assert_near(px(&p, 50, 10), [129, 0, 0, 255], 2);
}

#[test]
fn clip_and_alpha_scale_the_coverage() {
    let sh = parse(
        "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 10 0] /Extend [true true]
            /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [1 0 0] /N 1 >> >>",
    );
    let mut clip = Mask::new(4, 1).unwrap();
    clip.data_mut().copy_from_slice(&[255, 128, 0, 255]);
    let p = paint_with(&sh, 4, 1, Transform::identity(), Some(&clip), 1.0);
    assert_eq!(px(&p, 0, 0), [255, 0, 0, 255]);
    assert_near(px(&p, 1, 0), [128, 0, 0, 128], 1);
    assert_eq!(px(&p, 2, 0), CLEAR);
    let half = paint_with(&sh, 4, 1, Transform::identity(), Some(&clip), 0.5);
    assert_near(px(&half, 0, 0), [128, 0, 0, 128], 1);
    assert_near(px(&half, 1, 0), [64, 0, 0, 64], 1);
    // Source-over onto what is there.
    let mut pixmap = Pixmap::new(1, 1).unwrap();
    pixmap.fill(tiny_skia::Color::from_rgba8(0, 0, 255, 255));
    sh.paint(&mut pixmap.as_mut(), Transform::identity(), None, 0.5);
    assert_near(px(&pixmap, 0, 0), [128, 0, 127, 255], 1);
}

#[test]
fn bbox_limits_painting_and_background_is_parsed() {
    let sh = parse(&format!(
        "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Extend [true true]
            /BBox [60 0 20 10] /Background [0 0 1] /Function {GRAY_RAMP} >>"
    ));
    assert_eq!(sh.bbox, Some([20.0, 0.0, 60.0, 10.0]));
    assert_eq!(sh.background, Some([0.0, 0.0, 1.0]));
    let p = paint(&sh, 100, 20);
    assert_eq!(px(&p, 10, 5), CLEAR);
    assert_near(px(&p, 40, 5), gray(0.405), 1);
    assert_eq!(px(&p, 70, 5), CLEAR);
    assert_eq!(px(&p, 40, 15), CLEAR);
}

#[test]
fn invisible_spaces_paint_nothing() {
    let sh = parse(
        "<< /ShadingType 2 /Coords [0 0 10 0] /Extend [true true]
            /ColorSpace [/Separation /None /DeviceGray << /FunctionType 2 /Domain [0 1] /N 1 >>]
            /Function << /FunctionType 2 /Domain [0 1] /N 1 >> >>",
    );
    let p = paint(&sh, 4, 1);
    assert!(p.data().iter().all(|&b| b == 0));
}

#[test]
fn geometry_and_stops() {
    let axial = parse(&format!(
        "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [1 2 3 4] /Extend [true false]
            /Function {GRAY_RAMP} >>"
    ));
    assert_eq!(
        axial.geometry(),
        Some(ShadingGeometry::Axial {
            coords: [1.0, 2.0, 3.0, 4.0],
            extend: [true, false]
        })
    );
    // A straight RGB ramp needs its two ends only.
    let stops = axial.stops().unwrap();
    assert_eq!(stops.len(), 2);
    assert_eq!(stops[0], (0.0, [0.0; 3]));
    assert_eq!(stops[1], (1.0, [1.0; 3]));
    let radial = parse(&format!(
        "<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [0 0 1 2 2 3] /Function {GRAY_RAMP} >>"
    ));
    assert_eq!(
        radial.geometry(),
        Some(ShadingGeometry::Radial {
            coords: [0.0, 0.0, 1.0, 2.0, 2.0, 3.0],
            extend: [false, false]
        })
    );
    let function_based = parse(
        "<< /ShadingType 1 /ColorSpace /DeviceGray /Function << /FunctionType 2 /Domain [0 1] /N 1 >> >>",
    );
    assert_eq!(function_based.geometry(), None);
    assert_eq!(function_based.stops(), None);
}

#[test]
fn stops_follow_stitching_bounds_and_jumps() {
    let three = parse(
        "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 1 0]
            /Function << /FunctionType 3 /Domain [0 1] /Bounds [0.25] /Encode [0 1 0 1]
              /Functions [
                << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 1 0] /N 1 >>
                << /FunctionType 2 /Domain [0 1] /C0 [0 1 0] /C1 [0 0 1] /N 1 >>
              ] >> >>",
    );
    let stops = three.stops().unwrap();
    let offsets: Vec<f32> = stops.iter().map(|s| s.0).collect();
    assert_eq!(offsets, vec![0.0, 0.25, 1.0]);
    assert_eq!(stops[1].1, [0.0, 1.0, 0.0]);
    // A jump makes two stops at one offset.
    let hard = parse(
        "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 1 0]
            /Function << /FunctionType 3 /Domain [0 1] /Bounds [0.5] /Encode [0 1 0 1]
              /Functions [
                << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [1 0 0] /N 1 >>
                << /FunctionType 2 /Domain [0 1] /C0 [0 0 1] /C1 [0 0 1] /N 1 >>
              ] >> >>",
    );
    let stops = hard.stops().unwrap();
    assert_eq!(
        stops,
        vec![
            (0.0, [1.0, 0.0, 0.0]),
            (0.5, [1.0, 0.0, 0.0]),
            (0.5, [0.0, 0.0, 1.0]),
            (1.0, [0.0, 0.0, 1.0]),
        ]
    );
    // CMYK ramps bend in sRGB, needing stops between the ends, and every
    // sample stays within half a level of the line between stops.
    let cmyk = parse(
        "<< /ShadingType 2 /ColorSpace /DeviceCMYK /Coords [0 0 1 0]
            /Function << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [1 0.6 0 0.2] /N 1 >> >>",
    );
    let stops = cmyk.stops().unwrap();
    assert!(stops.len() > 2, "{stops:?}");
    assert!(stops.len() < 40, "{}", stops.len());
    for k in 0..=100 {
        let s = k as f32 / 100.0;
        let i = stops
            .iter()
            .rposition(|st| st.0 <= s)
            .unwrap()
            .min(stops.len() - 2);
        let (s0, c0) = stops[i];
        let (s1, c1) = stops[i + 1];
        let f = (s - s0) / (s1 - s0);
        let exact = crate::color::ColorSpace::Cmyk.to_rgb(&[s, 0.6 * s, 0.0, 0.2 * s]);
        for c in 0..3 {
            let line = c0[c] + (c1[c] - c0[c]) * f;
            assert!(
                (line - exact[c]).abs() < 2.0 / 255.0,
                "at {s}: {line} vs {}",
                exact[c]
            );
        }
    }
}

fn be16(values: &[u16]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_be_bytes()).collect()
}

/// A square patch over 0..99 (control points at thirds) with straight
/// edges, in listing order, as 16-bit coordinates.
fn square_boundary() -> Vec<u16> {
    vec![
        0, 0, 0, 33, 0, 66, 0, 99, // p00 p01 p02 p03
        33, 99, 66, 99, 99, 99, // p13 p23 p33
        99, 66, 99, 33, 99, 0, // p32 p31 p30
        66, 0, 33, 0, // p20 p10
    ]
}

const MESH_RGB: &str = "/ColorSpace /DeviceRGB /BitsPerCoordinate 16 /BitsPerComponent 8
    /BitsPerFlag 8 /Decode [0 65535 0 65535 0 1 0 1 0 1]";

fn corner_colors() -> Vec<u8> {
    // Red at p00, green at p03, blue at p33, white at p30.
    vec![255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]
}

/// The square patch's color at a pixel: bilinear in u = x / 99 and
/// v = y / 99 between the corner colors.
fn square_color(x: u32, y: u32) -> [u8; 4] {
    let (u, v) = ((x as f64 + 0.5) / 99.0, (y as f64 + 0.5) / 99.0);
    let corners = [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
        [1.0, 1.0, 1.0],
    ];
    let w = [(1.0 - u) * (1.0 - v), (1.0 - u) * v, u * v, u * (1.0 - v)];
    let c = |k: usize| {
        let v: f64 = (0..4).map(|i| w[i] * corners[i][k]).sum();
        (v * 255.0).round() as u8
    };
    [c(0), c(1), c(2), 255]
}

#[test]
fn coons_patch_corners_and_center() {
    let mut data = vec![0u8];
    data.extend(be16(&square_boundary()));
    data.extend(corner_colors());
    let sh = parse_stream(&format!("<< /ShadingType 6 {MESH_RGB} >>"), &data);
    assert_eq!(sh.shading_type(), 6);
    let p = paint(&sh, 100, 100);
    for (x, y) in [(1, 1), (1, 97), (97, 97), (97, 1), (49, 49), (20, 70)] {
        assert_near(px(&p, x, y), square_color(x, y), 3);
    }
    assert_eq!(px(&p, 99, 99), CLEAR);
}

#[test]
fn tensor_patch_and_shared_edges() {
    // A tensor patch with its inner points at thirds is the same square.
    let mut data = vec![0u8];
    let mut points = square_boundary();
    points.extend([33, 33, 33, 66, 66, 66, 66, 33]);
    data.extend(be16(&points));
    data.extend(corner_colors());
    let sh = parse_stream(&format!("<< /ShadingType 7 {MESH_RGB} >>"), &data);
    let p = paint(&sh, 100, 100);
    for (x, y) in [(1, 1), (97, 97), (49, 49), (70, 20)] {
        assert_near(px(&p, x, y), square_color(x, y), 3);
    }
    // A second Coons patch (flag 2) continues from the first's right
    // edge (p33 to p30, its own p00 to p03) out to x = 198, its far
    // corners black.
    let mut data = vec![0u8];
    data.extend(be16(&square_boundary()));
    data.extend(corner_colors());
    data.push(2);
    data.extend(be16(&[
        132, 0, 165, 0, 198, 0, // p13 p23 p33
        198, 33, 198, 66, 198, 99, // p32 p31 p30
        165, 99, 132, 99, // p20 p10
    ]));
    data.extend([0, 0, 0, 0, 0, 0]);
    let sh = parse_stream(&format!("<< /ShadingType 6 {MESH_RGB} >>"), &data);
    let p = paint(&sh, 200, 100);
    // Along the shared edge the colors agree: blue at the bottom, white
    // at the top.
    assert_near(px(&p, 100, 97), [3, 3, 250, 255], 8);
    assert_near(px(&p, 100, 1), [250, 250, 250, 255], 8);
    assert_near(px(&p, 197, 50), [3, 3, 3, 255], 6);
}

#[test]
fn free_form_and_lattice_triangles() {
    // Two triangles: flag 0 starts one, flag 1 adds a vertex to the last
    // one's last two.
    let mut data = Vec::new();
    for (flag, x, y, rgb) in [
        (0u8, 0u16, 0u16, [255u8, 0, 0]),
        (0, 99, 0, [0, 255, 0]),
        (0, 0, 99, [0, 0, 255]),
        (1, 99, 99, [255, 255, 255]),
    ] {
        data.push(flag);
        data.extend(be16(&[x, y]));
        data.extend(rgb);
    }
    let sh = parse_stream(&format!("<< /ShadingType 4 {MESH_RGB} >>"), &data);
    let p = paint(&sh, 100, 100);
    assert_near(px(&p, 0, 0), [252, 2, 2, 255], 4);
    assert_near(px(&p, 98, 0), [2, 252, 2, 255], 4);
    assert_near(px(&p, 0, 98), [2, 2, 252, 255], 4);
    assert_near(px(&p, 98, 98), [252, 252, 252, 255], 4);
    // The same as a 2 × 2 lattice.
    let mut data = Vec::new();
    for (x, y, rgb) in [
        (0u16, 0u16, [255u8, 0, 0]),
        (99, 0, [0, 255, 0]),
        (0, 99, [0, 0, 255]),
        (99, 99, [255, 255, 255]),
    ] {
        data.extend(be16(&[x, y]));
        data.extend(rgb);
    }
    let lattice = parse_stream(
        "<< /ShadingType 5 /ColorSpace /DeviceRGB /BitsPerCoordinate 16 /BitsPerComponent 8
            /VerticesPerRow 2 /Decode [0 65535 0 65535 0 1 0 1 0 1] >>",
        &data,
    );
    let q = paint(&lattice, 100, 100);
    for (x, y) in [(0, 0), (98, 0), (0, 98), (98, 98), (30, 60)] {
        assert_near(px(&q, x, y), px(&p, x, y), 2);
    }
}

#[test]
fn parametric_meshes_color_through_the_function() {
    // t from 0 to 1 across one triangle; the function maps t to gray.
    let mut data = Vec::new();
    for (x, y, t) in [(0u16, 0u16, 0u8), (99, 0, 255), (0, 99, 0)] {
        data.push(0);
        data.extend(be16(&[x, y]));
        data.push(t);
    }
    let sh = parse_stream(
        &format!(
            "<< /ShadingType 4 /ColorSpace /DeviceRGB /BitsPerCoordinate 16 /BitsPerComponent 8
                /BitsPerFlag 8 /Decode [0 65535 0 65535 0 1] /Function {GRAY_RAMP} >>"
        ),
        &data,
    );
    let p = paint(&sh, 100, 100);
    assert_near(px(&p, 0, 0), gray(0.0), 3);
    assert_near(px(&p, 49, 10), gray(0.5), 4);
    assert_near(px(&p, 97, 0), gray(1.0), 4);
}

#[test]
fn malformed_shadings_fail_to_parse() {
    let mock = Mock::default();
    for bad in [
        "<< /ColorSpace /DeviceRGB /Coords [0 0 1 0] >>",
        "<< /ShadingType 9 /ColorSpace /DeviceRGB >>",
        "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 1] /Function << /FunctionType 2 /Domain [0 1] /N 1 >> >>",
        "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 1 0] >>",
        "<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [0 0 -1 0 0 1] /Function << /FunctionType 2 /Domain [0 1] /N 1 >> >>",
        "<< /ShadingType 2 /ColorSpace /Pattern /Coords [0 0 1 0] /Function << /FunctionType 2 /Domain [0 1] /N 1 >> >>",
        "<< /ShadingType 4 /ColorSpace /DeviceRGB >>",
    ] {
        assert!(
            Shading::parse(&mock, &obj(bad), &Dict::new()).is_err(),
            "{bad}"
        );
    }
    // Truncated mesh data keeps the complete parts.
    let mut data = vec![0u8];
    data.extend(be16(&square_boundary()));
    data.extend(corner_colors());
    data.push(0);
    data.extend(be16(&[1, 2, 3]));
    let sh = parse_stream(&format!("<< /ShadingType 6 {MESH_RGB} >>"), &data);
    let p = paint(&sh, 100, 100);
    assert_near(px(&p, 1, 1), [252, 3, 3, 255], 6);
}

#[test]
fn garbage_shadings_never_panic() {
    let mut noise = crate::function::testing::Noise(5);
    let transforms = [
        Transform::identity(),
        Transform::from_row(1e6, 0.0, 0.0, 1e6, -3e7, 2e7),
        Transform::from_row(1e-6, 0.0, 0.0, 1e-6, 10.0, 10.0),
        Transform::from_row(0.0, 0.0, 0.0, 0.0, 5.0, 5.0),
        Transform::from_row(30.0, 20.0, -20.0, 30.0, 32.0, 32.0),
    ];
    let numbers = ["0", "1", "-1", "1e9", "-1e9", "0.5", "64", "1e-9"];
    let mut painted = 0;
    for round in 0..300 {
        let mut n = || *noise.pick(&numbers);
        let src = match round % 6 {
            0 => format!(
                "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [{} {} {} {}] /Extend [true true]
                    /Function {GRAY_RAMP} >>",
                n(),
                n(),
                n(),
                n()
            ),
            1 => format!(
                "<< /ShadingType 3 /ColorSpace /DeviceCMYK /Coords [{} {} 1 {} {} {}] /Extend [true false]
                    /Function << /FunctionType 2 /Domain [0 1] /C1 [1 0 0 0] /N 1 >> >>",
                n(),
                n(),
                n(),
                n(),
                n().trim_start_matches('-')
            ),
            2 => format!(
                "<< /ShadingType 1 /ColorSpace /DeviceGray /Domain [0 {} 0 {}] /Matrix [{} 0 0 {} 0 0]
                    /Function << /FunctionType 2 /Domain [0 1] /N 1 >> >>",
                n(),
                n(),
                n(),
                n()
            ),
            _ => String::new(),
        };
        let sh = if src.is_empty() {
            // Mesh data of random sizes and contents.
            let shading_type = 4 + noise.below(4);
            let coord = *noise.pick(&[1, 2, 8, 12, 16, 24, 32]);
            let comp = *noise.pick(&[1, 4, 8, 12, 16]);
            let flag = *noise.pick(&[2, 4, 8]);
            let function = if noise.below(2) == 0 {
                format!("/Function {GRAY_RAMP}")
            } else {
                String::new()
            };
            let len = noise.below(600) as usize;
            let data = noise.bytes(len);
            let dict = format!(
                "<< /ShadingType {shading_type} /ColorSpace /DeviceRGB /BitsPerCoordinate {coord}
                    /BitsPerComponent {comp} /BitsPerFlag {flag} /VerticesPerRow {}
                    /Decode [-50 150 -50 150 0 1 0 1 0 1] {function} >>",
                noise.below(5)
            );
            Shading::parse(
                &Mock::default(),
                &Object::Stream(stream(&dict, &data)),
                &Dict::new(),
            )
        } else {
            Shading::parse(&Mock::default(), &obj(&src), &Dict::new())
        };
        let Ok(sh) = sh else { continue };
        let transform = *noise.pick(&transforms);
        let alpha = *noise.pick(&[1.0, 0.5, 0.0, f32::NAN]);
        let mut pixmap = Pixmap::new(64, 64).unwrap();
        let mut clip = Mask::new(48, 70).unwrap();
        clip.data_mut().fill(200);
        let clip = (noise.below(2) == 0).then_some(&clip);
        sh.paint(&mut pixmap.as_mut(), transform, clip, alpha);
        let _ = sh.stops();
        painted += usize::from(pixmap.data().iter().any(|&b| b != 0));
    }
    assert!(painted > 30, "{painted}");
}

/// A transform from six numbers (`[a b c d e f]`).
fn matrix(v: &serde_json::Value) -> Option<Transform> {
    let m: Vec<f32> = v
        .as_array()?
        .iter()
        .map(|n| n.as_f64().map(|n| n as f32))
        .collect::<Option<_>>()?;
    (m.len() == 6).then(|| Transform::from_row(m[0], m[1], m[2], m[3], m[4], m[5]))
}

/// Paints the corpus's shadings (exported with references rendered by
/// MuPDF; see `GRAPHICS_CORPUS_DIR`) and compares coverage and color.
#[test]
#[ignore = "needs GRAPHICS_CORPUS_DIR, exported from local corpora"]
fn corpus_shadings_match_references() {
    let Some((dir, entries)) = corpus_manifest() else {
        return;
    };
    let mut worst_cover = 0.0f64;
    let mut worst_color = 0.0f64;
    for e in entries.iter().filter(|e| e["kind"] == "shading") {
        let name = e["dir"].as_str().unwrap_or_default();
        let xref = e["xref"].as_u64().unwrap_or_default() as u32;
        let corpus = Corpus {
            dir: dir.join(name),
        };
        let shading = Shading::parse(&corpus, &Object::Ref(ObjRef::new(xref, 0)), &Dict::new());
        let (Some(m), Some(device)) = (matrix(&e["matrix"]), matrix(&e["device"])) else {
            continue;
        };
        let reference =
            load_png(&dir.join(e["ref"].as_str().unwrap_or_default())).expect("reference render");
        let sh = match shading {
            Ok(sh) => sh,
            Err(err) => {
                println!("{name} {xref}: does not parse: {err}");
                continue;
            }
        };
        let mut pixmap = Pixmap::new(reference.width(), reference.height()).unwrap();
        let start = std::time::Instant::now();
        sh.paint(&mut pixmap.as_mut(), m.post_concat(device), None, 1.0);
        let took = start.elapsed();
        let (mut covered, mut cover_diff, mut both, mut far, mut total) = (0, 0, 0, 0, 0u64);
        for (a, b) in pixmap.pixels().iter().zip(reference.pixels()) {
            let (ca, cb) = (a.alpha() > 128, b.alpha() > 128);
            covered += usize::from(ca || cb);
            cover_diff += usize::from(ca != cb);
            if a.alpha() == 255 && b.alpha() == 255 {
                let d = [
                    a.red().abs_diff(b.red()),
                    a.green().abs_diff(b.green()),
                    a.blue().abs_diff(b.blue()),
                ]
                .into_iter()
                .max()
                .unwrap_or(0);
                both += 1;
                total += u64::from(d);
                far += usize::from(d > 8);
            }
        }
        if std::env::var_os("GRAPHICS_CORPUS_SAVE").is_some() {
            let out = dir.join(format!("{name}/mine_{xref}.png"));
            let _ = std::fs::write(out, fig_engine::images::encode_png(&pixmap));
        }
        let cover = cover_diff as f64 / covered.max(1) as f64 * 100.0;
        let mean = total as f64 / both.max(1) as f64;
        let far = far as f64 / both.max(1) as f64 * 100.0;
        println!(
            "{name} {xref} type {}: covered {covered}, coverage differs {cover:.2}%, \
             mean color diff {mean:.2}, >8 off {far:.2}%, {took:?}",
            sh.shading_type()
        );
        worst_cover = worst_cover.max(cover);
        worst_color = worst_color.max(far);
    }
    println!("worst coverage difference {worst_cover:.2}%, worst far-off colors {worst_color:.2}%");
}
