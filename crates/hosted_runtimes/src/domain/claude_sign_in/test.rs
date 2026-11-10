use std::collections::HashSet;
use std::sync::Mutex;

use chrono::{DateTime, TimeZone, Utc};
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;

const TEAM: Uuid = Uuid::from_u128(0x7ea4);

fn at(day: u32, hour: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, day, hour, 0, 0).unwrap()
}

/// Signed in on the 1st at noon, expiring on the 20th at noon, with macrod's
/// report from a minute after the sign-in and no notice sent yet.
fn signed_in_on_the_first() -> ClaudeSignIn {
    ClaudeSignIn {
        computer_id: ComputerId::new_from_uuid(Uuid::from_u128(1)),
        harness_id: HarnessId::new_from_uuid(Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_0c0c)),
        team_id: TEAM,
        computer_name: "Build box".to_owned(),
        signed_in_by: MacroUserIdStr::try_from("macro|signer@example.com".to_owned()).unwrap(),
        signed_in_at: at(1, 12),
        report: Some(ClaudeReport::SignedIn {
            expires_at: Some(at(20, 12)),
        }),
        reported_at: Some(at(1, 12) + Duration::minutes(1)),
        last_notice: None,
    }
}

#[test]
fn nothing_is_due_more_than_three_days_before_the_expiry() {
    assert_eq!(due_notice(at(17, 11), &signed_in_on_the_first()), None);
}

#[test]
fn expires_soon_is_due_three_days_before_the_expiry() {
    assert_eq!(
        due_notice(at(17, 12), &signed_in_on_the_first()),
        Some(ClaudeSignInNotice {
            signed_in_at: at(1, 12),
            stage: ClaudeSignInStage::ExpiresSoon,
            expires_at: Some(at(20, 12)),
        })
    );
}

#[test]
fn a_stage_already_sent_for_the_sign_in_is_not_sent_again() {
    let sign_in = ClaudeSignIn {
        last_notice: Some(ClaudeSignInNotice {
            signed_in_at: at(1, 12),
            stage: ClaudeSignInStage::ExpiresSoon,
            expires_at: Some(at(20, 12)),
        }),
        ..signed_in_on_the_first()
    };

    assert_eq!(due_notice(at(18, 12), &sign_in), None);
}

#[test]
fn expires_today_follows_expires_soon_on_the_last_day() {
    let sign_in = ClaudeSignIn {
        last_notice: Some(ClaudeSignInNotice {
            signed_in_at: at(1, 12),
            stage: ClaudeSignInStage::ExpiresSoon,
            expires_at: Some(at(20, 12)),
        }),
        ..signed_in_on_the_first()
    };

    assert_eq!(
        due_notice(at(19, 13), &sign_in),
        Some(ClaudeSignInNotice {
            signed_in_at: at(1, 12),
            stage: ClaudeSignInStage::ExpiresToday,
            expires_at: Some(at(20, 12)),
        })
    );
}

#[test]
fn a_passed_expiry_is_due_as_expired_without_the_warnings_it_overtook() {
    assert_eq!(
        due_notice(at(20, 12), &signed_in_on_the_first()),
        Some(ClaudeSignInNotice {
            signed_in_at: at(1, 12),
            stage: ClaudeSignInStage::Expired,
            expires_at: Some(at(20, 12)),
        })
    );
}

#[test]
fn a_rejected_sign_in_is_due_as_expired_at_once() {
    let sign_in = ClaudeSignIn {
        report: Some(ClaudeReport::SignedOut),
        reported_at: Some(at(5, 9)),
        ..signed_in_on_the_first()
    };

    assert_eq!(
        due_notice(at(5, 9), &sign_in),
        Some(ClaudeSignInNotice {
            signed_in_at: at(1, 12),
            stage: ClaudeSignInStage::Expired,
            expires_at: None,
        })
    );
}

#[test]
fn nothing_follows_expired_for_the_same_sign_in() {
    // It expired by time, then macrod saw Claude signed out.
    let sign_in = ClaudeSignIn {
        report: Some(ClaudeReport::SignedOut),
        reported_at: Some(at(20, 13)),
        last_notice: Some(ClaudeSignInNotice {
            signed_in_at: at(1, 12),
            stage: ClaudeSignInStage::Expired,
            expires_at: Some(at(20, 12)),
        }),
        ..signed_in_on_the_first()
    };

    assert_eq!(due_notice(at(21, 12), &sign_in), None);
}

#[test]
fn a_report_from_before_the_sign_in_is_not_its_outcome() {
    // macrod still reported the account it had before the new sign-in.
    let sign_in = ClaudeSignIn {
        report: Some(ClaudeReport::SignedOut),
        reported_at: Some(at(1, 11)),
        ..signed_in_on_the_first()
    };

    assert_eq!(due_notice(at(1, 12), &sign_in), None);
}

#[test]
fn a_new_sign_in_starts_its_notices_over() {
    let sign_in = ClaudeSignIn {
        signed_in_at: at(10, 12),
        reported_at: Some(at(10, 12) + Duration::minutes(1)),
        last_notice: Some(ClaudeSignInNotice {
            signed_in_at: at(1, 12),
            stage: ClaudeSignInStage::Expired,
            expires_at: None,
        }),
        ..signed_in_on_the_first()
    };

    assert_eq!(
        due_notice(at(18, 12), &sign_in),
        Some(ClaudeSignInNotice {
            signed_in_at: at(10, 12),
            stage: ClaudeSignInStage::ExpiresSoon,
            expires_at: Some(at(20, 12)),
        })
    );
}

#[test]
fn a_renewed_expiry_warns_again() {
    // Claude was signed in again on the computer itself, moving the expiry.
    let sign_in = ClaudeSignIn {
        report: Some(ClaudeReport::SignedIn {
            expires_at: Some(at(28, 12)),
        }),
        last_notice: Some(ClaudeSignInNotice {
            signed_in_at: at(1, 12),
            stage: ClaudeSignInStage::ExpiresToday,
            expires_at: Some(at(20, 12)),
        }),
        ..signed_in_on_the_first()
    };

    assert_eq!(
        due_notice(at(26, 12), &sign_in),
        Some(ClaudeSignInNotice {
            signed_in_at: at(1, 12),
            stage: ClaudeSignInStage::ExpiresSoon,
            expires_at: Some(at(28, 12)),
        })
    );
}

#[test]
fn an_unknown_expiry_is_never_warned_about() {
    let sign_in = ClaudeSignIn {
        report: Some(ClaudeReport::SignedIn { expires_at: None }),
        ..signed_in_on_the_first()
    };

    assert_eq!(due_notice(at(25, 12), &sign_in), None);
}

#[test]
fn nothing_is_due_before_macrod_reports() {
    let sign_in = ClaudeSignIn {
        report: None,
        reported_at: None,
        ..signed_in_on_the_first()
    };

    assert_eq!(due_notice(at(25, 12), &sign_in), None);
}

#[derive(Debug, thiserror::Error)]
#[error("fake failure")]
struct FakeError;

struct FakeSignIns {
    signed_in: Vec<ClaudeSignIn>,
    recorded: Mutex<Vec<(ComputerId, ClaudeSignInNotice)>>,
}

impl ClaudeSignIns for FakeSignIns {
    type Err = FakeError;

    async fn signed_in(&self) -> Result<Vec<ClaudeSignIn>, FakeError> {
        Ok(self.signed_in.clone())
    }

    async fn record_notice(
        &self,
        computer_id: ComputerId,
        notice: ClaudeSignInNotice,
    ) -> Result<(), FakeError> {
        self.recorded.lock().unwrap().push((computer_id, notice));
        Ok(())
    }
}

struct FakeNotices {
    failing_computer: ComputerId,
    sent: Mutex<Vec<(ClaudeSignInExpiry, HashSet<MacroUserIdStr<'static>>)>>,
}

impl ClaudeSignInNotices for FakeNotices {
    type Err = FakeError;

    async fn team_admins(&self, team_id: Uuid) -> Result<Vec<MacroUserIdStr<'static>>, FakeError> {
        assert_eq!(team_id, TEAM);
        Ok(vec![
            MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
            MacroUserIdStr::try_from("macro|signer@example.com".to_owned()).unwrap(),
        ])
    }

    async fn send(
        &self,
        expiry: ClaudeSignInExpiry,
        recipients: HashSet<MacroUserIdStr<'static>>,
    ) -> Result<(), FakeError> {
        if expiry.computer_id == self.failing_computer {
            return Err(FakeError);
        }
        self.sent.lock().unwrap().push((expiry, recipients));
        Ok(())
    }
}

#[tokio::test]
async fn a_pass_tells_the_signer_and_admins_and_one_failure_spares_the_rest() {
    let failing = ComputerId::new_from_uuid(Uuid::from_u128(2));
    let quiet = ComputerId::new_from_uuid(Uuid::from_u128(3));
    let sign_ins = FakeSignIns {
        signed_in: vec![
            signed_in_on_the_first(),
            ClaudeSignIn {
                computer_id: failing,
                ..signed_in_on_the_first()
            },
            ClaudeSignIn {
                computer_id: quiet,
                report: Some(ClaudeReport::SignedIn {
                    expires_at: Some(at(30, 12)),
                }),
                ..signed_in_on_the_first()
            },
        ],
        recorded: Mutex::new(Vec::new()),
    };
    let notices = FakeNotices {
        failing_computer: failing,
        sent: Mutex::new(Vec::new()),
    };

    let pass = notify_due(at(18, 12), &sign_ins, &notices).await.unwrap();

    assert_eq!(
        pass,
        ClaudeSignInPass {
            checked: 3,
            notified: 1,
            failed: 1,
        }
    );
    let notice = ClaudeSignInNotice {
        signed_in_at: at(1, 12),
        stage: ClaudeSignInStage::ExpiresSoon,
        expires_at: Some(at(20, 12)),
    };
    assert_eq!(
        *notices.sent.lock().unwrap(),
        vec![(
            ClaudeSignInExpiry {
                computer_id: ComputerId::new_from_uuid(Uuid::from_u128(1)),
                harness_id: HarnessId::new_from_uuid(Uuid::from_u128(
                    0x0000_0000_0000_7000_8000_0000_0000_0c0c
                )),
                computer_name: "Build box".to_owned(),
                notice,
            },
            HashSet::from([
                MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
                MacroUserIdStr::try_from("macro|signer@example.com".to_owned()).unwrap(),
            ]),
        )]
    );
    // The failed computer is not recorded, so the next pass retries it.
    assert_eq!(
        *sign_ins.recorded.lock().unwrap(),
        vec![(ComputerId::new_from_uuid(Uuid::from_u128(1)), notice)]
    );
}
