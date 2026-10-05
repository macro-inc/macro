//! Writing what team libraries record, in Figma's fields: an asset's key
//! (`componentKey` too on a copy of a library component), whether it is
//! published and its versions (`isSymbolPublishable`/`isPublishable`,
//! `sharedSymbolVersion`/`version`, `publishedVersion`), a copy's library
//! (`sourceLibraryKey`, `publishID`) and `overrideKey`, and Macro's own
//! values as `pluginData` (other plugins' entries are kept).

use super::Build;
use super::schema::FieldType::Named;
use super::schema::{BOOL, NewField, NewType, STRING};
use crate::error::Result;
use crate::kiwi::{Kind, Msg, Value};
use crate::model::library::MACRO_PLUGIN;
use crate::model::{NodeType, Props};

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
