// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Reads the expected values whatsmeow's Go code produced (see
//! `testdata/generator/README.md`). Not a port; test support only.

use std::path::PathBuf;

use serde_json::Value;

/// One JSON object of vectors from `testdata/`.
pub(crate) struct Vectors {
    name: String,
    values: serde_json::Map<String, Value>,
}

impl Vectors {
    /// Loads `testdata/<name>`.
    pub(crate) fn load(name: &str) -> Vectors {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("testdata")
            .join(name);
        let data = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("reading {}: {error}", path.display()));
        let Value::Object(values) = serde_json::from_str(&data).expect("vectors are JSON") else {
            panic!("{name} is not a JSON object");
        };
        Vectors {
            name: name.to_owned(),
            values,
        }
    }

    /// A raw value.
    pub(crate) fn value(&self, key: &str) -> &Value {
        self.values
            .get(key)
            .unwrap_or_else(|| panic!("{} has no {key}", self.name))
    }

    /// A string value.
    pub(crate) fn string(&self, key: &str) -> String {
        self.value(key)
            .as_str()
            .unwrap_or_else(|| panic!("{key} is not a string"))
            .to_owned()
    }

    /// A hex string value, decoded.
    pub(crate) fn bytes(&self, key: &str) -> Vec<u8> {
        hex::decode(self.string(key)).unwrap_or_else(|error| panic!("{key} is not hex: {error}"))
    }

    /// A node marshaled by Go (`binary.Marshal`, with the leading flag byte).
    pub(crate) fn node(&self, key: &str) -> crate::binary::Node {
        let data = crate::binary::unpack(&self.bytes(key)).expect("unpack vector node");
        crate::binary::unmarshal(&data).expect("unmarshal vector node")
    }

    /// A number value.
    pub(crate) fn u64(&self, key: &str) -> u64 {
        self.value(key)
            .as_u64()
            .unwrap_or_else(|| panic!("{key} is not a number"))
    }
}
