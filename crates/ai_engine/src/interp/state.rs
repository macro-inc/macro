//! The graphics state the interpreter keeps: the CTM, clipping paths,
//! colors, line settings, opacity and blending, soft masks, text state, and
//! the operators that set them.

use super::fonts::LoadedFont;
use crate::color::ColorSpace;
use crate::geom::{Affine, PathData};
use crate::model::{BlendMode, LineCap, LineJoin};
use crate::pdf::content::Op;
use crate::pdf::{Dict, Object};
use std::sync::Arc;

/// A resource dictionary, shared by the operators that name things in it.
#[derive(Clone, Debug)]
pub struct ResDict {
    /// Tells dictionaries apart.
    pub id: u64,
    /// The dictionary.
    pub dict: Arc<Dict>,
}

/// An operator that set part of the graphics state, and the resources it
/// names things in (state set in a page applies inside the forms it draws).
#[derive(Clone, Debug)]
pub struct StateOp {
    /// The operator.
    pub op: Op,
    /// Its resources.
    pub res: ResDict,
}

/// A fill or stroke color and how it was set.
#[derive(Clone, Debug)]
pub struct ColorState {
    /// The color space.
    pub space: ColorSpace,
    /// The color's components.
    pub comps: Vec<f32>,
    /// A pattern (its dictionary or stream), in a pattern space.
    pub pattern: Option<Object>,
    /// The operators that set the space and the color.
    pub ops: Vec<StateOp>,
}

impl ColorState {
    pub(super) fn initial(space: ColorSpace) -> ColorState {
        ColorState {
            comps: space.initial(),
            space,
            pattern: None,
            ops: Vec::new(),
        }
    }

    /// The color as straight sRGB.
    pub fn rgb(&self) -> [f32; 3] {
        self.space.to_rgb(&self.comps)
    }
}

/// Text state.
#[derive(Clone)]
pub struct TextState {
    /// The font.
    pub font: Option<Arc<LoadedFont>>,
    /// Font size.
    pub size: f64,
    /// Character spacing.
    pub char_spacing: f64,
    /// Word spacing.
    pub word_spacing: f64,
    /// Horizontal scale (1.0 is 100%).
    pub h_scale: f64,
    /// Leading.
    pub leading: f64,
    /// Rise.
    pub rise: f64,
    /// Render mode (0 fill, 1 stroke, 2 both, 3 invisible, 4–7 also clip).
    pub render: u8,
    /// The operators that set it (`Tf`, `Tc`, `Tw`, `Tz`, `TL`, `Ts`, `Tr`).
    pub ops: Vec<StateOp>,
}

impl Default for TextState {
    fn default() -> Self {
        TextState {
            font: None,
            size: 0.0,
            char_spacing: 0.0,
            word_spacing: 0.0,
            h_scale: 1.0,
            leading: 0.0,
            rise: 0.0,
            render: 0,
            ops: Vec::new(),
        }
    }
}

/// A clipping path in effect.
#[derive(Clone, Debug, PartialEq)]
pub struct ClipPath {
    /// The path, in page space.
    pub path: PathData,
    /// Even-odd rule.
    pub even_odd: bool,
    /// Which `W` (or form) set it: clips that share a serial are the same
    /// clip, kept by `q`.
    pub serial: u64,
    /// A form's bounding box rather than a clipping path of the content.
    pub form_box: bool,
}

/// The graphics state.
#[derive(Clone)]
pub struct GState {
    /// User space to page space.
    pub ctm: Affine,
    /// The CTM the content stream started with (page space for a page, the
    /// form's space for a form): patterns are placed relative to it.
    pub base: Affine,
    /// Clipping paths in effect.
    pub clips: Vec<ClipPath>,
    /// Fill color.
    pub fill: ColorState,
    /// Stroke color.
    pub stroke: ColorState,
    /// Line width.
    pub line_width: f64,
    /// Line cap.
    pub cap: LineCap,
    /// Line join.
    pub join: LineJoin,
    /// Miter limit.
    pub miter: f64,
    /// Dash lengths.
    pub dash: Vec<f64>,
    /// Dash phase.
    pub dash_offset: f64,
    /// Fill opacity (`ca`).
    pub fill_alpha: f32,
    /// Stroke opacity (`CA`).
    pub stroke_alpha: f32,
    /// Blend mode.
    pub blend: BlendMode,
    /// The soft mask, when one is set: its dictionary and the CTM when it
    /// was set (its group is drawn in that space).
    pub soft_mask: Option<(Dict, Affine)>,
    /// Operators that set line settings and `gs` (in order).
    pub ops: Vec<StateOp>,
    /// Text state.
    pub text: TextState,
}

impl Default for GState {
    fn default() -> Self {
        GState {
            ctm: Affine::IDENTITY,
            base: Affine::IDENTITY,
            clips: Vec::new(),
            fill: ColorState::initial(ColorSpace::Gray),
            stroke: ColorState::initial(ColorSpace::Gray),
            line_width: 1.0,
            cap: LineCap::Butt,
            join: LineJoin::Miter,
            miter: 10.0,
            dash: Vec::new(),
            dash_offset: 0.0,
            fill_alpha: 1.0,
            stroke_alpha: 1.0,
            blend: BlendMode::Normal,
            soft_mask: None,
            ops: Vec::new(),
            text: TextState::default(),
        }
    }
}

impl GState {
    /// Replaces the operator `op` keeps for one setting (the last of each
    /// kind wins), or appends `gs` operators.
    pub(super) fn remember(&mut self, op: &Op, res: &ResDict) {
        if !op.is("gs") {
            let name = op.operator.clone();
            self.ops.retain(|o| o.op.operator != name);
        }
        self.ops.push(StateOp {
            op: op.clone(),
            res: res.clone(),
        });
        if self.ops.len() > 64 {
            self.ops.remove(0);
        }
    }

    /// The operators that recreate the state's colors, line settings,
    /// `gs`, and text state in a fresh graphics state.
    pub fn state_ops(&self) -> Vec<StateOp> {
        let mut out = Vec::new();
        out.extend(self.ops.iter().cloned());
        out.extend(self.fill.ops.iter().cloned());
        out.extend(self.stroke.ops.iter().cloned());
        out.extend(self.text.ops.iter().cloned());
        out
    }
}

/// Keeps the operator that set a text state parameter (the last of each
/// kind wins).
pub(super) fn remember_text(t: &mut TextState, op: &Op, res: &ResDict) {
    let name = op.operator.clone();
    t.ops.retain(|o| o.op.operator != name);
    t.ops.push(StateOp {
        op: op.clone(),
        res: res.clone(),
    });
}
