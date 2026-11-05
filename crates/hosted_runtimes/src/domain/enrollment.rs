//! What a computer reads at first boot to join Macro.
//!
//! The control plane writes one [`Enrollment`] as JSON into the instance
//! config key [`INCUS_ENROLLMENT_KEY`] (read in the guest from `/dev/incus`),
//! or into a file for Docker computers, and deletes it once macrod connects.
//! These types are the contract between the control plane and
//! `macrod enroll`; macrod depends on this crate with default features off.

use std::borrow::Borrow;
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Instance config key carrying the JSON [`Enrollment`].
pub const INCUS_ENROLLMENT_KEY: &str = "user.macro.enrollment";

/// One-time join material. The device secret claims a pre-approved harness
/// pairing exactly once; a copy read after that claim is useless.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Enrollment {
    pub computer_id: Uuid,
    pub pairing_id: Uuid,
    pub device_secret: String,
    /// Display name the harness shows in Settings → Runtimes.
    pub name: String,
    /// `OVERRIDE_*` service URL variables (see `macro_service_urls`) macrod
    /// must use, for stacks that are not the computer's default environment.
    pub service_url_overrides: BTreeMap<String, String>,
    /// The agent persona this computer is bought for, if any.
    pub persona: Option<Persona>,
}

/// An agent identity that lives on the computer next to macrod: its own OS
/// user and its own long-running systemd service.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct Persona {
    pub name: String,
    /// Linux user created for the persona; its service runs as this user.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub os_user: PersonaOsUser,
    pub extra_service: PersonaService,
    /// Written to `/etc/macro/personas/<os_user>.env` and loaded by the
    /// persona's unit as its `EnvironmentFile`.
    pub config: BTreeMap<PersonaConfigKey, String>,
}

/// The persona's systemd service, installed as
/// `/etc/systemd/system/<unit_name>.service`.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PersonaService {
    /// Unit name without the `.service` suffix.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub unit_name: SystemdUnitName,
    /// `ExecStart` command line.
    pub exec: String,
    /// Extra `Environment=` values, on top of the `EnvironmentFile`.
    pub env: BTreeMap<PersonaConfigKey, String>,
}

impl std::fmt::Debug for Persona {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let config: BTreeMap<_, _> = self
            .config
            .keys()
            .map(|key| (key, "**redacted**"))
            .collect();
        f.debug_struct("Persona")
            .field("name", &self.name)
            .field("os_user", &self.os_user)
            .field("extra_service", &self.extra_service)
            .field("config", &config)
            .finish()
    }
}

impl std::fmt::Debug for PersonaService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let env: BTreeMap<_, _> = self.env.keys().map(|key| (key, "**redacted**")).collect();
        f.debug_struct("PersonaService")
            .field("unit_name", &self.unit_name)
            .field("exec", &self.exec)
            .field("env", &env)
            .finish()
    }
}

#[cfg(test)]
mod test;

/// A persona field that violates its construction rule.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PersonaFieldError {
    /// The OS user must be a safe Linux user name with the persona prefix.
    #[error("persona users must start with `agent-` and match ^agent-[a-z0-9][a-z0-9_-]{{0,24}}$")]
    OsUser,
    /// The unit name must be safe and must not replace a macrod unit.
    #[error(
        "persona unit_name must match ^[A-Za-z0-9_.@-]{{1,64}}$ and must not start with macrod"
    )]
    UnitName,
    /// Config and environment keys must be environment variable names.
    #[error("persona config key must match ^[A-Za-z_][A-Za-z0-9_]*$")]
    ConfigKey,
}

/// A validated Linux user name for a persona, starting with `agent-`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "inbound", schema(value_type = String))]
pub struct PersonaOsUser(String);

impl PersonaOsUser {
    /// Parse a value, rejecting invalid persona fields.
    pub fn parse(value: &str) -> Result<Self, PersonaFieldError> {
        if !lazy_regex::regex_is_match!(r"^agent-[a-z0-9][a-z0-9_-]{0,24}$", value) {
            return Err(PersonaFieldError::OsUser);
        }
        Ok(Self(value.to_owned()))
    }

    /// Borrow the validated value.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Take the validated value.
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl TryFrom<String> for PersonaOsUser {
    type Error = PersonaFieldError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}

impl From<PersonaOsUser> for String {
    fn from(value: PersonaOsUser) -> Self {
        value.into_inner()
    }
}

impl std::fmt::Display for PersonaOsUser {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A validated systemd unit name, without the `.service` suffix.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "inbound", schema(value_type = String))]
pub struct SystemdUnitName(String);

impl SystemdUnitName {
    /// Parse a value, rejecting invalid persona fields.
    pub fn parse(value: &str) -> Result<Self, PersonaFieldError> {
        if !lazy_regex::regex_is_match!(r"^[A-Za-z0-9_.@-]{1,64}$", value)
            || lazy_regex::regex_is_match!(r"^macrod", value)
        {
            return Err(PersonaFieldError::UnitName);
        }
        Ok(Self(value.to_owned()))
    }

    /// Borrow the validated value.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Take the validated value.
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl TryFrom<String> for SystemdUnitName {
    type Error = PersonaFieldError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}

impl From<SystemdUnitName> for String {
    fn from(value: SystemdUnitName) -> Self {
        value.into_inner()
    }
}

impl std::fmt::Display for SystemdUnitName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A validated environment variable name for persona config or service env.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "inbound", schema(value_type = String))]
pub struct PersonaConfigKey(String);

impl PersonaConfigKey {
    /// Parse a value, rejecting invalid persona fields.
    pub fn parse(value: &str) -> Result<Self, PersonaFieldError> {
        if !lazy_regex::regex_is_match!(r"^[A-Za-z_][A-Za-z0-9_]*$", value) {
            return Err(PersonaFieldError::ConfigKey);
        }
        Ok(Self(value.to_owned()))
    }

    /// Borrow the validated value.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Take the validated value.
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl TryFrom<String> for PersonaConfigKey {
    type Error = PersonaFieldError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}

impl From<PersonaConfigKey> for String {
    fn from(value: PersonaConfigKey) -> Self {
        value.into_inner()
    }
}

impl std::fmt::Display for PersonaConfigKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl Borrow<str> for PersonaConfigKey {
    fn borrow(&self) -> &str {
        self.as_str()
    }
}
