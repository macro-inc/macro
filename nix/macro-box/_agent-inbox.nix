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
        # reads it (a symlink to a root-only file fails there) and empties
        # it, and root only writes what macro handed over, capped at 64 KiB.
        script = ''
          inbox=${inbox}
          as_macro() { setpriv --reuid=macro --regid=macro --clear-groups "$@"; }
          if ! as_macro test -s "$inbox"; then
            exit 0
          fi
          role=${role}
          if [ "$role" != agent ]; then
            echo "macro-agent-apply: refusing an agent environment on a $role computer" >&2
            as_macro truncate --size=0 "$inbox"
            exit 1
          fi
          if ! as_macro head --bytes=65536 "$inbox" > ${installed}.new; then
            rm -f ${installed}.new
            echo "macro-agent-apply: macro cannot read its inbox's agent.env" >&2
            exit 1
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
          as_macro truncate --size=0 "$inbox"
        '';
      };
    })
  ];
}
