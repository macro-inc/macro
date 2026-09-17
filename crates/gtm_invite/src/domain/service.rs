//! GTM invite service implementation.

#[cfg(test)]
mod test;

use chrono::Utc;
use macro_user_id::{cowlike::CowLike, email::Email, user_id::MacroUserIdStr};
use uuid::Uuid;

use crate::domain::{
    models::{
        CreateInviteLink, GtmInviteConfig, GtmInviteError, InviteLink, InviteLinkStatus,
        InviteToken, ListInviteLinks, MAX_FIRST_NAME_LENGTH, MAX_NOTE_LENGTH,
    },
    ports::{GtmInviteRepo, GtmInviteService},
};

/// Most links the dashboard lists in one call.
const DASHBOARD_LIST_LIMIT: i64 = 500;

/// The concrete invite link service implementation.
pub struct GtmInviteServiceImpl<R> {
    /// Invite link repository.
    pub repo: R,
    /// The offer every new link carries.
    pub config: GtmInviteConfig,
}

impl<R: GtmInviteRepo> GtmInviteService for GtmInviteServiceImpl<R> {
    fn config(&self) -> &GtmInviteConfig {
        &self.config
    }

    #[tracing::instrument(skip_all, fields(creator = %creator.as_ref()), err)]
    async fn create_link(
        &self,
        creator: &MacroUserIdStr<'_>,
        request: CreateInviteLink,
    ) -> Result<InviteLink, GtmInviteError> {
        require_staff(creator)?;
        let request = normalize_create_request(request)?;

        let now = Utc::now();
        let link = InviteLink {
            id: macro_uuid::generate_uuid_v7(),
            token: InviteToken::generate(),
            first_name: request.first_name,
            recipient_email: request.recipient_email,
            note: request.note,
            promo_code: self.config.promo_code.clone(),
            created_by: creator.clone().into_owned(),
            created_at: now,
            expires_at: now + self.config.link_ttl,
            revoked_at: None,
            open_count: 0,
            first_opened_at: None,
            redemption: None,
        };

        self.repo.insert_link(&link).await.map_err(internal)?;
        Ok(link)
    }

    #[tracing::instrument(skip_all, fields(caller = %caller.as_ref(), only_mine), err)]
    async fn list_links(
        &self,
        caller: &MacroUserIdStr<'_>,
        only_mine: bool,
    ) -> Result<Vec<InviteLink>, GtmInviteError> {
        require_staff(caller)?;
        let filter = ListInviteLinks {
            created_by: only_mine.then(|| caller.clone().into_owned()),
            limit: DASHBOARD_LIST_LIMIT,
        };
        self.repo.list_links(&filter).await.map_err(internal)
    }

    #[tracing::instrument(skip_all, fields(caller = %caller.as_ref(), link_id = %id), err)]
    async fn revoke_link(
        &self,
        caller: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> Result<InviteLink, GtmInviteError> {
        require_staff(caller)?;
        let link = self
            .repo
            .get_link_by_id(id)
            .await
            .map_err(internal)?
            .ok_or(GtmInviteError::NotFound)?;

        if link.redemption.is_some() {
            return Err(already_used());
        }

        if link.revoked_at.is_none() {
            // The update is conditional on the row still being unredeemed, so a
            // signup racing this revoke wins and keeps its attribution.
            let revoked = self
                .repo
                .revoke_link(id, Utc::now())
                .await
                .map_err(internal)?;
            if !revoked {
                return Err(already_used());
            }
        }

        self.repo
            .get_link_by_id(id)
            .await
            .map_err(internal)?
            .ok_or(GtmInviteError::NotFound)
    }

    #[tracing::instrument(skip_all, err)]
    async fn resolve_link(&self, token: &InviteToken) -> Result<InviteLink, GtmInviteError> {
        let link = self
            .repo
            .get_link_by_token(token)
            .await
            .map_err(internal)?
            .ok_or(GtmInviteError::NotFound)?;

        // Tracking only — never fail the welcome page over it.
        let _ = self
            .repo
            .record_open(link.id, Utc::now())
            .await
            .inspect_err(|e| tracing::warn!(error=?e, "failed to record invite link open"));

        Ok(link)
    }

    #[tracing::instrument(skip_all, fields(user = %user.as_ref()), err)]
    async fn redeem_link(
        &self,
        token: &InviteToken,
        user: &MacroUserIdStr<'_>,
    ) -> Result<InviteLink, GtmInviteError> {
        let link = self
            .repo
            .get_link_by_token(token)
            .await
            .map_err(internal)?
            .ok_or(GtmInviteError::NotFound)?;

        if link.is_redeemed_by(user) {
            return Ok(link);
        }

        // A user holds one offer: whichever link they redeemed first stays.
        if let Some(existing) = self
            .repo
            .get_redeemed_link_for_user(user)
            .await
            .map_err(internal)?
        {
            tracing::info!(
                existing_link_id = %existing.id,
                link_id = %link.id,
                "user already redeemed another invite link; keeping the first"
            );
            return Ok(existing);
        }

        let now = Utc::now();
        match link.status(now) {
            InviteLinkStatus::Active => {}
            InviteLinkStatus::Expired => return Err(GtmInviteError::Expired),
            InviteLinkStatus::Revoked => return Err(GtmInviteError::Revoked),
            InviteLinkStatus::Redeemed | InviteLinkStatus::Converted => {
                return Err(GtmInviteError::AlreadyRedeemed);
            }
        }

        // The repository re-checks the guards atomically; `None` means a
        // concurrent signup, revoke, or the expiry beat us.
        self.repo
            .redeem_link(link.id, user, now)
            .await
            .map_err(internal)?
            .ok_or(GtmInviteError::AlreadyRedeemed)
    }

    #[tracing::instrument(skip_all, fields(user = %user.as_ref()), err)]
    async fn active_offer_for_user(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> Result<Option<InviteLink>, GtmInviteError> {
        let link = self
            .repo
            .get_redeemed_link_for_user(user)
            .await
            .map_err(internal)?;
        Ok(link.filter(|link| {
            link.redemption
                .as_ref()
                .is_some_and(|redemption| redemption.conversion.is_none())
        }))
    }

    #[tracing::instrument(skip_all, fields(user = %user.as_ref(), stripe_subscription_id), err)]
    async fn mark_converted(
        &self,
        user: &MacroUserIdStr<'_>,
        stripe_subscription_id: &str,
    ) -> Result<bool, GtmInviteError> {
        self.repo
            .mark_converted(user, stripe_subscription_id, Utc::now())
            .await
            .map_err(internal)
    }
}

fn require_staff(user: &MacroUserIdStr<'_>) -> Result<(), GtmInviteError> {
    if user.is_macro_staff() {
        Ok(())
    } else {
        Err(GtmInviteError::Forbidden)
    }
}

fn internal<E: Into<anyhow::Error>>(error: E) -> GtmInviteError {
    GtmInviteError::Internal(error.into())
}

fn already_used() -> GtmInviteError {
    GtmInviteError::BadRequest("a link someone already signed up through cannot be revoked".into())
}

/// Trims and validates staff input for a new link.
pub(crate) fn normalize_create_request(
    request: CreateInviteLink,
) -> Result<CreateInviteLink, GtmInviteError> {
    let first_name = request.first_name.trim();
    if first_name.is_empty() {
        return Err(GtmInviteError::BadRequest("first name is required".into()));
    }
    if first_name.chars().count() > MAX_FIRST_NAME_LENGTH {
        return Err(GtmInviteError::BadRequest(format!(
            "first name must be at most {MAX_FIRST_NAME_LENGTH} characters"
        )));
    }

    let recipient_email = match nonblank(request.recipient_email.as_deref()) {
        None => None,
        Some(email) => {
            let lowercased = email.to_lowercase();
            Email::parse_from_str(&lowercased).map_err(|_| {
                GtmInviteError::BadRequest("recipient email is not a valid email address".into())
            })?;
            Some(lowercased)
        }
    };

    let note = nonblank(request.note.as_deref()).map(str::to_owned);
    if note
        .as_ref()
        .is_some_and(|note| note.chars().count() > MAX_NOTE_LENGTH)
    {
        return Err(GtmInviteError::BadRequest(format!(
            "note must be at most {MAX_NOTE_LENGTH} characters"
        )));
    }

    Ok(CreateInviteLink {
        first_name: first_name.to_owned(),
        recipient_email,
        note,
    })
}

fn nonblank(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}
