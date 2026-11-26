//! Real-server scale evidence. This never seeds the engine index or deletes mailbox data.
use super::*;
use std::time::Instant;

const MESSAGE_COUNT: usize = 100_000;
const APPEND_BATCH: usize = 1_000;
const BODY_SENTINEL: &str = "SYNTHETIC_SCALE_BODY_MUST_REMAIN_LAZY";

fn resident_kib(field: &str) -> Option<u64> {
    std::fs::read_to_string("/proc/self/status")
        .ok()?
        .lines()
        .find_map(|line| {
            line.strip_prefix(field)?
                .split_ascii_whitespace()
                .next()?
                .parse()
                .ok()
        })
}

#[tokio::test]
#[ignore = "requires task-owned Dovecot lab; seeds a new unique 100000-message mailbox"]
async fn real_tls_initial_scan_of_one_hundred_thousand_remote_messages() {
    let run = uuid::Uuid::now_v7();
    let user = format!("scale-{run}@example.net");
    let ca = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../docker/imap-lab/generated/ca.pem"),
    )
    .expect("the task-owned mail lab must have a generated trust root");
    let protocol = ProtocolTransport::new(
        Connector::new(LocalEndpoints {
            addresses: BTreeMap::from([(
                "maillab.example.net:993".into(),
                "127.0.0.1:35993".into(),
            )]),
            trust_root_pem: Some(ca),
        })
        .expect("the task lab uses a valid TLS trust root"),
    );
    let login = Login {
        endpoint: Endpoint {
            host: "maillab.example.net".into(),
            port: 993,
            tls: TlsMode::Implicit,
            username: user.clone(),
        },
        password: Secret("pass".into()),
    };
    let credentials = Credentials {
        features: None,
        binding: None,
        user_id: "synthetic-scale-owner".into(),
        email: user.clone(),
        imap: login.clone(),
        smtp: login,
    };
    let started = Instant::now();
    let mut seeded_bytes = 0u64;
    timeout(Duration::from_secs(600), async {
        // Seed through the actual server's IMAP protocol, independently from snapshot/index code.
        let mut session = protocol
            .imap(&credentials.imap)
            .await
            .expect("verified TLS login to the task Dovecot lab");
        let capabilities = session.capabilities().await.unwrap();
        assert!(capabilities.has_str("MULTIAPPEND"), "Dovecot fixture must advertise MULTIAPPEND");
        assert!(capabilities.has_str("LITERAL+"), "Dovecot fixture must advertise LITERAL+");
        assert_eq!(session.select("INBOX").await.unwrap().exists, 0, "a unique synthetic mailbox must start empty");
        for first in (0..MESSAGE_COUNT).step_by(APPEND_BATCH) {
            let mut command = String::from("APPEND INBOX");
            for index in first..(first + APPEND_BATCH).min(MESSAGE_COUNT) {
                let mime = format!(
                    "From: sender@example.net\r\nTo: {user}\r\nMessage-ID: <{run}.{index}@example.net>\r\nDate: Tue, 14 Nov 2023 22:13:20 +0000\r\nSubject: synthetic scale {index}\r\nContent-Type: text/plain\r\n\r\n{BODY_SENTINEL}\r\n{}\r\n",
                    "0123456789abcdef".repeat(32)
                );
                seeded_bytes += mime.len() as u64;
                command.push_str(&format!(" {{{}+}}\r\n", mime.len()));
                command.push_str(&mime);
            }
            timeout(Duration::from_secs(30), session.run_command_and_check_ok(command))
                .await
                .expect("one MULTIAPPEND batch must finish within thirty seconds")
                .expect("Dovecot must accept the complete MULTIAPPEND batch");
            if (first + APPEND_BATCH).is_multiple_of(10_000) {
                eprintln!("imap_scale seeded={} elapsed_ms={} mailbox={user}", first + APPEND_BATCH, started.elapsed().as_millis());
            }
        }
        assert_eq!(session.select("INBOX").await.unwrap().exists as usize, MESSAGE_COUNT);
        session.logout().await.unwrap();
    })
    .await
    .expect("seeding one hundred thousand synthetic messages must finish within ten minutes");
    let seed_elapsed = started.elapsed();
    let rss_before = resident_kib("VmRSS:");
    let scan_started = Instant::now();
    let snapshot = timeout(
        Duration::from_secs(250),
        protocol.snapshot(&credentials, &AccountState::default()),
    )
    .await
    .expect("initial IMAP metadata scan must complete within its bounded deadline")
    .expect("real-server initial metadata scan must succeed");
    let scan_elapsed = scan_started.elapsed();
    let inbox = snapshot
        .iter()
        .find(|folder| folder.folder.role == FolderRole::Inbox)
        .unwrap();
    assert_eq!(inbox.messages.len(), MESSAGE_COUNT);
    assert_eq!(
        snapshot
            .iter()
            .map(|folder| folder.messages.len())
            .sum::<usize>(),
        MESSAGE_COUNT
    );
    assert_eq!(inbox.sync_tier, SyncTier::Full);
    assert!(
        inbox.highest_modseq.is_some(),
        "Dovecot fixture exposes the CONDSTORE watermark for later passes"
    );
    let header_bytes = inbox
        .messages
        .iter()
        .map(|message| message.mime.len() as u64)
        .sum::<u64>();
    let advertised_bytes = inbox
        .messages
        .iter()
        .map(|message| u64::from(message.size))
        .sum::<u64>();
    assert_eq!(advertised_bytes, seeded_bytes);
    assert!(
        header_bytes < advertised_bytes / 2,
        "snapshot must retain headers rather than complete MIME bodies"
    );
    assert!(inbox.messages.iter().all(|message| {
        !message
            .mime
            .windows(BODY_SENTINEL.len())
            .any(|window| window == BODY_SENTINEL.as_bytes())
    }));
    eprintln!(
        "imap_scale result count={} seed_ms={} scan_ms={} header_bytes={} remote_bytes={} rss_before_kib={:?} rss_after_kib={:?} peak_rss_kib={:?} tier={:?} watermark={:?} mailbox={user}",
        inbox.messages.len(),
        seed_elapsed.as_millis(),
        scan_elapsed.as_millis(),
        header_bytes,
        advertised_bytes,
        rss_before,
        resident_kib("VmRSS:"),
        resident_kib("VmHWM:"),
        inbox.sync_tier,
        inbox.highest_modseq,
    );
    let sample = &inbox.messages[MESSAGE_COUNT / 2];
    let source = protocol
        .source(&credentials, &inbox.path, inbox.uid_validity, sample.uid)
        .await
        .unwrap();
    assert!(
        source
            .windows(BODY_SENTINEL.len())
            .any(|window| window == BODY_SENTINEL.as_bytes()),
        "an explicit lazy source read must fetch the body"
    );
}
