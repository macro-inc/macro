//! Real IMAP engine and an independent IMAP client as its protocol oracle.

use crate::{
    Mail, Report,
    host::{ReservedPort, free_port},
    process::ServiceProcess,
};
use rootcause::prelude::*;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::Stdio,
};
use tokio::io::AsyncWriteExt;

/// Independent control of local Dovecot and Mailpit, outside Macro's engine.
#[derive(Clone, Debug)]
pub struct ImapLab {
    root: PathBuf,
    http: reqwest::Client,
}

impl ImapLab {
    fn local() -> Result<Self, Report> {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../docker/imap-lab");
        if !root.join("generated/ca.pem").is_file() {
            bail!("prepare and start docker/imap-lab before an IMAP scenario");
        }
        Ok(Self {
            root,
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()?,
        })
    }

    /// Synthetic account credentials; each address receives its own mail home.
    pub fn connect_request(&self, email: &str) -> Value {
        json!(
        {
            "requestId": uuid::Uuid::now_v7(),
            "email": email,
            "imap": {
                "endpoint": {
                    "host": "maillab.example.net",
                    "port": 993,
                    "tls": "implicit",
                    "username": email
                },
                "password": "pass"
            },
            "smtp": {
                "endpoint": {
                    "host": "maillab.example.net",
                    "port": 465,
                    "tls": "implicit",
                    "username": email
                },
                "password": "pass"
            },
            "confirmedHosts": [
                "maillab.example.net"
            ]
        }
        )
    }

    /// Inject MIME directly using an independent IMAP client.
    pub async fn deliver(&self, email: &str, mail: &Mail) -> Result<Value, Report> {
        use base64::Engine;
        let attachments: Vec<_> = mail
            .attachments
            .iter()
            .map(|part| {
                json!(
                {
                    "filename": part.filename,
                    "mimeType": part.mime_type,
                    "base64": base64::engine::general_purpose::STANDARD.encode(&part.bytes)
                }
                )
            })
            .collect();
        self.control(&json!(
        {
            "operation": "deliver",
            "email": email,
            "from": mail.from,
            "to": mail.to,
            "cc": mail.cc,
            "subject": mail.subject,
            "text": mail.text,
            "html": mail.html,
            "messageId": mail.message_id,
            "inReplyTo": mail.in_reply_to,
            "attachments": attachments
        }
        ))
        .await
    }

    /// Actual mail and flags at the server, independent from Macro's index.
    pub async fn messages(&self, email: &str) -> Result<Value, Report> {
        self.control(&json!({"operation":"messages","email":email}))
            .await
    }

    /// Change read state using another IMAP client.
    pub async fn set_read(&self, email: &str, message_id: &str, read: bool) -> Result<(), Report> {
        self.control(
            &json!({"operation":"setRead","email":email,"messageId":message_id,"read":read}),
        )
        .await?;
        Ok(())
    }

    /// The real receiving SMTP server's captured messages.
    pub async fn received(&self) -> Result<Value, Report> {
        Ok(self
            .http
            .get("http://127.0.0.1:35825/api/v1/messages")
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?)
    }

    /// Original SMTP DATA from the real Dovecot relay, before Mailpit adds display headers.
    pub async fn submission_mime(&self, subject: &str) -> Result<Option<Value>, Report> {
        let value = self
            .control(&json!({"operation":"submissionMime","subject":subject}))
            .await?;
        Ok((!value.is_null()).then_some(value))
    }

    async fn control(&self, input: &Value) -> Result<Value, Report> {
        let mut process = tokio::process::Command::new("python3")
            .arg(self.root.join("control.py"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .context("could not start independent IMAP oracle")?;
        let mut input_pipe = process
            .stdin
            .take()
            .ok_or_else(|| report!("IMAP oracle has no input pipe"))?;
        input_pipe.write_all(&serde_json::to_vec(input)?).await?;
        input_pipe.shutdown().await?;
        drop(input_pipe);
        let output = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            process.wait_with_output(),
        )
        .await??;
        if !output.status.success() {
            bail!(
                "independent IMAP oracle failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        Ok(serde_json::from_slice(&output.stdout)?)
    }
}

pub(crate) struct ImapLaunch {
    port: ReservedPort,
    lab: ImapLab,
}
impl ImapLaunch {
    pub(crate) async fn prepare() -> Result<Self, Report> {
        crate::process::ensure_built(&["imap_service"])?;
        Ok(Self {
            port: free_port().await?,
            lab: ImapLab::local()?,
        })
    }

    pub(crate) fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port.port())
    }

    pub(crate) async fn start(
        self,
        base: &BTreeMap<String, String>,
        email_api_url: &str,
        log_dir: &Path,
    ) -> Result<ImapPart, Report> {
        let url = self.url();
        let mut env = base.clone();
        env.insert("OVERRIDE_EMAIL_SERVICE_URL".into(), email_api_url.into());
        env.insert(
            "DATABASE_URL".into(),
            base.get("MACRO_DB_URL")
                .cloned()
                .ok_or_else(|| report!("IMAP stack has no scenario database"))?,
        );
        env.insert("PORT".into(), self.port.port().to_string());
        env.insert("LOCAL_AWS_URL".into(), "http://127.0.0.1:35456".into());
        env.insert(
            "INTERNAL_AUTH_KEY".into(),
            base.get("INTERNAL_API_KEY")
                .cloned()
                .ok_or_else(|| report!("IMAP stack has no internal API key"))?,
        );
        env.insert(
            "IMAP_CREDENTIAL_KMS_KEY_ID".into(),
            "alias/macro-local-imap-credentials".into(),
        );
        env.insert(
            "IMAP_TEST_ENDPOINT_MAP".into(),
            json!(
            {
                "maillab.example.net:993": "127.0.0.1:35993",
                "maillab.example.net:143": "127.0.0.1:35143",
                "maillab.example.net:465": "127.0.0.1:35465",
                "maillab.example.net:587": "127.0.0.1:35587"
            }
            )
            .to_string(),
        );
        env.insert(
            "IMAP_TEST_TRUST_ROOT_PEM".into(),
            std::fs::read_to_string(self.lab.root.join("generated/ca.pem"))?,
        );
        self.port.release();
        let mut service = ServiceProcess::spawn("imap_service", &env, log_dir)?;
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()?;
        crate::stack::wait_for_health(&http, &url, &mut service).await?;
        Ok(ImapPart {
            service,
            lab: self.lab,
        })
    }
}

pub(crate) struct ImapPart {
    pub(crate) service: ServiceProcess,
    pub(crate) lab: ImapLab,
}
