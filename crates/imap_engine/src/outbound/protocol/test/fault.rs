use super::*;
use std::{
    net::SocketAddr,
    sync::{
        Arc,
        atomic::{AtomicU32, Ordering},
    },
};
use tokio_rustls::{
    TlsAcceptor,
    rustls::{
        ServerConfig,
        pki_types::{CertificateDer, PrivateKeyDer, pem::PemObject},
    },
};
use tokio_util::{sync::CancellationToken, task::TaskTracker};

#[derive(Clone, Copy)]
pub(super) enum Fault {
    LoseFinal,
    RejectData(u16),
}
pub(super) struct Proxy {
    pub address: SocketAddr,
    pub connections: Arc<AtomicU32>,
    pub accepted: Arc<AtomicU32>,
    stop: CancellationToken,
    tasks: TaskTracker,
}
impl Proxy {
    pub async fn start(fault: Fault) -> Self {
        let generated = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../docker/imap-lab/generated");
        let certificate = std::fs::read(generated.join("server.pem")).unwrap();
        let key = std::fs::read(generated.join("server.key")).unwrap();
        let certificates = CertificateDer::pem_slice_iter(&certificate)
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let key = PrivateKeyDer::from_pem_slice(&key).unwrap();
        let config = ServerConfig::builder_with_provider(Arc::new(
            tokio_rustls::rustls::crypto::aws_lc_rs::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(certificates, key)
        .unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let stop = CancellationToken::new();
        let done = stop.clone();
        let tasks = TaskTracker::new();
        let children = tasks.clone();
        let connections = Arc::new(AtomicU32::new(0));
        let counted = connections.clone();
        let accepted = Arc::new(AtomicU32::new(0));
        let recorded = accepted.clone();
        tasks.spawn(async move {
            loop {
                let (socket, _) = tokio::select! {
                    _ = done.cancelled() => return,
                    incoming = listener.accept() => incoming.unwrap(),
                };
                counted.fetch_add(1, Ordering::AcqRel);
                let acceptor = TlsAcceptor::from(Arc::new(config.clone()));
                let stopped = done.clone();
                let recorded = recorded.clone();

                children.spawn(async move {
                    let work = async {
                        let mut client = acceptor.accept(socket).await.unwrap();
                        let ca = std::fs::read_to_string(
                            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                                .join("../../docker/imap-lab/generated/ca.pem"),
                        )
                        .unwrap();
                        let connector = Connector::new(LocalEndpoints {
                            addresses: BTreeMap::from([(
                                "maillab.example.net:465".into(),
                                "127.0.0.1:35465".into(),
                            )]),
                            trust_root_pem: Some(ca),
                        })
                        .unwrap();
                        let endpoint = Endpoint {
                            host: "maillab.example.net".into(),
                            port: 465,
                            tls: TlsMode::Implicit,
                            username: "unused".into(),
                        };
                        let socket = connector.tcp(&endpoint).await.unwrap();
                        let mut upstream = connector.tls(&endpoint, socket).await.unwrap();
                        let (_, greeting) = response(&mut upstream).await.unwrap();
                        client.write_all(&greeting).await.unwrap();

                        loop {
                            let Ok(command) = line(&mut client).await else {
                                return;
                            };
                            if command.eq_ignore_ascii_case(b"DATA\r\n")
                                && let Fault::RejectData(code) = fault
                            {
                                client
                                    .write_all(format!("{code} injected refusal\r\n").as_bytes())
                                    .await
                                    .unwrap();
                                return;
                            }
                            upstream.write_all(&command).await.unwrap();
                            let (code, reply) = response(&mut upstream).await.unwrap();
                            client.write_all(&reply).await.unwrap();
                            if code == 354 {
                                loop {
                                    let data = line(&mut client).await.unwrap();
                                    upstream.write_all(&data).await.unwrap();
                                    if data == b".\r\n" {
                                        break;
                                    }
                                }
                                let (code, reply) = response(&mut upstream).await.unwrap();
                                if code == 250 {
                                    recorded.fetch_add(1, Ordering::AcqRel);
                                }
                                match fault {
                                    Fault::LoseFinal => return,
                                    Fault::RejectData(_) => client.write_all(&reply).await.unwrap(),
                                }
                            }
                        }
                    };
                    tokio::select! {
                        _ = stopped.cancelled() => {},
                        _ = work => {},
                    }
                });
            }
        });
        Self {
            address,
            connections,
            accepted,
            stop,
            tasks,
        }
    }
    pub async fn close(self) {
        self.stop.cancel();
        self.tasks.close();
        tokio::time::timeout(Duration::from_secs(5), self.tasks.wait())
            .await
            .unwrap();
    }
    pub fn transport(&self) -> ProtocolTransport {
        let ca = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../docker/imap-lab/generated/ca.pem"),
        )
        .unwrap();
        ProtocolTransport::new(
            Connector::new(LocalEndpoints {
                addresses: BTreeMap::from([(
                    "maillab.example.net:465".into(),
                    self.address.to_string(),
                )]),
                trust_root_pem: Some(ca),
            })
            .unwrap(),
        )
    }
}
