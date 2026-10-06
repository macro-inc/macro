use crate::functions::engineering::transcendental::bessel_k;

use super::{
    bessel_i::bessel_i,
    bessel_j0_y0::{j0, y0},
    bessel_j1_y1::j1,
    bessel_jn_yn::{jn, yn},
};

const EPS: f64 = 1e-13;
const EPS_LOW: f64 = 1e-6;

// Known values computed with Arb via Nemo.jl in Julia
// You can also use Mathematica
// But please do not use Excel or any other software without arbitrary precision

fn numbers_are_close(a: f64, b: f64) -> bool {
    if a == b {
        // avoid underflow if a = b = 0.0
        return true;
    }
    (a - b).abs() / ((a * a + b * b).sqrt()) < EPS
}

fn numbers_are_somewhat_close(a: f64, b: f64) -> bool {
    if a == b {
        // avoid underflow if a = b = 0.0
        return true;
    }
    (a - b).abs() / ((a * a + b * b).sqrt()) < EPS_LOW
}

#[test]
fn bessel_j0_known_values() {
    let cases = [
        (2.4, 0.002507683297243813),
        (0.5, 0.9384698072408129),
        (1.0, 0.7651976865579666),
        (1.12345, 0.7084999488947348),
        (27.0, 0.07274191800588709),
        (33.0, 0.09727067223550946),
        (2e-4, 0.9999999900000001),
        (0.0, 1.0),
        (1e10, 2.175591750246892e-6),
    ];
    for (value, known) in cases {
        let f = j0(value);
        assert!(
            numbers_are_close(f, known),
            "Got: {f}, expected: {known} for j0({value})"
        );
    }
}

#[test]
fn bessel_y0_known_values() {
    let cases = [
        (2.4, 0.5104147486657438),
        (0.5, -0.4445187335067065),
        (1.0, 0.08825696421567692),
        (1.12345, 0.1783162909790613),
        (27.0, 0.1352149762078722),
        (33.0, 0.0991348255208796),
        (2e-4, -5.496017824512429),
        (1e10, -7.676508175792937e-6),
        (1e-300, -439.8351636227653),
    ];
    for (value, known) in cases {
        let f = y0(value);
        assert!(
            numbers_are_close(f, known),
            "Got: {f}, expected: {known} for y0({value})"
        );
    }
    assert!(y0(0.0).is_infinite());
}

#[test]
fn bessel_j1_known_values() {
    // Values computed with Maxima, the computer algebra system
    // TODO: Recompute
    let cases = [
        (2.4, 0.5201852681819311),
        (0.5, 0.2422684576748738),
        (1.0, 0.4400505857449335),
        (1.17232, 0.4910665691824317),
        (27.5, 0.1521418932046569),
        (42.0, -0.04599388822188721),
        (3e-5, 1.499999999831249E-5),
        (350.0, -0.02040531295214455),
        (0.0, 0.0),
        (1e12, -7.913802683850441e-7),
    ];
    for (value, known) in cases {
        let f = j1(value);
        assert!(
            numbers_are_close(f, known),
            "Got: {f}, expected: {known} for j1({value})"
        );
    }
}

#[test]
fn bessel_jn_known_values() {
    // Values computed with Maxima, the computer algebra system
    // TODO: Recompute
    let cases = [
        (3, 0.5, 0.002_563_729_994_587_244),
        (4, 0.5, 0.000_160_736_476_364_287_6),
        (-3, 0.5, -0.002_563_729_994_587_244),
        (-4, 0.5, 0.000_160_736_476_364_287_6),
        (3, 30.0, 0.129211228759725),
        (-3, 30.0, -0.129211228759725),
        (4, 30.0, -0.052609000321320355),
        (20, 30.0, 0.0048310199934040645),
        (7, 0.0, 0.0),
    ];
    for (n, value, known) in cases {
        let f = jn(n, value);
        assert!(
            numbers_are_close(f, known),
            "Got: {f}, expected: {known} for jn({n}, {value})"
        );
    }
}

#[test]
fn bessel_yn_known_values() {
    let cases = [
        (3, 0.5, -42.059494304723883),
        (4, 0.5, -499.272_560_819_512_3),
        (-3, 0.5, 42.059494304723883),
        (-4, 0.5, -499.272_560_819_512_3),
        (3, 35.0, -0.13191405300596323),
        (-12, 12.2, -0.310438011314211),
        (7, 1e12, 1.016_712_505_197_956_3e-7),
        (35, 3.0, -6.895_879_073_343_495e31),
    ];
    for (n, value, known) in cases {
        let f = yn(n, value);
        assert!(
            numbers_are_close(f, known),
            "Got: {f}, expected: {known} for yn({n}, {value})"
        );
    }
}

#[test]
fn bessel_in_known_values() {
    let cases = [
        (1, 0.5, 0.2578943053908963),
        (3, 0.5, 0.002645111968990286),
        (7, 0.2, 1.986608521182497e-11),
        (7, 0.0, 0.0),
        (0, -0.5, 1.0634833707413236),
        // worse case scenario
        (0, 3.7499, 9.118167894541882),
        (0, 3.7501, 9.119723897590003),
    ];
    for (n, value, known) in cases {
        let f = bessel_i(n, value);
        assert!(
            numbers_are_somewhat_close(f, known),
            "Got: {f}, expected: {known} for in({n}, {value})"
        );
    }
}

#[test]
fn bessel_kn_known_values() {
    let cases = [
        (1, 0.5, 1.656441120003301),
        (0, 0.5, 0.9244190712276659),
        (3, 0.5, 62.05790952993026),
    ];
    for (n, value, known) in cases {
        let f = bessel_k(n, value);
        assert!(
            numbers_are_somewhat_close(f, known),
            "Got: {f}, expected: {known} for kn({n}, {value})"
        );
    }
}
