//! The workspace teams service: access policy over [`SubteamRepository`].

use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt, MemberTeamRole};
use macro_user_id::user_id::MacroUserIdStr;

use super::{
    CreateSubteamOutcome, NestOutcome, NewSubteam, SaveMemberOutcome, Subteam, SubteamError,
    SubteamJoinPolicy, SubteamPatch, SubteamRepository, SubteamRole, SubteamService,
};

/// [`SubteamService`] backed by a [`SubteamRepository`].
#[derive(Clone)]
pub struct SubteamServiceImpl<Repository> {
    repository: Repository,
}

impl<Repository> SubteamServiceImpl<Repository> {
    /// Creates the service over `repository`.
    pub fn new(repository: Repository) -> Self {
        Self { repository }
    }
}

/// Who is asking, and in which workspace.
struct Caller {
    team_id: uuid::Uuid,
    user_id: MacroUserIdStr<'static>,
    is_workspace_admin: bool,
}

impl Caller {
    fn from_receipt(receipt: EntityAccessReceipt<MemberTeamRole>) -> Result<Self, SubteamError> {
        let team_id = macro_uuid::string_to_uuid(&receipt.entity().entity_id)?;
        let user_id = receipt.get_authenticated_user()?.clone();
        let is_workspace_admin = receipt.try_into_requirement::<AdminTeamRole>().is_ok();

        Ok(Self {
            team_id,
            user_id,
            is_workspace_admin,
        })
    }

    fn manages(&self, subteam: &Subteam) -> bool {
        self.is_workspace_admin || subteam.role_of(&self.user_id) == Some(SubteamRole::Manager)
    }

    fn require_manager(&self, subteam: &Subteam) -> Result<(), SubteamError> {
        if self.manages(subteam) {
            Ok(())
        } else {
            Err(SubteamError::NotManager)
        }
    }

    fn is(&self, user_id: &MacroUserIdStr<'_>) -> bool {
        let caller: &str = self.user_id.as_ref();
        let other: &str = user_id.as_ref();
        caller == other
    }
}

impl<Repository: SubteamRepository> SubteamServiceImpl<Repository> {
    async fn load(&self, caller: &Caller, subteam_id: uuid::Uuid) -> Result<Subteam, SubteamError> {
        self.repository
            .get_subteam(caller.team_id, subteam_id)
            .await?
            .ok_or(SubteamError::NotFound)
    }

    /// The parent a team is being nested under, which the caller must manage.
    async fn load_managed_parent(
        &self,
        caller: &Caller,
        parent_id: uuid::Uuid,
    ) -> Result<Subteam, SubteamError> {
        let parent = self
            .repository
            .get_subteam(caller.team_id, parent_id)
            .await?
            .ok_or(SubteamError::InvalidParent)?;

        caller.require_manager(&parent)?;

        Ok(parent)
    }
}

impl<Repository: SubteamRepository> SubteamService for SubteamServiceImpl<Repository> {
    #[tracing::instrument(skip_all, err)]
    async fn list_subteams(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
    ) -> Result<Vec<Subteam>, SubteamError> {
        let caller = Caller::from_receipt(receipt)?;

        Ok(self.repository.list_subteams(caller.team_id).await?)
    }

    #[tracing::instrument(
        skip_all,
        fields(parent_id = ?subteam.parent_id, member_count = member_ids.len()),
        err
    )]
    async fn create_subteam(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
        subteam: NewSubteam,
        member_ids: Vec<MacroUserIdStr<'static>>,
    ) -> Result<Subteam, SubteamError> {
        let caller = Caller::from_receipt(receipt)?;

        if let Some(parent_id) = subteam.parent_id {
            self.load_managed_parent(&caller, parent_id).await?;
        }

        let member_ids: Vec<MacroUserIdStr<'static>> = member_ids
            .into_iter()
            .filter(|member_id| !caller.is(member_id))
            .collect();

        let outcome = self
            .repository
            .create_subteam(caller.team_id, &subteam, &caller.user_id, &member_ids)
            .await?;

        match outcome {
            CreateSubteamOutcome::Created(created) => {
                tracing::info!(subteam_id = %created.id, "created team");
                Ok(created)
            }
            CreateSubteamOutcome::InvalidParent => Err(SubteamError::InvalidParent),
            CreateSubteamOutcome::NotWorkspaceMember => Err(SubteamError::NotWorkspaceMember),
        }
    }

    #[tracing::instrument(skip_all, fields(%subteam_id), err)]
    async fn update_subteam(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
        subteam_id: uuid::Uuid,
        patch: SubteamPatch,
    ) -> Result<Subteam, SubteamError> {
        let caller = Caller::from_receipt(receipt)?;
        let subteam = self.load(&caller, subteam_id).await?;
        caller.require_manager(&subteam)?;

        self.repository
            .update_subteam(caller.team_id, subteam_id, &patch)
            .await?
            .ok_or(SubteamError::NotFound)
    }

    #[tracing::instrument(skip_all, fields(%subteam_id, ?parent_id), err)]
    async fn nest_subteam(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
        subteam_id: uuid::Uuid,
        parent_id: Option<uuid::Uuid>,
    ) -> Result<Subteam, SubteamError> {
        let caller = Caller::from_receipt(receipt)?;
        let subteam = self.load(&caller, subteam_id).await?;
        caller.require_manager(&subteam)?;

        if let Some(parent_id) = parent_id {
            self.load_managed_parent(&caller, parent_id).await?;
        }

        let outcome = self
            .repository
            .nest_subteam(caller.team_id, subteam_id, parent_id)
            .await?;

        match outcome {
            NestOutcome::Nested => self.load(&caller, subteam_id).await,
            NestOutcome::SubteamNotFound => Err(SubteamError::NotFound),
            NestOutcome::InvalidParent => Err(SubteamError::InvalidParent),
        }
    }

    #[tracing::instrument(skip_all, fields(%subteam_id), err)]
    async fn delete_subteam(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
        subteam_id: uuid::Uuid,
    ) -> Result<(), SubteamError> {
        let caller = Caller::from_receipt(receipt)?;
        let subteam = self.load(&caller, subteam_id).await?;
        caller.require_manager(&subteam)?;

        let deleted = self
            .repository
            .delete_subteam(caller.team_id, subteam_id)
            .await?;

        if deleted {
            Ok(())
        } else {
            Err(SubteamError::NotFound)
        }
    }

    #[tracing::instrument(skip_all, fields(%subteam_id, ?role), err)]
    async fn save_subteam_member(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
        subteam_id: uuid::Uuid,
        user_id: MacroUserIdStr<'static>,
        role: SubteamRole,
    ) -> Result<Subteam, SubteamError> {
        let caller = Caller::from_receipt(receipt)?;
        let subteam = self.load(&caller, subteam_id).await?;

        if !caller.manages(&subteam) {
            let joining_as_member = caller.is(&user_id) && role == SubteamRole::Member;
            if !joining_as_member {
                return Err(SubteamError::NotManager);
            }

            match subteam.join_policy {
                SubteamJoinPolicy::Open => {}
                SubteamJoinPolicy::InviteOnly => return Err(SubteamError::InviteOnly),
            }
        }

        let outcome = self
            .repository
            .save_subteam_member(caller.team_id, subteam_id, &user_id, role)
            .await?;

        match outcome {
            SaveMemberOutcome::Saved => self.load(&caller, subteam_id).await,
            SaveMemberOutcome::SubteamNotFound => Err(SubteamError::NotFound),
            SaveMemberOutcome::NotWorkspaceMember => Err(SubteamError::NotWorkspaceMember),
        }
    }

    #[tracing::instrument(skip_all, fields(%subteam_id), err)]
    async fn remove_subteam_member(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
        subteam_id: uuid::Uuid,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Subteam, SubteamError> {
        let caller = Caller::from_receipt(receipt)?;
        let subteam = self.load(&caller, subteam_id).await?;

        if !caller.is(&user_id) {
            caller.require_manager(&subteam)?;
        }

        self.repository
            .remove_subteam_member(caller.team_id, subteam_id, &user_id)
            .await?;

        self.load(&caller, subteam_id).await
    }
}
