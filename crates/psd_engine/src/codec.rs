//! Codecs for the tagged blocks the engine models: action descriptors and
//! the text engine's data, then each kind of layer content built on them.
//!
//! Each decoder turns a block's data into the model's typed values; each
//! encoder writes the model back, starting from the original block when
//! there is one so fields the model does not cover survive.

pub mod adjustment;
pub mod descriptor;
pub mod effects;
pub mod engine_data;
pub mod fill;
pub mod pattern;
pub mod smart;
pub mod text;
pub mod vector;
