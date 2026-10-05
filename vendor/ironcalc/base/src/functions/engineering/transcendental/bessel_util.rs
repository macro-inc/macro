pub(crate) const HUGE: f64 = 1e300;
pub(crate) const FRAC_2_SQRT_PI: f64 = 5.641_895_835_477_563e-1;

pub(crate) fn high_word(x: f64) -> i32 {
    let [_, _, _, _, a1, a2, a3, a4] = x.to_ne_bytes();
    // let binding = x.to_ne_bytes();
    // let high = <&[u8; 4]>::try_from(&binding[4..8]).expect("");
    i32::from_ne_bytes([a1, a2, a3, a4])
}

pub(crate) fn split_words(x: f64) -> (i32, i32) {
    let [a1, a2, a3, a4, b1, b2, b3, b4] = x.to_ne_bytes();
    // let binding = x.to_ne_bytes();
    // let high = <&[u8; 4]>::try_from(&binding[4..8]).expect("");
    (
        i32::from_ne_bytes([a1, a2, a3, a4]),
        i32::from_ne_bytes([b1, b2, b3, b4]),
    )
}
