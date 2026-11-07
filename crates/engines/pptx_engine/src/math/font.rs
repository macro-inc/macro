//! The math font: OpenType `MATH` constants, italic corrections, accent
//! attachment points, and the size variants and assemblies of stretchy
//! glyphs, all in ems.

use crate::font::{FaceId, FontDb};
use skrifa::GlyphId;
use skrifa::raw::tables::math::{Math, MathConstant, StretchAxis};
use skrifa::raw::{FontRef, TableProvider};

/// The bundled math font (STIX Two Math), typeset in place of Cambria Math.
pub const MATH_FAMILY: &str = "STIX Two Math";

/// Layout constants in ems. Values without a font are STIX Two Math's.
#[derive(Clone, Copy, Debug)]
pub struct Constants {
    pub script_scale: f32,
    pub script_script_scale: f32,
    pub delimited_sub_formula_min_height: f32,
    pub display_operator_min_height: f32,
    pub axis_height: f32,
    pub accent_base_height: f32,
    pub subscript_shift_down: f32,
    pub subscript_top_max: f32,
    pub subscript_baseline_drop_min: f32,
    pub superscript_shift_up: f32,
    pub superscript_shift_up_cramped: f32,
    pub superscript_bottom_min: f32,
    pub superscript_baseline_drop_max: f32,
    pub sub_superscript_gap_min: f32,
    pub superscript_bottom_max_with_subscript: f32,
    pub space_after_script: f32,
    pub upper_limit_gap_min: f32,
    pub upper_limit_baseline_rise_min: f32,
    pub lower_limit_gap_min: f32,
    pub lower_limit_baseline_drop_min: f32,
    pub stack_top_shift_up: f32,
    pub stack_top_display_style_shift_up: f32,
    pub stack_bottom_shift_down: f32,
    pub stack_bottom_display_style_shift_down: f32,
    pub stack_gap_min: f32,
    pub stack_display_style_gap_min: f32,
    pub fraction_numerator_shift_up: f32,
    pub fraction_numerator_display_style_shift_up: f32,
    pub fraction_denominator_shift_down: f32,
    pub fraction_denominator_display_style_shift_down: f32,
    pub fraction_numerator_gap_min: f32,
    pub fraction_num_display_style_gap_min: f32,
    pub fraction_rule_thickness: f32,
    pub fraction_denominator_gap_min: f32,
    pub fraction_denom_display_style_gap_min: f32,
    pub overbar_vertical_gap: f32,
    pub overbar_rule_thickness: f32,
    pub overbar_extra_ascender: f32,
    pub underbar_vertical_gap: f32,
    pub underbar_rule_thickness: f32,
    pub radical_vertical_gap: f32,
    pub radical_display_style_vertical_gap: f32,
    pub radical_rule_thickness: f32,
    pub radical_extra_ascender: f32,
    pub radical_kern_before_degree: f32,
    pub radical_kern_after_degree: f32,
    pub radical_degree_bottom_raise: f32,
    pub min_connector_overlap: f32,
}

impl Default for Constants {
    fn default() -> Self {
        Self {
            script_scale: 0.73,
            script_script_scale: 0.6,
            delimited_sub_formula_min_height: 1.325,
            display_operator_min_height: 1.8,
            axis_height: 0.258,
            accent_base_height: 0.48,
            subscript_shift_down: 0.21,
            subscript_top_max: 0.368,
            subscript_baseline_drop_min: 0.16,
            superscript_shift_up: 0.36,
            superscript_shift_up_cramped: 0.252,
            superscript_bottom_min: 0.12,
            superscript_baseline_drop_max: 0.23,
            sub_superscript_gap_min: 0.15,
            superscript_bottom_max_with_subscript: 0.38,
            space_after_script: 0.04,
            upper_limit_gap_min: 0.135,
            upper_limit_baseline_rise_min: 0.3,
            lower_limit_gap_min: 0.135,
            lower_limit_baseline_drop_min: 0.67,
            stack_top_shift_up: 0.47,
            stack_top_display_style_shift_up: 0.67,
            stack_bottom_shift_down: 0.385,
            stack_bottom_display_style_shift_down: 0.67,
            stack_gap_min: 0.15,
            stack_display_style_gap_min: 0.3,
            fraction_numerator_shift_up: 0.585,
            fraction_numerator_display_style_shift_up: 0.64,
            fraction_denominator_shift_down: 0.585,
            fraction_denominator_display_style_shift_down: 0.64,
            fraction_numerator_gap_min: 0.068,
            fraction_num_display_style_gap_min: 0.15,
            fraction_rule_thickness: 0.068,
            fraction_denominator_gap_min: 0.068,
            fraction_denom_display_style_gap_min: 0.15,
            overbar_vertical_gap: 0.175,
            overbar_rule_thickness: 0.068,
            overbar_extra_ascender: 0.068,
            underbar_vertical_gap: 0.175,
            underbar_rule_thickness: 0.068,
            radical_vertical_gap: 0.085,
            radical_display_style_vertical_gap: 0.17,
            radical_rule_thickness: 0.068,
            radical_extra_ascender: 0.078,
            radical_kern_before_degree: 0.065,
            radical_kern_after_degree: -0.335,
            radical_degree_bottom_raise: 0.55,
            min_connector_overlap: 0.1,
        }
    }
}

/// One size of a stretchy glyph.
#[derive(Clone, Copy, Debug)]
pub struct Variant {
    pub glyph: u16,
    /// Size along the stretch axis (ems).
    pub advance: f32,
}

/// A piece of a glyph assembly.
#[derive(Clone, Copy, Debug)]
pub struct Part {
    pub glyph: u16,
    pub start_connector: f32,
    pub end_connector: f32,
    pub full_advance: f32,
    pub extender: bool,
}

/// How a glyph stretches along an axis.
#[derive(Clone, Debug, Default)]
pub struct Construction {
    /// Ready-made sizes, smallest first.
    pub variants: Vec<Variant>,
    /// Parts to build any larger size from, bottom (or left) first.
    pub assembly: Vec<Part>,
}

/// The `MATH` table of the math face, when the database has it.
pub struct MathFont<'a> {
    pub face: Option<FaceId>,
    math: Option<Math<'a>>,
    upem: f32,
    pub constants: Constants,
}

impl<'a> MathFont<'a> {
    /// The math face of `fonts` (or none, with default constants).
    pub fn new(fonts: &'a FontDb) -> Self {
        let face = fonts
            .select(MATH_FAMILY, false, false)
            .map(|c| c.face)
            .filter(|&f| fonts.family(f).eq_ignore_ascii_case(MATH_FAMILY));
        let font = face
            .and_then(|f| fonts.face_data(f))
            .and_then(|(data, index)| FontRef::from_index(data, index).ok());
        let math = font.as_ref().and_then(|f| f.math().ok());
        let upem = font
            .as_ref()
            .and_then(|f| f.head().ok())
            .map_or(1000.0, |h| f32::from(h.units_per_em().max(1)));
        let mut constants = Constants::default();
        if let Some(c) = math.as_ref().and_then(|m| m.math_constants().ok()) {
            let v = |k: MathConstant| c.constant(k) as f32 / upem;
            let d = Constants::default();
            constants = Constants {
                // Cambria Math's script sizes (73% and 60%), which PowerPoint shows.
                script_scale: d.script_scale,
                script_script_scale: d.script_script_scale,
                delimited_sub_formula_min_height: v(MathConstant::DelimitedSubFormulaMinHeight),
                display_operator_min_height: v(MathConstant::DisplayOperatorMinHeight),
                axis_height: v(MathConstant::AxisHeight),
                accent_base_height: v(MathConstant::AccentBaseHeight),
                subscript_shift_down: v(MathConstant::SubscriptShiftDown),
                subscript_top_max: v(MathConstant::SubscriptTopMax),
                subscript_baseline_drop_min: v(MathConstant::SubscriptBaselineDropMin),
                superscript_shift_up: v(MathConstant::SuperscriptShiftUp),
                superscript_shift_up_cramped: v(MathConstant::SuperscriptShiftUpCramped),
                superscript_bottom_min: v(MathConstant::SuperscriptBottomMin),
                superscript_baseline_drop_max: v(MathConstant::SuperscriptBaselineDropMax),
                sub_superscript_gap_min: v(MathConstant::SubSuperscriptGapMin),
                superscript_bottom_max_with_subscript: v(
                    MathConstant::SuperscriptBottomMaxWithSubscript,
                ),
                space_after_script: v(MathConstant::SpaceAfterScript),
                upper_limit_gap_min: v(MathConstant::UpperLimitGapMin),
                upper_limit_baseline_rise_min: v(MathConstant::UpperLimitBaselineRiseMin),
                lower_limit_gap_min: v(MathConstant::LowerLimitGapMin),
                lower_limit_baseline_drop_min: v(MathConstant::LowerLimitBaselineDropMin),
                stack_top_shift_up: v(MathConstant::StackTopShiftUp),
                stack_top_display_style_shift_up: v(MathConstant::StackTopDisplayStyleShiftUp),
                stack_bottom_shift_down: v(MathConstant::StackBottomShiftDown),
                stack_bottom_display_style_shift_down: v(
                    MathConstant::StackBottomDisplayStyleShiftDown,
                ),
                stack_gap_min: v(MathConstant::StackGapMin),
                stack_display_style_gap_min: v(MathConstant::StackDisplayStyleGapMin),
                fraction_numerator_shift_up: v(MathConstant::FractionNumeratorShiftUp),
                fraction_numerator_display_style_shift_up: v(
                    MathConstant::FractionNumeratorDisplayStyleShiftUp,
                ),
                fraction_denominator_shift_down: v(MathConstant::FractionDenominatorShiftDown),
                fraction_denominator_display_style_shift_down: v(
                    MathConstant::FractionDenominatorDisplayStyleShiftDown,
                ),
                fraction_numerator_gap_min: v(MathConstant::FractionNumeratorGapMin),
                fraction_num_display_style_gap_min: v(MathConstant::FractionNumDisplayStyleGapMin),
                fraction_rule_thickness: v(MathConstant::FractionRuleThickness),
                fraction_denominator_gap_min: v(MathConstant::FractionDenominatorGapMin),
                fraction_denom_display_style_gap_min: v(
                    MathConstant::FractionDenomDisplayStyleGapMin,
                ),
                overbar_vertical_gap: v(MathConstant::OverbarVerticalGap),
                overbar_rule_thickness: v(MathConstant::OverbarRuleThickness),
                overbar_extra_ascender: v(MathConstant::OverbarExtraAscender),
                underbar_vertical_gap: v(MathConstant::UnderbarVerticalGap),
                underbar_rule_thickness: v(MathConstant::UnderbarRuleThickness),
                radical_vertical_gap: v(MathConstant::RadicalVerticalGap),
                radical_display_style_vertical_gap: v(MathConstant::RadicalDisplayStyleVerticalGap),
                radical_rule_thickness: v(MathConstant::RadicalRuleThickness),
                radical_extra_ascender: v(MathConstant::RadicalExtraAscender),
                radical_kern_before_degree: v(MathConstant::RadicalKernBeforeDegree),
                radical_kern_after_degree: v(MathConstant::RadicalKernAfterDegree),
                radical_degree_bottom_raise: c
                    .constant(MathConstant::RadicalDegreeBottomRaisePercent)
                    as f32
                    / 100.0,
                min_connector_overlap: math
                    .as_ref()
                    .and_then(|m| m.math_variants().ok())
                    .map_or(d.min_connector_overlap, |mv| {
                        f32::from(mv.min_connector_overlap().to_u16()) / upem
                    }),
            };
        }
        Self {
            face,
            math,
            upem,
            constants,
        }
    }

    /// The glyph of a character in the math face.
    pub fn glyph(&self, fonts: &FontDb, c: char) -> Option<u16> {
        fonts.glyph(self.face?, c)
    }

    /// Italic correction of a glyph (ems), when the font gives one.
    pub fn italic_correction(&self, glyph: u16) -> Option<f32> {
        let info = self.math.as_ref()?.math_glyph_info().ok()?;
        let table = info.math_italics_correction_info()?.ok()?;
        table
            .correction(GlyphId::new(u32::from(glyph)))
            .map(|v| v as f32 / self.upem)
    }

    /// Where an accent attaches above a glyph (ems from its origin).
    pub fn top_accent(&self, glyph: u16) -> Option<f32> {
        let info = self.math.as_ref()?.math_glyph_info().ok()?;
        let table = info.math_top_accent_attachment()?.ok()?;
        table
            .attachment(GlyphId::new(u32::from(glyph)))
            .map(|v| v as f32 / self.upem)
    }

    /// How a glyph stretches vertically (`vertical`) or horizontally.
    pub fn construction(&self, glyph: u16, vertical: bool) -> Construction {
        let Some(variants) = self.math.as_ref().and_then(|m| m.math_variants().ok()) else {
            return Construction::default();
        };
        let axis = if vertical {
            StretchAxis::Vertical
        } else {
            StretchAxis::Horizontal
        };
        let Some(c) = variants.glyph_construction(GlyphId::new(u32::from(glyph)), axis) else {
            return Construction::default();
        };
        let upem = self.upem;
        let list = c
            .math_glyph_variant_records()
            .iter()
            .map(|r| Variant {
                glyph: r.variant_glyph().to_u16(),
                advance: f32::from(r.advance_measurement().to_u16()) / upem,
            })
            .collect();
        let assembly = c
            .glyph_assembly()
            .and_then(Result::ok)
            .map(|a| {
                a.part_records()
                    .iter()
                    .map(|p| Part {
                        glyph: p.glyph_id().to_u16(),
                        start_connector: f32::from(p.start_connector_length().to_u16()) / upem,
                        end_connector: f32::from(p.end_connector_length().to_u16()) / upem,
                        full_advance: f32::from(p.full_advance().to_u16()) / upem,
                        extender: p.part_flags().bits() & 1 != 0,
                    })
                    .collect()
            })
            .unwrap_or_default();
        Construction {
            variants: list,
            assembly,
        }
    }
}
