use std::sync::{Arc, Mutex};

use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::ChannelLabelsServiceImpl;
use crate::domain::models::{
    ChannelLabel, ChannelLabelRule, ChannelLabelsError, ChannelLabelsReceipt, ChannelLabelsScope,
    LabelWriteOutcome, NewChannelLabel, SetChannelLabelOutcome, SmartTagPreview,
};
use crate::domain::ports::{ChannelLabelsRepo, ChannelLabelsService};

const USER_ID: &str = "macro|labels-user@macro.com";

#[derive(Clone, Debug, PartialEq)]
enum RepoCall {
    Create {
        scope: ChannelLabelsScope,
        channel_ids: Vec<Uuid>,
        name: String,
        rule: Option<ChannelLabelRule>,
    },
    Rename {
        label_id: Uuid,
        name: String,
    },
    Delete {
        label_id: Uuid,
    },
    SetChannelLabel {
        channel_id: Uuid,
        label_id: Option<Uuid>,
    },
    Preview {
        scope: ChannelLabelsScope,
    },
}

#[derive(Clone, Default)]
struct FakeRepo {
    existing_rule: Option<ChannelLabelRule>,
    create_outcome: Option<LabelWriteOutcome>,
    rename_outcome: Option<LabelWriteOutcome>,
    delete_removed: bool,
    set_outcome: Option<SetChannelLabelOutcome>,
    calls: Arc<Mutex<Vec<RepoCall>>>,
}

impl FakeRepo {
    fn calls(&self) -> Vec<RepoCall> {
        self.calls.lock().expect("calls lock poisoned").clone()
    }

    fn record(&self, call: RepoCall) {
        self.calls.lock().expect("calls lock poisoned").push(call);
    }
}

#[derive(Debug, thiserror::Error)]
#[error("fake repository error")]
struct FakeErr;

fn label(team_id: Uuid, name: &str) -> ChannelLabel {
    ChannelLabel {
        id: Uuid::now_v7(),
        team_id: Some(team_id),
        name: name.to_string(),
        rule: None,
        sort_order: 0.0,
        channel_ids: Vec::new(),
        channel_count: 0,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

impl ChannelLabelsRepo for FakeRepo {
    type Err = FakeErr;

    async fn list_labels(
        &self,
        scope: &ChannelLabelsScope,
        _viewer: &MacroUserIdStr<'_>,
    ) -> Result<Vec<ChannelLabel>, Self::Err> {
        Ok(vec![label(
            scope.team_id().unwrap_or_default(),
            "Enterprise",
        )])
    }

    async fn get_label(
        &self,
        scope: &ChannelLabelsScope,
        label_id: Uuid,
        _viewer: &MacroUserIdStr<'_>,
    ) -> Result<Option<ChannelLabel>, Self::Err> {
        let mut found = label(scope.team_id().unwrap_or_default(), "Reloaded");
        found.id = label_id;
        found.rule = self.existing_rule.clone();
        found.channel_count = 2;
        Ok(Some(found))
    }

    async fn create_label(
        &self,
        scope: &ChannelLabelsScope,
        name: &str,
        channel_ids: &[Uuid],
        _viewer: &MacroUserIdStr<'_>,
        rule: Option<&ChannelLabelRule>,
    ) -> Result<LabelWriteOutcome, Self::Err> {
        self.record(RepoCall::Create {
            scope: scope.clone(),
            channel_ids: channel_ids.to_vec(),
            name: name.to_string(),
            rule: rule.cloned(),
        });
        Ok(self.create_outcome.clone().unwrap_or_else(|| {
            LabelWriteOutcome::Written({
                let mut result = label(scope.team_id().unwrap_or_default(), name);
                result.rule = rule.cloned();
                result.team_id = scope.team_id();
                result.channel_ids = channel_ids.to_vec();
                result.channel_count = channel_ids.len() as i64;
                result
            })
        }))
    }

    async fn rename_label(
        &self,
        scope: &ChannelLabelsScope,
        label_id: Uuid,
        name: &str,
        _viewer: &MacroUserIdStr<'_>,
        rule: Option<&ChannelLabelRule>,
    ) -> Result<LabelWriteOutcome, Self::Err> {
        let _ = rule;
        self.record(RepoCall::Rename {
            label_id,
            name: name.to_string(),
        });
        Ok(self.rename_outcome.clone().unwrap_or_else(|| {
            LabelWriteOutcome::Written(label(scope.team_id().unwrap_or_default(), name))
        }))
    }

    async fn delete_label(
        &self,
        _scope: &ChannelLabelsScope,
        label_id: Uuid,
    ) -> Result<bool, Self::Err> {
        self.record(RepoCall::Delete { label_id });
        Ok(self.delete_removed)
    }

    async fn set_channel_label(
        &self,
        _scope: &ChannelLabelsScope,
        channel_id: Uuid,
        label_id: Option<Uuid>,
        _actor: &MacroUserIdStr<'_>,
    ) -> Result<SetChannelLabelOutcome, Self::Err> {
        self.record(RepoCall::SetChannelLabel {
            channel_id,
            label_id,
        });
        Ok(self.set_outcome.unwrap_or(SetChannelLabelOutcome::Updated))
    }
    async fn preview_smart_tag(
        &self,
        scope: &ChannelLabelsScope,
        _viewer: &MacroUserIdStr<'_>,
        _rule: &ChannelLabelRule,
        _limit: u16,
    ) -> Result<SmartTagPreview, Self::Err> {
        self.record(RepoCall::Preview {
            scope: scope.clone(),
        });
        Ok(SmartTagPreview {
            channels: vec![],
            total_count: 0,
        })
    }
}

#[tokio::test]
async fn preview_uses_the_same_authorized_scope_as_saved_labels() {
    let repo = FakeRepo::default();
    let service = ChannelLabelsServiceImpl::new(repo.clone());
    let (team_id, receipt) = receipt();

    service
        .preview_smart_tag(
            &receipt,
            ChannelLabelRule::Name {
                contains: "support".into(),
            },
        )
        .await
        .unwrap();

    assert_eq!(
        repo.calls(),
        vec![RepoCall::Preview {
            scope: ChannelLabelsScope::Team(team_id),
        }]
    );
}

#[tokio::test]
async fn creation_and_assignment_report_ineligible_channels() {
    let (_, receipt) = receipt();
    let repo = FakeRepo {
        create_outcome: Some(LabelWriteOutcome::InvalidChannel(
            SetChannelLabelOutcome::ChannelNotLabelable,
        )),
        set_outcome: Some(SetChannelLabelOutcome::ChannelNotLabelable),
        ..FakeRepo::default()
    };
    let service = ChannelLabelsServiceImpl::new(repo);
    let channel_id = Uuid::now_v7();

    let created = service
        .create_label(
            &receipt,
            NewChannelLabel {
                name: "Support".into(),
                channel_ids: vec![channel_id],
                rule: None,
            },
        )
        .await;
    let assigned = service
        .set_channel_label(&receipt, channel_id, Some(Uuid::now_v7()))
        .await;

    for result in [created.map(|_| ()), assigned] {
        assert!(matches!(
            result,
            Err(ChannelLabelsError::BadRequest(message)) if message.contains("only team channels")
        ));
    }
}

fn receipt() -> (Uuid, ChannelLabelsReceipt) {
    let team_id = Uuid::now_v7();
    (
        team_id,
        ChannelLabelsReceipt::dangerously_internal(team_id, USER_ID),
    )
}

#[tokio::test]
async fn create_trims_name_and_moves_channels_in() {
    let repo = FakeRepo::default();
    let service = ChannelLabelsServiceImpl::new(repo.clone());
    let (team_id, receipt) = receipt();
    let channels = vec![Uuid::now_v7(), Uuid::now_v7()];

    let created = service
        .create_label(
            &receipt,
            NewChannelLabel {
                rule: None,
                name: "  Enterprise support ".to_string(),
                channel_ids: channels.clone(),
            },
        )
        .await
        .expect("label should be created");

    let calls = repo.calls();
    assert_eq!(
        calls[0],
        RepoCall::Create {
            scope: ChannelLabelsScope::Team(team_id),
            channel_ids: {
                let mut ids = channels.clone();
                ids.sort_unstable();
                ids
            },
            name: "Enterprise support".to_string(),
            rule: None,
        }
    );
    assert_eq!(
        calls.len(),
        1,
        "creation and assignments are one atomic repository call"
    );
    assert_eq!(created.channel_count, 2);
}

#[tokio::test]
async fn create_rejects_blank_and_oversized_names_without_touching_the_repo() {
    let repo = FakeRepo::default();
    let service = ChannelLabelsServiceImpl::new(repo.clone());
    let (_, receipt) = receipt();

    for name in ["", "   ", &"x".repeat(81)] {
        let error = service
            .create_label(
                &receipt,
                NewChannelLabel {
                    rule: None,
                    name: name.to_string(),
                    channel_ids: Vec::new(),
                },
            )
            .await
            .expect_err("invalid name should be rejected");
        assert!(
            matches!(error, ChannelLabelsError::BadRequest(_)),
            "{error:?}"
        );
    }
    assert!(repo.calls().is_empty());
}

#[tokio::test]
async fn create_reports_a_taken_name() {
    let repo = FakeRepo {
        create_outcome: Some(LabelWriteOutcome::NameTaken),
        ..FakeRepo::default()
    };
    let service = ChannelLabelsServiceImpl::new(repo);
    let (_, receipt) = receipt();

    let error = service
        .create_label(
            &receipt,
            NewChannelLabel {
                rule: None,
                name: "SMB".to_string(),
                channel_ids: vec![Uuid::now_v7()],
            },
        )
        .await
        .expect_err("duplicate name should be rejected");
    assert!(matches!(error, ChannelLabelsError::NameTaken(name) if name == "SMB"));
}

#[tokio::test]
async fn rename_validates_and_maps_outcomes() {
    let (_, receipt) = receipt();
    let label_id = Uuid::now_v7();

    let service = ChannelLabelsServiceImpl::new(FakeRepo::default());
    let renamed = service
        .rename_label(&receipt, label_id, " Onboarding ".to_string(), None)
        .await
        .expect("rename should succeed");
    assert_eq!(renamed.name, "Onboarding");

    let service = ChannelLabelsServiceImpl::new(FakeRepo {
        rename_outcome: Some(LabelWriteOutcome::NotFound),
        ..FakeRepo::default()
    });
    let error = service
        .rename_label(&receipt, label_id, "Onboarding".to_string(), None)
        .await
        .expect_err("missing label should be reported");
    assert!(matches!(error, ChannelLabelsError::NotFound(_)));
}

#[tokio::test]
async fn delete_reports_missing_labels() {
    let (_, receipt) = receipt();
    let label_id = Uuid::now_v7();

    let service = ChannelLabelsServiceImpl::new(FakeRepo {
        delete_removed: true,
        ..FakeRepo::default()
    });
    service
        .delete_label(&receipt, label_id)
        .await
        .expect("delete should succeed");

    let service = ChannelLabelsServiceImpl::new(FakeRepo::default());
    let error = service
        .delete_label(&receipt, label_id)
        .await
        .expect_err("missing label should be reported");
    assert!(matches!(error, ChannelLabelsError::NotFound(_)));
}

#[tokio::test]
async fn set_channel_label_maps_repo_outcomes() {
    let (_, receipt) = receipt();
    let channel_id = Uuid::now_v7();

    let cases = [
        (SetChannelLabelOutcome::Updated, None),
        (SetChannelLabelOutcome::ChannelNotFound, Some("not found")),
        (SetChannelLabelOutcome::LabelNotFound, Some("not found")),
        (
            SetChannelLabelOutcome::ChannelNotLabelable,
            Some("bad request"),
        ),
    ];
    for (outcome, expected) in cases {
        let service = ChannelLabelsServiceImpl::new(FakeRepo {
            set_outcome: Some(outcome),
            ..FakeRepo::default()
        });
        let result = service.set_channel_label(&receipt, channel_id, None).await;
        match expected {
            None => assert!(result.is_ok(), "{outcome:?} should succeed"),
            Some("not found") => {
                assert!(
                    matches!(result, Err(ChannelLabelsError::NotFound(_))),
                    "{outcome:?}"
                )
            }
            Some(_) => {
                assert!(
                    matches!(result, Err(ChannelLabelsError::BadRequest(_))),
                    "{outcome:?}"
                )
            }
        }
    }
}

#[tokio::test]
async fn users_without_teams_create_private_labels() {
    let actor = MacroUserIdStr::try_from(USER_ID.to_owned()).unwrap();
    let receipt = ChannelLabelsReceipt::from_access(actor.clone(), None).unwrap();
    let repo = FakeRepo::default();
    let service = ChannelLabelsServiceImpl::new(repo.clone());
    let channel = Uuid::now_v7();
    let created = service
        .create_label(
            &receipt,
            NewChannelLabel {
                rule: None,
                name: "Private".into(),
                channel_ids: vec![channel, channel],
            },
        )
        .await
        .unwrap();
    assert_eq!(created.team_id, None);
    assert_eq!(created.channel_ids, vec![channel]);
    assert!(
        matches!(&repo.calls()[0], RepoCall::Create { scope: ChannelLabelsScope::User(id), .. } if id == &actor)
    );
}

#[test]
fn cannot_use_another_users_team_receipt() {
    let actor = MacroUserIdStr::try_from(USER_ID.to_owned()).unwrap();
    let other = MacroUserIdStr::try_from("macro|other@macro.com".to_owned()).unwrap();
    let access =
        entity_access::domain::models::EntityAccessReceipt::dangerously_assert_authenticated_user(
            other,
            &Uuid::now_v7().to_string(),
            model_entity::EntityType::Team,
        );
    assert!(matches!(
        ChannelLabelsReceipt::from_access(actor, Some(access)),
        Err(ChannelLabelsError::Unauthorized)
    ));
}

#[tokio::test]
async fn smart_tags_validate_and_trim_rules_before_persistence() {
    let repo = FakeRepo::default();
    let service = ChannelLabelsServiceImpl::new(repo.clone());
    let (_, receipt) = receipt();
    for pattern in ["", "  ", &"x".repeat(201)] {
        let rule = ChannelLabelRule::Name {
            contains: pattern.into(),
        };
        assert!(matches!(
            service.preview_smart_tag(&receipt, rule.clone()).await,
            Err(ChannelLabelsError::BadRequest(_))
        ));
        assert!(matches!(
            service
                .create_label(
                    &receipt,
                    NewChannelLabel {
                        name: "Support".into(),
                        rule: Some(rule),
                        channel_ids: vec![],
                    }
                )
                .await,
            Err(ChannelLabelsError::BadRequest(_))
        ));
    }
    assert!(repo.calls().is_empty());
    let rule = ChannelLabelRule::Name {
        contains: "  Support  ".into(),
    };
    assert!(matches!(
        service
            .create_label(
                &receipt,
                NewChannelLabel {
                    name: "Support".into(),
                    rule: Some(rule.clone()),
                    channel_ids: vec![Uuid::now_v7()],
                }
            )
            .await,
        Err(ChannelLabelsError::BadRequest(_))
    ));
    let created = service
        .create_label(
            &receipt,
            NewChannelLabel {
                name: "Support".into(),
                rule: Some(rule),
                channel_ids: vec![],
            },
        )
        .await
        .unwrap();
    assert_eq!(
        created.rule,
        Some(ChannelLabelRule::Name {
            contains: "Support".into()
        })
    );
    assert_eq!(repo.calls().len(), 1);
}

#[tokio::test]
async fn rules_can_be_edited_only_on_existing_smart_tags() {
    let (_, receipt) = receipt();
    let rule = ChannelLabelRule::Name {
        contains: "new".into(),
    };
    let manual = ChannelLabelsServiceImpl::new(FakeRepo::default());
    assert!(matches!(
        manual
            .rename_label(&receipt, Uuid::now_v7(), "New".into(), Some(rule.clone()))
            .await,
        Err(ChannelLabelsError::BadRequest(_))
    ));
    let repo = FakeRepo {
        existing_rule: Some(rule.clone()),
        ..FakeRepo::default()
    };
    let smart = ChannelLabelsServiceImpl::new(repo.clone());
    smart
        .rename_label(&receipt, Uuid::now_v7(), "New".into(), Some(rule))
        .await
        .unwrap();
    assert_eq!(repo.calls().len(), 1);
}
