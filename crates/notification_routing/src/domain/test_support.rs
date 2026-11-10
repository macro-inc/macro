//! In-memory ports for the domain tests.

use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use feature_flags::outbound::fake::FakeFeatureFlags;
use feature_flags::{FlagSnapshot, FlagValue};
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::NotificationLane;
use rootcause::Report;
use uuid::Uuid;

use crate::domain::evaluate::DocumentPlacement;
use crate::domain::models::{
    NOTIFICATION_STACKS_FLAG, NewStack, NotificationStack, StackChanges, StackRule,
};
use crate::domain::ports::{DocumentPlacements, StackRepository};

pub(crate) fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

/// Flags that turn stacks on for `on`, off for `off`, and fail to load for
/// anyone else.
pub(crate) fn flags(
    on: &[&MacroUserIdStr<'static>],
    off: &[&MacroUserIdStr<'static>],
) -> FakeFeatureFlags {
    let mut flags = FakeFeatureFlags::default();
    for owner in on {
        flags.set(
            (*owner).clone(),
            Ok(FlagSnapshot::new([(
                NOTIFICATION_STACKS_FLAG.to_string(),
                FlagValue::Boolean(true),
            )])),
        );
    }
    for owner in off {
        flags.set((*owner).clone(), Ok(FlagSnapshot::default()));
    }
    flags
}

/// A stack as the repository would return it.
pub(crate) fn stack(
    id: u128,
    capture: Vec<StackRule>,
    release: Vec<StackRule>,
) -> NotificationStack {
    NotificationStack {
        id: Uuid::from_u128(id),
        name: "Support channels".to_string(),
        position: 0,
        lane: NotificationLane::Noise,
        capture,
        release,
        enabled: true,
        revision: 1,
        created_at: DateTime::<Utc>::UNIX_EPOCH,
        updated_at: DateTime::<Utc>::UNIX_EPOCH,
    }
}

/// Stacks kept in memory, in each owner's insertion order.
#[derive(Clone, Default)]
pub(crate) struct FakeStacks {
    stacks: Arc<Mutex<Vec<(MacroUserIdStr<'static>, NotificationStack)>>>,
}

impl FakeStacks {
    pub(crate) fn with(self, owner: &MacroUserIdStr<'static>, stack: NotificationStack) -> Self {
        self.stacks.lock().unwrap().push((owner.clone(), stack));
        self
    }

    fn owned_by(&self, owner: &MacroUserIdStr<'_>) -> Vec<NotificationStack> {
        let mut stacks: Vec<NotificationStack> = self
            .stacks
            .lock()
            .unwrap()
            .iter()
            .filter(|(stack_owner, _)| stack_owner == owner)
            .map(|(_, stack)| stack.clone())
            .collect();
        stacks.sort_by_key(|stack| stack.position);
        stacks
    }
}

impl StackRepository for FakeStacks {
    type Err = Infallible;

    async fn list(&self, owner: &MacroUserIdStr<'_>) -> Result<Vec<NotificationStack>, Infallible> {
        Ok(self.owned_by(owner))
    }

    async fn enabled_for(
        &self,
        owners: &[MacroUserIdStr<'_>],
    ) -> Result<HashMap<MacroUserIdStr<'static>, Vec<NotificationStack>>, Infallible> {
        Ok(owners
            .iter()
            .map(|owner| {
                let enabled: Vec<NotificationStack> = self
                    .owned_by(owner)
                    .into_iter()
                    .filter(|stack| stack.enabled)
                    .collect();
                (owner.clone().into_owned(), enabled)
            })
            .filter(|(_, stacks)| !stacks.is_empty())
            .collect())
    }

    async fn create(
        &self,
        owner: &MacroUserIdStr<'_>,
        id: Uuid,
        stack: &NewStack,
        lane: NotificationLane,
        limit: usize,
    ) -> Result<Option<NotificationStack>, Infallible> {
        let owned = self.owned_by(owner);
        if owned.len() >= limit {
            return Ok(None);
        }

        let created = NotificationStack {
            id,
            name: stack.name.clone(),
            position: owned.len() as i32,
            lane,
            capture: stack.capture.clone(),
            release: stack.release.clone(),
            enabled: true,
            revision: 1,
            created_at: DateTime::<Utc>::UNIX_EPOCH,
            updated_at: DateTime::<Utc>::UNIX_EPOCH,
        };
        self.stacks
            .lock()
            .unwrap()
            .push((owner.clone().into_owned(), created.clone()));
        Ok(Some(created))
    }

    async fn update(
        &self,
        owner: &MacroUserIdStr<'_>,
        id: Uuid,
        changes: &StackChanges,
    ) -> Result<Option<NotificationStack>, Infallible> {
        let mut stacks = self.stacks.lock().unwrap();
        let Some((_, stack)) = stacks
            .iter_mut()
            .find(|(stack_owner, stack)| stack_owner == owner && stack.id == id)
        else {
            return Ok(None);
        };

        if let Some(name) = &changes.name {
            stack.name = name.clone();
        }
        if let Some(capture) = &changes.capture {
            stack.capture = capture.clone();
        }
        if let Some(release) = &changes.release {
            stack.release = release.clone();
        }
        if let Some(enabled) = changes.enabled {
            stack.enabled = enabled;
        }
        stack.revision += 1;
        Ok(Some(stack.clone()))
    }

    async fn delete(&self, owner: &MacroUserIdStr<'_>, id: Uuid) -> Result<bool, Infallible> {
        let mut stacks = self.stacks.lock().unwrap();
        let before = stacks.len();
        stacks.retain(|(stack_owner, stack)| !(stack_owner == owner && stack.id == id));
        Ok(stacks.len() < before)
    }

    async fn reorder(
        &self,
        owner: &MacroUserIdStr<'_>,
        ids: &[Uuid],
    ) -> Result<Option<Vec<NotificationStack>>, Infallible> {
        let mut current: Vec<Uuid> = self.owned_by(owner).iter().map(|stack| stack.id).collect();
        let mut named = ids.to_vec();
        current.sort();
        named.sort();
        if current != named {
            return Ok(None);
        }

        for (stack_owner, stack) in self.stacks.lock().unwrap().iter_mut() {
            if stack_owner.as_ref() == owner.as_ref()
                && let Some(position) = ids.iter().position(|id| *id == stack.id)
            {
                stack.position = position as i32;
            }
        }
        Ok(Some(self.owned_by(owner)))
    }
}

/// Placements that file every document in the same place and count the
/// reads.
#[derive(Clone, Default)]
pub(crate) struct FakePlacements {
    pub(crate) placement: DocumentPlacement,
    pub(crate) reads: Arc<Mutex<Vec<(String, bool)>>>,
}

impl DocumentPlacements for FakePlacements {
    async fn placement(
        &self,
        document_id: &str,
        is_task: bool,
    ) -> Result<DocumentPlacement, Report> {
        self.reads
            .lock()
            .unwrap()
            .push((document_id.to_string(), is_task));
        Ok(self.placement.clone())
    }
}
