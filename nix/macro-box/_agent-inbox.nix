# How an agent teammate's environment reaches the guest, on every backend.
# macrod receives it over its socket (ApplyAgent) and, as macro, stages it in
# /run/macro-agent-inbox, which exists only on an agent's computer (macrod
# refuses ApplyAgent without it). macro-agent-apply, a root unit, checks the
# role again and installs it as /var/lib/macrod/agent.env, where the agent's
# own path unit (`_agent.nix`) picks it up.
#
# The role is the image's (`macro.box.role`: the Docker fleet picks the
# agent image for an agent's computer) or, when null, the restore's:
# macro-restore writes /run/macro/role and makes the inbox
# (`_firecracker-restore.nix`).
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.macro.box;
  inboxDirectory = "/run/macro-agent-inbox";
  inbox = "${inboxDirectory}/agent.env";
  installed = "/var/lib/macrod/agent.env";
  # What the apply unit is reading; macrod never writes this name.
  claimed = "${inboxDirectory}/agent.env.claimed";
  # The largest environment installed; macrod refuses to stage a larger one
  # (`AGENT_ENV_MAX_BYTES` in crates/coding_agent_worker/src/agent_env.rs).
  maxBytes = 65536;
  # What the apply unit compares with `agent`.
  role = if cfg.role == null then "$(cat /run/macro/role 2> /dev/null || true)" else cfg.role;
in
{
  options.macro.box.role = lib.mkOption {
    type = lib.types.nullOr (
      lib.types.enum [
        "person"
        "agent"
      ]
    );
    default = if cfg.agentMode then "agent" else "person";
    defaultText = lib.literalExpression ''if agentMode then "agent" else "person"'';
    description = ''
      Whom every computer from this image is for: an `agent` image makes
      the agent's inbox at boot and starts `macro-agent.target`. Null leaves
      it to the restore, which writes `/run/macro/role`.
    '';
  };

  config = lib.mkMerge [
    {
      assertions = [
        {
          assertion = cfg.role != "agent" || cfg.agentMode;
          message = "macro.box.role = \"agent\" needs macro.box.agentMode (macro without sudo or docker)";
        }
        {
          assertion = cfg.role != null || cfg.agentMode;
          message = "a role decided at restore needs macro.box.agentMode: the agent's units must be in the image";
        }
      ];
    }
    (lib.mkIf cfg.agentMode {
      systemd.targets.macro-agent = {
        description = "This computer runs an agent teammate";
        wantedBy = lib.optionals (cfg.role == "agent") [ "multi-user.target" ];
      };

      # macro's, 0700: macrod writes it as macro and nobody else reads it.
      systemd.tmpfiles.settings."20-macro-agent-inbox" = lib.mkIf (cfg.role == "agent") {
        ${inboxDirectory}.d = {
          user = "macro";
          group = "macro";
          mode = "0700";
        };
      };

      systemd.paths.macro-agent-apply = {
        description = "Watch for an agent environment from macrod";
        wantedBy = [ "macro-agent.target" ];
        pathConfig.PathChanged = inbox;
      };
      systemd.services.macro-agent-apply = {
        description = "Install the agent environment macrod received";
        path = [
          pkgs.coreutils
          pkgs.util-linux
        ];
        serviceConfig = {
          Type = "oneshot";
          UMask = "0077";
        };
        # The inbox is macro's, so root never opens anything in it: macro
        # claims the staged file by renaming it (a symlink is moved, not
        # followed), reads it (a symlink to a root-only file fails there) and
        # removes it; root only writes what macro handed over. An environment
        # over 64 KiB is refused whole, never installed in part. One staged
        # while another is installed keeps the inbox's name and is installed
        # next.
        script = ''
          inbox=${inbox}
          claimed=${claimed}
          as_macro() { setpriv --reuid=macro --regid=macro --clear-groups "$@"; }
          refuse() {
            rm -f ${installed}.new
            as_macro rm -f "$claimed"
            echo "macro-agent-apply: $1" >&2
            exit 1
          }
          role=${role}
          for _ in 1 2 3 4 5 6 7 8; do
            if ! as_macro mv --force --no-target-directory "$inbox" "$claimed" 2> /dev/null; then
              exit 0
            fi
            if [ "$role" != agent ]; then
              refuse "refusing an agent environment on a $role computer"
            fi
            if ! as_macro head --bytes=${toString (maxBytes + 1)} "$claimed" > ${installed}.new; then
              refuse "macro cannot read its inbox's agent.env"
            fi
            if [ "$(stat --format=%s ${installed}.new)" -gt ${toString maxBytes} ]; then
              refuse "refusing an agent environment over ${toString maxBytes} bytes"
            fi
            if [ ! -s ${installed}.new ]; then
              rm -f ${installed}.new
              as_macro rm -f "$claimed"
              continue
            fi
            # The setup trace macrod staged beside it (not a secret): installed
            # root-owned and read-only for start-agent, capped like a
            # traceparent, and only the first, so a redelivery's fresh one
            # changes nothing. Nothing here fails the environment's install:
            # the trace is only telemetry. One that can't be installed stays in
            # the inbox for the next delivery.
            trace_inbox=${inboxDirectory}/setup-traceparent
            trace=/run/macrod/agent-traceparent
            if as_macro test -s "$trace_inbox"; then
              if [ -e "$trace" ] || {
                install -d -m 0755 /run/macrod &&
                  as_macro head --bytes=128 "$trace_inbox" > "$trace.new" &&
                  chmod 0644 "$trace.new" &&
                  mv "$trace.new" "$trace"
              }; then
                as_macro truncate --size=0 "$trace_inbox" || true
              else
                rm -f "$trace.new" || true
                echo "macro-agent-apply: could not install the setup trace" >&2
              fi
            fi
            chown macro:macro ${installed}.new
            mv ${installed}.new ${installed}
            as_macro rm -f "$claimed"
          done
        '';
      };
    })
  ];
}
