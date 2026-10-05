//! Prototype interactions, flow starting points, and overlay settings.
//!
//! Interactions live in `prototypeInteractions`; files from before Figma
//! kept several per layer have one connection in fields on the node itself
//! (`transitionNodeID`, `transitionType`…), read here as one interaction.
//! Absent enum fields take Figma's defaults: a click, an internal
//! connection that navigates, instantly.

use super::{color, guid, vec2};
use crate::kiwi::MsgRef;
use crate::model::{Action, FlowStart, Guid, Interaction, OverlaySettings, Props};
use std::sync::Arc;

/// The `NodeChange` fields read here.
pub(super) const FIELDS: &[&str] = &[
    "prototypeInteractions",
    "prototypeStartingPoint",
    "prototypeStartNodeID",
    "overlayPositionType",
    "overlayBackgroundInteraction",
    "overlayBackgroundAppearance",
    "transitionNodeID",
    "transitionType",
    "transitionDuration",
    "easingType",
    "connectionType",
    "connectionURL",
    "navigationType",
    "interactionType",
    "transitionTimeout",
    "destinationIsOverlay",
];

/// Figma writes `0xFFFFFFFF:0xFFFFFFFF` for "no node".
fn node_ref(m: Option<MsgRef>) -> Option<Guid> {
    m.and_then(guid)
        .filter(|g| g.session != u32::MAX && *g != Guid::default())
}

fn action(a: &MsgRef) -> Action {
    let destination = node_ref(a.msg("transitionNodeID"));
    Action {
        connection: a
            .enum_name("connectionType")
            .unwrap_or(if destination.is_some() {
                "INTERNAL_NODE"
            } else {
                "NONE"
            })
            .into(),
        navigation: a.enum_name("navigationType").unwrap_or("NAVIGATE").into(),
        destination,
        transition: a
            .enum_name("transitionType")
            .unwrap_or("INSTANT_TRANSITION")
            .into(),
        duration: a.f32("transitionDuration").unwrap_or(0.3),
        easing: a.enum_name("easingType").map(Into::into),
        url: a
            .str("connectionURL")
            .filter(|u| !u.is_empty())
            .map(Into::into),
        open_in_new_tab: a.bool("openUrlInNewTab"),
        overlay_offset: a.msg("overlayRelativePosition").map(vec2),
    }
}

fn interaction(m: &MsgRef) -> Option<Interaction> {
    if m.bool("isDeleted") == Some(true) {
        return None;
    }
    let event = m.msg("event");
    Some(Interaction {
        id: m.msg("id").and_then(guid),
        trigger: event
            .and_then(|e| e.enum_name("interactionType"))
            .unwrap_or("ON_CLICK")
            .into(),
        timeout: event.and_then(|e| e.f32("transitionTimeout")),
        actions: m.msgs("actions").map(|a| action(&a)).collect(),
    })
}

/// The legacy single connection kept on the node, as an interaction.
fn legacy(m: &MsgRef) -> Option<Interaction> {
    let connection = m.enum_name("connectionType");
    let destination = node_ref(m.msg("transitionNodeID"));
    if destination.is_none() && !matches!(connection, Some("URL" | "BACK" | "CLOSE")) {
        return None;
    }
    let mut a = action(m);
    if m.bool("destinationIsOverlay") == Some(true) && a.navigation.as_ref() == "NAVIGATE" {
        a.navigation = "OVERLAY".into();
    }
    Some(Interaction {
        id: None,
        trigger: m.enum_name("interactionType").unwrap_or("ON_CLICK").into(),
        timeout: m.f32("transitionTimeout"),
        actions: Arc::from([a]),
    })
}

/// Reads the prototype fields of a node change into `p`.
pub(super) fn read(m: &MsgRef, p: &mut Props) {
    if m.has("prototypeInteractions") {
        p.interactions = Some(
            m.msgs("prototypeInteractions")
                .filter_map(|i| interaction(&i))
                .collect(),
        );
    } else if let Some(i) = legacy(m) {
        p.interactions = Some(Arc::from([i]));
    }
    p.flow_start = m.msg("prototypeStartingPoint").map(|s| {
        Arc::new(FlowStart {
            name: s.str("name").unwrap_or("").into(),
            description: s.str("description").unwrap_or("").into(),
            position: s.str("position").unwrap_or("").into(),
        })
    });
    p.prototype_start = node_ref(m.msg("prototypeStartNodeID"));
    let position = m.enum_name("overlayPositionType");
    let outside = m.enum_name("overlayBackgroundInteraction");
    let appearance = m.msg("overlayBackgroundAppearance");
    if position.is_some() || outside.is_some() || appearance.is_some() {
        p.overlay = Some(Arc::new(OverlaySettings {
            position: position.unwrap_or("CENTER").into(),
            close_on_click_outside: outside == Some("CLOSE_ON_CLICK_OUTSIDE"),
            background: appearance
                .filter(|a| a.enum_name("backgroundType") == Some("SOLID_COLOR"))
                .and_then(|a| a.msg("backgroundColor"))
                .map(color),
        }));
    }
}
