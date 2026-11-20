//! Fakes for the Focus service's ports, for the worker's database tests.

use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};

use chrono::NaiveDate;
use email::domain::focus::{
    DueDateExtractor, DueDateInput, FocusClassifier, FocusClassifierError, FocusEnrollment,
    FocusNotifier, ProfileSource,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde_json::Value;
use sqlx::{Pool, Postgres};
use tokio::sync::watch;
use uuid::Uuid;

/// Link f01 in the Focus fixtures, held by owner@acme.example.
pub const OWNERS_LINK: Uuid = uuid::uuid!("00000000-0000-0000-0000-000000000f01");
/// Link f02 in the Focus fixtures, held by other@elsewhere.example. The
/// email_focus_linked fixture links it to owner@acme.example, whose Focus tab
/// lists it as a secondary inbox.
pub const OTHERS_LINK: Uuid = uuid::uuid!("00000000-0000-0000-0000-000000000f02");
/// Thread f201 in link f01.
pub const OWNERS_THREAD: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f201");
/// Thread f207 in link f02, held by other@elsewhere.example.
pub const OTHERS_THREAD: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f207");

pub struct NoProfile;

impl ProfileSource for NoProfile {
    async fn profile(&self, _owner: &MacroUserIdStr<'static>) -> Result<Option<String>, Report> {
        Ok(None)
    }

    async fn time_zone(&self, _owner: &MacroUserIdStr<'static>) -> Result<Option<String>, Report> {
        Ok(None)
    }
}

/// Says yes to Focus for `focus_tenths` of threads in ten after `latency`,
/// recording the threads it was asked about; `asked_count` follows how many.
#[derive(Clone)]
pub struct RecordingClassifier {
    pub asked: Arc<Mutex<Vec<Uuid>>>,
    pub asked_count: watch::Sender<usize>,
    latency: Duration,
    focus_tenths: u128,
}

impl RecordingClassifier {
    pub fn new(latency: Duration) -> Self {
        Self {
            asked: Arc::default(),
            asked_count: watch::Sender::new(0),
            latency,
            focus_tenths: 10,
        }
    }

    /// Say yes to Focus for only `tenths` of threads in ten.
    pub fn focus_in_tenths(self, tenths: u128) -> Self {
        Self {
            focus_tenths: tenths,
            ..self
        }
    }
}

impl FocusClassifier for RecordingClassifier {
    async fn answer(
        &self,
        _owner: &MacroUserIdStr<'static>,
        thread_id: Uuid,
        _input: &Value,
        questions: &[&'static str],
    ) -> Result<Vec<f32>, FocusClassifierError> {
        if !self.latency.is_zero() {
            tokio::time::sleep(self.latency).await;
        }
        let asked = {
            let mut asked = self.asked.lock().unwrap();
            asked.push(thread_id);
            asked.len()
        };
        self.asked_count.send_replace(asked);
        let mut answers = vec![0.0; questions.len()];
        if thread_id.as_u128() % 10 < self.focus_tenths {
            answers[0] = 0.9;
        }
        Ok(answers)
    }

    fn model(&self) -> &'static str {
        "jev-test"
    }
}

pub struct NoReaders;

impl FocusNotifier for NoReaders {
    fn focus_changed(&self, _owner: &MacroUserIdStr<'static>, _link_id: Uuid) {}
}

/// Finds no due date after `latency`, counting the calls.
#[derive(Clone, Default)]
pub struct NoDueDates {
    pub calls: Arc<Mutex<usize>>,
    pub latency: Duration,
}

impl DueDateExtractor for NoDueDates {
    async fn due_on(
        &self,
        _owner: &MacroUserIdStr<'static>,
        _thread_id: Uuid,
        _input: &DueDateInput,
    ) -> Result<Option<NaiveDate>, Report> {
        if !self.latency.is_zero() {
            tokio::time::sleep(self.latency).await;
        }
        *self.calls.lock().unwrap() += 1;
        Ok(None)
    }
}

/// A fixed set of owners in the rollout.
pub struct Enrolled(pub HashSet<MacroUserIdStr<'static>>);

impl Enrolled {
    pub fn owner(email: &str) -> Self {
        Self(HashSet::from([
            MacroUserIdStr::try_from_email(email).unwrap()
        ]))
    }
}

impl FocusEnrollment for Enrolled {
    async fn is_enrolled(&self, owner: &MacroUserIdStr<'static>) -> Result<bool, Report> {
        Ok(self.0.contains(owner))
    }
}

/// Connect inbox `link_id` for `owner`, unless it is already, and give it
/// `threads` more signal threads in the inbox, each one message from a vendor,
/// spread over the last `days` days.
pub async fn seed_inbox(
    pool: &Pool<Postgres>,
    link_id: Uuid,
    owner: &str,
    threads: i32,
    days: i32,
) {
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider,
                                 is_sync_active, created_at, updated_at)
        VALUES ($1::uuid, 'macro|' || $2::text, $1::uuid, $2::text, 'GMAIL', true, NOW(), NOW())
        ON CONFLICT DO NOTHING
        "#,
        link_id,
        owner,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
        VALUES (md5($1::uuid::text || 'vendor')::uuid, $1::uuid, 'billing@vendor.example', 'Vendor', NOW(), NOW())
        ON CONFLICT DO NOTHING
        "#,
        link_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        WITH t AS (
            INSERT INTO email_threads (id, link_id, inbox_visible, is_read, is_signal,
                                       latest_inbound_message_ts, created_at, updated_at)
            SELECT md5($1::uuid::text || i)::uuid, $1::uuid, true, false, true,
                   NOW() - make_interval(secs => i::float8 * $3::int * 86400 / $2::int),
                   NOW(), NOW()
            FROM generate_series(1, $2::int) AS i
            RETURNING id, latest_inbound_message_ts AS at
        )
        INSERT INTO email_messages (id, thread_id, link_id, provider_id, global_id, is_sent,
                                    from_contact_id, internal_date_ts, subject, body_text,
                                    has_attachments, is_read, is_starred, is_draft,
                                    created_at, updated_at)
        SELECT md5(t.id::text)::uuid, t.id, $1::uuid, 'p-' || t.id, 'g-' || t.id, false,
               md5($1::uuid::text || 'vendor')::uuid, t.at,
               'Invoice ' || left(t.id::text, 8), 'Can you approve this invoice by Friday?',
               false, false, false, false, NOW(), NOW()
        FROM t
        "#,
        link_id,
        threads,
        days,
    )
    .execute(pool)
    .await
    .unwrap();
}
