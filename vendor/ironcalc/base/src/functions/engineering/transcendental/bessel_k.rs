// This are somewhat lower precision than the BesselJ and BesselY

use super::bessel_i::bessel_i0;
use super::bessel_i::bessel_i1;

fn bessel_k0(x: f64) -> f64 {
    let p1 = -0.57721566;
    let p2 = 0.42278420;
    let p3 = 0.23069756;
    let p4 = 3.488590e-2;
    let p5 = 2.62698e-3;
    let p6 = 1.0750e-4;
    let p7 = 7.4e-6;

    let q1 = 1.25331414;
    let q2 = -7.832358e-2;
    let q3 = 2.189568e-2;
    let q4 = -1.062446e-2;
    let q5 = 5.87872e-3;
    let q6 = -2.51540e-3;
    let q7 = 5.3208e-4;

    if x <= 0.0 {
        return 0.0;
    }

    if x <= 2.0 {
        let y = x * x / 4.0;
        (-(x / 2.0).ln() * bessel_i0(x))
            + (p1 + y * (p2 + y * (p3 + y * (p4 + y * (p5 + y * (p6 + y * p7))))))
    } else {
        let y = 2.0 / x;
        ((-x).exp() / x.sqrt())
            * (q1 + y * (q2 + y * (q3 + y * (q4 + y * (q5 + y * (q6 + y * q7))))))
    }
}

fn bessel_k1(x: f64) -> f64 {
    let p1 = 1.0;
    let p2 = 0.15443144;
    let p3 = -0.67278579;
    let p4 = -0.18156897;
    let p5 = -1.919402e-2;
    let p6 = -1.10404e-3;
    let p7 = -4.686e-5;

    let q1 = 1.25331414;
    let q2 = 0.23498619;
    let q3 = -3.655620e-2;
    let q4 = 1.504268e-2;
    let q5 = -7.80353e-3;
    let q6 = 3.25614e-3;
    let q7 = -6.8245e-4;

    if x <= 0.0 {
        return f64::NAN;
    }

    if x <= 2.0 {
        let y = x * x / 4.0;
        ((x / 2.0).ln() * bessel_i1(x))
            + (1. / x) * (p1 + y * (p2 + y * (p3 + y * (p4 + y * (p5 + y * (p6 + y * p7))))))
    } else {
        let y = 2.0 / x;
        ((-x).exp() / x.sqrt())
            * (q1 + y * (q2 + y * (q3 + y * (q4 + y * (q5 + y * (q6 + y * q7))))))
    }
}

pub(crate) fn bessel_k(n: i32, x: f64) -> f64 {
    if x <= 0.0 || n < 0 {
        return f64::NAN;
    }

    if n == 0 {
        return bessel_k0(x);
    }
    if n == 1 {
        return bessel_k1(x);
    }

    // Perform upward recurrence for all x
    let tox = 2.0 / x;
    let mut bkm = bessel_k0(x);
    let mut bk = bessel_k1(x);
    for j in 1..n {
        (bkm, bk) = (bk, bkm + (j as f64) * tox * bk);
    }
    bk
}
