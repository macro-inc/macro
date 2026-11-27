# MAPPING.md: every Datadog monitor in the files here, and its Grafana rules,
# queries and comparison so far. The observability cluster's flake renders it
# (`nix run .#render` in infra/k8s/observability/cluster) and its check fails
# when the committed copy differs.
{ lib }:
let
  datadog = import ./. { inherit lib; };
  inherit (datadog) files ported;

  duration =
    seconds:
    if seconds == 0 then
      "0s"
    else if lib.mod seconds 3600 == 0 then
      "${toString (seconds / 3600)}h"
    else if lib.mod seconds 60 == 0 then
      "${toString (seconds / 60)}m"
    else
      "${toString seconds}s";

  routeText = {
    page = "pages";
    notify = "notifies";
    silent = "sends nothing";
  };

  datadogLink =
    monitor:
    if monitor.datadogId == null then
      "not deployed"
    else
      "[${toString monitor.datadogId}](${datadog.datadogUrl monitor.datadogId})";

  comparisonOf =
    monitor:
    monitor.comparison or (
      if monitor.datadogId == null then
        "Nothing to compare with: the monitor is in `infra/stacks/monitoring` but not deployed to Datadog."
      else
        "Not compared yet."
    );

  # Monitors in file order, each with its entries (one, or one per part).
  byMonitor =
    entries:
    map (name: builtins.filter (entry: entry.monitor == name) entries) (
      lib.unique (map (entry: entry.monitor) entries)
    );

  rules =
    entry:
    lib.concatMapStringsSep ", " (
      severity: "`${datadog.uid entry severity}` (${severity}, ${datadog.threshold entry severity})"
    ) (datadog.severities entry);

  input =
    entry: input:
    let
      delay = entry.delay or 0;
    in
    "- `${input.id}`: ${
      if input.query.datasourceUid == "cloudwatch" then
        "${input.reducer or "last"} over ${duration entry.window}"
      else
        "instant query"
    }${lib.optionalString (delay > 0) ", ${duration delay} late"}. ${input.query.text}";

  portedEntry =
    entry:
    lib.concatStringsSep "\n" (
      [ "- Rules: ${rules entry}" ]
      ++ map (input entry) entry.inputs
      ++ [
        "- Value: `${entry.value or ("$" + (builtins.head entry.inputs).id)}`${
          lib.optionalString ((entry.noData or "OK") == "Alerting") "; no data fires the critical rule"
        }."
        "- Translation: ${entry.translation}"
      ]
    );

  section =
    entries:
    let
      first = builtins.head entries;
      header = [
        "### `${first.monitor}`"
        ""
        "${first.name} · Datadog ${datadogLink first} · ${routeText.${first.route}} in Datadog"
        ""
      ];
    in
    lib.concatStringsSep "\n" (
      header
      ++ (
        if ported first then
          [
            "Comparison: ${comparisonOf first}"
            ""
          ]
          ++ (
            if first ? part then
              map (entry: "#### ${entry.part}\n\n${portedEntry entry}\n") entries
            else
              [
                (portedEntry first)
                ""
              ]
          )
        else
          [
            "Not ported. ${first.reason}"
            ""
          ]
      )
    );

  allMonitors = lib.concatMap (file: byMonitor file.monitors) files;
  count = predicate: toString (builtins.length (builtins.filter predicate allMonitors));

  summaryRow =
    entries:
    let
      first = builtins.head entries;
      ruleCount = lib.foldl' (n: entry: n + builtins.length (datadog.severities entry)) 0 entries;
    in
    "| `${first.monitor}` | ${datadogLink first} | ${first.route} | ${
      if ported first then
        "ported, ${toString ruleCount} rule${lib.optionalString (ruleCount != 1) "s"}"
      else
        "not ported"
    } |";
in
''
  # Datadog monitors in Grafana

  Generated from `infra/stacks/observability/nixos/grafana-provisioning/datadog/`
  by `nix run .#render` in `infra/k8s/observability/cluster`; edit those files.

  Every Datadog monitor in `infra/stacks/monitoring/monitors/`, and the
  Grafana alert rules it became. Ported rules run in shadow, in the folder
  `Datadog shadow` with the label `shadow=datadog`: they notify GoAlert's
  Notify service and never page, and a monitor that sends nothing in Datadog
  sends nothing here. A group moves to paging once its rules have fired when
  Datadog did.

  How a rule reads: each input is queried over its window, ending its delay
  before now (Datadog's evaluation delay), and reduced to one value per
  series; the value is computed from them, and the rule fires when it passes
  the threshold. Warning and critical are exclusive bands. No datapoints
  never fires unless noted. Rule state history is in Loki,
  `{from="state-history", group=~"Datadog .*"} | json`.

  Of ${toString (builtins.length allMonitors)} monitors, ${
    count (entries: ported (builtins.head entries))
  } are ported and ${count (entries: !(ported (builtins.head entries)))} not.

  | Monitor | Datadog | Route | Grafana |
  | --- | --- | --- | --- |
  ${lib.concatMapStringsSep "\n" summaryRow allMonitors}

  ${lib.concatMapStringsSep "\n" (
    file:
    "## `${file.source}`\n\nRule group `Datadog ${lib.removeSuffix ".ts" (baseNameOf file.source)}`, every ${file.interval}.\n\n"
    + lib.concatMapStringsSep "\n" section (byMonitor file.monitors)
  ) files}''
