/* @(#)e_j0.c 1.3 95/01/18 */
/*
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 */

/* j0(x), y0(x)
 * Bessel function of the first and second kinds of order zero.
 * Method -- j0(x):
 *	1. For tiny x, we use j0(x) = 1 - x^2/4 + x^4/64 - ...
 *	2. Reduce x to |x| since j0(x)=j0(-x),  and
 *	   for x in (0,2)
 *		j0(x) = 1-z/4+ z^2*R0/S0,  where z = x*x;
 *	   (precision:  |j0-1+z/4-z^2R0/S0 |<2**-63.67 )
 *	   for x in (2,inf)
 * 		j0(x) = sqrt(2/(pi*x))*(p0(x)*cos(x0)-q0(x)*sin(x0))
 * 	   where x0 = x-pi/4. It is better to compute sin(x0),cos(x0)
 *	   as follow:
 *		cos(x0) = cos(x)cos(pi/4)+sin(x)sin(pi/4)
 *			= 1/sqrt(2) * (cos(x) + sin(x))
 *		sin(x0) = sin(x)cos(pi/4)-cos(x)sin(pi/4)
 *			= 1/sqrt(2) * (sin(x) - cos(x))
 * 	   (To avoid cancellation, use
 *		sin(x) +- cos(x) = -cos(2x)/(sin(x) -+ cos(x))
 * 	    to compute the worse 1.)
 *
 *	3 Special cases
 *		j0(nan)= nan
 *		j0(0) = 1
 *		j0(inf) = 0
 *
 * Method -- y0(x):
 *	1. For x<2.
 *	   Since
 *		y0(x) = 2/pi*(j0(x)*(ln(x/2)+Euler) + x^2/4 - ...)
 *	   therefore y0(x)-2/pi*j0(x)*ln(x) is an even function.
 *	   We use the following function to approximate y0,
 *		y0(x) = U(z)/V(z) + (2/pi)*(j0(x)*ln(x)), z= x^2
 *	   where
 *		U(z) = u00 + u01*z + ... + u06*z^6
 *		V(z) = 1  + v01*z + ... + v04*z^4
 *	   with absolute approximation error bounded by 2**-72.
 *	   Note: For tiny x, U/V = u0 and j0(x)~1, hence
 *		y0(tiny) = u0 + (2/pi)*ln(tiny), (choose tiny<2**-27)
 *	2. For x>=2.
 * 		y0(x) = sqrt(2/(pi*x))*(p0(x)*cos(x0)+q0(x)*sin(x0))
 * 	   where x0 = x-pi/4. It is better to compute sin(x0),cos(x0)
 *	   by the method menti1d above.
 *	3. Special cases: y0(0)=-inf, y0(x<0)=NaN, y0(inf)=0.
 */

use std::f64::consts::FRAC_2_PI;

use super::bessel_util::{high_word, split_words, FRAC_2_SQRT_PI, HUGE};

// R0/S0 on [0, 2.00]
const R02: f64 = 1.562_499_999_999_999_5e-2; // 0x3F8FFFFF, 0xFFFFFFFD
const R03: f64 = -1.899_792_942_388_547_2e-4; // 0xBF28E6A5, 0xB61AC6E9
const R04: f64 = 1.829_540_495_327_006_7e-6; // 0x3EBEB1D1, 0x0C503919
const R05: f64 = -4.618_326_885_321_032e-9; // 0xBE33D5E7, 0x73D63FCE
const S01: f64 = 1.561_910_294_648_900_1e-2; // 0x3F8FFCE8, 0x82C8C2A4
const S02: f64 = 1.169_267_846_633_374_5e-4; // 0x3F1EA6D2, 0xDD57DBF4
const S03: f64 = 5.135_465_502_073_181e-7; // 0x3EA13B54, 0xCE84D5A9
const S04: f64 = 1.166_140_033_337_9e-9; // 0x3E1408BC, 0xF4745D8F

/* The asymptotic expansions of pzero is
 *	1 - 9/128 s^2 + 11025/98304 s^4 - ...,	where s = 1/x.
 * For x >= 2, We approximate pzero by
 * 	pzero(x) = 1 + (R/S)
 * where  R = pR0 + pR1*s^2 + pR2*s^4 + ... + pR5*s^10
 * 	  S = 1 + pS0*s^2 + ... + pS4*s^10
 * and
 *	| pzero(x)-1-R/S | <= 2  ** ( -60.26)
 */
const P_R8: [f64; 6] = [
    /* for x in [inf, 8]=1/[0,0.125] */
    0.00000000000000000000e+00, /* 0x00000000, 0x00000000 */
    -7.031_249_999_999_004e-2,  /* 0xBFB1FFFF, 0xFFFFFD32 */
    -8.081_670_412_753_498,     /* 0xC02029D0, 0xB44FA779 */
    -2.570_631_056_797_048_5e2, /* 0xC0701102, 0x7B19E863 */
    -2.485_216_410_094_288e3,   /* 0xC0A36A6E, 0xCD4DCAFC */
    -5.253_043_804_907_295e3,   /* 0xC0B4850B, 0x36CC643D */
];
const P_S8: [f64; 5] = [
    1.165_343_646_196_681_8e2, /* 0x405D2233, 0x07A96751 */
    3.833_744_753_641_218_3e3, /* 0x40ADF37D, 0x50596938 */
    4.059_785_726_484_725_5e4, /* 0x40E3D2BB, 0x6EB6B05F */
    1.167_529_725_643_759_2e5, /* 0x40FC810F, 0x8F9FA9BD */
    4.762_772_841_467_309_6e4, /* 0x40E74177, 0x4F2C49DC */
];

const P_R5: [f64; 6] = [
    /* for x in [8,4.5454]=1/[0.125,0.22001] */
    -1.141_254_646_918_945e-11, /* 0xBDA918B1, 0x47E495CC */
    -7.031_249_408_735_993e-2,  /* 0xBFB1FFFF, 0xE69AFBC6 */
    -4.159_610_644_705_878,     /* 0xC010A370, 0xF90C6BBF */
    -6.767_476_522_651_673e1,   /* 0xC050EB2F, 0x5A7D1783 */
    -3.312_312_996_491_729_7e2, /* 0xC074B3B3, 0x6742CC63 */
    -3.464_333_883_656_049e2,   /* 0xC075A6EF, 0x28A38BD7 */
];
const P_S5: [f64; 5] = [
    6.075_393_826_923_003_4e1, /* 0x404E6081, 0x0C98C5DE */
    1.051_252_305_957_045_8e3, /* 0x40906D02, 0x5C7E2864 */
    5.978_970_943_338_558e3,   /* 0x40B75AF8, 0x8FBE1D60 */
    9.625_445_143_577_745e3,   /* 0x40C2CCB8, 0xFA76FA38 */
    2.406_058_159_229_391e3,   /* 0x40A2CC1D, 0xC70BE864 */
];

const P_R3: [f64; 6] = [
    /* for x in [4.547,2.8571]=1/[0.2199,0.35001] */
    -2.547_046_017_719_519e-9, /* 0xBE25E103, 0x6FE1AA86 */
    -7.031_196_163_814_817e-2, /* 0xBFB1FFF6, 0xF7C0E24B */
    -2.409_032_215_495_296,    /* 0xC00345B2, 0xAEA48074 */
    -2.196_597_747_348_831e1,  /* 0xC035F74A, 0x4CB94E14 */
    -5.807_917_047_017_376e1,  /* 0xC04D0A22, 0x420A1A45 */
    -3.144_794_705_948_885e1,  /* 0xC03F72AC, 0xA892D80F */
];
const P_S3: [f64; 5] = [
    3.585_603_380_552_097e1,   /* 0x4041ED92, 0x84077DD3 */
    3.615_139_830_503_038_6e2, /* 0x40769839, 0x464A7C0E */
    1.193_607_837_921_115_3e3, /* 0x4092A66E, 0x6D1061D6 */
    1.127_996_798_569_074_1e3, /* 0x40919FFC, 0xB8C39B7E */
    1.735_809_308_133_357_5e2, /* 0x4065B296, 0xFC379081 */
];

const P_R2: [f64; 6] = [
    /* for x in [2.8570,2]=1/[0.3499,0.5] */
    -8.875_343_330_325_264e-8,  /* 0xBE77D316, 0xE927026D */
    -7.030_309_954_836_247e-2,  /* 0xBFB1FF62, 0x495E1E42 */
    -1.450_738_467_809_529_9,   /* 0xBFF73639, 0x8A24A843 */
    -7.635_696_138_235_278,     /* 0xC01E8AF3, 0xEDAFA7F3 */
    -1.119_316_688_603_567_5e1, /* 0xC02662E6, 0xC5246303 */
    -3.233_645_793_513_353_4,   /* 0xC009DE81, 0xAF8FE70F */
];
const P_S2: [f64; 5] = [
    2.222_029_975_320_888e1,   /* 0x40363865, 0x908B5959 */
    1.362_067_942_182_152e2,   /* 0x4061069E, 0x0EE8878F */
    2.704_702_786_580_835e2,   /* 0x4070E786, 0x42EA079B */
    1.538_753_942_083_203_3e2, /* 0x40633C03, 0x3AB6FAFF */
    1.465_761_769_482_562e1,   /* 0x402D50B3, 0x44391809 */
];

// Note: This function is only called for ix>=0x40000000 (see above)
fn pzero(x: f64) -> f64 {
    let ix = high_word(x) & 0x7fffffff;
    // ix>=0x40000000 && ix<=0x48000000);
    let (p, q) = if ix >= 0x40200000 {
        (P_R8, P_S8)
    } else if ix >= 0x40122E8B {
        (P_R5, P_S5)
    } else if ix >= 0x4006DB6D {
        (P_R3, P_S3)
    } else {
        (P_R2, P_S2)
    };
    let z = 1.0 / (x * x);
    let r = p[0] + z * (p[1] + z * (p[2] + z * (p[3] + z * (p[4] + z * p[5]))));
    let s = 1.0 + z * (q[0] + z * (q[1] + z * (q[2] + z * (q[3] + z * q[4]))));
    1.0 + r / s
}

/* For x >= 8, the asymptotic expansions of qzero is
 *	-1/8 s + 75/1024 s^3 - ..., where s = 1/x.
 * We approximate pzero by
 * 	qzero(x) = s*(-1.25 + (R/S))
 * where  R = qR0 + qR1*s^2 + qR2*s^4 + ... + qR5*s^10
 * 	  S = 1 + qS0*s^2 + ... + qS5*s^12
 * and
 *	| qzero(x)/s +1.25-R/S | <= 2  ** ( -61.22)
 */
const Q_R8: [f64; 6] = [
    /* for x in [inf, 8]=1/[0,0.125] */
    0.00000000000000000000e+00, /* 0x00000000, 0x00000000 */
    7.324_218_749_999_35e-2,    /* 0x3FB2BFFF, 0xFFFFFE2C */
    1.176_820_646_822_527e1,    /* 0x40278952, 0x5BB334D6 */
    5.576_733_802_564_019e2,    /* 0x40816D63, 0x15301825 */
    8.859_197_207_564_686e3,    /* 0x40C14D99, 0x3E18F46D */
    3.701_462_677_768_878e4,    /* 0x40E212D4, 0x0E901566 */
];
const Q_S8: [f64; 6] = [
    1.637_760_268_956_898_2e2, /* 0x406478D5, 0x365B39BC */
    8.098_344_946_564_498e3,   /* 0x40BFA258, 0x4E6B0563 */
    1.425_382_914_191_204_8e5, /* 0x41016652, 0x54D38C3F */
    8.033_092_571_195_144e5,   /* 0x412883DA, 0x83A52B43 */
    8.405_015_798_190_605e5,   /* 0x4129A66B, 0x28DE0B3D */
    -3.438_992_935_378_666e5,  /* 0xC114FD6D, 0x2C9530C5 */
];

const Q_R5: [f64; 6] = [
    /* for x in [8,4.5454]=1/[0.125,0.22001] */
    1.840_859_635_945_155_3e-11, /* 0x3DB43D8F, 0x29CC8CD9 */
    7.324_217_666_126_848e-2,    /* 0x3FB2BFFF, 0xD172B04C */
    5.835_635_089_620_569_5,     /* 0x401757B0, 0xB9953DD3 */
    1.351_115_772_864_498_3e2,   /* 0x4060E392, 0x0A8788E9 */
    1.027_243_765_961_641e3,     /* 0x40900CF9, 0x9DC8C481 */
    1.989_977_858_646_053_8e3,   /* 0x409F17E9, 0x53C6E3A6 */
];
const Q_S5: [f64; 6] = [
    8.277_661_022_365_378e1,  /* 0x4054B1B3, 0xFB5E1543 */
    2.077_814_164_213_93e3,   /* 0x40A03BA0, 0xDA21C0CE */
    1.884_728_877_857_181e4,  /* 0x40D267D2, 0x7B591E6D */
    5.675_111_228_949_473e4,  /* 0x40EBB5E3, 0x97E02372 */
    3.597_675_384_251_145e4,  /* 0x40E19118, 0x1F7A54A0 */
    -5.354_342_756_019_448e3, /* 0xC0B4EA57, 0xBEDBC609 */
];

const Q_R3: [f64; 6] = [
    /* for x in [4.547,2.8571]=1/[0.2199,0.35001] */
    4.377_410_140_897_386e-9,  /* 0x3E32CD03, 0x6ADECB82 */
    7.324_111_800_429_114e-2,  /* 0x3FB2BFEE, 0x0E8D0842 */
    3.344_231_375_161_707,     /* 0x400AC0FC, 0x61149CF5 */
    4.262_184_407_454_126_5e1, /* 0x40454F98, 0x962DAEDD */
    1.708_080_913_405_656e2,   /* 0x406559DB, 0xE25EFD1F */
    1.667_339_486_966_511_7e2, /* 0x4064D77C, 0x81FA21E0 */
];
const Q_S3: [f64; 6] = [
    4.875_887_297_245_872e1,   /* 0x40486122, 0xBFE343A6 */
    7.096_892_210_566_06e2,    /* 0x40862D83, 0x86544EB3 */
    3.704_148_226_201_113_6e3, /* 0x40ACF04B, 0xE44DFC63 */
    6.460_425_167_525_689e3,   /* 0x40B93C6C, 0xD7C76A28 */
    2.516_333_689_203_689_6e3, /* 0x40A3A8AA, 0xD94FB1C0 */
    -1.492_474_518_361_564e2,  /* 0xC062A7EB, 0x201CF40F */
];

const Q_R2: [f64; 6] = [
    /* for x in [2.8570,2]=1/[0.3499,0.5] */
    1.504_444_448_869_832_7e-7, /* 0x3E84313B, 0x54F76BDB */
    7.322_342_659_630_793e-2,   /* 0x3FB2BEC5, 0x3E883E34 */
    1.998_191_740_938_16,       /* 0x3FFFF897, 0xE727779C */
    1.449_560_293_478_857_4e1,  /* 0x402CFDBF, 0xAAF96FE5 */
    3.166_623_175_047_815_4e1,  /* 0x403FAA8E, 0x29FBDC4A */
    1.625_270_757_109_292_7e1,  /* 0x403040B1, 0x71814BB4 */
];
const Q_S2: [f64; 6] = [
    3.036_558_483_552_192e1,   /* 0x403E5D96, 0xF7C07AED */
    2.693_481_186_080_498_4e2, /* 0x4070D591, 0xE4D14B40 */
    8.447_837_575_953_201e2,   /* 0x408A6645, 0x22B3BF22 */
    8.829_358_451_124_886e2,   /* 0x408B977C, 0x9C5CC214 */
    2.126_663_885_117_988_3e2, /* 0x406A9553, 0x0E001365 */
    -5.310_954_938_826_669_5,  /* 0xC0153E6A, 0xF8B32931 */
];

fn qzero(x: f64) -> f64 {
    let ix = high_word(x) & 0x7fffffff;
    let (p, q) = if ix >= 0x40200000 {
        (Q_R8, Q_S8)
    } else if ix >= 0x40122E8B {
        (Q_R5, Q_S5)
    } else if ix >= 0x4006DB6D {
        (Q_R3, Q_S3)
    } else {
        (Q_R2, Q_S2)
    };
    let z = 1.0 / (x * x);
    let r = p[0] + z * (p[1] + z * (p[2] + z * (p[3] + z * (p[4] + z * p[5]))));
    let s = 1.0 + z * (q[0] + z * (q[1] + z * (q[2] + z * (q[3] + z * (q[4] + z * q[5])))));
    (-0.125 + r / s) / x
}

const U00: f64 = -7.380_429_510_868_723e-2; /* 0xBFB2E4D6, 0x99CBD01F */
const U01: f64 = 1.766_664_525_091_811_2e-1; /* 0x3FC69D01, 0x9DE9E3FC */
const U02: f64 = -1.381_856_719_455_969e-2; /* 0xBF8C4CE8, 0xB16CFA97 */
const U03: f64 = 3.474_534_320_936_836_5e-4; /* 0x3F36C54D, 0x20B29B6B */
const U04: f64 = -3.814_070_537_243_641_6e-6; /* 0xBECFFEA7, 0x73D25CAD */
const U05: f64 = 1.955_901_370_350_229_2e-8; /* 0x3E550057, 0x3B4EABD4 */
const U06: f64 = -3.982_051_941_321_034e-11; /* 0xBDC5E43D, 0x693FB3C8 */
const V01: f64 = 1.273_048_348_341_237e-2; /* 0x3F8A1270, 0x91C9C71A */
const V02: f64 = 7.600_686_273_503_533e-5; /* 0x3F13ECBB, 0xF578C6C1 */
const V03: f64 = 2.591_508_518_404_578e-7; /* 0x3E91642D, 0x7FF202FD */
const V04: f64 = 4.411_103_113_326_754_7e-10; /* 0x3DFE5018, 0x3BD6D9EF */

pub(crate) fn y0(x: f64) -> f64 {
    let (lx, hx) = split_words(x);
    let ix = 0x7fffffff & hx;

    // Y0(NaN) is NaN, y0(-inf) is Nan, y0(inf) is 0
    if ix >= 0x7ff00000 {
        return 1.0 / (x + x * x);
    }
    if (ix | lx) == 0 {
        return f64::NEG_INFINITY;
    }
    if hx < 0 {
        return f64::NAN;
    }

    if ix >= 0x40000000 {
        // |x| >= 2.0
        // y0(x) = sqrt(2/(pi*x))*(p0(x)*sin(x0)+q0(x)*cos(x0))
        // where x0 = x-pi/4
        //      Better formula:
        //              cos(x0) = cos(x)cos(pi/4)+sin(x)sin(pi/4)
        //                      =  1/sqrt(2) * (sin(x) + cos(x))
        //              sin(x0) = sin(x)cos(3pi/4)-cos(x)sin(3pi/4)
        //                      =  1/sqrt(2) * (sin(x) - cos(x))
        // To avoid cancellation, use
        //              sin(x) +- cos(x) = -cos(2x)/(sin(x) -+ cos(x))
        // to compute the worse 1.

        let s = x.sin();
        let c = x.cos();
        let mut ss = s - c;
        let mut cc = s + c;

        // j0(x) = 1/sqrt(pi) * (P(0,x)*cc - Q(0,x)*ss) / sqrt(x)
        // y0(x) = 1/sqrt(pi) * (P(0,x)*ss + Q(0,x)*cc) / sqrt(x)

        if ix < 0x7fe00000 {
            // make sure x+x not overflow
            let z = -(x + x).cos();
            if (s * c) < 0.0 {
                cc = z / ss;
            } else {
                ss = z / cc;
            }
        }
        return if ix > 0x48000000 {
            FRAC_2_SQRT_PI * ss / x.sqrt()
        } else {
            let u = pzero(x);
            let v = qzero(x);
            FRAC_2_SQRT_PI * (u * ss + v * cc) / x.sqrt()
        };
    }

    if ix <= 0x3e400000 {
        // x < 2^(-27)
        return U00 + FRAC_2_PI * x.ln();
    }
    let z = x * x;
    let u = U00 + z * (U01 + z * (U02 + z * (U03 + z * (U04 + z * (U05 + z * U06)))));
    let v = 1.0 + z * (V01 + z * (V02 + z * (V03 + z * V04)));
    u / v + FRAC_2_PI * (j0(x) * x.ln())
}

pub(crate) fn j0(x: f64) -> f64 {
    let hx = high_word(x);
    let ix = hx & 0x7fffffff;
    if x.is_nan() {
        return x;
    } else if x.is_infinite() {
        return 0.0;
    }
    // the function is even
    let x = x.abs();
    if ix >= 0x40000000 {
        // |x| >= 2.0
        // let (s, c) = x.sin_cos()
        let s = x.sin();
        let c = x.cos();
        let mut ss = s - c;
        let mut cc = s + c;
        // makes sure that x+x does not overflow
        if ix < 0x7fe00000 {
            // |x| < f64::MAX / 2.0
            let z = -(x + x).cos();
            if s * c < 0.0 {
                cc = z / ss;
            } else {
                ss = z / cc;
            }
        }

        //   j0(x) = 1/sqrt(pi) * (P(0,x)*cc - Q(0,x)*ss) / sqrt(x)
        //   y0(x) = 1/sqrt(pi) * (P(0,x)*ss + Q(0,x)*cc) / sqrt(x)
        return if ix > 0x48000000 {
            // x < 5.253807105661922e-287 (2^(-951))
            FRAC_2_SQRT_PI * cc / (x.sqrt())
        } else {
            let u = pzero(x);
            let v = qzero(x);
            FRAC_2_SQRT_PI * (u * cc - v * ss) / x.sqrt()
        };
    };
    if ix < 0x3f200000 {
        // |x| < 2^(-13)
        if HUGE + x > 1.0 {
            // raise inexact if x != 0
            if ix < 0x3e400000 {
                return 1.0; // |x|<2^(-27)
            } else {
                return 1.0 - 0.25 * x * x;
            }
        }
    }
    let z = x * x;
    let r = z * (R02 + z * (R03 + z * (R04 + z * R05)));
    let s = 1.0 + z * (S01 + z * (S02 + z * (S03 + z * S04)));
    if ix < 0x3FF00000 {
        // |x| < 1.00
        1.0 + z * (-0.25 + (r / s))
    } else {
        let u = 0.5 * x;
        (1.0 + u) * (1.0 - u) + z * (r / s)
    }
}
