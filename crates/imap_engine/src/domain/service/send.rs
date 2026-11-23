//! Durable SMTP admission and replayable post-send effects.
use super::*;

impl Engine {
    pub(super) async fn reconcile_submission(
        &self,
        a: &mut Account,
        credentials: &Credentials,
        id: &str,
    ) -> Result<(), Error> {
        let draft = a.state.drafts.get(id).ok_or(Error::NotFound)?;
        if draft.submission != Some(SubmissionOutcome::Unknown) {
            return Ok(());
        }
        let send: SendRequest = serde_json::from_value(
            draft
                .frozen_content
                .as_ref()
                .unwrap_or(&draft.input.content)
                .clone(),
        )
        .map_err(|_| Error::Invalid)?;
        let message_id = send.message_id.as_ref().ok_or(Error::Invalid)?;
        let mime = send.build_mime().map_err(|_| Error::Invalid)?;
        // Reconcile exactly the requested attempt. Another unconfirmed draft
        // must not hide its Sent evidence or monopolize background copy work.
        if self
            .transport
            .save_sent(credentials, message_id, &mime, false)
            .await?
        {
            accept_submission(a, id, &mime, false)?;
            self.repository.save(a).await?;
        }
        Ok(())
    }

    pub(super) async fn reconcile_sent(
        &self,
        a: &mut Account,
        credentials: &Credentials,
    ) -> Result<(), Error> {
        let ids = a
            .state
            .drafts
            .iter()
            .filter(|(_, d)| {
                (d.sent_copy_pending || d.answered_pending)
                    && d.submission == Some(SubmissionOutcome::Accepted)
            })
            .map(|(id, _)| id.clone())
            .take(1)
            .collect::<Vec<_>>();
        for id in ids {
            let draft = a.state.drafts.get(&id).ok_or(Error::NotFound)?;
            let send: SendRequest = serde_json::from_value(
                draft
                    .frozen_content
                    .as_ref()
                    .unwrap_or(&draft.input.content)
                    .clone(),
            )
            .map_err(|_| Error::Invalid)?;
            let message_id = send.message_id.as_ref().ok_or(Error::Invalid)?;
            let mime = send.build_mime().map_err(|_| Error::Invalid)?;
            if draft.sent_copy_pending {
                let allow_append = !draft.sent_copy_attempted;
                if allow_append {
                    a.state
                        .drafts
                        .get_mut(&id)
                        .ok_or(Error::NotFound)?
                        .sent_copy_attempted = true;
                    self.repository.save(a).await?;
                }
                match self
                    .transport
                    .save_sent(credentials, message_id, &mime, allow_append)
                    .await
                {
                    Ok(true) => {
                        if let Some(draft) = a.state.drafts.get_mut(&id) {
                            draft.sent_copy_pending = false;
                        }
                        self.repository.save(a).await?;
                    }
                    Ok(false) => {}
                    Err(error) => tracing::warn!(?error, "IMAP sent copy remains pending"),
                }
            }
            let reply = a
                .state
                .drafts
                .get(&id)
                .filter(|d| d.answered_pending)
                .and_then(|d| d.input.reply_to.clone());
            if let Some(reply) = reply {
                let location = a
                    .state
                    .locations
                    .iter()
                    .find(|l| l.message_id == reply && l.uid > 0)
                    .cloned();
                let result = if let Some(location) = location {
                    let folder = a
                        .state
                        .folders
                        .get(&location.folder_id)
                        .ok_or(Error::NotFound)?;
                    self.transport
                        .apply(
                            credentials,
                            &folder.path,
                            location.uid_validity,
                            location.uid,
                            RemoteAction::Flag {
                                flag: "\\Answered".into(),
                                enabled: true,
                            },
                        )
                        .await
                        .map_err(ApplyError::into_error)
                        .map(|_| ())
                } else if a.state.messages.contains_key(&reply) {
                    Err(Error::ConnectionUnavailable)
                } else {
                    Ok(())
                };
                match result {
                    Ok(()) => {
                        if let Some(draft) = a.state.drafts.get_mut(&id) {
                            draft.answered_pending = false;
                        }
                        self.repository.save(a).await?;
                    }
                    Err(error) => tracing::warn!(?error, "IMAP answered flag remains pending"),
                }
            }
        }
        Ok(())
    }
    #[tracing::instrument(skip_all, name = "imap.submit", fields(smtp.renew_failures = tracing::field::Empty, smtp.penalty_applied = tracing::field::Empty), err)]
    pub(super) async fn submit(
        &self,
        a: &mut Account,
        id: &str,
        submission_deadline: tokio::time::Instant,
    ) -> Result<Value, Error> {
        let draft = a.state.drafts.get(id).ok_or(Error::NotFound)?;
        if let Some(outcome) = &draft.submission {
            return value(outcome);
        }
        if self.shutdown.is_cancelled() {
            return self.submission_during_shutdown(a.binding, id).await;
        }
        if a.state
            .send_penalty_until
            .is_some_and(|until| until > Utc::now())
        {
            return Err(Error::ConnectionUnavailable);
        }
        let day = Utc::now().date_naive();
        if a.state.send_day != Some(day) {
            a.state.send_day = Some(day);
            a.state.sends_today = 0;
        }
        if a.state.sends_today >= 500 {
            return Err(Error::Throttled);
        }

        let mut send: SendRequest = serde_json::from_value(
            draft
                .frozen_content
                .as_ref()
                .unwrap_or(&draft.input.content)
                .clone(),
        )
        .map_err(|_| Error::Invalid)?;
        let c = self
            .cipher
            .decrypt(a.binding.link_id, &a.user_id, &a.ciphertext)
            .await?;
        if !send.from.email.eq_ignore_ascii_case(&c.email) {
            return Err(Error::Forbidden);
        }
        let recipients = send
            .message
            .to
            .iter()
            .flatten()
            .chain(send.message.cc.iter().flatten())
            .chain(send.message.bcc.iter().flatten())
            .map(|c| c.email.clone())
            .collect::<Vec<_>>();
        if recipients.is_empty() || recipients.len() > 100 {
            return Err(Error::Invalid);
        }
        let message_id = send
            .message_id
            .clone()
            .unwrap_or_else(|| format!("{}@macro.email", draft.input.correlation));
        send.message_id = Some(message_id.clone());
        if draft.frozen_content.is_none() {
            for attachment in draft.attachments.values() {
                let bytes = STANDARD
                    .decode(&attachment.data_base64)
                    .map_err(|_| Error::Invalid)?;
                send.message
                    .attachments
                    .get_or_insert_with(Vec::new)
                    .push(models_attachment(attachment, bytes));
            }
        }
        let mime = send.build_mime().map_err(|_| Error::Invalid)?;
        if mime.len() > 25 * 1024 * 1024 {
            return Err(Error::Invalid);
        }
        let frozen_input = serde_json::to_value(&send).map_err(|_| Error::Invalid)?;
        if self.shutdown.is_cancelled() {
            return self.submission_during_shutdown(a.binding, id).await;
        }
        let draft = a.state.drafts.get_mut(id).ok_or(Error::NotFound)?;
        draft.frozen_content = Some(frozen_input);
        // This sticky tombstone is committed under the distributed fence BEFORE any SMTP delivery bytes.
        // A crash can conservatively lose a send, but it cannot cause an automatic duplicate.
        draft.submission = Some(SubmissionOutcome::Unknown);
        a.state.sends_today = a.state.sends_today.saturating_add(1);
        self.repository.save(a).await?;
        let mut renew_failures = 0_u64;
        let transport_result = {
            let submission = self.transport.submit(
                &c,
                &send.from.email,
                &recipients,
                &mime,
                submission_deadline,
            );
            // Renewal is a separate polled future: database waits must never
            // stop SMTP IO or its absolute deadline from being polled.
            let heartbeat =
                renew_during_submission(self.repository.as_ref(), a, &mut renew_failures);
            tokio::pin!(submission, heartbeat);
            tokio::select! {
                result = &mut submission => result,
                never = &mut heartbeat => match never {},
            }
        };
        tracing::Span::current().record("smtp.renew_failures", renew_failures);
        let deadline_exceeded = transport_result
            .as_ref()
            .is_ok_and(|result| result.deadline_exceeded);
        let outcome = match transport_result {
            Ok(result) => {
                if result.deadline_exceeded {
                    a.state.send_penalty_until = Some(Utc::now() + Duration::minutes(10));
                }
                result.outcome
            }
            Err(error) => {
                // A definite rejection occurred before acceptance. The caller may choose a new attempt.
                {
                    if let Some(d) = a.state.drafts.get_mut(id) {
                        d.submission = None;
                    }
                    self.repository.save(a).await?;
                }
                return Err(error);
            }
        };
        if matches!(outcome, SubmissionOutcome::Rejected { .. }) {
            // Rejection is returned to the caller, never persisted as a new
            // submission vocabulary: older binaries must still read this draft.
            // Clear the Unknown fence only after the transport proves no body
            // was submitted, and save before allowing a deliberate new attempt.
            if let Some(d) = a.state.drafts.get_mut(id) {
                d.submission = None;
            }
            self.repository.save(a).await?;
            return value(outcome);
        }
        if let Some(d) = a.state.drafts.get_mut(id) {
            d.submission = Some(outcome.clone());
            if outcome == SubmissionOutcome::Accepted {
                d.draft.is_draft = false;
                d.sent_copy_pending = true;
                d.answered_pending = d.input.reply_to.is_some();
            }
        }
        if outcome == SubmissionOutcome::Accepted {
            accept_submission(a, id, &mime, true)?;
        }
        self.repository.save(a).await?;
        if deadline_exceeded {
            tracing::Span::current().record("smtp.penalty_applied", true);
        }
        if outcome == SubmissionOutcome::Accepted {
            self.reconcile_sent(a, &c).await?;
        }
        value(outcome)
    }
}

fn accept_submission(
    a: &mut Account,
    id: &str,
    mime: &[u8],
    copy_pending: bool,
) -> Result<(), Error> {
    let draft = a.state.drafts.get_mut(id).ok_or(Error::NotFound)?;
    draft.submission = Some(SubmissionOutcome::Accepted);
    draft.draft.is_draft = false;
    draft.sent_copy_pending = copy_pending;
    draft.answered_pending = draft.input.reply_to.is_some();
    let conversation = draft.draft.conversation_id.clone();
    let correlation = draft.input.correlation;
    let folder = a
        .state
        .folders
        .values()
        .find(|f| f.folder.role == FolderRole::Sent)
        .map(|f| f.folder.id.clone())
        .unwrap_or_else(|| "virtual:sent".into());
    a.state.messages.insert(
        id.into(),
        Message {
            id: id.into(),
            thread_id: conversation,
            folder_id: folder,
            flags: vec!["\\Seen".into()],
            tags: Vec::new(),
            version: format!("sent:{correlation}"),
            mime_base64: STANDARD.encode(mime),
            source_complete: true,
            classification: None,
            received_at: Utc::now(),
            size: u32::try_from(mime.len()).map_err(|_| Error::Invalid)?,
            is_sent: true,
            draft_correlation: Some(correlation),
        },
    );
    Ok(())
}

async fn renew_during_submission(
    repository: &dyn Repository,
    account: &Account,
    failures: &mut u64,
) -> std::convert::Infallible {
    let interval = std::time::Duration::from_secs(60);
    let mut heartbeat = tokio::time::interval_at(tokio::time::Instant::now() + interval, interval);
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        heartbeat.tick().await;
        match tokio::time::timeout(
            std::time::Duration::from_secs(10),
            repository.renew(account),
        )
        .await
        {
            Ok(Ok(())) => continue,
            Ok(Err(error)) => {
                tracing::warn!(?error, "SMTP lease renewal failed; submission continues")
            }
            Err(_) => tracing::warn!("SMTP lease renewal timed out; submission continues"),
        }
        *failures = failures.saturating_add(1);
    }
}
