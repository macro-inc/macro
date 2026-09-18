use super::*;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};

fn test_frontend(stage: &Stage) -> Frontend {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);

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
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let process = spawn(stage, &mut command, port).unwrap();
    Frontend {
        process,
        command,
        port,
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
        .process_group(0)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let error = frontend.restart(&stage).unwrap_err();
    assert!(error.to_string().contains("vite-startup-failed"));
    assert!(TcpStream::connect(("127.0.0.1", frontend.port)).is_err());
}
