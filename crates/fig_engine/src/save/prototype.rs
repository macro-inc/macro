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
use crate::kiwi::{Kind, Msg, Schema, Ty, Value, Writer};
use crate::model::{Action, Guid, Interaction, Props};
use std::collections::HashMap;

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

/// A field's type: a primitive (kiwi's negative type codes) or a type by name.
enum FieldType {
    Prim(i32),
    Named(&'static str),
}

use FieldType::{Named, Prim};

const FLOAT: FieldType = Prim(-5);
const STRING: FieldType = Prim(-6);
const BOOL: FieldType = Prim(-1);

type NewField = (&'static str, FieldType, bool);

/// The prototype types Figma's schema has (values and fields the engine
/// writes), by name.
fn prototype_types() -> Vec<(&'static str, Kind, Vec<NewField>)> {
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
/// lacks them. Existing types keep their indices and field ids, so the
/// file's records read the same.
pub(super) fn with_prototype_fields(bytes: &[u8]) -> Result<Option<Vec<u8>>> {
    let schema = Schema::decode(bytes)?;
    let Some(node) = schema.def_index("NodeChange") else {
        return Ok(None);
    };
    let node_fields: Vec<NewField> = [
        ("prototypeInteractions", Named("PrototypeInteraction"), true),
        (
            "prototypeStartingPoint",
            Named("PrototypeStartingPoint"),
            false,
        ),
    ]
    .into_iter()
    .filter(|(name, _, _)| schema.def(node).index_of(name).is_none())
    .collect();
    if node_fields.is_empty() {
        return Ok(None);
    }
    let added: Vec<_> = prototype_types()
        .into_iter()
        .filter(|(name, _, _)| schema.def_index(name).is_none())
        .collect();
    let mut index: HashMap<&str, i32> = HashMap::new();
    let count = schema.defs.len();
    for (k, (name, _, _)) in added.iter().enumerate() {
        index.insert(name, (count + k) as i32);
    }
    let resolve = |t: &FieldType| match t {
        Prim(p) => Some(*p),
        Named(n) => index
            .get(n)
            .copied()
            .or_else(|| schema.def_index(n).map(|d| d as i32)),
    };
    let ty = |t: Ty| match t {
        Ty::Bool => -1,
        Ty::Byte => -2,
        Ty::Int => -3,
        Ty::Uint => -4,
        Ty::Float => -5,
        Ty::String => -6,
        Ty::Int64 => -7,
        Ty::Uint64 => -8,
        Ty::Def(i) => i as i32,
    };
    let kind = |k: Kind| match k {
        Kind::Enum => 0,
        Kind::Struct => 1,
        Kind::Message => 2,
    };
    // Fields whose types this schema cannot name are left out.
    let resolved = |fields: &[NewField]| -> Vec<(&'static str, i32, bool)> {
        fields
            .iter()
            .filter_map(|(name, t, array)| Some((*name, resolve(t)?, *array)))
            .collect()
    };
    let extra = resolved(&node_fields);
    let mut w = Writer::default();
    w.var_uint((count + added.len()) as u32);
    for (k, d) in schema.defs.iter().enumerate() {
        w.string(&d.name);
        w.byte(kind(d.kind));
        let more = if k as u32 == node { extra.len() } else { 0 };
        w.var_uint((d.fields.len() + more) as u32);
        for f in &d.fields {
            w.string(&f.name);
            w.var_int(ty(f.ty));
            w.byte(u8::from(f.array));
            w.var_uint(f.id);
        }
        if more > 0 {
            let mut next = d.fields.iter().map(|f| f.id).max().unwrap_or(0);
            for (name, t, array) in &extra {
                next += 1;
                w.string(name);
                w.var_int(*t);
                w.byte(u8::from(*array));
                w.var_uint(next);
            }
        }
    }
    for (name, k, fields) in &added {
        let fields = if *k == Kind::Enum {
            fields.iter().map(|(n, _, _)| (*n, 0, false)).collect()
        } else {
            resolved(fields)
        };
        w.string(name);
        w.byte(kind(*k));
        w.var_uint(fields.len() as u32);
        for (i, (field, t, array)) in fields.iter().enumerate() {
            w.string(field);
            w.var_int(*t);
            w.byte(u8::from(*array));
            // Enum values are their own ids; message fields count from 1.
            w.var_uint(if *k == Kind::Enum {
                i as u32
            } else {
                i as u32 + 1
            });
        }
    }
    Ok(Some(w.bytes))
}
