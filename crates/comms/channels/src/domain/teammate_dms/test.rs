use std::sync::{Arc, Mutex};

use super::*;

#[derive(Clone, Default)]
struct RecordingChannels {
    calls: Arc<Mutex<Vec<EnsureDms>>>,
    summary: EnsureDmsSummary,
    fail: bool,
}

impl TeammateDirectMessages for RecordingChannels {
    fn ensure_dms(
        &self,
        command: EnsureDms,
    ) -> impl Future<Output = Result<EnsureDmsSummary, ChannelMutationErr>> + Send {
        self.calls.lock().expect("calls mutex").push(command);
        let summary = self.summary;
        let fail = self.fail;
        async move {
            if fail {
                Err(ChannelMutationErr::Repo(anyhow::anyhow!(
                    "ensure direct messages failed"
                )))
            } else {
                Ok(summary)
            }
        }
    }
}

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{email}")).unwrap()
}

#[tokio::test]
async fn joining_member_gets_a_star_of_distinct_teammates() {
    let joiner = user("joiner@example.com");
    let owner = user("owner@example.com");
    let teammate = user("teammate@example.com");
    let channels = RecordingChannels::default();

    let summary = ensure_joined_member_dms(
        &channels,
        joiner.clone(),
        vec![
            owner.clone(),
            teammate.clone(),
            teammate.clone(),
            joiner.clone(),
        ],
    )
    .await
    .unwrap();

    assert_eq!(summary, EnsureDmsSummary::default());
    assert_eq!(
        channels.calls.lock().unwrap().clone(),
        vec![ensure_dms_for_joining_member(joiner, vec![owner, teammate])]
    );
}

#[tokio::test]
async fn channel_and_partial_failures_are_transient() {
    let joiner = user("joiner@example.com");
    let owner = user("owner@example.com");

    let channel_error = ensure_joined_member_dms(
        &RecordingChannels {
            fail: true,
            ..Default::default()
        },
        joiner.clone(),
        vec![owner.clone()],
    )
    .await
    .unwrap_err();
    assert!(channel_error.is_transient());

    let partial = ensure_joined_member_dms(
        &RecordingChannels {
            summary: EnsureDmsSummary {
                created: 0,
                existing: 0,
                failed: 1,
            },
            ..Default::default()
        },
        joiner,
        vec![owner],
    )
    .await
    .unwrap_err();
    assert!(matches!(
        partial,
        TeammateDmError::Partial { failed: 1, .. }
    ));
    assert!(partial.is_transient());
}
