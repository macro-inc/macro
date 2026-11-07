use activity::{ActivityOverview, DayCount, EntityRank, trailing_year};
use async_graphql::{Context, ID, InputObject, SimpleObject};
use chrono::Utc;
use chrono_tz::Tz;
use graphql_common::GraphqlEntityType;
use macro_user_id::user_id::MacroUserIdStr;

use crate::loaders::ActivityFeedReader;

#[cfg(test)]
mod test;

/// Request for the authenticated user's trailing-year activity overview.
#[derive(InputObject)]
pub struct ActivityOverviewInput {
    /// IANA time zone used for local dates. Omitted or empty means UTC.
    pub time_zone: Option<String>,
}

/// Activity aggregated over the authenticated user's trailing year.
///
/// This value has no `id`, so the normalized client cache embeds it under
/// the authenticated user instead of treating it as a global entity.
#[derive(SimpleObject)]
pub struct GraphqlActivityOverview {
    /// First local date, inclusive, in `YYYY-MM-DD` form.
    pub from: String,
    /// One past the final local date, exclusive, in `YYYY-MM-DD` form.
    pub to: String,
    /// IANA time zone used for the window and day buckets.
    pub time_zone: String,
    /// Total activity in the window.
    pub total: i32,
    /// Sparse positive day counts in ascending order.
    pub days: Vec<GraphqlActivityDay>,
    /// Most active entities in stable rank order.
    pub top_entities: Vec<GraphqlActivityEntityRank>,
}

/// One local date with activity.
#[derive(SimpleObject)]
pub struct GraphqlActivityDay {
    /// Local date in `YYYY-MM-DD` form.
    pub date: String,
    /// Number of activities on that date.
    pub count: i32,
}

/// One entity ranked by its activity count.
#[derive(SimpleObject)]
pub struct GraphqlActivityEntityRank {
    /// Kind of entity.
    pub entity_type: GraphqlEntityType,
    /// Entity identifier.
    pub entity_id: ID,
    /// Number of activities that touched the entity.
    pub count: i32,
}

impl TryFrom<ActivityOverview> for GraphqlActivityOverview {
    type Error = async_graphql::Error;

    fn try_from(overview: ActivityOverview) -> Result<Self, Self::Error> {
        let total = graphql_count(overview.total())?;
        let days = overview
            .days
            .iter()
            .copied()
            .map(GraphqlActivityDay::try_from)
            .collect::<Result<Vec<_>, _>>()?;
        let top_entities = overview
            .top_entities
            .iter()
            .cloned()
            .map(GraphqlActivityEntityRank::try_from)
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Self {
            from: overview.window.start.to_string(),
            to: overview.window.end.to_string(),
            time_zone: overview.window.zone.name().to_owned(),
            total,
            days,
            top_entities,
        })
    }
}

impl TryFrom<DayCount> for GraphqlActivityDay {
    type Error = async_graphql::Error;

    fn try_from(day: DayCount) -> Result<Self, Self::Error> {
        Ok(Self {
            date: day.day.to_string(),
            count: graphql_count(day.count.get())?,
        })
    }
}

impl TryFrom<EntityRank> for GraphqlActivityEntityRank {
    type Error = async_graphql::Error;

    fn try_from(rank: EntityRank) -> Result<Self, Self::Error> {
        Ok(Self {
            entity_type: GraphqlEntityType::new(rank.entity_type),
            entity_id: ID(rank.entity_id),
            count: graphql_count(rank.count.get())?,
        })
    }
}

/// Narrow a domain count to GraphQL `Int`, rejecting overflow.
fn graphql_count(count: u64) -> async_graphql::Result<i32> {
    i32::try_from(count)
        .map_err(|_| async_graphql::Error::new("activity count exceeds GraphQL Int"))
}

/// Parse an optional IANA zone name; omitted or empty means UTC.
fn parse_time_zone(time_zone: Option<String>) -> async_graphql::Result<Tz> {
    let Some(time_zone) = time_zone.filter(|zone| !zone.is_empty()) else {
        return Ok(chrono_tz::UTC);
    };
    time_zone
        .parse()
        .map_err(|_| async_graphql::Error::new("invalid timeZone: expected an IANA zone name"))
}

/// Resolve the authenticated user's activity overview.
pub async fn resolve_activity_overview<R>(
    ctx: &Context<'_>,
    user_id: &MacroUserIdStr<'static>,
    input: ActivityOverviewInput,
) -> async_graphql::Result<GraphqlActivityOverview>
where
    R: ActivityFeedReader,
{
    let reader = ctx.data::<R>()?;
    let zone = parse_time_zone(input.time_zone)?;
    let window = trailing_year(Utc::now(), zone);
    let overview = reader
        .subject_overview(user_id.as_ref(), window)
        .await
        .map_err(|_| async_graphql::Error::new("activity overview is unavailable"))?;
    overview
        .try_into()
        .map_err(|_| async_graphql::Error::new("activity overview is unavailable"))
}
