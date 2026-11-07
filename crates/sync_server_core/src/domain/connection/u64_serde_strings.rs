use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::BTreeSet;

pub fn serialize<S: Serializer>(value: &BTreeSet<u64>, serializer: S) -> Result<S::Ok, S::Error> {
    let string_set: BTreeSet<String> = value.iter().map(|x| x.to_string()).collect();
    string_set.serialize(serializer)
}

pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<BTreeSet<u64>, D::Error> {
    let string_set: BTreeSet<String> = BTreeSet::deserialize(deserializer)?;
    string_set
        .into_iter()
        .map(|s| s.parse::<u64>().map_err(serde::de::Error::custom))
        .collect()
}

#[cfg(test)]
mod test;
