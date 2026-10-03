//! The 187 ECMA-376 preset shape definitions.
//!
//! Source: `presetShapeDefinitions.xml` from ECMA-376 Part 1 (as distributed
//! with Apache POI and LibreOffice), minified. Parsed once on first use.

use crate::xml::{NodeId, XmlDoc};
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

const DEFINITIONS: &str = include_str!("../../assets/preset_shape_definitions.xml");

/// One preset: the shared document and the preset's element in it.
pub struct PresetDef {
    pub doc: Arc<XmlDoc>,
    pub node: NodeId,
}

static PRESETS: OnceLock<HashMap<String, PresetDef>> = OnceLock::new();

/// All preset definitions by name.
pub fn definitions() -> &'static HashMap<String, PresetDef> {
    PRESETS.get_or_init(|| {
        let doc = Arc::new(
            XmlDoc::parse(DEFINITIONS.as_bytes(), "presetShapeDefinitions.xml")
                .expect("embedded preset definitions are well-formed"),
        );
        doc.children(doc.root())
            .map(|node| (doc.local(node).to_owned(), PresetDef { doc: Arc::clone(&doc), node }))
            .collect()
    })
}
