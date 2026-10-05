//! Color spaces: device gray, RGB, and CMYK, calibrated spaces, Lab,
//! ICC-based (by component count, or its alternate), indexed, separations
//! and DeviceN (through their tint transforms), and patterns; converted to
//! straight sRGB.

use crate::error::Result;
use crate::function::Function;
use crate::pdf::{Dict, Object, Resolve};

/// A color space.
#[derive(Clone, Debug, PartialEq)]
pub enum ColorSpace {
    /// `DeviceGray`.
    Gray,
    /// `DeviceRGB`.
    Rgb,
    /// `DeviceCMYK`.
    Cmyk,
    /// `CalGray`, drawn as gray with its gamma.
    CalGray {
        /// Gamma.
        gamma: f32,
    },
    /// `CalRGB`, drawn as RGB with its gammas.
    CalRgb {
        /// Gamma per component.
        gamma: [f32; 3],
    },
    /// `Lab`.
    Lab {
        /// White point.
        white: [f32; 3],
        /// `a` and `b` ranges.
        range: [f32; 4],
    },
    /// `ICCBased`: drawn by component count (gray, RGB, CMYK) or its
    /// alternate.
    Icc {
        /// Components.
        n: usize,
        /// The alternate space.
        alternate: Box<ColorSpace>,
    },
    /// `Indexed`.
    Indexed {
        /// The base space.
        base: Box<ColorSpace>,
        /// The highest index.
        hival: u32,
        /// The lookup table (`(hival + 1) × base components` bytes).
        lookup: Vec<u8>,
    },
    /// `Separation`.
    Separation {
        /// The colorant (`All`, `None`, or an ink).
        name: String,
        /// The alternate space.
        alternate: Box<ColorSpace>,
        /// Tint to alternate components.
        tint: Function,
    },
    /// `DeviceN`.
    DeviceN {
        /// Colorants.
        names: Vec<String>,
        /// The alternate space.
        alternate: Box<ColorSpace>,
        /// Tints to alternate components.
        tint: Function,
    },
    /// `Pattern`, with the space of an uncolored pattern's color.
    Pattern(Option<Box<ColorSpace>>),
}

impl ColorSpace {
    /// Reads a color space: a name (device spaces, or a key of the
    /// resources' `ColorSpace` dictionary) or an array.
    pub fn parse(pdf: &dyn Resolve, value: &Object, resources: &Dict) -> Result<ColorSpace> {
        let _ = (pdf, value, resources);
        todo!("ColorSpace::parse")
    }

    /// Components a color in this space has.
    pub fn components(&self) -> usize {
        todo!("ColorSpace::components")
    }

    /// The initial color (`0` in most spaces, `1` for separations).
    pub fn initial(&self) -> Vec<f32> {
        todo!("ColorSpace::initial")
    }

    /// A color's straight sRGB, `0..=1`.
    pub fn to_rgb(&self, components: &[f32]) -> [f32; 3] {
        let _ = components;
        todo!("ColorSpace::to_rgb")
    }
}
