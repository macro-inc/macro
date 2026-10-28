//! Prototyping: what happens when someone clicks, hovers, or waits on a
//! layer while the design is presented, where flows start, and how a frame
//! shows as an overlay.
//!
//! Enum values keep Figma's names (`ON_CLICK`, `INTERNAL_NODE`, `NAVIGATE`,
//! `DISSOLVE`…), so files written by newer Figma versions keep values the
//! engine does not know, and saving writes them back by name.

use super::{Color, Guid, Vec2};
use std::sync::Arc;

/// One prototype interaction (`PrototypeInteraction`): a trigger and the
/// actions it runs, in order.
#[derive(Clone, Debug, PartialEq)]
pub struct Interaction {
    /// The interaction's id; `None` for one read from the legacy fields
    /// files from before interactions kept on a node.
    pub id: Option<Guid>,
    /// `InteractionType`: `ON_CLICK`, `ON_HOVER`, `ON_PRESS`, `ON_DRAG`
    /// (`DRAG`), `AFTER_TIMEOUT`, `MOUSE_ENTER`, `MOUSE_LEAVE`,
    /// `ON_KEY_DOWN`…
    pub trigger: Arc<str>,
    /// Seconds to wait, for `AFTER_TIMEOUT`.
    pub timeout: Option<f32>,
    pub actions: Arc<[Action]>,
}

/// One action (`PrototypeAction`).
#[derive(Clone, Debug, PartialEq)]
pub struct Action {
    /// `ConnectionType`: `INTERNAL_NODE` (go to `destination`), `URL`,
    /// `BACK`, `CLOSE` (close the overlay), or `NONE`.
    pub connection: Arc<str>,
    /// `NavigationType` of an `INTERNAL_NODE` connection: `NAVIGATE`,
    /// `OVERLAY` (open it), `SWAP` (swap the overlay), `SCROLL_TO`, or
    /// `SWAP_STATE` (change a component's variant).
    pub navigation: Arc<str>,
    pub destination: Option<Guid>,
    /// `TransitionType`: `INSTANT_TRANSITION`, `DISSOLVE`,
    /// `SMART_ANIMATE`, `MOVE_FROM_LEFT`, `PUSH_FROM_RIGHT`,
    /// `SLIDE_FROM_TOP`, `MOVE_OUT_TO_BOTTOM`…
    pub transition: Arc<str>,
    /// Seconds.
    pub duration: f32,
    /// `EasingType` as the file names it (`OUT_CUBIC` is Ease out).
    pub easing: Option<Arc<str>>,
    pub url: Option<Arc<str>>,
    pub open_in_new_tab: Option<bool>,
    /// Where a manually placed overlay goes, relative to the hotspot's
    /// frame.
    pub overlay_offset: Option<Vec2>,
}

impl Action {
    /// A `Navigate to` action with Figma's defaults (instant).
    pub fn navigate(destination: Guid) -> Action {
        Action {
            connection: "INTERNAL_NODE".into(),
            navigation: "NAVIGATE".into(),
            destination: Some(destination),
            transition: "INSTANT_TRANSITION".into(),
            duration: 0.3,
            easing: None,
            url: None,
            open_in_new_tab: None,
            overlay_offset: None,
        }
    }
}

/// A flow starting point (`prototypeStartingPoint`) on a top-level frame.
#[derive(Clone, Debug, PartialEq)]
pub struct FlowStart {
    pub name: Arc<str>,
    pub description: Arc<str>,
    /// Orders the page's flows (a fractional index, like layer positions).
    pub position: Arc<str>,
}

/// How a frame shows when it is opened as an overlay.
#[derive(Clone, Debug, PartialEq)]
pub struct OverlaySettings {
    /// `OverlayPositionType`: `CENTER`, `TOP_LEFT`, …, `BOTTOM_RIGHT`, or
    /// `MANUAL` (at the action's offset).
    pub position: Arc<str>,
    /// Clicking outside the overlay closes it.
    pub close_on_click_outside: bool,
    /// The color drawn behind the overlay, when it has one.
    pub background: Option<Color>,
}
