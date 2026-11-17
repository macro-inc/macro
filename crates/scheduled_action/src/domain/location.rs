//! Routines that run when their owner's phone arrives at or leaves a place.
//!
//! The phone watches the places itself (OS geofencing), so the server never
//! receives a location: a registered phone reports only that it crossed one
//! of its owner's fences. Each phone holds a device token, of which the
//! server keeps the SHA-256.

use std::fmt;
use std::str::FromStr;
use std::sync::Arc;

use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use lazy_regex::{regex_captures, regex_is_match};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::{Uuid, generate_uuid_v7};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use utoipa::ToSchema;

use super::models::ScheduledAction;
use super::ports::{ScheduledActionExecutor, ScheduledActionRepo};

#[cfg(test)]
mod test;

pub const MIN_RADIUS_METERS: u32 = 100;
pub const MAX_RADIUS_METERS: u32 = 5_000;
pub const MAX_PLACE_NAME_CHARS: usize = 100;

/// Phones report a crossing more than once (GPS jitter, two phones); a place
/// runs its routine at most once in this long.
pub const FIRING_COOLDOWN: Duration = Duration::minutes(10);

/// A circle around a point: the place a location trigger watches.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(try_from = "PlaceInput")]
pub struct Place {
    /// What the owner calls it, such as "Office".
    #[schema(min_length = 1, max_length = 100)]
    name: String,
    /// Degrees north, -90 to 90.
    #[schema(minimum = -90.0, maximum = 90.0)]
    latitude: f64,
    /// Degrees east, -180 to 180.
    #[schema(minimum = -180.0, maximum = 180.0)]
    longitude: f64,
    /// How far from the point still counts as there. Phones place a fence
    /// reliably only from about 100 meters.
    #[schema(minimum = 100, maximum = 5000)]
    radius_meters: u32,
}

/// Validated coordinates are finite, so comparing their bits is exact.
impl PartialEq for Place {
    fn eq(&self, other: &Self) -> bool {
        self.name == other.name
            && self.latitude.to_bits() == other.latitude.to_bits()
            && self.longitude.to_bits() == other.longitude.to_bits()
            && self.radius_meters == other.radius_meters
    }
}

impl Eq for Place {}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PlaceInput {
    name: String,
    latitude: f64,
    longitude: f64,
    radius_meters: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum PlaceError {
    #[error("a place needs a name of at most 100 characters")]
    Name,
    #[error("latitude must be between -90 and 90, and longitude between -180 and 180")]
    Coordinates,
    #[error("a place's radius must be between 100 and 5000 meters")]
    Radius,
}

impl TryFrom<PlaceInput> for Place {
    type Error = PlaceError;

    fn try_from(input: PlaceInput) -> Result<Self, Self::Error> {
        let name = input.name.trim().to_owned();
        if name.is_empty() || name.chars().count() > MAX_PLACE_NAME_CHARS {
            return Err(PlaceError::Name);
        }

        let latitude_valid = input.latitude.is_finite() && input.latitude.abs() <= 90.0;
        let longitude_valid = input.longitude.is_finite() && input.longitude.abs() <= 180.0;
        if !latitude_valid || !longitude_valid {
            return Err(PlaceError::Coordinates);
        }

        if !(MIN_RADIUS_METERS..=MAX_RADIUS_METERS).contains(&input.radius_meters) {
            return Err(PlaceError::Radius);
        }

        Ok(Self {
            name,
            // -0.0 and 0.0 are the same place; keep equality exact.
            latitude: input.latitude + 0.0,
            longitude: input.longitude + 0.0,
            radius_meters: input.radius_meters,
        })
    }
}

impl Place {
    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn latitude(&self) -> f64 {
        self.latitude
    }

    pub fn longitude(&self) -> f64 {
        self.longitude
    }

    pub fn radius_meters(&self) -> u32 {
        self.radius_meters
    }
}

/// Crossing into or out of a place.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LocationTransition {
    Arrive,
    Leave,
}

impl From<LocationTransition> for trigger_context::PlaceTransition {
    fn from(transition: LocationTransition) -> Self {
        match transition {
            LocationTransition::Arrive => Self::Arrive,
            LocationTransition::Leave => Self::Leave,
        }
    }
}

impl From<&Place> for trigger_context::PlaceWatch {
    fn from(place: &Place) -> Self {
        Self {
            name: place.name.clone(),
            latitude: trigger_context::Degrees(place.latitude),
            longitude: trigger_context::Degrees(place.longitude),
            radius_meters: place.radius_meters,
        }
    }
}

/// One fence a phone watches: a routine's place and the crossing that runs it.
///
/// Its text form is `<routine id>.<digest>`. The digest covers the routine, the
/// circle and the crossing but not the place's name, so renaming a place keeps
/// its fence, and moving it makes the phone's old fence unknown.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct FenceId {
    routine_id: Uuid,
    digest: String,
}

impl FenceId {
    pub fn of(routine_id: Uuid, place: &Place, on: LocationTransition) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(routine_id.as_bytes());
        hasher.update(place.latitude.to_bits().to_be_bytes());
        hasher.update(place.longitude.to_bits().to_be_bytes());
        hasher.update(place.radius_meters.to_be_bytes());
        hasher.update(match on {
            LocationTransition::Arrive => b"arrive".as_slice(),
            LocationTransition::Leave => b"leave".as_slice(),
        });
        Self {
            routine_id,
            digest: hex::encode(&hasher.finalize()[..8]),
        }
    }

    pub fn routine_id(&self) -> Uuid {
        self.routine_id
    }
}

impl fmt::Display for FenceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}", self.routine_id, self.digest)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("a fence id is a routine id and a 16-digit hex digest, joined by a dot")]
pub struct FenceIdError;

impl FromStr for FenceId {
    type Err = FenceIdError;

    fn from_str(text: &str) -> Result<Self, Self::Err> {
        let (_, routine_id, digest) = regex_captures!(
            r"^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([0-9a-f]{16})$",
            text
        )
        .ok_or(FenceIdError)?;
        Ok(Self {
            routine_id: routine_id.parse().map_err(|_| FenceIdError)?,
            digest: digest.to_owned(),
        })
    }
}

impl Serialize for FenceId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for FenceId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        String::deserialize(deserializer)?
            .parse()
            .map_err(serde::de::Error::custom)
    }
}

/// A fence for the owner's phones to watch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct Fence {
    #[schema(value_type = String)]
    pub id: FenceId,
    #[schema(value_type = String, format = Uuid)]
    pub routine_id: Uuid,
    pub routine_name: String,
    pub place: Place,
    pub on: LocationTransition,
}

/// The fences of a routine's location triggers.
pub fn fences(action: &ScheduledAction) -> Vec<Fence> {
    let Some(routine_id) = action.id else {
        return Vec::new();
    };
    action
        .trigger
        .places()
        .into_iter()
        .map(|(place, on)| Fence {
            id: FenceId::of(routine_id, place, on),
            routine_id,
            routine_name: action.name.clone(),
            place: place.clone(),
            on,
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FenceList {
    pub fences: Vec<Fence>,
}

/// A phone saying it crossed one of its fences.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct LocationReport {
    #[schema(value_type = String)]
    pub fence: FenceId,
    pub on: LocationTransition,
}

/// Whether a report started its routine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub struct LocationReportOutcome {
    /// False when the place already ran it within the cooldown.
    pub started: bool,
}

/// A phone's secret: `mloc_` and 64 hex digits.
pub struct DeviceToken(String);

impl DeviceToken {
    /// The token, when `text` has its shape.
    pub fn parse(text: &str) -> Option<Self> {
        regex_is_match!(r"^mloc_[0-9a-f]{64}$", text).then(|| Self(text.to_owned()))
    }

    fn generate() -> Self {
        let mut secret = [0_u8; 32];
        rand::rng().fill_bytes(&mut secret);
        Self(format!("mloc_{}", hex::encode(secret)))
    }

    /// What the server keeps.
    pub fn hash(&self) -> [u8; 32] {
        Sha256::digest(self.0.as_bytes()).into()
    }
}

/// A newly registered phone. The token is shown only here.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct RegisteredDevice {
    #[schema(value_type = String, format = Uuid)]
    pub device_id: Uuid,
    pub token: String,
}

/// The crossing a location run started on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocationFiring {
    pub place: Place,
    pub on: LocationTransition,
    pub reported_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum LocationError {
    /// The token was never issued or its phone was removed.
    #[error("unknown device")]
    UnknownDevice,
    /// The routine is gone, disabled, someone else's, or no longer watches
    /// that place: the phone should stop watching the fence.
    #[error("unknown fence")]
    UnknownFence,
    #[error("unknown device id")]
    DeviceNotFound,
}

pub trait LocationDeviceRepo: Send + Sync + 'static {
    fn create_device(
        &self,
        id: Uuid,
        owner: &MacroUserIdStr<'static>,
        token_hash: &[u8; 32],
    ) -> impl Future<Output = Result<()>> + Send;

    /// Whether the owner had that device.
    fn delete_device(
        &self,
        id: Uuid,
        owner: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<bool>> + Send;

    fn device_owner(
        &self,
        token_hash: &[u8; 32],
    ) -> impl Future<Output = Result<Option<MacroUserIdStr<'static>>>> + Send;

    /// Records that the fence fired now unless it fired less than `cooldown`
    /// ago; whether it was recorded. Concurrent reports record one.
    fn claim_firing(
        &self,
        fence: &FenceId,
        cooldown: Duration,
    ) -> impl Future<Output = Result<bool>> + Send;
}

pub trait LocationRoutineService: Send + Sync + 'static {
    fn register_device(
        &self,
        owner: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<RegisteredDevice>> + Send;

    fn remove_device(
        &self,
        owner: &MacroUserIdStr<'static>,
        device_id: Uuid,
    ) -> impl Future<Output = Result<()>> + Send;

    /// The fences of the owner's enabled routines.
    fn fences(
        &self,
        owner: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<FenceList>> + Send;

    fn report(
        &self,
        token: DeviceToken,
        report: LocationReport,
    ) -> impl Future<Output = Result<LocationReportOutcome>> + Send;
}

pub struct LocationRoutines<Rpo, Devices, Exe> {
    repo: Arc<Rpo>,
    devices: Arc<Devices>,
    executor: Arc<Exe>,
}

impl<Rpo, Devices, Exe> LocationRoutines<Rpo, Devices, Exe> {
    pub fn new(repo: Arc<Rpo>, devices: Arc<Devices>, executor: Arc<Exe>) -> Self {
        Self {
            repo,
            devices,
            executor,
        }
    }
}

impl<Rpo, Devices, Exe> LocationRoutines<Rpo, Devices, Exe>
where
    Rpo: ScheduledActionRepo,
    Exe: ScheduledActionExecutor + Send + Sync + 'static,
{
    /// The routine behind a reported fence, when its owner still has it
    /// enabled and it still watches that crossing.
    async fn reported_routine(
        &self,
        owner: &MacroUserIdStr<'static>,
        report: &LocationReport,
    ) -> Result<(ScheduledAction, Place)> {
        let action = self
            .repo
            .get_action(&report.fence.routine_id())
            .await?
            .filter(|action| action.enabled && action.owner.as_user() == Some(owner))
            .ok_or(LocationError::UnknownFence)?;
        let place = fences(&action)
            .into_iter()
            .find(|fence| fence.id == report.fence && fence.on == report.on)
            .map(|fence| fence.place)
            .ok_or(LocationError::UnknownFence)?;
        Ok((action, place))
    }
}

impl<Rpo, Devices, Exe> LocationRoutineService for LocationRoutines<Rpo, Devices, Exe>
where
    Rpo: ScheduledActionRepo,
    Devices: LocationDeviceRepo,
    Exe: ScheduledActionExecutor + Send + Sync + 'static,
{
    async fn register_device(&self, owner: &MacroUserIdStr<'static>) -> Result<RegisteredDevice> {
        let device_id = generate_uuid_v7();
        let token = DeviceToken::generate();
        self.devices
            .create_device(device_id, owner, &token.hash())
            .await?;
        Ok(RegisteredDevice {
            device_id,
            token: token.0,
        })
    }

    async fn remove_device(&self, owner: &MacroUserIdStr<'static>, device_id: Uuid) -> Result<()> {
        if self.devices.delete_device(device_id, owner).await? {
            Ok(())
        } else {
            Err(LocationError::DeviceNotFound.into())
        }
    }

    async fn fences(&self, owner: &MacroUserIdStr<'static>) -> Result<FenceList> {
        let fences = self
            .repo
            .get_owned_actions(owner)
            .await?
            .iter()
            .filter(|action| action.enabled)
            .flat_map(fences)
            .collect();
        Ok(FenceList { fences })
    }

    #[tracing::instrument(
        name = "routine.location_report",
        skip_all,
        fields(routine_id = %report.fence.routine_id(), on = ?report.on, started)
    )]
    async fn report(
        &self,
        token: DeviceToken,
        report: LocationReport,
    ) -> Result<LocationReportOutcome> {
        let owner = self
            .devices
            .device_owner(&token.hash())
            .await?
            .ok_or(LocationError::UnknownDevice)?;
        let (action, place) = self.reported_routine(&owner, &report).await?;

        let started = self
            .devices
            .claim_firing(&report.fence, FIRING_COOLDOWN)
            .await?;
        tracing::Span::current().record("started", started);
        if !started {
            return Ok(LocationReportOutcome { started });
        }

        let firing = LocationFiring {
            place,
            on: report.on,
            reported_at: Utc::now(),
        };
        self.executor.execute_location(action, firing).await?;
        Ok(LocationReportOutcome { started })
    }
}
