//! Writing prototype interactions and flow starting points.
//!
//! Interactions are written into the node's `prototypeInteractions`: one
//! the file already had (same id) starts from its record, and each of its
//! actions from the action at the same index, so the fields the engine does
//! not model (conditions, variables, easing curves) survive an edit. The
//! legacy single connection on the node is dropped once interactions are
//! written, as Figma does when it upgrades a file.
//!
//! Files whose schema has no prototype fields (designs made in Macro) get
//! them, with Figma's type and field names, when an edit adds any.

use super::Build;
use crate::error::Result;
use crate::kiwi::{Kind, Msg, Schema, Value};
use crate::model::{Action, Guid, Interaction, Props};

/// The node's own (legacy) connection fields.
const LEGACY: &[&str] = &[
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
    "transitionShouldSmartAnimate",
];

fn msgs(value: Option<&Value>) -> Vec<Msg> {
    match value {
        Some(Value::List(items)) => items
            .iter()
            .filter_map(|v| match v {
                Value::Msg(m) => Some((**m).clone()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn read_guid(schema: &Schema, m: &Msg, field: &str) -> Option<Guid> {
    let Some(Value::Msg(g)) = m.get(schema, field) else {
        return None;
    };
    let part = |name| match g.get(schema, name) {
        Some(Value::Uint(v)) => *v,
        _ => 0,
    };
    Some(Guid {
        session: part("sessionID"),
        local: part("localID"),
    })
}

impl Build<'_> {
    /// Writes the prototype fields of an edited node.
    pub(super) fn prototype(&self, m: &mut Msg, p: &Props) {
        let s = self.schema;
        if let Some(list) = p.interactions.as_deref()
            && let Some(def) = self.sub(m.def, "prototypeInteractions")
        {
            let existing = msgs(m.get(s, "prototypeInteractions"));
            let items = list
                .iter()
                .map(|i| Value::Msg(Box::new(self.interaction(def, i, &existing))))
                .collect();
            self.list_field(m, "prototypeInteractions", items);
            for f in LEGACY {
                m.remove(s, f);
            }
        }
        match p.flow_start.as_deref() {
            Some(f) => {
                let base = match m.get(s, "prototypeStartingPoint") {
                    Some(Value::Msg(b)) => Some((**b).clone()),
                    _ => None,
                };
                if let Some(def) = self.sub(m.def, "prototypeStartingPoint") {
                    let mut sm = base.unwrap_or_else(|| Msg::new(def));
                    sm.set(s, "name", Value::Str(f.name.as_ref().into()));
                    sm.set(s, "description", Value::Str(f.description.as_ref().into()));
                    sm.set(s, "position", Value::Str(f.position.as_ref().into()));
                    m.set(s, "prototypeStartingPoint", Value::Msg(Box::new(sm)));
                }
            }
            None => m.remove(s, "prototypeStartingPoint"),
        }
    }

    fn interaction(&self, def: u32, i: &Interaction, existing: &[Msg]) -> Msg {
        let s = self.schema;
        let base =
            i.id.and_then(|id| existing.iter().find(|e| read_guid(s, e, "id") == Some(id)));
        let mut m = base.cloned().unwrap_or_else(|| Msg::new(def));
        if let Some(id) = i.id {
            self.guid_field(&mut m, "id", id);
        }
        if let Some(event_def) = self.sub(def, "event") {
            let mut event = match m.get(s, "event") {
                Some(Value::Msg(e)) => (**e).clone(),
                _ => Msg::new(event_def),
            };
            self.set_enum(&mut event, "interactionType", &i.trigger);
            match i.timeout {
                Some(t) => {
                    event.set(s, "transitionTimeout", Value::Float(t));
                }
                None => event.remove(s, "transitionTimeout"),
            }
            m.set(s, "event", Value::Msg(Box::new(event)));
        }
        if let Some(action_def) = self.sub(def, "actions") {
            let old = msgs(m.get(s, "actions"));
            let actions = i
                .actions
                .iter()
                .enumerate()
                .map(|(k, a)| {
                    let base = old.get(k).cloned().unwrap_or_else(|| Msg::new(action_def));
                    Value::Msg(Box::new(self.action(base, a)))
                })
                .collect();
            self.list_field(&mut m, "actions", actions);
        }
        m.set(s, "isDeleted", Value::Bool(false));
        m
    }

    fn action(&self, mut m: Msg, a: &Action) -> Msg {
        let s = self.schema;
        self.set_enum(&mut m, "connectionType", &a.connection);
        self.set_enum(&mut m, "navigationType", &a.navigation);
        match a.destination {
            Some(g) => self.guid_field(&mut m, "transitionNodeID", g),
            None => m.remove(s, "transitionNodeID"),
        }
        self.set_enum(&mut m, "transitionType", &a.transition);
        m.set(s, "transitionDuration", Value::Float(a.duration));
        if let Some(e) = &a.easing {
            self.set_enum(&mut m, "easingType", e);
        }
        match &a.url {
            Some(u) => {
                m.set(s, "connectionURL", Value::Str(u.as_ref().into()));
            }
            None => m.remove(s, "connectionURL"),
        }
        if let Some(t) = a.open_in_new_tab {
            m.set(s, "openUrlInNewTab", Value::Bool(t));
        }
        if let Some(v) = a.overlay_offset {
            self.vector(&mut m, "overlayRelativePosition", v);
        }
        m
    }
}

// ---- schema ---------------------------------------------------------------

use super::schema::FieldType::{Named, Prim};
use super::schema::{BOOL, FLOAT, NewType, STRING};

/// The prototype types Figma's schema has (values and fields the engine
/// writes), by name.
fn prototype_types() -> Vec<NewType> {
    let values = |names: &[&'static str]| names.iter().map(|n| (*n, Prim(0), false)).collect();
    vec![
        (
            "InteractionType",
            Kind::Enum,
            values(&[
                "ON_CLICK",
                "AFTER_TIMEOUT",
                "MOUSE_IN",
                "MOUSE_OUT",
                "ON_HOVER",
                "MOUSE_DOWN",
                "MOUSE_UP",
                "ON_PRESS",
                "NONE",
                "DRAG",
                "ON_KEY_DOWN",
                "ON_VOICE",
                "ON_MEDIA_HIT",
                "ON_MEDIA_END",
                "MOUSE_ENTER",
                "MOUSE_LEAVE",
            ]),
        ),
        (
            "TransitionType",
            Kind::Enum,
            values(&[
                "INSTANT_TRANSITION",
                "DISSOLVE",
                "FADE",
                "SLIDE_FROM_LEFT",
                "SLIDE_FROM_RIGHT",
                "SLIDE_FROM_TOP",
                "SLIDE_FROM_BOTTOM",
                "PUSH_FROM_LEFT",
                "PUSH_FROM_RIGHT",
                "PUSH_FROM_TOP",
                "PUSH_FROM_BOTTOM",
                "MOVE_FROM_LEFT",
                "MOVE_FROM_RIGHT",
                "MOVE_FROM_TOP",
                "MOVE_FROM_BOTTOM",
                "SLIDE_OUT_TO_LEFT",
                "SLIDE_OUT_TO_RIGHT",
                "SLIDE_OUT_TO_TOP",
                "SLIDE_OUT_TO_BOTTOM",
                "MOVE_OUT_TO_LEFT",
                "MOVE_OUT_TO_RIGHT",
                "MOVE_OUT_TO_TOP",
                "MOVE_OUT_TO_BOTTOM",
                "MAGIC_MOVE",
                "SMART_ANIMATE",
                "SCROLL_ANIMATE",
            ]),
        ),
        (
            "EasingType",
            Kind::Enum,
            values(&[
                "IN_CUBIC",
                "OUT_CUBIC",
                "INOUT_CUBIC",
                "LINEAR",
                "IN_BACK_CUBIC",
                "OUT_BACK_CUBIC",
                "INOUT_BACK_CUBIC",
                "CUSTOM_CUBIC",
                "SPRING",
                "GENTLE_SPRING",
                "CUSTOM_SPRING",
            ]),
        ),
        (
            "ConnectionType",
            Kind::Enum,
            values(&["NONE", "INTERNAL_NODE", "URL", "BACK", "CLOSE"]),
        ),
        (
            "NavigationType",
            Kind::Enum,
            values(&["NAVIGATE", "OVERLAY", "SWAP", "SWAP_STATE", "SCROLL_TO"]),
        ),
        (
            "PrototypeEvent",
            Kind::Message,
            vec![
                ("interactionType", Named("InteractionType"), false),
                ("transitionTimeout", FLOAT, false),
            ],
        ),
        (
            "PrototypeAction",
            Kind::Message,
            vec![
                ("transitionNodeID", Named("GUID"), false),
                ("transitionType", Named("TransitionType"), false),
                ("transitionDuration", FLOAT, false),
                ("easingType", Named("EasingType"), false),
                ("connectionType", Named("ConnectionType"), false),
                ("connectionURL", STRING, false),
                ("navigationType", Named("NavigationType"), false),
                ("overlayRelativePosition", Named("Vector"), false),
                ("openUrlInNewTab", BOOL, false),
            ],
        ),
        (
            "PrototypeInteraction",
            Kind::Message,
            vec![
                ("id", Named("GUID"), false),
                ("event", Named("PrototypeEvent"), false),
                ("actions", Named("PrototypeAction"), true),
                ("isDeleted", BOOL, false),
            ],
        ),
        (
            "PrototypeStartingPoint",
            Kind::Message,
            vec![
                ("name", STRING, false),
                ("description", STRING, false),
                ("position", STRING, false),
            ],
        ),
    ]
}

/// The schema with Figma's prototype types and `NodeChange` fields, when it
/// lacks them.
pub(super) fn with_prototype_fields(bytes: &[u8]) -> Result<Option<Vec<u8>>> {
    super::schema::extend(
        bytes,
        vec![(
            "NodeChange",
            vec![
                ("prototypeInteractions", Named("PrototypeInteraction"), true),
                (
                    "prototypeStartingPoint",
                    Named("PrototypeStartingPoint"),
                    false,
                ),
            ],
        )],
        prototype_types(),
    )
}
