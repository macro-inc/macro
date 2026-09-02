//! Small serde helpers for the inbound layer.

/// Serialize a `BTreeSet<u64>` as a set of decimal strings (and back), because
/// JSON can't represent u64 peer ids losslessly as numbers.
pub mod u64_serde_strings {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use std::collections::BTreeSet;

    pub fn serialize<S: Serializer>(
        value: &BTreeSet<u64>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        let string_set: BTreeSet<String> = value.iter().map(|x| x.to_string()).collect();
        string_set.serialize(serializer)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<BTreeSet<u64>, D::Error> {
        let string_set: BTreeSet<String> = BTreeSet::deserialize(deserializer)?;
        string_set
            .into_iter()
            .map(|s| s.parse::<u64>().map_err(serde::de::Error::custom))
            .collect()
    }

    #[cfg(test)]
    mod test {
        use super::*;
        #[derive(Serialize, Deserialize)]
        struct Foo {
            #[serde(with = "super")]
            set: BTreeSet<u64>,
        }
        #[test]
        fn serde_u64_btree_set() -> std::result::Result<(), Box<dyn std::error::Error>> {
            let data = BTreeSet::from([1_u64, u64::MAX, u64::MIN, 0, 42]);
            let obj = Foo { set: data.clone() };
            let json = serde_json::to_string(&obj)?;
            let result: Foo = serde_json::from_str(&json)?;
            assert_eq!(result.set, data);
            Ok(())
        }
    }
}
