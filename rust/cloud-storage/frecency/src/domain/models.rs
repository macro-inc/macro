//! This crate provides the utilities to compute aggregate frecency scores from some input event
use chrono::{DateTime, Utc};
use macro_user_id::{
    cowlike::CowLike,
    user_id::{MacroUserIdStr, ParseErr},
};
use model_entity::{
    Entity, TrackAction, TrackingData,
    as_owned::{IntoOwned, ShallowClone},
};
use num_traits::ToPrimitive;
use ordered_float::OrderedFloat;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};

#[cfg(test)]
mod tests;

/// the data required to construct a single event
#[derive(Debug, Serialize, Clone)]
#[non_exhaustive]
pub struct EventRecord<'a> {
    /// the entity on which the event occured + the user that triggered it
    pub event: TrackingData<'a>,
    /// the timestamp of the event
    pub timestamp: chrono::DateTime<Utc>,
}

/// wrapper around [EventRecord] which allows any persistence layer to associate extra identifier data with a given record
#[derive(Debug, Serialize, Clone)]
pub struct EventRecordWithId<'a, T> {
    /// the inner [EventRecord]
    #[serde(flatten)]
    pub event_record: EventRecord<'a>,

    /// the identifier for this record as it exists in some db
    #[serde(flatten)]
    pub id: T,
}

impl EventRecord<'_> {
    /// grants a caller read only access to the [TrackingData]
    pub fn event(&self) -> &TrackingData<'_> {
        &self.event
    }
}

impl<'a> EventRecord<'a> {
    /// create a new [EventRecord] using the current UTC time as the timestamp
    pub fn new(event: TrackingData<'a>) -> Self {
        EventRecord {
            event,
            timestamp: Utc::now(),
        }
    }
}

/// A simple record which records a timestamp for an event and the weight of that event
#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
pub struct TimestampWeight {
    /// The time at which the event occurred
    pub timestamp: DateTime<Utc>,
    /// the weight assigned to this event
    pub weight: f64,
}

/// The keys to uniquely identify a single [AggregateFrecency]
#[derive(Debug, Serialize, Deserialize, Clone, Hash, PartialEq, Eq)]
pub struct AggregateId<'a> {
    /// The user id that created this [AggregateFrecency] record
    pub user_id: MacroUserIdStr<'a>,
    /// the [Entity] that the [AggregateFrecency] record is referencing
    pub entity: Entity<'a>,
}

impl<'a> AggregateId<'a> {
    pub(crate) fn from_event_record<T>(r: &'a EventRecordWithId<'a, T>) -> Result<Self, ParseErr> {
        Ok(AggregateId {
            user_id: MacroUserIdStr::parse_from_str(r.event_record.event.entity.user_id.as_ref())?,
            entity: r.event_record.event.entity.extra.extra.shallow_clone(),
        })
    }

    pub(crate) fn into_owned(self) -> AggregateId<'static> {
        let AggregateId { user_id, entity } = self;
        AggregateId {
            user_id: user_id.into_owned(),
            entity: entity.into_owned(),
        }
    }
}

/// The aggregated frecency record which is constructed from many [EventRecord]
/// A single [AggregateFrecency] describes a single [Entity]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[non_exhaustive]
pub struct AggregateFrecency {
    /// the unique identifier for this aggregate record
    #[serde(flatten)]
    pub id: AggregateId<'static>,

    /// the frecency data associated with the record
    #[serde(flatten)]
    pub data: FrecencyData,
}

/// struct which contains the frecency score for a given [AggregateId]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FrecencyData {
    /// the total number of events that have occurred on this entity
    pub event_count: usize,

    /// the current aggregate frecency score for this entity
    pub frecency_score: f64,

    /// the utc timestamp of the first recorded event for this entity
    pub first_event: DateTime<Utc>,

    /// A list of the most recents event timestamps and their weight
    pub recent_events: VecDeque<TimestampWeight>,
}

#[cfg(feature = "mock")]
impl AggregateFrecency {
    /// mock function for testing purposes
    pub fn new_mock(entity: Entity<'static>, frecency_score: f64) -> Self {
        AggregateFrecency {
            id: AggregateId {
                user_id: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
                entity,
            },
            data: FrecencyData {
                event_count: 1,
                frecency_score,
                first_event: Default::default(),
                recent_events: VecDeque::new(),
            },
        }
    }
}

trait WeightForAction {
    fn get_weight(&self) -> f64;
}

impl WeightForAction for TrackAction {
    fn get_weight(&self) -> f64 {
        match self {
            TrackAction::Open => 2.0,
            TrackAction::Ping => 0.0,
            TrackAction::Close => -1.0,
        }
    }
}

/// the max number of events we look at for recency
const MAX_RECENT_EVENTS: usize = 10;
/// The rate at which recency decays per hour
/// A larger number means more decay
const RECENCY_DECAY_RATE: f64 = 0.1;
/// The percentage weighting that Frequency factors into frecency.
/// That is to say 1.0 - FREQUENCY_WEIGHT = RECENCY_WEIGHT
const FREQUENCY_PERCENT: f64 = 0.7;

impl AggregateFrecency {
    /// Create a new inital record from a given [TrackingData] event
    /// This should only be called if there is not yet an aggregate record for
    /// this user/this entity
    pub fn new_from_initial_action(
        event: EventRecord<'_>,
        now: DateTime<Utc>,
    ) -> Result<Self, ParseErr> {
        let mut out = Self {
            id: AggregateId {
                user_id: MacroUserIdStr::parse_from_str(&event.event.entity.user_id)?.into_owned(),
                entity: event.event.entity.extra.extra.into_owned(),
            },
            data: FrecencyData {
                event_count: 0,
                frecency_score: 0.0,
                first_event: event.timestamp,
                recent_events: VecDeque::with_capacity(1),
            },
        };
        out.append_event_inner(
            TimestampWeight {
                timestamp: event.timestamp,
                weight: event.event.action.get_weight(),
            },
            now,
        );
        Ok(out)
    }

    /// create a new instance of Self similar to [Self::new_from_initial_action]
    /// but instead using an input [MacroUserIdStr]
    pub fn new_from_initial_action_and_user_id(
        user_id: MacroUserIdStr<'static>,
        event: EventRecord<'_>,
        now: DateTime<Utc>,
    ) -> Self {
        let mut out = Self {
            id: AggregateId {
                user_id,
                entity: event.event.entity.extra.extra.into_owned(),
            },
            data: FrecencyData {
                event_count: 0,
                frecency_score: 0.0,
                first_event: event.timestamp,
                recent_events: VecDeque::with_capacity(1),
            },
        };
        out.append_event_inner(
            TimestampWeight {
                timestamp: event.timestamp,
                weight: event.event.action.get_weight(),
            },
            now,
        );
        out
    }

    /// Consume self to return an updated version which accounts for the new input [EventRecord].
    /// NB: this function does not validate the input [EventRecord] references the same entity as the [AggregateFrecency].
    /// It is the callers job to make sure they are calling this method on matching entity ids otherwise the stats will get borked.
    pub fn append_event(mut self, event: &EventRecord, now: DateTime<Utc>) -> Self {
        self.append_event_mut(event, now);
        self
    }

    /// this is the same as [AggregateFrecency::append_event] but works off of a &mut ref instead of an owned value
    pub fn append_event_mut(&mut self, event: &EventRecord, now: DateTime<Utc>) {
        self.append_event_inner(
            TimestampWeight {
                timestamp: event.timestamp,
                weight: event.event.action.get_weight(),
            },
            now,
        );
    }

    /// Consume self to return an updated version which accounts for the new input [TimestampWeight]
    /// This is the actual implementation of [Self::append_event]
    fn append_event_inner(&mut self, action: TimestampWeight, now: DateTime<Utc>) {
        self.data.event_count += 1;
        self.data.recent_events.push_front(action);
        self.data.recent_events.truncate(MAX_RECENT_EVENTS);
        self.data.frecency_score = self.calc_frecency(now);
    }

    fn calc_frequency(&self) -> f64 {
        // we add 2 to avoid log(0) and log(1)
        (self.data.event_count.to_f64().unwrap_or_default() + 2.0).log2()
    }

    fn calc_recency(&self, now: DateTime<Utc>) -> f64 {
        self.data.recent_events.iter().fold(0.0, |acc, cur| {
            let delta_hours = now.signed_duration_since(cur.timestamp).num_hours();
            if delta_hours < 0 {
                return acc;
            }
            let Some(hours) = delta_hours.to_f64() else {
                return acc;
            };
            let decay_factor = (-RECENCY_DECAY_RATE * hours).exp();
            acc + (decay_factor * cur.weight)
        })
    }

    fn calc_frecency(&self, now: DateTime<Utc>) -> f64 {
        let recency_percent = 1.0 - FREQUENCY_PERCENT;
        (FREQUENCY_PERCENT * self.calc_frequency()) + (recency_percent * self.calc_recency(now))
    }
}

/// Stats about the number of events that were processed and aggregated into a [AggregateFrecency]
#[derive(Debug, Clone, Copy, Default)]
#[non_exhaustive]
pub struct EventAggregationStats {
    /// the count of events that were processed
    pub event_count: usize,
    /// the count of aggregate records that already existed
    pub existing_aggregate_count: usize,
    /// the count of newly create records
    pub new_aggregate_count: usize,
}

impl std::ops::AddAssign for EventAggregationStats {
    fn add_assign(&mut self, rhs: Self) {
        self.event_count += rhs.event_count;
        self.existing_aggregate_count += rhs.existing_aggregate_count;
        self.new_aggregate_count += rhs.new_aggregate_count;
    }
}

/// request to get a single page of a frecency from the service
#[derive(Debug)]
pub struct FrecencyPageRequest<'a> {
    /// the [MacroUserIdStr] who is making the request
    pub user_id: MacroUserIdStr<'a>,
    /// the maximum score that can be returned in the response.
    /// This is used for pagination, if None is provided the max is unbounded (first page)
    pub from_score: Option<f64>,
    /// the limit to the number of results to return on the page
    pub limit: u32,
}

/// the response which contains the single page of frecency from the service
pub struct FrecencyPageResponse {
    results: HashMap<AggregateId<'static>, FrecencyData>,
}

impl FrecencyPageResponse {
    pub(crate) fn new(iter: impl IntoIterator<Item = AggregateFrecency>) -> Self {
        let results = iter
            .into_iter()
            .map(|AggregateFrecency { id, data }| (id, data))
            .collect();
        FrecencyPageResponse { results }
    }

    /// create a new mock value for testing
    #[cfg(feature = "mock")]
    pub fn new_mock(iter: impl IntoIterator<Item = AggregateFrecency>) -> Self {
        Self::new(iter)
    }
}

impl FrecencyPageResponse {
    /// return an iterator over all the ids in the [FrecencyPageResponse]
    pub fn ids(&self) -> impl Iterator<Item = &AggregateId<'static>> + '_ {
        self.results.keys()
    }
}

/// trait for joining the data source
pub trait JoinFrecency: Iterator + Sized {
    /// join the frecency results to some other data source
    fn join_frecency<Cb>(
        self,
        mut frecency_data: FrecencyPageResponse,
        mut join_on: Cb,
    ) -> Vec<(<Self as Iterator>::Item, AggregateFrecency)>
    where
        Cb: FnMut(&<Self as Iterator>::Item) -> AggregateId<'_>,
        <Self as Iterator>::Item: 'static,
    {
        let mut out: Vec<_> = self
            .filter_map(move |v| {
                let id = join_on(&v).into_owned();
                let data = frecency_data.results.remove(&id)?;
                Some((v, AggregateFrecency { id, data }))
            })
            .collect();

        out.sort_unstable_by_key(|i| std::cmp::Reverse(OrderedFloat(i.1.data.frecency_score)));

        out
    }
}

impl<T> JoinFrecency for T where T: Iterator + Sized {}
