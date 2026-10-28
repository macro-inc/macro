//! The outline of a slide's animations (see `edit::animation`).

use crate::edit::{AnimationClass, AnimationRepeat, AnimationStart};
use serde::Serialize;

/// One animation of a slide's main sequence (what plays as the presenter
/// clicks through the slide). A slide's animations are listed in playback
/// order; an animation's index in that list is its playback position.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationOutline {
    /// The animated shape (a group member's own id when the target is inside a group).
    pub shape_id: u32,
    /// Effect group.
    pub class: AnimationClass,
    /// Effect name (see `AnimationSpec::effect`), a name for a PowerPoint
    /// preset the engine reads but does not create (`blinds`, `boomerang`,
    /// `play`...), or `custom` for an unknown preset.
    pub effect: String,
    /// PowerPoint's `presetID`.
    pub preset_id: u32,
    /// PowerPoint's `presetSubtype` (directions and other options).
    pub preset_subtype: u32,
    /// When it starts.
    pub start: AnimationStart,
    /// Duration of one play in milliseconds (0 for instant effects such as `appear`).
    pub duration_ms: u32,
    /// Wait in milliseconds after its start before it plays.
    pub delay_ms: u32,
    /// Effect option (see `AnimationSpec::direction`), when it has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    /// The paragraph it animates (0-based), when it animates one paragraph.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paragraph: Option<u32>,
    /// How often it plays, when it repeats.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat: Option<AnimationRepeat>,
    /// Motion paths: the path in PowerPoint's syntax (`M 0 0 L 0 0.25 E`),
    /// in fractions of the slide's width and height, relative to the shape.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}
