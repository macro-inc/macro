//! Conversions to sRGB: CMYK through a fit of a press profile, Lab through
//! XYZ with Bradford adaptation to D65, and the sRGB transfer curve.

use std::sync::OnceLock;

/// D50, the white point PDF color spaces usually name.
pub(crate) const D50: [f32; 3] = [0.9642, 1.0, 0.8249];
/// D65, sRGB's white.
const D65: [f32; 3] = [0.95047, 1.0, 1.08883];

/// XYZ to cone responses (Bradford).
const BRADFORD: [[f32; 3]; 3] = [
    [0.8951, 0.2664, -0.1614],
    [-0.7502, 1.7135, 0.0367],
    [0.0389, -0.0685, 1.0296],
];
/// Cone responses to XYZ.
const BRADFORD_INVERSE: [[f32; 3]; 3] = [
    [0.986_993, -0.147_054_3, 0.159_962_7],
    [0.432_305_3, 0.518_360_3, 0.049_291_2],
    [-0.008_528_7, 0.040_042_8, 0.968_486_7],
];
/// XYZ (D65) to linear sRGB.
const XYZ_TO_SRGB: [[f32; 3]; 3] = [
    [3.240_454_2, -1.537_138_5, -0.498_531_4],
    [-0.969_266, 1.876_010_8, 0.041_556],
    [0.055_643_4, -0.204_025_9, 1.057_225_2],
];

fn mul(m: &[[f32; 3]; 3], v: [f32; 3]) -> [f32; 3] {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

fn matmul(a: &[[f32; 3]; 3], b: &[[f32; 3]; 3]) -> [[f32; 3]; 3] {
    let mut out = [[0.0; 3]; 3];
    for (i, row) in out.iter_mut().enumerate() {
        for (j, v) in row.iter_mut().enumerate() {
            *v = (0..3).map(|k| a[i][k] * b[k][j]).sum();
        }
    }
    out
}

/// CMYK (`0..=1`) to sRGB: pdf.js's quadratic fit of U.S. Web Coated
/// (SWOP), which is far closer to what Illustrator shows than the naive
/// `1 - min(1, c + k)`.
pub(crate) fn cmyk_to_rgb(c: f32, m: f32, y: f32, k: f32) -> [f32; 3] {
    let (c, m, y, k) = (
        c.clamp(0.0, 1.0),
        m.clamp(0.0, 1.0),
        y.clamp(0.0, 1.0),
        k.clamp(0.0, 1.0),
    );
    let r = 255.0
        + c * (-4.387_332_4 * c + 54.486_15 * m + 18.822_905 * y + 212.256_62 * k - 285.233_1)
        + m * (1.714_976_3 * m - 5.609_673_7 * y - 17.873_87 * k - 5.497_006_4)
        + y * (-2.521_734 * y - 21.248_923 * k + 17.511_927)
        + k * (-21.861_221 * k - 189.481_8);
    let g = 255.0
        + c * (8.841_041 * c + 60.118_027 * m + 6.871_425_6 * y + 31.159_1 * k - 79.297_08)
        + m * (-15.310_361 * m + 17.575_25 * y + 131.352_5 * k - 190.945_33)
        + y * (4.444_339 * y + 9.863_286 * k - 24.867_416)
        + k * (-20.737_326 * k - 187.804_54);
    let b = 255.0
        + c * (0.884_252_2 * c + 8.078_677 * m + 30.899_784 * y - 0.238_832_39 * k - 14.183_577)
        + m * (10.495_933 * m + 63.023_785 * y + 50.606_96 * k - 112.238_84)
        + y * (0.032_960_41 * y + 115.603_84 * k - 193.582_1)
        + k * (-22.338_168 * k - 180.126_14);
    [
        (r / 255.0).clamp(0.0, 1.0),
        (g / 255.0).clamp(0.0, 1.0),
        (b / 255.0).clamp(0.0, 1.0),
    ]
}

/// The matrix from XYZ relative to `white` to linear sRGB: Bradford
/// adaptation to D65, then sRGB's primaries.
pub(crate) fn xyz_to_linear_srgb(white: [f32; 3]) -> [[f32; 3]; 3] {
    let white = if white.iter().all(|w| w.is_finite() && *w > 0.0) {
        white
    } else {
        D50
    };
    let from = mul(&BRADFORD, white);
    let to = mul(&BRADFORD, D65);
    let scale = [
        [to[0] / from[0], 0.0, 0.0],
        [0.0, to[1] / from[1], 0.0],
        [0.0, 0.0, to[2] / from[2]],
    ];
    let adapt = matmul(&BRADFORD_INVERSE, &matmul(&scale, &BRADFORD));
    matmul(&XYZ_TO_SRGB, &adapt)
}

/// CIE L*a*b* to XYZ relative to `white`.
pub(crate) fn lab_to_xyz(l: f32, a: f32, b: f32, white: [f32; 3]) -> [f32; 3] {
    fn g(x: f32) -> f32 {
        const DELTA: f32 = 6.0 / 29.0;
        if x >= DELTA {
            x * x * x
        } else {
            3.0 * DELTA * DELTA * (x - 4.0 / 29.0)
        }
    }
    let fy = (l + 16.0) / 116.0;
    let fx = fy + a / 500.0;
    let fz = fy - b / 200.0;
    [white[0] * g(fx), white[1] * g(fy), white[2] * g(fz)]
}

/// XYZ through `matrix` (from [`xyz_to_linear_srgb`]) to sRGB.
pub(crate) fn xyz_to_srgb(matrix: &[[f32; 3]; 3], xyz: [f32; 3]) -> [f32; 3] {
    mul(matrix, xyz).map(srgb_encode)
}

/// [`xyz_to_srgb`] to bytes, through a table.
pub(crate) fn xyz_to_srgb_u8(matrix: &[[f32; 3]; 3], xyz: [f32; 3]) -> [u8; 3] {
    mul(matrix, xyz).map(srgb_encode_u8)
}

/// Linear light (`0..=1`) to the sRGB transfer curve.
pub(crate) fn srgb_encode(linear: f32) -> f32 {
    let l = if linear.is_nan() {
        0.0
    } else {
        linear.clamp(0.0, 1.0)
    };
    if l <= 0.003_130_8 {
        12.92 * l
    } else {
        1.055 * l.powf(1.0 / 2.4) - 0.055
    }
}

/// [`srgb_encode`] to a byte, through a table.
pub(crate) fn srgb_encode_u8(linear: f32) -> u8 {
    const STEPS: usize = 4096;
    static TABLE: OnceLock<Vec<u8>> = OnceLock::new();
    let table = TABLE.get_or_init(|| {
        (0..STEPS)
            .map(|i| to_u8(srgb_encode(i as f32 / (STEPS - 1) as f32)))
            .collect()
    });
    let l = if linear.is_nan() {
        0.0
    } else {
        linear.clamp(0.0, 1.0)
    };
    table[(l * (STEPS - 1) as f32 + 0.5) as usize]
}

/// `0..=1` to a byte, rounding.
pub(crate) fn to_u8(v: f32) -> u8 {
    if v.is_nan() {
        0
    } else {
        (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
    }
}
