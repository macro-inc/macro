//! The screen stream: on `screen_open`, dial the service's screen socket on
//! a connection of its own (never the runtime connection, so a frame burst
//! cannot hold up agent traffic) and relay its bytes to the local Xvnc
//! display. The service pairs it with the viewer's socket by `stream_id`.

use futures::{SinkExt as _, StreamExt as _};
use rootcause::prelude::ResultExt as _;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
use tracing::Instrument as _;
use uuid::Uuid;

use crate::capabilities::SCREEN_ADDRESS;
use crate::config::{HarnessCredentials, MacroApi};

const HARNESS_TOKEN_HEADER: &str = "x-macro-harness-token";
/// The service route macrod dials, relative to the agent-harness base.
const SCREEN_PATH: &str = "/harnesses/me/screen";
const READ_CHUNK: usize = 64 * 1024;
const DIAL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// Dials screen streams for this harness.
pub struct ScreenDialer {
    base: String,
    token: String,
}

/// A dialed stream, ready to relay.
pub struct ScreenStream {
    display: TcpStream,
    socket: Socket,
    span: tracing::Span,
}

impl ScreenDialer {
    pub fn new(macro_api: &MacroApi, credentials: &HarnessCredentials) -> Self {
        let base = macro_api
            .api_url
            .trim_end_matches('/')
            .replacen("https://", "wss://", 1)
            .replacen("http://", "ws://", 1);
        Self {
            base,
            token: credentials.token.clone(),
        }
    }

    /// The URL for `stream_id`, which must be a UUID.
    pub fn url(&self, stream_id: &str) -> rootcause::Result<String> {
        let stream_id = Uuid::parse_str(stream_id)
            .map_err(|_| rootcause::report!("the screen stream id is not a UUID"))?;
        Ok(format!("{}{SCREEN_PATH}?stream={stream_id}", self.base))
    }

    /// Reach the display, then the service. The display goes first so a
    /// computer without one fails the command instead of the viewer waiting.
    pub async fn connect(&self, stream_id: &str) -> rootcause::Result<ScreenStream> {
        let url = self.url(stream_id)?;
        let span = tracing::info_span!(
            "macrod.screen.stream",
            stream_id,
            bytes_to_display = tracing::field::Empty,
            bytes_from_display = tracing::field::Empty,
        );
        let display = tokio::time::timeout(DIAL_TIMEOUT, TcpStream::connect(SCREEN_ADDRESS))
            .instrument(span.clone())
            .await
            .context("the display connection timed out")?
            .context("this computer's display is not running")?;
        let mut request = url
            .into_client_request()
            .context("the screen URL is not a valid request")?;
        request.headers_mut().insert(
            HARNESS_TOKEN_HEADER,
            self.token
                .parse()
                .context("the harness credential is not a valid header value")?,
        );
        let (socket, _response) =
            tokio::time::timeout(DIAL_TIMEOUT, tokio_tungstenite::connect_async(request))
                .instrument(span.clone())
                .await
                .context("the screen socket connection timed out")?
                .context("could not dial the screen socket")?;
        Ok(ScreenStream {
            display,
            socket,
            span,
        })
    }
}

impl ScreenStream {
    /// Relay until either side closes.
    pub async fn relay(self) {
        let Self {
            display,
            socket,
            span,
        } = self;
        let (mut display_reader, mut display_writer) = display.into_split();
        let (mut socket_writer, mut socket_reader) = socket.split();
        let mut to_display = 0u64;
        let mut from_display = 0u64;
        async {
            let mut buffer = vec![0u8; READ_CHUNK];
            loop {
                tokio::select! {
                    read = display_reader.read(&mut buffer) => match read {
                        Ok(0) | Err(_) => break,
                        Ok(read) => {
                            from_display += read as u64;
                            let chunk = buffer[..read].to_vec();
                            if socket_writer.send(Message::Binary(chunk.into())).await.is_err() {
                                break;
                            }
                        }
                    },
                    message = socket_reader.next() => match message {
                        Some(Ok(Message::Binary(bytes))) => {
                            to_display += bytes.len() as u64;
                            if display_writer.write_all(&bytes).await.is_err() {
                                break;
                            }
                        }
                        Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                        Some(Ok(_)) => {}
                    },
                }
            }
            let _ = socket_writer.close().await;
            tracing::Span::current().record("bytes_to_display", to_display);
            tracing::Span::current().record("bytes_from_display", from_display);
            tracing::info!("screen stream ended");
        }
        .instrument(span)
        .await;
    }
}
