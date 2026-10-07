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

/* __ieee754_j1(x), __ieee754_y1(x)
 * Bessel function of the first and second kinds of order zero.
 * Method -- j1(x):
 *	1. For tiny x, we use j1(x) = x/2 - x^3/16 + x^5/384 - ...
 *	2. Reduce x to |x| since j1(x)=-j1(-x),  and
 *	   for x in (0,2)
 *		j1(x) = x/2 + x*z*R0/S0,  where z = x*x;
 *	   (precision:  |j1/x - 1/2 - R0/S0 |<2**-61.51 )
 *	   for x in (2,inf)
 * 		j1(x) = sqrt(2/(pi*x))*(p1(x)*cos(x1)-q1(x)*sin(x1))
 * 		y1(x) = sqrt(2/(pi*x))*(p1(x)*sin(x1)+q1(x)*cos(x1))
 * 	   where x1 = x-3*pi/4. It is better to compute sin(x1),cos(x1)
 *	   as follow:
 *		cos(x1) =  cos(x)cos(3pi/4)+sin(x)sin(3pi/4)
 *			=  1/sqrt(2) * (sin(x) - cos(x))
 *		sin(x1) =  sin(x)cos(3pi/4)-cos(x)sin(3pi/4)
 *			= -1/sqrt(2) * (sin(x) + cos(x))
 * 	   (To avoid cancellation, use
 *		sin(x) +- cos(x) = -cos(2x)/(sin(x) -+ cos(x))
 * 	    to compute the worse one.)
 *
 *	3 Special cases
 *		j1(nan)= nan
 *		j1(0) = 0
 *		j1(inf) = 0
 *
 * Method -- y1(x):
 *	1. screen out x<=0 cases: y1(0)=-inf, y1(x<0)=NaN
 *	2. For x<2.
 *	   Since
 *		y1(x) = 2/pi*(j1(x)*(ln(x/2)+Euler)-1/x-x/2+5/64*x^3-...)
 *	   therefore y1(x)-2/pi*j1(x)*ln(x)-1/x is an odd function.
 *	   We use the following function to approximate y1,
 *		y1(x) = x*U(z)/V(z) + (2/pi)*(j1(x)*ln(x)-1/x), z= x^2
 *	   where for x in [0,2] (abs err less than 2**-65.89)
 *		U(z) = U0[0] + U0[1]*z + ... + U0[4]*z^4
 *		V(z) = 1  + v0[0]*z + ... + v0[4]*z^5
 *	   Note: For tiny x, 1/x dominate y1 and hence
 *		y1(tiny) = -2/pi/tiny, (choose tiny<2**-54)
 *	3. For x>=2.
 * 		y1(x) = sqrt(2/(pi*x))*(p1(x)*sin(x1)+q1(x)*cos(x1))
 * 	   where x1 = x-3*pi/4. It is better to compute sin(x1),cos(x1)
 *	   by method mentioned above.
 */

use std::f64::consts::FRAC_2_PI;

use super::bessel_util::{high_word, split_words, FRAC_2_SQRT_PI, HUGE};

// R0/S0 on [0,2]
const R00: f64 = -6.25e-2; // 0xBFB00000, 0x00000000
const R01: f64 = 1.407_056_669_551_897e-3; // 0x3F570D9F, 0x98472C61
const R02: f64 = -1.599_556_310_840_356e-5; // 0xBEF0C5C6, 0xBA169668
const R03: f64 = 4.967_279_996_095_844_5e-8; // 0x3E6AAAFA, 0x46CA0BD9
const S01: f64 = 1.915_375_995_383_634_6e-2; // 0x3F939D0B, 0x12637E53
const S02: f64 = 1.859_467_855_886_309_2e-4; // 0x3F285F56, 0xB9CDF664
const S03: f64 = 1.177_184_640_426_236_8e-6; // 0x3EB3BFF8, 0x333F8498
const S04: f64 = 5.046_362_570_762_170_4e-9; // 0x3E35AC88, 0xC97DFF2C
const S05: f64 = 1.235_422_744_261_379_1e-11; // 0x3DAB2ACF, 0xCFB97ED8

pub(crate) fn j1(x: f64) -> f64 {
    let hx = high_word(x);
    let ix = hx & 0x7fffffff;
    if ix >= 0x7ff00000 {
        return 1.0 / x;
    }
    let y = x.abs();
    if ix >= 0x40000000 {
        /* |x| >= 2.0 */
        let s = y.sin();
        let c = y.cos();
        let mut ss = -s - c;
        let mut cc = s - c;
        if ix < 0x7fe00000 {
            /* make sure y+y not overflow */
            let z = (y + y).cos();
            if s * c > 0.0 {
                cc = z / ss;
            } else {
                ss = z / cc;
            }
        }

        // j1(x) = 1/sqrt(pi) * (P(1,x)*cc - Q(1,x)*ss) / sqrt(x)
        // y1(x) = 1/sqrt(pi) * (P(1,x)*ss + Q(1,x)*cc) / sqrt(x)

        let z = if ix > 0x48000000 {
            FRAC_2_SQRT_PI * cc / y.sqrt()
        } else {
            let u = pone(y);
            let v = qone(y);
            FRAC_2_SQRT_PI * (u * cc - v * ss) / y.sqrt()
        };
        if hx < 0 {
            return -z;
        } else {
            return z;
        }
    }
    if ix < 0x3e400000 {
        /* |x|<2**-27 */
        if HUGE + x > 1.0 {
            return 0.5 * x; /* inexact if x!=0 necessary */
        }
    }
    let z = x * x;
    let mut r = z * (R00 + z * (R01 + z * (R02 + z * R03)));
    let s = 1.0 + z * (S01 + z * (S02 + z * (S03 + z * (S04 + z * S05))));
    r *= x;
    x * 0.5 + r / s
}

const U0: [f64; 5] = [
    -1.960_570_906_462_389_4e-1, /* 0xBFC91866, 0x143CBC8A */
    5.044_387_166_398_113e-2,    /* 0x3FA9D3C7, 0x76292CD1 */
    -1.912_568_958_757_635_5e-3, /* 0xBF5F55E5, 0x4844F50F */
    2.352_526_005_616_105e-5,    /* 0x3EF8AB03, 0x8FA6B88E */
    -9.190_991_580_398_789e-8,   /* 0xBE78AC00, 0x569105B8 */
];
const V0: [f64; 5] = [
    1.991_673_182_366_499e-2,    /* 0x3F94650D, 0x3F4DA9F0 */
    2.025_525_810_251_351_7e-4,  /* 0x3F2A8C89, 0x6C257764 */
    1.356_088_010_975_162_3e-6,  /* 0x3EB6C05A, 0x894E8CA6 */
    6.227_414_523_646_215e-9,    /* 0x3E3ABF1D, 0x5BA69A86 */
    1.665_592_462_079_920_8e-11, /* 0x3DB25039, 0xDACA772A */
];

pub(crate) fn y1(x: f64) -> f64 {
    let (lx, hx) = split_words(x);
    let ix = 0x7fffffff & hx;
    // if Y1(NaN) is NaN, Y1(-inf) is NaN, Y1(inf) is 0
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
        let s = x.sin();
        let c = x.cos();
        let mut ss = -s - c;
        let mut cc = s - c;
        if ix < 0x7fe00000 {
            // make sure x+x not overflow
            let z = (x + x).cos();
            if s * c > 0.0 {
                cc = z / ss;
            } else {
                ss = z / cc;
            }
        }
        /* y1(x) = sqrt(2/(pi*x))*(p1(x)*sin(x0)+q1(x)*cos(x0))
         * where x0 = x-3pi/4
         *      Better formula:
         *              cos(x0) = cos(x)cos(3pi/4)+sin(x)sin(3pi/4)
         *                      =  1/sqrt(2) * (sin(x) - cos(x))
         *              sin(x0) = sin(x)cos(3pi/4)-cos(x)sin(3pi/4)
         *                      = -1/sqrt(2) * (cos(x) + sin(x))
         * To avoid cancellation, use
         *              sin(x) +- cos(x) = -cos(2x)/(sin(x) -+ cos(x))
         * to compute the worse one.
         */
        return if ix > 0x48000000 {
            FRAC_2_SQRT_PI * ss / x.sqrt()
        } else {
            let u = pone(x);
            let v = qone(x);
            FRAC_2_SQRT_PI * (u * ss + v * cc) / x.sqrt()
        };
    }
    if ix <= 0x3c900000 {
        // x < 2^(-54)
        return -FRAC_2_PI / x;
    }
    let z = x * x;
    let u = U0[0] + z * (U0[1] + z * (U0[2] + z * (U0[3] + z * U0[4])));
    let v = 1.0 + z * (V0[0] + z * (V0[1] + z * (V0[2] + z * (V0[3] + z * V0[4]))));
    x * (u / v) + FRAC_2_PI * (j1(x) * x.ln() - 1.0 / x)
}

/* For x >= 8, the asymptotic expansions of pone is
 *	1 + 15/128 s^2 - 4725/2^15 s^4 - ...,	where s = 1/x.
 * We approximate pone by
 * 	pone(x) = 1 + (R/S)
 * where  R = pr0 + pr1*s^2 + pr2*s^4 + ... + pr5*s^10
 * 	  S = 1 + ps0*s^2 + ... + ps4*s^10
 * and
 *	| pone(x)-1-R/S | <= 2  ** ( -60.06)
 */

const PR8: [f64; 6] = [
    /* for x in [inf, 8]=1/[0,0.125] */
    0.00000000000000000000e+00, /* 0x00000000, 0x00000000 */
    1.171_874_999_999_886_5e-1, /* 0x3FBDFFFF, 0xFFFFFCCE */
    1.323_948_065_930_735_8e1,  /* 0x402A7A9D, 0x357F7FCE */
    4.120_518_543_073_785_6e2,  /* 0x4079C0D4, 0x652EA590 */
    3.874_745_389_139_605_3e3,  /* 0x40AE457D, 0xA3A532CC */
    7.914_479_540_318_917e3,    /* 0x40BEEA7A, 0xC32782DD */
];

const PS8: [f64; 5] = [
    1.142_073_703_756_784_1e2, /* 0x405C8D45, 0x8E656CAC */
    3.650_930_834_208_534_6e3, /* 0x40AC85DC, 0x964D274F */
    3.695_620_602_690_334_6e4, /* 0x40E20B86, 0x97C5BB7F */
    9.760_279_359_349_508e4,   /* 0x40F7D42C, 0xB28F17BB */
    3.080_427_206_278_888e4,   /* 0x40DE1511, 0x697A0B2D */
];

const PR5: [f64; 6] = [
    /* for x in [8,4.5454]=1/[0.125,0.22001] */
    1.319_905_195_562_435_2e-11, /* 0x3DAD0667, 0xDAE1CA7D */
    1.171_874_931_906_141e-1,    /* 0x3FBDFFFF, 0xE2C10043 */
    6.802_751_278_684_329,       /* 0x401B3604, 0x6E6315E3 */
    1.083_081_829_901_891_1e2,   /* 0x405B13B9, 0x452602ED */
    5.176_361_395_331_998e2,     /* 0x40802D16, 0xD052D649 */
    5.287_152_013_633_375e2,     /* 0x408085B8, 0xBB7E0CB7 */
];
const PS5: [f64; 5] = [
    5.928_059_872_211_313e1,   /* 0x404DA3EA, 0xA8AF633D */
    9.914_014_187_336_144e2,   /* 0x408EFB36, 0x1B066701 */
    5.353_266_952_914_88e3,    /* 0x40B4E944, 0x5706B6FB */
    7.844_690_317_495_512e3,   /* 0x40BEA4B0, 0xB8A5BB15 */
    1.504_046_888_103_610_6e3, /* 0x40978030, 0x036F5E51 */
];

const PR3: [f64; 6] = [
    3.025_039_161_373_736e-9,   /* 0x3E29FC21, 0xA7AD9EDD */
    1.171_868_655_672_535_9e-1, /* 0x3FBDFFF5, 0x5B21D17B */
    3.932_977_500_333_156_4,    /* 0x400F76BC, 0xE85EAD8A */
    3.511_940_355_916_369e1,    /* 0x40418F48, 0x9DA6D129 */
    9.105_501_107_507_813e1,    /* 0x4056C385, 0x4D2C1837 */
    4.855_906_851_973_649e1,    /* 0x4048478F, 0x8EA83EE5 */
];
const PS3: [f64; 5] = [
    3.479_130_950_012_515e1,   /* 0x40416549, 0xA134069C */
    3.367_624_587_478_257_5e2, /* 0x40750C33, 0x07F1A75F */
    1.046_871_399_757_751_3e3, /* 0x40905B7C, 0x5037D523 */
    8.908_113_463_982_564e2,   /* 0x408BD67D, 0xA32E31E9 */
    1.037_879_324_396_392_8e2, /* 0x4059F26D, 0x7C2EED53 */
];

const PR2: [f64; 6] = [
    /* for x in [2.8570,2]=1/[0.3499,0.5] */
    1.077_108_301_068_737_4e-7, /* 0x3E7CE9D4, 0xF65544F4 */
    1.171_762_194_626_833_5e-1, /* 0x3FBDFF42, 0xBE760D83 */
    2.368_514_966_676_088,      /* 0x4002F2B7, 0xF98FAEC0 */
    1.224_261_091_482_612_3e1,  /* 0x40287C37, 0x7F71A964 */
    1.769_397_112_716_877_3e1,  /* 0x4031B1A8, 0x177F8EE2 */
    5.073_523_125_888_185,      /* 0x40144B49, 0xA574C1FE */
];
const PS2: [f64; 5] = [
    2.143_648_593_638_214e1,   /* 0x40356FBD, 0x8AD5ECDC */
    1.252_902_271_684_027_5e2, /* 0x405F5293, 0x14F92CD5 */
    2.322_764_690_571_628e2,   /* 0x406D08D8, 0xD5A2DBD9 */
    1.176_793_732_871_471e2,   /* 0x405D6B7A, 0xDA1884A9 */
    8.364_638_933_716_183,     /* 0x4020BAB1, 0xF44E5192 */
];

/* Note: This function is only called for ix>=0x40000000 (see above) */
fn pone(x: f64) -> f64 {
    let ix = high_word(x) & 0x7fffffff;
    // ix>=0x40000000 && ix<=0x48000000)
    let (p, q) = if ix >= 0x40200000 {
        (PR8, PS8)
    } else if ix >= 0x40122E8B {
        (PR5, PS5)
    } else if ix >= 0x4006DB6D {
        (PR3, PS3)
    } else {
        (PR2, PS2)
    };
    let z = 1.0 / (x * x);
    let r = p[0] + z * (p[1] + z * (p[2] + z * (p[3] + z * (p[4] + z * p[5]))));
    let s = 1.0 + z * (q[0] + z * (q[1] + z * (q[2] + z * (q[3] + z * q[4]))));
    1.0 + r / s
}

/* For x >= 8, the asymptotic expansions of qone is
 *	3/8 s - 105/1024 s^3 - ..., where s = 1/x.
 * We approximate pone by
 * 	qone(x) = s*(0.375 + (R/S))
 * where  R = qr1*s^2 + qr2*s^4 + ... + qr5*s^10
 * 	  S = 1 + qs1*s^2 + ... + qs6*s^12
 * and
 *	| qone(x)/s -0.375-R/S | <= 2  ** ( -61.13)
 */

const QR8: [f64; 6] = [
    /* for x in [inf, 8]=1/[0,0.125] */
    0.00000000000000000000e+00,  /* 0x00000000, 0x00000000 */
    -1.025_390_624_999_927_1e-1, /* 0xBFBA3FFF, 0xFFFFFDF3 */
    -1.627_175_345_445_9e1,      /* 0xC0304591, 0xA26779F7 */
    -7.596_017_225_139_501e2,    /* 0xC087BCD0, 0x53E4B576 */
    -1.184_980_667_024_295_9e4,  /* 0xC0C724E7, 0x40F87415 */
    -4.843_851_242_857_503_5e4,  /* 0xC0E7A6D0, 0x65D09C6A */
];
const QS8: [f64; 6] = [
    1.613_953_697_007_229e2,    /* 0x40642CA6, 0xDE5BCDE5 */
    7.825_385_999_233_485e3,    /* 0x40BE9162, 0xD0D88419 */
    1.338_753_362_872_495_8e5,  /* 0x4100579A, 0xB0B75E98 */
    7.196_577_236_832_409e5,    /* 0x4125F653, 0x72869C19 */
    6.666_012_326_177_764e5,    /* 0x412457D2, 0x7719AD5C */
    -2.944_902_643_038_346_4e5, /* 0xC111F969, 0x0EA5AA18 */
];

const QR5: [f64; 6] = [
    /* for x in [8,4.5454]=1/[0.125,0.22001] */
    -2.089_799_311_417_641e-11,  /* 0xBDB6FA43, 0x1AA1A098 */
    -1.025_390_502_413_754_3e-1, /* 0xBFBA3FFF, 0xCB597FEF */
    -8.056_448_281_239_36,       /* 0xC0201CE6, 0xCA03AD4B */
    -1.836_696_074_748_883_8e2,  /* 0xC066F56D, 0x6CA7B9B0 */
    -1.373_193_760_655_081_6e3,  /* 0xC09574C6, 0x6931734F */
    -2.612_444_404_532_156_6e3,  /* 0xC0A468E3, 0x88FDA79D */
];
const QS5: [f64; 6] = [
    8.127_655_013_843_358e1,   /* 0x405451B2, 0xFF5A11B2 */
    1.991_798_734_604_859_6e3, /* 0x409F1F31, 0xE77BF839 */
    1.746_848_519_249_089e4,   /* 0x40D10F1F, 0x0D64CE29 */
    4.985_142_709_103_523e4,   /* 0x40E8576D, 0xAABAD197 */
    2.794_807_516_389_181_2e4, /* 0x40DB4B04, 0xCF7C364B */
    -4.719_183_547_951_285e3,  /* 0xC0B26F2E, 0xFCFFA004 */
];

const QR3: [f64; 6] = [
    -5.078_312_264_617_666e-9,   /* 0xBE35CFA9, 0xD38FC84F */
    -1.025_378_298_208_370_9e-1, /* 0xBFBA3FEB, 0x51AEED54 */
    -4.610_115_811_394_734,      /* 0xC01270C2, 0x3302D9FF */
    -5.784_722_165_627_836_4e1,  /* 0xC04CEC71, 0xC25D16DA */
    -2.282_445_407_376_317e2,    /* 0xC06C87D3, 0x4718D55F */
    -2.192_101_284_789_093_3e2,  /* 0xC06B66B9, 0x5F5C1BF6 */
];
const QS3: [f64; 6] = [
    4.766_515_503_237_295e1,    /* 0x4047D523, 0xCCD367E4 */
    6.738_651_126_766_997e2,    /* 0x40850EEB, 0xC031EE3E */
    3.380_152_866_795_263_4e3,  /* 0x40AA684E, 0x448E7C9A */
    5.547_729_097_207_228e3,    /* 0x40B5ABBA, 0xA61D54A6 */
    1.903_119_193_388_108e3,    /* 0x409DBC7A, 0x0DD4DF4B */
    -1.352_011_914_443_073_4e2, /* 0xC060E670, 0x290A311F */
];

const QR2: [f64; 6] = [
    /* for x in [2.8570,2]=1/[0.3499,0.5] */
    -1.783_817_275_109_588_7e-7, /* 0xBE87F126, 0x44C626D2 */
    -1.025_170_426_079_855_5e-1, /* 0xBFBA3E8E, 0x9148B010 */
    -2.752_205_682_781_874_6,    /* 0xC0060484, 0x69BB4EDA */
    -1.966_361_626_437_037_2e1,  /* 0xC033A9E2, 0xC168907F */
    -4.232_531_333_728_305e1,    /* 0xC04529A3, 0xDE104AAA */
    -2.137_192_117_037_040_6e1,  /* 0xC0355F36, 0x39CF6E52 */
];
const QS2: [f64; 6] = [
    2.953_336_290_605_238_5e1, /* 0x403D888A, 0x78AE64FF */
    2.529_815_499_821_905_3e2, /* 0x406F9F68, 0xDB821CBA */
    7.575_028_348_686_454e2,   /* 0x4087AC05, 0xCE49A0F7 */
    7.393_932_053_204_672e2,   /* 0x40871B25, 0x48D4C029 */
    1.559_490_033_366_661_2e2, /* 0x40637E5E, 0x3C3ED8D4 */
    -4.959_498_988_226_282,    /* 0xC013D686, 0xE71BE86B */
];

// Note: This function is only called for ix>=0x40000000 (see above)
fn qone(x: f64) -> f64 {
    let ix = high_word(x) & 0x7fffffff;
    // ix>=0x40000000 && ix<=0x48000000
    let (p, q) = if ix >= 0x40200000 {
        (QR8, QS8)
    } else if ix >= 0x40122E8B {
        (QR5, QS5)
    } else if ix >= 0x4006DB6D {
        (QR3, QS3)
    } else {
        (QR2, QS2)
    };
    let z = 1.0 / (x * x);
    let r = p[0] + z * (p[1] + z * (p[2] + z * (p[3] + z * (p[4] + z * p[5]))));
    let s = 1.0 + z * (q[0] + z * (q[1] + z * (q[2] + z * (q[3] + z * (q[4] + z * q[5])))));
    (0.375 + r / s) / x
}
