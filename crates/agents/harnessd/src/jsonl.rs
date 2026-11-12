//! The JSONL loop: one [`Request`] per line in, one [`Response`] per line
//! out, in order.

use crate::auth::{Account, AgentAuth, AgentStatus, Agents};
use harnessd_protocol::{AgentProvider, ErrorKind, Request, Response};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};

#[cfg(test)]
mod test;

/// Answer every request line from `reader` on `writer` until `reader`
/// ends. Blank lines are skipped.
pub async fn serve_connection<Claude, Reader, Writer>(
    agents: &Agents<Claude>,
    reader: Reader,
    mut writer: Writer,
) -> std::io::Result<()>
where
    Claude: AgentAuth,
    Reader: AsyncBufRead + Unpin,
    Writer: AsyncWrite + Unpin,
{
    let mut lines = reader.lines();
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }

        let response = answer(agents, &line).await;
        let mut answer_line = serde_json::to_string(&response).map_err(std::io::Error::other)?;
        answer_line.push('\n');
        writer.write_all(answer_line.as_bytes()).await?;
        writer.flush().await?;
    }
    Ok(())
}

/// The response to one request line.
pub async fn answer<Claude: AgentAuth>(agents: &Agents<Claude>, line: &str) -> Response {
    let Ok(request) = serde_json::from_str::<Request>(line) else {
        return Response::Error {
            agent: None,
            kind: ErrorKind::InvalidRequest,
        };
    };

    let agent = request.agent();
    let adapter = agents.adapter(agent);
    let outcome = match request {
        Request::SignInStart { .. } => adapter
            .start()
            .await
            .map(|url| Response::SignInStarted { agent, url }),
        Request::SignInComplete { code, .. } => adapter
            .complete(code)
            .await
            .map(|status| status_response(agent, status)),
        Request::SignInCancel { .. } => adapter
            .cancel()
            .await
            .map(|status| status_response(agent, status)),
        Request::SignOut { .. } => adapter
            .sign_out()
            .await
            .map(|()| Response::SignedOut { agent }),
        Request::Status { .. } => adapter
            .status()
            .await
            .map(|status| status_response(agent, status)),
    };

    outcome.unwrap_or_else(|kind| Response::Error {
        agent: Some(agent),
        kind,
    })
}

fn status_response(agent: AgentProvider, status: AgentStatus) -> Response {
    match status {
        AgentStatus::SignedIn(Account::Claude(account)) => Response::SignedIn {
            agent,
            claude: Some(account),
        },
        AgentStatus::Pending => Response::Pending { agent },
        AgentStatus::SignedOut => Response::SignedOut { agent },
    }
}
