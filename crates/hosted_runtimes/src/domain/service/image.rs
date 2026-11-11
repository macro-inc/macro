//! Operator image updates: rebuild a computer's root disk from another
//! versioned image, keeping its data disk. Internal routes only; no UI.

use uuid::Uuid;

use super::{ComputerError, ComputerService, internal};
use crate::domain::ids::ComputerId;
use crate::domain::image::GuestImage;
use crate::domain::lifecycle::{Event, Phase};
use crate::domain::ports::{Billing, CompPolicy, ComputerRepo, FleetAttachmentSource};
use crate::domain::service::Clock;

/// An accepted image update.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ImageUpdate {
    /// The image the root disk is being rebuilt from.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub image: GuestImage,
    /// The image it ran before; `null` if creation never recorded one.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub previous_image: Option<GuestImage>,
}

impl<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
> ComputerService<Repo, Bill, Time, Attachment, Policy>
{
    /// Stop a running or stopped computer, rebuild its root disk from
    /// `image` and start it again if it was running. Other phases return
    /// [`ComputerError::NotUpdatable`].
    #[tracing::instrument(skip(self), fields(image = %image), err)]
    pub async fn update_image(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
        image: GuestImage,
    ) -> Result<ImageUpdate, ComputerError> {
        self.require_attached().await?;
        let computer = self.team_computer(team_id, computer_id).await?;
        if !matches!(
            computer.state.phase,
            Phase::Running { .. } | Phase::Stopped { .. }
        ) {
            return Err(ComputerError::NotUpdatable);
        }
        if computer.image.as_ref() == Some(&image) {
            return Err(ComputerError::BadRequest(format!(
                "the computer already runs {image}"
            )));
        }
        let updated = self
            .repo
            .apply(
                computer_id,
                Event::UpdateImage {
                    image: image.clone(),
                },
                self.clock.now(),
            )
            .await
            .map_err(internal)?
            .ok_or(ComputerError::NotFound)?;
        // The phase can change between the read and the locked transition.
        if !matches!(updated.state.phase, Phase::Updating { .. }) {
            return Err(ComputerError::NotUpdatable);
        }
        Ok(ImageUpdate {
            image,
            previous_image: computer.image,
        })
    }

    /// Update the computer back to the image it ran before its last update.
    #[tracing::instrument(skip(self), err)]
    pub async fn rollback_image(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<ImageUpdate, ComputerError> {
        self.require_attached().await?;
        let previous = self
            .team_computer(team_id, computer_id)
            .await?
            .previous_image
            .ok_or(ComputerError::NoPreviousImage)?;
        self.update_image(team_id, computer_id, previous).await
    }
}
