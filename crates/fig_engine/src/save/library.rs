//! Writing what team libraries record, in Figma's fields: an asset's key
//! (`componentKey` too on a copy of a library component), whether it is
//! published and its versions (`isSymbolPublishable`/`isPublishable`,
//! `sharedSymbolVersion`/`version`, `publishedVersion`), a copy's library
//! (`sourceLibraryKey`, `publishID`) and `overrideKey`, and Macro's own
//! values as `pluginData` (other plugins' entries are kept). Copies of
//! library variables and collections get their fields written where their
//! record lacks them (a file made in Macro had no variables to keep them).

use super::Build;
use super::schema::FieldType::Named;
use super::schema::FieldType::Prim;
use super::schema::{BOOL, FLOAT, NewField, NewType, STRING};
use crate::error::Result;
use crate::kiwi::{Kind, Msg, Value};
use crate::model::library::MACRO_PLUGIN;
use crate::model::{NodeType, Props, Variable, VariableMode, VariableValue};

impl Build<'_> {
    /// [`crate::edit::flags::LIBRARY`]: the library fields `p` sets.
    pub(super) fn library_fields(&self, m: &mut Msg, p: &Props) {
        let s = self.schema;
        let component = p.node_type() == NodeType::Symbol || p.is_state_group == Some(true);
        if let Some(key) = &p.key {
            m.set(s, "key", Value::Str(key.as_ref().into()));
            if component && p.library_source().is_some() {
                m.set(s, "componentKey", Value::Str(key.as_ref().into()));
            }
        }
        if let Some(k) = p.override_key {
            self.guid_field(m, "overrideKey", k);
        }
        if let Some(l) = p.library.as_deref() {
            let symbol = p.node_type() == NodeType::Symbol;
            if let Some(v) = l.publishable {
                let field = if symbol {
                    "isSymbolPublishable"
                } else {
                    "isPublishable"
                };
                m.set(s, field, Value::Bool(v));
            }
            if let Some(v) = &l.version {
                let field = if symbol {
                    "sharedSymbolVersion"
                } else {
                    "version"
                };
                m.set(s, field, Value::Str(v.as_ref().into()));
            }
            if let Some(v) = &l.published_version {
                m.set(s, "publishedVersion", Value::Str(v.as_ref().into()));
            }
            if let Some(v) = &l.source {
                m.set(s, "sourceLibraryKey", Value::Str(v.as_ref().into()));
            }
            if let Some(g) = l.publish_id {
                self.guid_field(m, "publishID", g);
            }
        }
        self.plugin_data(m, p);
        if let Some(v) = p.variable.as_deref() {
            self.variable(m, v);
        }
        if let Some(modes) = p.variable_modes.as_deref() {
            self.variable_set(m, modes);
        }
    }

    /// A variable's type, collection, and values, where the record has none.
    fn variable(&self, m: &mut Msg, v: &Variable) {
        let s = self.schema;
        if m.get(s, "type").is_none() {
            self.set_enum(m, "type", "VARIABLE");
        }
        if m.get(s, "variableSetID").is_none()
            && let Some(set) = v.set
            && let Some(def) = self.sub(m.def, "variableSetID")
        {
            let mut id = Msg::new(def);
            self.guid_field(&mut id, "guid", set);
            m.set(s, "variableSetID", Value::Msg(Box::new(id)));
        }
        if m.get(s, "variableResolvedType").is_none() {
            self.set_enum(m, "variableResolvedType", v.resolved_type.name());
        }
        if m.get(s, "variableDataValues").is_some() {
            return;
        }
        let Some(values_def) = self.sub(m.def, "variableDataValues") else {
            return;
        };
        let Some(entry_def) = self.sub(values_def, "entries") else {
            return;
        };
        let Some(data_def) = self.sub(entry_def, "variableData") else {
            return;
        };
        let entries = v
            .values
            .iter()
            .filter_map(|(mode, value)| {
                let data = self.variable_data(data_def, value, v.resolved_type.name())?;
                let mut e = Msg::new(entry_def);
                self.guid_field(&mut e, "modeID", *mode);
                e.set(s, "variableData", Value::Msg(Box::new(data)));
                Some(Value::Msg(Box::new(e)))
            })
            .collect();
        let mut values = Msg::new(values_def);
        values.set(s, "entries", Value::List(entries));
        m.set(s, "variableDataValues", Value::Msg(Box::new(values)));
    }

    /// One mode's value as Figma's `VariableData`.
    fn variable_data(&self, def: u32, value: &VariableValue, resolved: &str) -> Option<Msg> {
        let s = self.schema;
        let any_def = self.sub(def, "value")?;
        let mut any = Msg::new(any_def);
        let kind = match value {
            VariableValue::Color(c) => {
                self.color(&mut any, "colorValue", *c);
                "COLOR"
            }
            VariableValue::Float(f) => {
                any.set(s, "floatValue", Value::Float(*f));
                "FLOAT"
            }
            VariableValue::Bool(b) => {
                any.set(s, "boolValue", Value::Bool(*b));
                "BOOLEAN"
            }
            VariableValue::Text(t) => {
                any.set(s, "textValue", Value::Str(t.as_ref().into()));
                "STRING"
            }
            VariableValue::Alias(g) => {
                let alias_def = self.sub(any_def, "alias")?;
                let mut alias = Msg::new(alias_def);
                self.guid_field(&mut alias, "guid", *g);
                any.set(s, "alias", Value::Msg(Box::new(alias)));
                "ALIAS"
            }
            VariableValue::Other => return None,
        };
        let mut data = Msg::new(def);
        data.set(s, "value", Value::Msg(Box::new(any)));
        self.set_enum(&mut data, "dataType", kind);
        self.set_enum(&mut data, "resolvedDataType", resolved);
        Some(data)
    }

    /// A collection's type and modes, where the record has none.
    fn variable_set(&self, m: &mut Msg, modes: &[VariableMode]) {
        let s = self.schema;
        if m.get(s, "type").is_none() {
            self.set_enum(m, "type", "VARIABLE_SET");
        }
        if m.get(s, "variableSetModes").is_some() {
            return;
        }
        let Some(def) = self.sub(m.def, "variableSetModes") else {
            return;
        };
        let list = modes
            .iter()
            .map(|mode| {
                let mut e = Msg::new(def);
                self.guid_field(&mut e, "id", mode.id);
                e.set(s, "name", Value::Str(mode.name.as_ref().into()));
                Value::Msg(Box::new(e))
            })
            .collect();
        m.set(s, "variableSetModes", Value::List(list));
    }

    /// Macro's `pluginData` entries replaced by `p`'s.
    fn plugin_data(&self, m: &mut Msg, p: &Props) {
        let s = self.schema;
        let Some(def) = self.sub(m.def, "pluginData") else {
            return;
        };
        let mut list: Vec<Value> = match m.get(s, "pluginData") {
            Some(Value::List(l)) => l
                .iter()
                .filter(|v| {
                    !matches!(v, Value::Msg(e)
                        if matches!(e.get(s, "pluginID"), Some(Value::Str(id)) if &**id == MACRO_PLUGIN))
                })
                .cloned()
                .collect(),
            _ => Vec::new(),
        };
        for (key, value) in p.macro_data.iter().flat_map(|d| d.iter()) {
            let mut e = Msg::new(def);
            e.set(s, "pluginID", Value::Str(MACRO_PLUGIN.into()));
            e.set(s, "key", Value::Str(key.as_ref().into()));
            e.set(s, "value", Value::Str(value.as_ref().into()));
            list.push(Value::Msg(Box::new(e)));
        }
        if list.is_empty() {
            m.remove(s, "pluginData");
        } else {
            m.set(s, "pluginData", Value::List(list));
        }
    }
}

/// The schema with the library fields of `NodeChange` (and Figma's
/// `PluginData`), when it lacks them.
pub(super) fn with_library_fields(bytes: &[u8]) -> Result<Option<Vec<u8>>> {
    let node: Vec<NewField> = vec![
        ("key", STRING, false),
        ("componentKey", STRING, false),
        ("isSymbolPublishable", BOOL, false),
        ("isPublishable", BOOL, false),
        ("sharedSymbolVersion", STRING, false),
        ("version", STRING, false),
        ("publishedVersion", STRING, false),
        ("sourceLibraryKey", STRING, false),
        ("publishID", Named("GUID"), false),
        ("overrideKey", Named("GUID"), false),
        ("pluginData", Named("PluginData"), true),
    ];
    let types: Vec<NewType> = vec![(
        "PluginData",
        Kind::Message,
        vec![
            ("pluginID", STRING, false),
            ("value", STRING, false),
            ("key", STRING, false),
        ],
    )];
    super::schema::extend(bytes, vec![("NodeChange", node)], types)
}

/// The schema with Figma's variable types and fields (on `NodeChange`, and
/// `colorVar` on `Paint`), when it lacks them.
pub(super) fn with_variable_fields(bytes: &[u8]) -> Result<Option<Vec<u8>>> {
    let values = |names: &[&'static str]| -> Vec<NewField> {
        names.iter().map(|n| (*n, Prim(0), false)).collect()
    };
    let types: Vec<NewType> = vec![
        (
            "VariableDataType",
            Kind::Enum,
            values(&[
                "BOOLEAN",
                "FLOAT",
                "STRING",
                "ALIAS",
                "COLOR",
                "EXPRESSION",
                "MAP",
            ]),
        ),
        (
            "VariableResolvedDataType",
            Kind::Enum,
            values(&["BOOLEAN", "FLOAT", "STRING", "COLOR", "MAP"]),
        ),
        (
            "VariableID",
            Kind::Message,
            vec![
                ("guid", Named("GUID"), false),
                ("assetRef", Named("AssetRef"), false),
            ],
        ),
        (
            "VariableSetID",
            Kind::Message,
            vec![
                ("guid", Named("GUID"), false),
                ("assetRef", Named("AssetRef"), false),
            ],
        ),
        (
            "VariableAnyValue",
            Kind::Message,
            vec![
                ("boolValue", BOOL, false),
                ("textValue", STRING, false),
                ("floatValue", FLOAT, false),
                ("alias", Named("VariableID"), false),
                ("colorValue", Named("Color"), false),
            ],
        ),
        (
            "VariableData",
            Kind::Message,
            vec![
                ("value", Named("VariableAnyValue"), false),
                ("dataType", Named("VariableDataType"), false),
                ("resolvedDataType", Named("VariableResolvedDataType"), false),
            ],
        ),
        (
            "VariableDataValuesEntry",
            Kind::Message,
            vec![
                ("modeID", Named("GUID"), false),
                ("variableData", Named("VariableData"), false),
            ],
        ),
        (
            "VariableDataValues",
            Kind::Message,
            vec![("entries", Named("VariableDataValuesEntry"), true)],
        ),
        (
            "VariableSetMode",
            Kind::Message,
            vec![
                ("id", Named("GUID"), false),
                ("name", STRING, false),
                ("sortPosition", STRING, false),
            ],
        ),
        (
            "VariableModeBySetMapEntry",
            Kind::Message,
            vec![
                ("variableSetID", Named("VariableSetID"), false),
                ("variableModeID", Named("GUID"), false),
            ],
        ),
        (
            "VariableModeBySetMap",
            Kind::Message,
            vec![("entries", Named("VariableModeBySetMapEntry"), true)],
        ),
    ];
    let node: Vec<NewField> = vec![
        ("variableSetID", Named("VariableSetID"), false),
        (
            "variableResolvedType",
            Named("VariableResolvedDataType"),
            false,
        ),
        ("variableDataValues", Named("VariableDataValues"), false),
        ("variableSetModes", Named("VariableSetMode"), true),
        ("variableModeBySetMap", Named("VariableModeBySetMap"), false),
    ];
    super::schema::extend(
        bytes,
        vec![
            ("NodeChange", node),
            ("Paint", vec![("colorVar", Named("VariableData"), false)]),
            (
                "NodeType",
                vec![
                    ("VARIABLE", Prim(0), false),
                    ("VARIABLE_SET", Prim(0), false),
                ],
            ),
        ],
        types,
    )
}
