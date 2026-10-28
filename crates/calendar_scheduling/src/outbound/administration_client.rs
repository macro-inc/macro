//! Scheduling administration through the calendar service's authenticated API.
use crate::domain::{
    administration::SchedulingAdministration,
    insights::{BookingInsights, InsightQuery},
    management::BookingChange,
    models::*,
};
use chrono::{DateTime, NaiveDate, Utc};
use reqwest::{Client, Method, RequestBuilder, StatusCode};
use serde::{Deserialize, de::DeserializeOwned};
use uuid::Uuid;

/// Keeps calendar provider writes and recovery in the calendar service.
pub struct SchedulingAdministrationClient {
    base_url: String,
    internal_api_key: String,
    http: Client,
}
impl SchedulingAdministrationClient {
    /// `calendar_url` includes the `/calendar` gateway prefix.
    pub fn new(calendar_url: String, internal_api_key: String) -> Self {
        Self {
            base_url: format!("{}/scheduling", calendar_url.trim_end_matches('/')),
            internal_api_key,
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .expect("static HTTP client configuration is valid"),
        }
    }
    fn request(
        &self,
        method: Method,
        path: &str,
        user: &str,
        team: Option<Uuid>,
    ) -> RequestBuilder {
        let request = self
            .http
            .request(method, format!("{}{path}", self.base_url))
            .header("x-internal-auth-key", &self.internal_api_key)
            .header("x-internal-macro-user-id", user);
        match team {
            Some(team) => request.query(&[("teamId", team)]),
            None => request,
        }
    }
    async fn send<T: DeserializeOwned>(&self, request: RequestBuilder) -> Result<T, Error> {
        let response = request.send().await.map_err(|_| Error::Unavailable)?;
        if response.status().is_success() {
            return response.json().await.map_err(|_| Error::Unavailable);
        }
        let status = response.status();
        let body = response.json::<ErrorBody>().await.ok();
        Err(match status {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Error::Forbidden,
            StatusCode::NOT_FOUND => Error::NotFound,
            StatusCode::CONFLICT => Error::Conflict,
            StatusCode::TOO_MANY_REQUESTS => Error::RateLimited,
            StatusCode::BAD_REQUEST => Error::Invalid(
                body.map(|b| b.message)
                    .unwrap_or_else(|| "Invalid scheduling request".into()),
            ),
            _ => Error::Unavailable,
        })
    }
}
#[derive(Deserialize)]
struct ErrorBody {
    message: String,
}
#[derive(Deserialize)]
struct ProfileBody {
    profile: Profile,
}
#[derive(Deserialize)]
struct BookingsBody {
    bookings: Vec<Booking>,
}
#[derive(Deserialize)]
struct BookingBody {
    booking: Booking,
}
#[derive(Deserialize)]
struct SlotsBody {
    slots: Vec<Slot>,
}
impl SchedulingAdministration for SchedulingAdministrationClient {
    async fn settings(&self, user: &str, team: Option<Uuid>) -> Result<Profile, Error> {
        Ok(self
            .send::<ProfileBody>(self.request(Method::GET, "/settings", user, team))
            .await?
            .profile)
    }
    async fn save(
        &self,
        user: &str,
        team: Option<Uuid>,
        profile: Profile,
    ) -> Result<Profile, Error> {
        Ok(self
            .send::<ProfileBody>(
                self.request(Method::PUT, "/settings", user, team)
                    .json(&profile),
            )
            .await?
            .profile)
    }
    async fn bookings_in_range(
        &self,
        user: &str,
        team: Option<Uuid>,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Vec<Booking>, Error> {
        Ok(self
            .send::<BookingsBody>(
                self.request(Method::GET, "/bookings", user, team)
                    .query(&[("from", from), ("to", to)]),
            )
            .await?
            .bookings)
    }
    async fn booking_insights(
        &self,
        user: &str,
        team: Option<Uuid>,
        query: InsightQuery,
    ) -> Result<BookingInsights, Error> {
        self.send(
            self.request(Method::POST, "/insights", user, team)
                .json(&query),
        )
        .await
    }
    async fn change_booking(
        &self,
        user: &str,
        id: Uuid,
        change: BookingChange,
    ) -> Result<Booking, Error> {
        Ok(self
            .send::<BookingBody>(
                self.request(Method::POST, &format!("/bookings/{id}/change"), user, None)
                    .json(&change),
            )
            .await?
            .booking)
    }
    async fn host_replacement_slots(
        &self,
        user: &str,
        id: Uuid,
        date: NaiveDate,
    ) -> Result<Vec<Slot>, Error> {
        Ok(self
            .send::<SlotsBody>(
                self.request(Method::GET, &format!("/bookings/{id}/slots"), user, None)
                    .query(&[("date", date)]),
            )
            .await?
            .slots)
    }
}

#[cfg(test)]
mod test;
