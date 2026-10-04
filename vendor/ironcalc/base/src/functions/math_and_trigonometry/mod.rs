mod arabic_roman;
pub(crate) mod array_size;
mod gcd_lcm;
mod mathematical;
mod matrix;
mod mmult;
mod multinomial;
mod random;
// MACRO
#[cfg(target_arch = "wasm32")]
pub use random::set_random_seed;
mod sequence;
mod seriessum;
mod sum;
mod sumproduct;
