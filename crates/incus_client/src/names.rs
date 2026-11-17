//! Validated names accepted at the hand-written Incus boundary.
use serde::{Deserialize, Serialize};

/// An invalid Incus resource name.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum InvalidName {
    /// A computer name must contain the canonical simple UUID.
    #[error("invalid Incus instance name")]
    InstanceName,
    /// An image alias must contain only safe alias characters.
    #[error("invalid Incus image alias")]
    ImageAlias,
    /// A profile name must contain only safe resource-name characters.
    #[error("invalid Incus profile name")]
    ProfileName,
    /// A storage pool name must contain only safe resource-name characters.
    #[error("invalid Incus storage pool name")]
    StoragePoolName,
    /// A storage volume name must contain only safe resource-name characters.
    #[error("invalid Incus storage volume name")]
    StorageVolumeName,
}

/// A computer instance name: `mc-` followed by a lowercase simple UUID.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct InstanceName(String);

impl InstanceName {
    /// Validate the name before making an Incus request.
    pub fn try_new(value: &str) -> Result<Self, InvalidName> {
        if !(value.len() == 35
            && value.starts_with("mc-")
            && value
                .bytes()
                .skip(3)
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
        {
            return Err(InvalidName::InstanceName);
        }
        Ok(Self(value.to_owned()))
    }
    /// Borrow the validated name.
    pub fn as_str(&self) -> &str {
        &self.0
    }
    /// Take the validated name.
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl TryFrom<String> for InstanceName {
    type Error = InvalidName;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl std::fmt::Display for InstanceName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// An image alias, optionally containing slash-separated components.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct ImageAlias(String);

impl ImageAlias {
    /// Validate the name before making an Incus request.
    pub fn try_new(value: &str) -> Result<Self, InvalidName> {
        if value.is_empty()
            || !value.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b'/')
            })
        {
            return Err(InvalidName::ImageAlias);
        }
        Ok(Self(value.to_owned()))
    }
    /// Borrow the validated name.
    pub fn as_str(&self) -> &str {
        &self.0
    }
    /// Take the validated name.
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl TryFrom<String> for ImageAlias {
    type Error = InvalidName;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl std::fmt::Display for ImageAlias {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// An Incus profile name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct ProfileName(String);

impl ProfileName {
    /// Validate the name before making an Incus request.
    pub fn try_new(value: &str) -> Result<Self, InvalidName> {
        if !(!value.is_empty()
            && value != "."
            && value != ".."
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.')))
        {
            return Err(InvalidName::ProfileName);
        }
        Ok(Self(value.to_owned()))
    }
    /// Borrow the validated name.
    pub fn as_str(&self) -> &str {
        &self.0
    }
    /// Take the validated name.
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl TryFrom<String> for ProfileName {
    type Error = InvalidName;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl std::fmt::Display for ProfileName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// An Incus storage pool name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct StoragePoolName(String);

impl StoragePoolName {
    /// Validate the name before making an Incus request.
    pub fn try_new(value: &str) -> Result<Self, InvalidName> {
        if !(!value.is_empty()
            && value != "."
            && value != ".."
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.')))
        {
            return Err(InvalidName::StoragePoolName);
        }
        Ok(Self(value.to_owned()))
    }
    /// Borrow the validated name.
    pub fn as_str(&self) -> &str {
        &self.0
    }
    /// Take the validated name.
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl TryFrom<String> for StoragePoolName {
    type Error = InvalidName;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl std::fmt::Display for StoragePoolName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// An Incus custom storage volume name, e.g. a computer's data disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct StorageVolumeName(String);

impl StorageVolumeName {
    /// Validate the name before making an Incus request.
    pub fn try_new(value: &str) -> Result<Self, InvalidName> {
        if !(!value.is_empty()
            && value != "."
            && value != ".."
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.')))
        {
            return Err(InvalidName::StorageVolumeName);
        }
        Ok(Self(value.to_owned()))
    }
    /// Borrow the validated name.
    pub fn as_str(&self) -> &str {
        &self.0
    }
    /// Take the validated name.
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl TryFrom<String> for StorageVolumeName {
    type Error = InvalidName;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl std::fmt::Display for StorageVolumeName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for StorageVolumeName {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::try_from(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

impl InstanceName {
    /// Build the canonical computer name from its parsed UUID.
    pub fn from_uuid(id: uuid::Uuid) -> Self {
        Self(format!("mc-{}", id.simple()))
    }
}

#[cfg(test)]
mod test;

impl<'de> Deserialize<'de> for InstanceName {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::try_from(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

impl<'de> Deserialize<'de> for ImageAlias {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::try_from(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

impl<'de> Deserialize<'de> for ProfileName {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::try_from(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

impl<'de> Deserialize<'de> for StoragePoolName {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::try_from(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}
