// This are somewhat lower precision than the BesselJ and BesselY

// needed for BesselK
pub(crate) fn bessel_i0(x: f64) -> f64 {
    // Parameters of the polynomial approximation
    let p1 = 1.0;
    let p2 = 3.5156229;
    let p3 = 3.0899424;
    let p4 = 1.2067492;
    let p5 = 0.2659732;
    let p6 = 3.60768e-2;
    let p7 = 4.5813e-3;

    let q1 = 0.39894228;
    let q2 = 1.328592e-2;
    let q3 = 2.25319e-3;
    let q4 = -1.57565e-3;
    let q5 = 9.16281e-3;
    let q6 = -2.057706e-2;
    let q7 = 2.635537e-2;
    let q8 = -1.647633e-2;
    let q9 = 3.92377e-3;

    let k1 = 3.75;
    let ax = x.abs();

    if x.is_infinite() {
        return 0.0;
    }

    if ax < k1 {
        // let xx = x / k1;
        // let y = xx * xx;
        // let mut result = 1.0;
        // let max_iter = 50;
        // let mut term = 1.0;
        // for i in 1..max_iter {
        //     term = term * k1*k1*y /(2.0*i as f64).powi(2);
        //     result += term;
        // };
        // result

        let xx = x / k1;
        let y = xx * xx;
        p1 + y * (p2 + y * (p3 + y * (p4 + y * (p5 + y * (p6 + y * p7)))))
    } else {
        let y = k1 / ax;
        ((ax).exp() / (ax).sqrt())
            * (q1
                + y * (q2
                    + y * (q3 + y * (q4 + y * (q5 + y * (q6 + y * (q7 + y * (q8 + y * q9))))))))
    }
}

// needed for BesselK
pub(crate) fn bessel_i1(x: f64) -> f64 {
    let p1 = 0.5;
    let p2 = 0.87890594;
    let p3 = 0.51498869;
    let p4 = 0.15084934;
    let p5 = 2.658733e-2;
    let p6 = 3.01532e-3;
    let p7 = 3.2411e-4;

    let q1 = 0.39894228;
    let q2 = -3.988024e-2;
    let q3 = -3.62018e-3;
    let q4 = 1.63801e-3;
    let q5 = -1.031555e-2;
    let q6 = 2.282967e-2;
    let q7 = -2.895312e-2;
    let q8 = 1.787654e-2;
    let q9 = -4.20059e-3;

    let k1 = 3.75;
    let ax = x.abs();

    if ax < k1 {
        let xx = x / k1;
        let y = xx * xx;
        x * (p1 + y * (p2 + y * (p3 + y * (p4 + y * (p5 + y * (p6 + y * p7))))))
    } else {
        let y = k1 / ax;
        let result = ((ax).exp() / (ax).sqrt())
            * (q1
                + y * (q2
                    + y * (q3 + y * (q4 + y * (q5 + y * (q6 + y * (q7 + y * (q8 + y * q9))))))));
        if x < 0.0 {
            return -result;
        }
        result
    }
}

pub(crate) fn bessel_i(n: i32, x: f64) -> f64 {
    let accuracy = 40;
    let large_number = 1e10;
    let small_number = 1e-10;

    if n < 0 {
        return f64::NAN;
    }

    if n == 0 {
        return bessel_i0(x);
    }
    if x == 0.0 {
        // I_n(0) = 0 for all n!= 0
        return 0.0;
    }
    if n == 1 {
        return bessel_i1(x);
    }

    if x.abs() > large_number {
        return 0.0;
    };

    let tox = 2.0 / x.abs();
    let mut bip = 0.0;
    let mut bi = 1.0;
    let mut result = 0.0;
    let m = 2 * (((accuracy * n) as f64).sqrt().trunc() as i32 + n);

    for j in (1..=m).rev() {
        (bip, bi) = (bi, bip + (j as f64) * tox * bi);
        // Prevent overflow
        if bi.abs() > large_number {
            result *= small_number;
            bi *= small_number;
            bip *= small_number;
        }
        if j == n {
            result = bip;
        }
    }

    result *= bessel_i0(x) / bi;
    if (x < 0.0) && (n % 2 == 1) {
        result = -result;
    }

    result
}
