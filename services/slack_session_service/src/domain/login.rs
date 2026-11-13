//! Sign-in attempts DSS records: claim one that has input, open its sealed
//! state, take one step with Slack, seal what comes next. Signed-in sessions
//! are checked with `auth.test` and sealed for their account at once.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use slack_client::login::{
    LoginErrorKind, LoginInput as SlackInput, LoginState, LoginStep as SlackStep,
    LoginWorkspace as SlackWorkspace,
};
use slack_client::{CookieToken, Secret, SessionCredentials, SessionToken, TeamId};
use slack_linked::domain::events::{LoginAdvance, LoginWork, SignedInWorkspace};
use slack_linked::domain::models::{
    LoginFailure, LoginInput, LoginStep, LoginWorkspace, SessionSubmission, WorkspaceSignIn,
};
use slack_linked::domain::session::SessionService;
use tracing::Instrument;
use uuid::Uuid;

use super::ports::{OpenFailure, Secrets, SlackConnector};

/// A sign-in's private state between steps, sealed in the attempt row.
#[derive(Serialize, Deserialize)]
struct Progress {
    /// Where Slack's sign-in is.
    login: LoginState,
    /// The workspace list to sign in to the remaining teams from.
    choosing: Option<LoginState>,
    /// Chosen teams not yet signed in.
    remaining: Vec<TeamId>,
    /// Signed in so far.
    done: Vec<SignedInWorkspace>,
    /// Chosen teams that need SSO.
    skipped: Vec<LoginWorkspace>,
}

/// Runs claimed sign-in attempts.
pub struct Logins<Connector, Keys> {
    sessions: SessionService,
    connector: Arc<Connector>,
    secrets: Arc<Keys>,
    /// Slack's sign-in page, where the captcha belongs.
    sign_in_page: String,
}

impl<Connector: SlackConnector, Keys: Secrets> Logins<Connector, Keys> {
    /// Wire the worker.
    pub fn new(
        sessions: SessionService,
        connector: Arc<Connector>,
        secrets: Arc<Keys>,
        sign_in_page: String,
    ) -> Self {
        Self {
            sessions,
            connector,
            secrets,
            sign_in_page,
        }
    }

    /// Advance one attempt if it has input nobody else is working on.
    pub async fn process(&self, attempt: Uuid) {
        let work = match self.sessions.claim_login(attempt).await {
            Ok(Some(work)) => work,
            Ok(None) => return,
            Err(report) => {
                tracing::warn!(error = %report, "Claiming a Slack sign-in failed");
                return;
            }
        };
        let span = tracing::info_span!(
            "slack.login.step",
            login_id = %attempt,
            outcome = tracing::field::Empty,
        );
        external_chat::signals::trace_context::adopt(&span, work.traceparent.as_deref());
        async {
            let advance = self.step(&work).await;
            let outcome = match &advance {
                Some(LoginAdvance::Wait { step, .. }) => <&'static str>::from(step.name()),
                Some(LoginAdvance::Done { .. }) => "done",
                Some(LoginAdvance::Failed(reason)) => (*reason).into(),
                None => "retry",
            };
            tracing::Span::current().record("outcome", outcome);
            // KMS unavailable: leave the claim to expire and retry.
            let Some(advance) = advance else { return };
            if let Err(report) = self.sessions.advance_login(attempt, &advance).await {
                tracing::warn!(error = %report, "Recording a Slack sign-in step failed");
            }
        }
        .instrument(span)
        .await;
    }

    async fn step(&self, work: &LoginWork) -> Option<LoginAdvance> {
        let failed = |reason| Some(LoginAdvance::Failed(reason));
        match &work.input {
            Some(LoginInput::Email { email }) => {
                let progress = Progress {
                    login: LoginState::AwaitingEmail,
                    choosing: None,
                    remaining: vec![],
                    done: vec![],
                    skipped: vec![],
                };
                self.slack_step(work, progress, SlackInput::Email(email.clone()), false)
                    .await
            }
            Some(LoginInput::Captcha { solution }) => {
                let progress = self.progress(work).await?;
                let input = SlackInput::CaptchaSolution(Secret::new(solution.clone()));
                self.slack_step(work, progress, input, false).await
            }
            Some(LoginInput::Code { code }) => {
                let progress = self.progress(work).await?;
                let input = SlackInput::EmailCode(Secret::new(code.clone()));
                self.slack_step(work, progress, input, false).await
            }
            Some(LoginInput::TwoFactor { code }) => {
                let progress = self.progress(work).await?;
                let input = SlackInput::TwoFactorCode(Secret::new(code.clone()));
                self.slack_step(work, progress, input, false).await
            }
            Some(LoginInput::Workspaces { team_ids }) => {
                let mut progress = self.progress(work).await?;
                progress.choosing = Some(progress.login.clone());
                progress.remaining = team_ids
                    .iter()
                    .filter_map(|team| TeamId::new(team.clone()).ok())
                    .collect();
                self.next_workspace(work, progress).await
            }
            Some(LoginInput::Session { .. }) => self.session(work).await,
            None => failed(LoginFailure::SlackUnavailable),
        }
    }

    /// The sealed progress of the previous step.
    async fn progress(&self, work: &LoginWork) -> Option<Progress> {
        let Some(sealed) = &work.sealed_state else {
            return Some(Progress {
                login: LoginState::AwaitingEmail,
                choosing: None,
                remaining: vec![],
                done: vec![],
                skipped: vec![],
            });
        };
        let bytes = match self
            .secrets
            .open_login_state(&work.user_id, work.id, sealed)
            .await
        {
            Ok(bytes) => bytes,
            Err(OpenFailure::Unavailable) => return None,
            Err(OpenFailure::Unreadable) => {
                return Some(Progress {
                    login: LoginState::AwaitingEmail,
                    choosing: None,
                    remaining: vec![],
                    done: vec![],
                    skipped: vec![],
                });
            }
        };
        serde_json::from_slice(&bytes).ok()
    }

    /// Sign in to the next chosen team, or finish.
    async fn next_workspace(
        &self,
        work: &LoginWork,
        mut progress: Progress,
    ) -> Option<LoginAdvance> {
        let Some(team) = progress.remaining.first().cloned() else {
            if progress.done.is_empty() && progress.skipped.len() == 1 {
                let team = progress.skipped.remove(0);
                return Some(LoginAdvance::Wait {
                    step: LoginStep::FinishOnDesktop {
                        sign_in_url: format!("https://{}.slack.com/", team.domain),
                        team,
                    },
                    state: None,
                });
            }
            return Some(LoginAdvance::Done {
                workspaces: progress.done,
                skipped: progress.skipped,
            });
        };
        progress.remaining.remove(0);
        let choosing = progress.choosing.clone()?;
        progress.login = choosing;
        Box::pin(self.slack_step(work, progress, SlackInput::Workspace(team), true)).await
    }

    async fn slack_step(
        &self,
        work: &LoginWork,
        mut progress: Progress,
        input: SlackInput,
        choosing: bool,
    ) -> Option<LoginAdvance> {
        let state = progress.login.clone();
        match self.connector.login_step(state, input).await {
            Ok(SlackStep::Next(next)) => {
                progress.login = next;
                self.wait(work, progress, false).await
            }
            Ok(SlackStep::Complete {
                workspace,
                credentials,
            }) => {
                match self.sign_in(work, &credentials).await? {
                    Ok(signed) => progress.done.push(signed),
                    Err(_) => progress.skipped.push(workspace_view(&workspace, &[])),
                }
                Box::pin(self.next_workspace(work, progress)).await
            }
            Ok(SlackStep::BrowserRequired { workspace, .. }) => {
                progress.skipped.push(workspace_view(&workspace, &[]));
                Box::pin(self.next_workspace(work, progress)).await
            }
            Err(error) => {
                progress.login = error.resume_from;
                match error.kind {
                    LoginErrorKind::InvalidCode
                    | LoginErrorKind::InvalidTwoFactorCode
                    | LoginErrorKind::CaptchaRejected
                    | LoginErrorKind::TwoFactorExpired => self.wait(work, progress, true).await,
                    LoginErrorKind::UnknownWorkspace if choosing => {
                        Box::pin(self.next_workspace(work, progress)).await
                    }
                    LoginErrorKind::InvalidEmail => {
                        Some(LoginAdvance::Failed(LoginFailure::InvalidEmail))
                    }
                    LoginErrorKind::CodeExpired => {
                        Some(LoginAdvance::Failed(LoginFailure::CodeExpired))
                    }
                    LoginErrorKind::NoWorkspaces => {
                        Some(LoginAdvance::Failed(LoginFailure::NoWorkspaces))
                    }
                    LoginErrorKind::RateLimited { .. } => {
                        Some(LoginAdvance::Failed(LoginFailure::RateLimited))
                    }
                    LoginErrorKind::WrongInput
                    | LoginErrorKind::UnknownWorkspace
                    | LoginErrorKind::SessionIncomplete
                    | LoginErrorKind::Slack(_) => {
                        Some(LoginAdvance::Failed(LoginFailure::SlackUnavailable))
                    }
                }
            }
        }
    }

    /// Wait for the person in the step the state names, sealing it.
    async fn wait(
        &self,
        work: &LoginWork,
        progress: Progress,
        retry: bool,
    ) -> Option<LoginAdvance> {
        // A storage failure leaves the claim to expire, and the step retries.
        let connected = self.sessions.connected_teams(&work.user_id).await.ok()?;
        let view = |workspace: &SlackWorkspace| workspace_view(workspace, &connected);
        let step = match &progress.login {
            LoginState::AwaitingEmail => {
                return Some(LoginAdvance::Failed(LoginFailure::SlackUnavailable));
            }
            LoginState::AwaitingCaptcha { site_key, .. } => LoginStep::Captcha {
                site_key: site_key.clone(),
                page_url: self.sign_in_page.clone(),
                retry,
            },
            LoginState::AwaitingEmailCode { email, .. } => LoginStep::EmailCode {
                email: email.expose().to_owned(),
                retry,
            },
            LoginState::ChoosingWorkspace { workspaces, .. } => LoginStep::PickWorkspaces {
                workspaces: workspaces.iter().map(view).collect(),
            },
            LoginState::AwaitingTwoFactor { workspace, .. } => LoginStep::TwoFactor {
                team: view(workspace),
                retry,
            },
        };
        let bytes = serde_json::to_vec(&progress).ok()?;
        let state = self
            .secrets
            .seal_login_state(&work.user_id, work.id, &bytes)
            .await
            .ok()?;
        Some(LoginAdvance::Wait {
            step,
            state: Some(state),
        })
    }

    /// Check a session Slack handed out and seal it for its account.
    /// `None`: KMS is unavailable.
    async fn sign_in(
        &self,
        work: &LoginWork,
        credentials: &SessionCredentials,
    ) -> Option<Result<SignedInWorkspace, LoginFailure>> {
        let validated = match self.connector.validate(credentials).await {
            Ok(validated) => validated,
            Err(_) => return Some(Err(LoginFailure::InvalidSession)),
        };
        let account = self
            .sessions
            .account_id_for(&work.user_id, &validated.team_id)
            .await
            .ok()?;
        let sealed = self
            .secrets
            .seal_credentials(&work.user_id, account, credentials)
            .await
            .ok()?;
        Some(Ok(SignedInWorkspace {
            account_id: account,
            team_id: validated.team_id,
            enterprise_id: validated.enterprise_id,
            team_name: validated.team_name,
            team_domain: validated.team_domain,
            team_icon_url: validated.team_icon_url,
            slack_user_id: validated.slack_user_id,
            credentials: sealed,
        }))
    }

    /// A pasted or captured session: every token must authenticate.
    async fn session(&self, work: &LoginWork) -> Option<LoginAdvance> {
        let sealed = work.sealed_input.as_ref()?;
        let bytes = match self
            .secrets
            .open_login_input(&work.user_id, work.id, sealed)
            .await
        {
            Ok(bytes) => bytes,
            Err(OpenFailure::Unavailable) => return None,
            Err(OpenFailure::Unreadable) => {
                return Some(LoginAdvance::Failed(LoginFailure::InvalidSession));
            }
        };
        let invalid = Some(LoginAdvance::Failed(LoginFailure::InvalidSession));
        let Ok(submission) = serde_json::from_slice::<SessionSubmission>(&bytes) else {
            return invalid;
        };
        let Ok(cookie) = CookieToken::new(submission.cookie.clone()) else {
            return invalid;
        };
        let mut workspaces = Vec::with_capacity(submission.tokens.len());
        for token in &submission.tokens {
            let Ok(token) = SessionToken::new(token.token.clone()) else {
                return invalid;
            };
            let credentials = SessionCredentials {
                token,
                cookie: cookie.clone(),
                cookie_session_start: submission.cookie_ds.clone().map(Secret::new),
            };
            match self.sign_in(work, &credentials).await? {
                Ok(signed) => workspaces.push(signed),
                Err(reason) => return Some(LoginAdvance::Failed(reason)),
            }
        }
        Some(LoginAdvance::Done {
            workspaces,
            skipped: vec![],
        })
    }
}

/// A Slack sign-in workspace as the web shows it.
fn workspace_view(workspace: &SlackWorkspace, connected: &[String]) -> LoginWorkspace {
    LoginWorkspace {
        team_id: workspace.team_id.to_string(),
        name: workspace.name.clone(),
        domain: workspace.domain.clone().unwrap_or_default(),
        icon_url: workspace.icon_url.clone(),
        enterprise_name: workspace.enterprise_name.clone(),
        sign_in: if workspace.sso_required {
            WorkspaceSignIn::Sso
        } else if workspace.two_factor_required {
            WorkspaceSignIn::TwoFactor
        } else {
            WorkspaceSignIn::Ready
        },
        already_connected: connected
            .iter()
            .any(|team| team == workspace.team_id.as_str()),
    }
}
