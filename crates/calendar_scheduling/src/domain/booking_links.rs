//! Single-link workflows. Authorization and validation stay in the scheduling service.
pub use super::booking_link_models::*;
use super::{
    models::*,
    ports::{Directory, Repository},
    service::Service,
};
use std::future::Future;
use uuid::Uuid;

/// Workflows exposed to booking-link clients. Reads never create a profile.
pub trait BookingLinks: Send + Sync + 'static {
    /// Discover owned links and full editable drafts, optionally searching their public text.
    fn list_links(
        &self,
        user: &str,
        team: Option<Uuid>,
        query: Option<&str>,
    ) -> impl Future<Output = Result<BookingLinkListing, Error>> + Send;
    /// Create a link; replaying an identical slug and draft returns the existing link.
    fn create_link(
        &self,
        user: &str,
        team: Option<Uuid>,
        draft: BookingLinkDraft,
    ) -> impl Future<Output = Result<BookingLink, Error>> + Send;
    /// Edit exactly one link at the revision reviewed by the user. Identical retries are no-ops.
    fn edit_link(
        &self,
        user: &str,
        team: Option<Uuid>,
        event: Uuid,
        revision: i64,
        draft: BookingLinkDraft,
    ) -> impl Future<Output = Result<BookingLink, Error>> + Send;
}

fn saved_link(profile: &Profile, event: &EventType) -> Result<BookingLink, Error> {
    let schedule = profile
        .schedules
        .iter()
        .find(|s| s.id == event.schedule_id)
        .ok_or(Error::NotFound)?;
    Ok(BookingLink {
        profile_id: profile.id,
        event_type_id: event.id,
        revision: profile.revision,
        draft: BookingLinkDraft::from_parts(event, schedule),
    })
}

impl<Store: Repository, Calendar: Send + Sync + 'static, Members: Directory> BookingLinks
    for Service<Store, Calendar, Members>
{
    async fn list_links(
        &self,
        user: &str,
        team: Option<Uuid>,
        query: Option<&str>,
    ) -> Result<BookingLinkListing, Error> {
        let profile = self.settings(user, team).await?;
        let query = query.unwrap_or_default().trim().to_lowercase();
        let links = profile
            .event_types
            .iter()
            .filter(|e| {
                [&e.title, &e.slug, &e.description]
                    .iter()
                    .any(|text| text.to_lowercase().contains(&query))
            })
            .map(|event| saved_link(&profile, event))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(BookingLinkListing {
            team_ids: self.directory.user_teams(user).await?,
            user_id: user.into(),
            profile_id: profile.id,
            revision: profile.revision,
            schedules: profile.schedules,
            links,
        })
    }

    async fn create_link(
        &self,
        user: &str,
        team: Option<Uuid>,
        draft: BookingLinkDraft,
    ) -> Result<BookingLink, Error> {
        let mut profile = self.settings(user, team).await?;
        self.authorize_link_write(user, team, &profile).await?;
        if let Some(event) = profile
            .event_types
            .iter()
            .find(|e| e.slug == draft.event.slug)
        {
            let existing = saved_link(&profile, event)?;
            return if existing.draft == draft {
                Ok(existing)
            } else {
                Err(Error::Conflict)
            };
        }
        let shared_schedule = profile
            .schedules
            .iter()
            .find(|schedule| {
                let (_, wanted) = draft.clone().into_parts(Uuid::nil(), schedule.id);
                **schedule == wanted
            })
            .map(|schedule| schedule.id);
        let (event, schedule) =
            draft.into_parts(Uuid::now_v7(), shared_schedule.unwrap_or_else(Uuid::now_v7));
        if shared_schedule.is_none() {
            profile.schedules.push(schedule);
        }
        profile.event_types.push(event.clone());
        let profile = self.save(user, team, profile).await?;
        saved_link(&profile, &event)
    }

    async fn edit_link(
        &self,
        user: &str,
        team: Option<Uuid>,
        event_id: Uuid,
        revision: i64,
        draft: BookingLinkDraft,
    ) -> Result<BookingLink, Error> {
        let mut profile = self.settings(user, team).await?;
        self.authorize_link_write(user, team, &profile).await?;
        let index = profile
            .event_types
            .iter()
            .position(|e| e.id == event_id)
            .ok_or(Error::NotFound)?;
        let existing = saved_link(&profile, &profile.event_types[index])?;
        if existing.draft == draft {
            return Ok(existing);
        }
        if profile.revision != revision {
            return Err(Error::Conflict);
        }
        let old_schedule_id = profile.event_types[index].schedule_id;
        let schedule_changed = existing.draft.schedule != draft.schedule;
        // Never mutate an existing schedule: it may be another link's availability or personal default.
        let schedule_id = if schedule_changed {
            Uuid::now_v7()
        } else {
            old_schedule_id
        };
        let (event, schedule) = draft.into_parts(event_id, schedule_id);
        profile.event_types[index] = event.clone();
        if schedule_changed {
            profile.schedules.push(schedule);
            // Remove only this link's now-unused schedule, preserving explicit and legacy personal defaults.
            let default_id = profile
                .default_schedule_id
                .or_else(|| profile.schedules.first().map(|s| s.id));
            if default_id != Some(old_schedule_id)
                && !profile
                    .event_types
                    .iter()
                    .any(|e| e.schedule_id == old_schedule_id)
            {
                profile.schedules.retain(|s| s.id != old_schedule_id);
            }
        }
        let profile = self.save(user, team, profile).await?;
        saved_link(&profile, &event)
    }
}

impl<Store: Repository, Calendar, Members: Directory> Service<Store, Calendar, Members> {
    async fn authorize_link_write(
        &self,
        user: &str,
        team: Option<Uuid>,
        profile: &Profile,
    ) -> Result<(), Error> {
        self.authorize(
            user,
            &OwnedProfile {
                user_id: team.is_none().then(|| user.into()),
                team_id: team,
                profile: profile.clone(),
            },
            true,
        )
        .await
    }
}
