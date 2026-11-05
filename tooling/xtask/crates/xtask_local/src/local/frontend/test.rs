use super::*;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};

#[test]
fn stack_frontend_uses_same_origin_with_an_instance_specific_server_target() {
    for instance in [
        Instance::derive(None, None).unwrap(),
        Instance::derive(Some("remote-dev"), Some(20100)).unwrap(),
        Instance::derive(Some("other-dev"), Some(20300)).unwrap(),
    ] {
        for mode in [Mode::Local, Mode::Dev] {
            let env: std::collections::HashMap<_, _> = dev_env(&instance, mode, true)
                .unwrap()
                .into_iter()
                .collect();
            assert_eq!(
                env["MACRO_LOCAL_HOSTNAME"],
                super::super::tls::hostname().unwrap()
            );
            assert_eq!(env["VITE_LOCAL_BACKEND_ORIGIN"], "same-origin");
            assert_eq!(
                env["NODE_EXTRA_CA_CERTS"],
                proxy::ca_pem().display().to_string()
            );
            assert_eq!(env["MACRO_LOCAL_BACKEND_PROXY"], proxy::url(&instance));
            assert_eq!(
                env["MACRO_LOCAL_BACKEND_ROUTES"],
                proxy::frontend_path_prefixes().join(",")
            );
            assert_eq!(env["VITE_OTEL_EXPORTER_URL"], "/i/otlp/v1/traces");
            if mode.spec().runs_local_infra {
                assert_eq!(env["VITE_AI_EDITING_WORKER_URL"], "/ai-editing");
            } else {
                assert!(!env.contains_key("VITE_AI_EDITING_WORKER_URL"));
            }
            if mode == Mode::Local {
                assert_eq!(env["VITE_LOCAL_STACK"], "true");
            } else {
                assert!(!env.contains_key("VITE_LOCAL_STACK"));
            }
        }
        let env: std::collections::HashMap<_, _> = dev_env(&instance, Mode::Local, false)
            .unwrap()
            .into_iter()
            .collect();
        assert_eq!(env["VITE_ENABLE_BROWSER_OTEL"], "false");
        assert!(!env.contains_key("VITE_OTEL_EXPORTER_URL"));
    }
}

fn test_frontend(stage: &Stage) -> Frontend {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);

    let log = std::env::temp_dir().join(format!("frontend-test-{port}.log"));
    let mut command = Command::new("python3");
    command
        .args([
            "-u",
            "-c",
            include_str!("test_server.py"),
            &port.to_string(),
        ])
        .current_dir(app_dir())
        .env("VITE_LOCAL_BACKEND_ORIGIN", "http://localhost:18090")
        .process_group(0)
        .stdin(Stdio::piped());
    let process = spawn(stage, &mut command, port, &log).unwrap();
    Frontend {
        process,
        command,
        port,
        pid_file: log.with_extension("pid"),
        log,
    }
}

fn response(frontend: &Frontend) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", frontend.port)).unwrap();
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
        .unwrap();
    stream
        .write_all(b"GET / HTTP/1.0\r\nHost: localhost\r\n\r\n")
        .unwrap();
    let mut body = String::new();
    stream.read_to_string(&mut body).unwrap();
    body
}

#[test]
fn restart_replaces_process_and_preserves_port_environment_and_directory() {
    let stage = Stage::from_env().quiet();
    let mut frontend = test_frontend(&stage);
    // Represents an unrelated backend listener that restarting Vite must not touch.
    let backend = TcpListener::bind("127.0.0.1:0").unwrap();
    let original_port = frontend.port;

    for _ in 0..2 {
        let original_pid = frontend.process.child.id();
        frontend.restart(&stage).unwrap();

        assert_ne!(frontend.process.child.id(), original_pid);
        // SAFETY: signal 0 only probes whether the old process still exists.
        assert_eq!(unsafe { libc::kill(original_pid as i32, 0) }, -1);
        assert_eq!(frontend.port, original_port);
        let body = response(&frontend);
        assert!(body.contains("http://localhost:18090"));
        assert!(body.contains(&app_dir().display().to_string()));
        assert!(TcpStream::connect(backend.local_addr().unwrap()).is_ok());
    }

    frontend.shutdown();
    assert!(TcpStream::connect(("127.0.0.1", original_port)).is_err());
}

#[test]
fn failed_restart_reports_output_and_releases_the_port() {
    let stage = Stage::from_env().quiet();
    let mut frontend = test_frontend(&stage);
    frontend.command = Command::new("sh");
    frontend
        .command
        .args(["-c", "echo vite-startup-failed >&2; exit 1"])
        .process_group(0);

    let error = frontend.restart(&stage).unwrap_err();
    assert!(error.to_string().contains("vite-startup-failed"));
    assert!(TcpStream::connect(("127.0.0.1", frontend.port)).is_err());
}

#[test]
fn a_second_frontend_build_in_a_checkout_waits_for_the_first() {
    let dir = tempfile::tempdir().unwrap();
    let first = lock_build_in(dir.path(), || panic!("nothing holds the lock yet")).unwrap();
    let (waiting_tx, waiting_rx) = std::sync::mpsc::channel();
    let (locked_tx, locked_rx) = std::sync::mpsc::channel();
    let path = dir.path().to_path_buf();
    let second = std::thread::spawn(move || {
        let _lock = lock_build_in(&path, || waiting_tx.send(()).unwrap()).unwrap();
        locked_tx.send(()).unwrap();
    });
    waiting_rx.recv().unwrap();
    assert!(
        locked_rx.try_recv().is_err(),
        "the second build ran while the first held the lock"
    );
    drop(first);
    locked_rx.recv().unwrap();
    second.join().unwrap();
}
