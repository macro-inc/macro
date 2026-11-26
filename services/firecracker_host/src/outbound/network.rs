//! The netns slot pool and its firewall, created at startup so a purchase
//! never creates links.
//!
//! Slot `n`: netns `<prefix>-<n>` holding `tap0` (172.16.0.1/30; the guest
//! is 172.16.0.2 in every slot, fixed by the golden) and `eth0`, the peer of
//! the host's `<prefix>v<n>` veth (a /30 from `veth_base`). Inside, traffic
//! from the tap leaves only with the guest's own source address and is
//! masqueraded; the host masquerades again on the uplink. The root table
//! drops guest traffic to the host, to other guests, to private and
//! link-local ranges (GCP metadata included; MMDS is answered by Firecracker
//! inside the netns), to the tailnet except the configured control plane,
//! IPv6 and SMTP, and admits the API port only from the configured sources.
//! Every rule matches the agent's own interfaces or port: the host's own
//! traffic (its DNS through the metadata server, Incus's dnsmasq) is never
//! filtered here.

use std::net::Ipv4Addr;
use std::path::Path;

use tokio::io::AsyncWriteExt;

use crate::config::NetworkConfig;
use crate::domain::service::GUEST_GATEWAY;

#[cfg(test)]
mod test;

/// Creating a slot or loading a table failed.
#[derive(Debug, thiserror::Error)]
pub enum NetworkError {
    /// A command failed.
    #[error("{command} failed: {message}")]
    Command {
        /// The command line.
        command: String,
        /// Its stderr or spawn error.
        message: String,
    },
}

/// The slot pool's names and addresses.
#[derive(Debug, Clone)]
pub struct Network {
    config: NetworkConfig,
    api_port: u16,
    uid_base: u32,
}

impl Network {
    /// The pool `config` describes.
    pub fn new(config: NetworkConfig, api_port: u16, uid_base: u32) -> Self {
        Self {
            config,
            api_port,
            uid_base,
        }
    }

    fn netns(&self, slot: u16) -> String {
        format!("{}-{slot}", self.config.prefix)
    }

    fn host_veth(&self, slot: u16) -> String {
        format!("{}v{slot}", self.config.prefix)
    }

    /// The host and netns ends of slot `slot`'s veth /30.
    pub fn veth_addresses(&self, slot: u16) -> (Ipv4Addr, Ipv4Addr) {
        let base = u32::from(self.config.veth_base);
        let first = base + u32::from(slot) * 4;
        (Ipv4Addr::from(first + 1), Ipv4Addr::from(first + 2))
    }

    /// Load the root tables, then create every missing slot `0..count`.
    #[tracing::instrument(name = "firecracker_host.network_setup", skip(self), err)]
    pub async fn set_up(&self, count: u16) -> Result<(), NetworkError> {
        run_with_input("nft", &["-f", "-"], &self.root_tables()).await?;
        for slot in 0..count {
            self.ensure_slot(slot).await?;
        }
        Ok(())
    }

    #[tracing::instrument(name = "firecracker_host.network_slot", skip(self), fields(remade = tracing::field::Empty), err)]
    async fn ensure_slot(&self, slot: u16) -> Result<(), NetworkError> {
        let netns = self.netns(slot);
        let veth = self.host_veth(slot);
        let uid = (self.uid_base + u32::from(slot)).to_string();
        let present = Path::new("/run/netns").join(&netns).exists()
            && Path::new("/sys/class/net").join(&veth).exists();
        // A slot made under another `jail.uid_base` has a tap the slot's
        // user cannot open: it is made again.
        let reusable = present && tap_owner(&netns).await.as_deref() == Some(uid.as_str());
        // Remade: present but unusable. A fresh or reused slot records false.
        tracing::Span::current().record("remade", present && !reusable);
        if reusable {
            return Ok(());
        }
        // A half-made slot from an interrupted start goes first.
        let _ = run("ip", &["netns", "del", &netns]).await;
        let _ = run("ip", &["link", "del", &veth]).await;

        let (host, inside) = self.veth_addresses(slot);
        let host_cidr = format!("{host}/30");
        let inside_cidr = format!("{inside}/30");
        let tap_cidr = format!("{GUEST_GATEWAY}/30");
        let host_text = host.to_string();
        let steps: [&[&str]; 12] = [
            &["netns", "add", &netns],
            &["-n", &netns, "link", "set", "lo", "up"],
            // Owned by the slot's user: the jailed Firecracker has no
            // capabilities to open someone else's tap.
            &[
                "-n", &netns, "tuntap", "add", "dev", "tap0", "mode", "tap", "user", &uid, "group",
                &uid,
            ],
            &["-n", &netns, "addr", "add", &tap_cidr, "dev", "tap0"],
            &["-n", &netns, "link", "set", "tap0", "up"],
            &[
                "link", "add", &veth, "type", "veth", "peer", "name", "eth0", "netns", &netns,
            ],
            &["addr", "add", &host_cidr, "dev", &veth],
            &["link", "set", &veth, "up"],
            &["-n", &netns, "addr", "add", &inside_cidr, "dev", "eth0"],
            &["-n", &netns, "link", "set", "eth0", "up"],
            &["-n", &netns, "route", "add", "default", "via", &host_text],
            &[
                "netns",
                "exec",
                &netns,
                "sysctl",
                "-qw",
                "net.ipv4.ip_forward=1",
                "net.ipv6.conf.all.disable_ipv6=1",
            ],
        ];
        for arguments in steps {
            run("ip", arguments).await?;
        }
        run_with_input(
            "ip",
            &["netns", "exec", &netns, "nft", "-f", "-"],
            NETNS_TABLE,
        )
        .await
    }

    /// The root namespace's tables, replaced as a whole.
    pub fn root_tables(&self) -> String {
        let prefix = &self.config.prefix;
        let veths = format!("{prefix}v*");
        let base = self.config.veth_base;
        let uplink = &self.config.uplink;
        let api_port = self.api_port;
        let sources = if self.config.api_sources.is_empty() {
            String::new()
        } else {
            let list = self
                .config
                .api_sources
                .iter()
                .map(Ipv4Addr::to_string)
                .collect::<Vec<_>>()
                .join(", ");
            format!("ip saddr {{ {list} }} accept\n")
        };
        let (control_plane_forward, control_plane_nat) = match &self.config.control_plane {
            Some(control_plane) if !control_plane.ports.is_empty() => {
                let ports = control_plane
                    .ports
                    .iter()
                    .map(u16::to_string)
                    .collect::<Vec<_>>()
                    .join(", ");
                let address = control_plane.address;
                (
                    format!(
                        "oifname \"tailscale0\" ip daddr {address} tcp dport {{ {ports} }} accept\n"
                    ),
                    format!(
                        "ip saddr {base}/16 oifname \"tailscale0\" ip daddr {address} tcp dport {{ {ports} }} masquerade\n"
                    ),
                )
            }
            _ => (String::new(), String::new()),
        };
        let guest_destinations: String = self
            .config
            .guest_destinations
            .iter()
            .map(|destination| {
                format!(
                    "ip daddr {} tcp dport {} accept\n    ",
                    destination.address, destination.port
                )
            })
            .collect();
        format!(
            r#"table inet {prefix}
delete table inet {prefix}
table inet {prefix} {{
  set blocked_ipv4 {{
    type ipv4_addr
    flags interval
    elements = {{ 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16,
                 172.16.0.0/12, 192.168.0.0/16, 224.0.0.0/4, 240.0.0.0/4 }}
  }}

  chain input {{
    type filter hook input priority filter; policy accept;
    iifname "{veths}" jump vm_to_host
    tcp dport {api_port} jump api_in
  }}

  chain api_in {{
    iifname "lo" accept
    {sources}counter drop
  }}

  chain vm_to_host {{
    ct state established,related accept
    # Errors only (path MTU discovery): guests get no echo from the host.
    meta l4proto icmp icmp type {{ destination-unreachable, time-exceeded }} accept
    counter drop
  }}

  chain forward {{
    type filter hook forward priority filter; policy accept;
    iifname "{veths}" jump vm_out
    oifname "{veths}" ct state established,related accept
    oifname "{veths}" counter drop
  }}

  chain vm_out {{
    {control_plane_forward}{guest_destinations}meta nfproto ipv6 counter drop
    oifname {{ "tailscale0", "wg0" }} counter drop
    oifname "{veths}" counter drop
    ip daddr @blocked_ipv4 counter drop
    tcp dport 25 counter drop
    accept
  }}
}}
table ip {prefix}-nat
delete table ip {prefix}-nat
table ip {prefix}-nat {{
  chain postrouting {{
    type nat hook postrouting priority srcnat; policy accept;
    ip saddr {base}/16 oifname "{uplink}" masquerade
    {control_plane_nat}
  }}
}}
"#
        )
    }
}

/// Inside every slot's netns: only the guest's own address leaves the tap
/// (no spoofing), nothing reaches the netns itself, and traffic is
/// masqueraded onto the veth.
const NETNS_TABLE: &str = r#"table inet vm
delete table inet vm
table inet vm {
  chain forward {
    type filter hook forward priority filter; policy drop;
    iifname "tap0" oifname "eth0" ip saddr 172.16.0.2 accept
    iifname "eth0" oifname "tap0" ct state established,related accept
  }
  chain input {
    type filter hook input priority filter; policy drop;
    iifname "lo" accept
    ct state established,related accept
  }
  chain post {
    type nat hook postrouting priority srcnat; policy accept;
    oifname "eth0" masquerade
  }
}
"#;

/// The uid owning `tap0` in `netns`, if it can be read.
async fn tap_owner(netns: &str) -> Option<String> {
    let output = tokio::process::Command::new("ip")
        .args(["netns", "exec", netns, "cat", "/sys/class/net/tap0/owner"])
        .output()
        .await
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

async fn run(program: &str, arguments: &[&str]) -> Result<(), NetworkError> {
    let output = tokio::process::Command::new(program)
        .args(arguments)
        .output()
        .await
        .map_err(|error| command_error(program, arguments, error.to_string()))?;
    if output.status.success() {
        return Ok(());
    }
    Err(command_error(
        program,
        arguments,
        String::from_utf8_lossy(&output.stderr).trim().to_owned(),
    ))
}

async fn run_with_input(
    program: &str,
    arguments: &[&str],
    input: &str,
) -> Result<(), NetworkError> {
    let mut child = tokio::process::Command::new(program)
        .args(arguments)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| command_error(program, arguments, error.to_string()))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(input.as_bytes())
            .await
            .map_err(|error| command_error(program, arguments, error.to_string()))?;
    }
    let output = child
        .wait_with_output()
        .await
        .map_err(|error| command_error(program, arguments, error.to_string()))?;
    if output.status.success() {
        return Ok(());
    }
    Err(command_error(
        program,
        arguments,
        String::from_utf8_lossy(&output.stderr).trim().to_owned(),
    ))
}

fn command_error(program: &str, arguments: &[&str], message: String) -> NetworkError {
    NetworkError::Command {
        command: format!("{program} {}", arguments.join(" ")),
        message,
    }
}
