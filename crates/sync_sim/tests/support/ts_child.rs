use super::peer_protocol::*;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

pub struct TsChild {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    expected_loro: &'static str,
    pub transcript: Vec<(String, String)>,
}
impl TsChild {
    pub fn spawn(seed: u32) -> Self {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let lane = match macro_env_var::read_env_var("SYNC_SIM_TS_LORO") {
            Ok(value) => value,
            Err(std::env::VarError::NotPresent) => "current".into(),
            Err(error) => panic!("invalid SYNC_SIM_TS_LORO: {error}"),
        };
        let expected_loro = match lane.as_str() {
            "current" => "1.17.1",
            "legacy" => "1.16.3",
            _ => panic!("SYNC_SIM_TS_LORO must be current or legacy"),
        };
        let mut child = Command::new("bun")
            .arg("tooling/sync-sim/ts-peer.ts")
            .arg(seed.to_string())
            .arg(lane)
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("Bun peer must be installed; run bun install --ignore-scripts");
        Self {
            input: child.stdin.take().unwrap(),
            output: BufReader::new(child.stdout.take().unwrap()),
            child,
            expected_loro,
            transcript: vec![],
        }
    }
    pub fn command(&mut self, command: &PeerCommand) -> PeerReport {
        let command = serde_json::to_string(command).unwrap();
        writeln!(self.input, "{command}").expect("write peer command");
        self.input.flush().unwrap();
        let mut line = String::new();
        assert!(
            self.output.read_line(&mut line).unwrap() > 0,
            "peer exited; command={command}; transcript={:#?}",
            self.transcript
        );
        let report: PeerReport = serde_json::from_str(&line)
            .unwrap_or_else(|error| panic!("peer report: {error}: {line}"));
        assert_eq!(report.version, 1);
        assert_eq!(
            report.loro_version, self.expected_loro,
            "selected web Loro lane changed"
        );
        self.transcript.push((command, line));
        report
    }
}
impl Drop for TsChild {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
    }
}
