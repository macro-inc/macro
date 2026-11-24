# How full the Firecracker hosts are and where their running VMs sit, for
# placement and capacity decisions. Same series as the Macro computers fleet
# dashboard (computers-dashboard.nix), written by Alloy on each host
# (nix/hosts/_nixos/firecracker-host.alloy):
# - `firecracker-host/host`: node_exporter, the host (a machine or a nested VM);
# - `firecracker-host/computers`: cAdvisor over the VMs' cgroups. A series with
#   a `computer_id` is one running VM; hibernated and stopped computers have no
#   cgroup, so no series.
# A VM is shown only as the first 8 hex digits of its computer id (`vm`); the
# full id never reaches a legend, table or tooltip.
{ lib }:
let
  datasource = {
    type = "prometheus";
    uid = "prometheus";
  };

  host = ''job="firecracker-host/host",deployment_environment=~"$env",host=~"$host"'';
  # Every running VM of the selected hosts, for capacity sums.
  vms = ''job="firecracker-host/computers",deployment_environment=~"$env",host=~"$host",computer_id!=""'';
  # The running VMs of one repeated host row, narrowed by the `vm` prefix box.
  hostVms = ''job="firecracker-host/computers",host="$host",computer_id!="",computer_id=~"$vm.*"'';
  # The filesystem computers' disks live on: the ZFS dataset `<pool>/firecracker`
  # and its clones, or the XFS mount (`macro.firecrackerHost.storage`).
  storage = ''${host},fstype=~"zfs|xfs",mountpoint=~"/[^/]+/firecracker(/.*)?|/var/lib/firecracker-host"'';

  # Default `memory_high_watermark_percent` (docs/runbooks/computer-overcommit.md).
  watermark = "0.8";

  cores = by: ''count${by} (node_cpu_seconds_total{${host},mode="idle"})'';
  memTotal = by: "sum${by} (node_memory_MemTotal_bytes{${host}})";
  memAvailable = by: "sum${by} (node_memory_MemAvailable_bytes{${host}})";
  cpuBusy =
    by: ''100 * (1 - sum${by} (rate(node_cpu_seconds_total{${host},mode="idle"}[5m])) / ${cores by})'';
  ramUsed = by: "100 * (1 - ${memAvailable by} / ${memTotal by})";
  # ZFS: each dataset's size is what it references plus the pool's free
  # space, so used is the datasets' referenced bytes together (clones count
  # the blocks they share with their golden: an upper bound) and free is the
  # pool's. XFS: the one filesystem.
  storageUsedByHost = "sum by (host, deployment_environment) (node_filesystem_size_bytes{${storage}} - node_filesystem_avail_bytes{${storage}})";
  storageFreeByHost = "max by (host, deployment_environment) (node_filesystem_avail_bytes{${storage}})";
  storageUsed =
    by:
    "100 * sum${by} (${storageUsedByHost}) / (sum${by} (${storageUsedByHost}) + sum${by} (${storageFreeByHost}))";
  # A count over VMs reads 0 only for a host that reports; with no host it
  # stays empty, so the panel says what is missing.
  zeroIfReporting = by: "(count${by} (node_memory_MemTotal_bytes{${host}}) * 0)";
  runningVms = by: "(count${by} (container_memory_usage_bytes{${vms}}) or ${zeroIfReporting by})";
  vcpuLimits =
    by:
    "(sum${by} (container_spec_cpu_quota{${vms}} / container_spec_cpu_period{${vms}}) or ${zeroIfReporting by})";
  memoryLimits =
    by: "(sum${by} (container_spec_memory_limit_bytes{${vms}}) or ${zeroIfReporting by})";
  vcpuPerCore = by: "${vcpuLimits by} / ${cores by}";
  memoryCommitted = by: "100 * ${memoryLimits by} / ${memTotal by}";
  headroom =
    by:
    "sum${by} (clamp_min(${watermark} * node_memory_MemTotal_bytes{${host}} - (node_memory_MemTotal_bytes{${host}} - node_memory_MemAvailable_bytes{${host}}), 0))";
  # Newest sample of each host: exact while it reports (5 minute lookback),
  # else the last day's newest at minute resolution.
  lastSample = "max by (host, deployment_environment) (timestamp(node_memory_MemTotal_bytes{${host}})) or max by (host, deployment_environment) (max_over_time(timestamp(node_memory_MemTotal_bytes{${host}})[1d:1m]))";
  sampleAge = "time() - (${lastSample})";
  psi =
    resource:
    "sum by (host, deployment_environment) (rate(node_pressure_${resource}_waiting_seconds_total{${host}}[5m]))";

  byHost = " by (host, deployment_environment)";
  fleet = "";

  # One VM's series, labelled by its id's first 8 hex digits.
  vm = expr: ''label_replace(${expr}, "vm", "$1", "computer_id", "([0-9a-f]{8}).*")'';
  perVm = expr: "sum by (host, vm) (${vm expr})";
  vmCpu = perVm "rate(container_cpu_usage_seconds_total{${hostVms}}[5m])";
  vmVcpus = perVm "container_spec_cpu_quota{${hostVms}} / container_spec_cpu_period{${hostVms}}";
  vmMemory = perVm "container_memory_usage_bytes{${hostVms}}";
  vmMemoryLimit = perVm "container_spec_memory_limit_bytes{${hostVms}}";
  vmThrottled = perVm "rate(container_cpu_cfs_throttled_seconds_total{${hostVms}}[5m])";
  vmCpuShare = "100 * ${vmCpu} / ${vmVcpus}";
  vmMemoryShare = "100 * ${vmMemory} / ${vmMemoryLimit}";
  # `sort` is 1 for cpu and 0 for memory; only the chosen query returns data.
  # A tile shows only while its host reports: `@ end()` checks the end of
  # the range, so a silent host's last VMs don't linger with old values.
  whenSort =
    value: expr:
    ''(${expr}) and on () (vector($sort) == ${toString value}) and on (host) (node_memory_MemTotal_bytes{job="firecracker-host/host",host="$host"} @ end())'';

  noFleet = "No firecracker-host series in Mimir";
  # A reporting host with no running VM (or none matching the prefix) looks
  # the same as a silent one here; the Hosts table tells them apart.
  noHost = "No running VM, or no telemetry from this host: see Hosts";

  steps = colors: {
    mode = "absolute";
    steps = lib.imap0 (i: step: {
      color = builtins.elemAt step 0;
      value = if i == 0 then null else builtins.elemAt step 1;
    }) colors;
  };
  # Host load: the default relief (70 %) and admission (80 %) watermarks.
  loadSteps = steps [
    [ "green" ]
    [
      "orange"
      70
    ]
    [
      "red"
      80
    ]
  ];
  storageSteps = steps [
    [ "green" ]
    [
      "orange"
      75
    ]
    [
      "red"
      90
    ]
  ];
  # Default allocation ratios: 6 vCPUs per core, memory limits at 400 %.
  vcpuSteps = steps [
    [ "green" ]
    [
      "orange"
      4.8
    ]
    [
      "red"
      6
    ]
  ];
  memoryCommitSteps = steps [
    [ "green" ]
    [
      "orange"
      320
    ]
    [
      "red"
      400
    ]
  ];
  shareSteps = steps [
    [ "green" ]
    [
      "orange"
      70
    ]
    [
      "red"
      90
    ]
  ];
  neutral = steps [ [ "blue" ] ];

  # Missing data in grey, so it never reads as a healthy green.
  missing = text: [
    {
      type = "special";
      options = {
        match = "null+nan";
        result = {
          inherit text;
          color = "text";
          index = 0;
        };
      };
    }
  ];

  target = refId: legendFormat: expr: {
    inherit refId legendFormat expr;
  };
  instant = refId: expr: {
    inherit refId expr;
    instant = true;
    range = false;
    format = "table";
  };

  pos = x: y: w: h: {
    inherit
      x
      y
      w
      h
      ;
  };

  stat =
    {
      id,
      title,
      description,
      gridPos,
      expr,
      unit ? "short",
      thresholds ? neutral,
      noValue ? noFleet,
      decimals ? null,
    }:
    {
      inherit
        id
        title
        description
        datasource
        gridPos
        ;
      type = "stat";
      targets = [
        {
          refId = "A";
          inherit expr;
          instant = true;
          range = false;
        }
      ];
      fieldConfig.defaults = {
        inherit unit thresholds noValue;
        mappings = missing noValue;
        color.mode = "thresholds";
      }
      // lib.optionalAttrs (decimals != null) { inherit decimals; };
      options = {
        graphMode = "none";
        colorMode = "background";
        textMode = "value";
        justifyMode = "center";
        reduceOptions = {
          calcs = [ "lastNotNull" ];
          fields = "";
          values = false;
        };
      };
    };

  timeseries =
    {
      id,
      title,
      description,
      gridPos,
      targets,
      unit,
      thresholds ? null,
      noValue ? noFleet,
    }:
    {
      inherit
        id
        title
        description
        datasource
        gridPos
        targets
        ;
      type = "timeseries";
      fieldConfig.defaults = {
        inherit unit noValue;
        custom = {
          fillOpacity = 0;
          showPoints = "never";
        }
        // lib.optionalAttrs (thresholds != null) { thresholdsStyle.mode = "dashed"; };
      }
      // lib.optionalAttrs (thresholds != null) { inherit thresholds; };
      options = {
        legend = {
          displayMode = "list";
          placement = "bottom";
          showLegend = true;
        };
        tooltip = {
          mode = "multi";
          sort = "desc";
        };
      };
    };

  text = id: title: gridPos: content: {
    inherit id title gridPos;
    type = "text";
    options = {
      mode = "markdown";
      inherit content;
    };
  };

  row =
    id: y: title: extra:
    {
      inherit id title;
      type = "row";
      collapsed = false;
      gridPos = pos 0 y 24 1;
      panels = [ ];
    }
    // extra;

  # A column of a merged table: its query's `Value #<ref>` renamed, with a
  # unit and, if given, cell colors.
  column = ref: name: unit: thresholds: {
    matcher = {
      id = "byName";
      options = name;
    };
    properties = [
      {
        id = "unit";
        value = unit;
      }
    ]
    ++ lib.optionals (thresholds != null) [
      {
        id = "thresholds";
        value = thresholds;
      }
      {
        id = "custom.cellOptions";
        value.type = "color-background";
      }
    ];
  };

  table =
    {
      id,
      title,
      description,
      gridPos,
      columns,
      keys,
      noValue,
      sortBy,
      extraOverrides ? [ ],
    }:
    {
      inherit
        id
        title
        description
        datasource
        gridPos
        ;
      type = "table";
      targets = map (c: instant c.ref c.expr) columns;
      transformations = [
        {
          id = "merge";
          options = { };
        }
        {
          id = "organize";
          options = {
            excludeByName.Time = true;
            indexByName = lib.listToAttrs (
              lib.imap0 (i: name: lib.nameValuePair name i) (keys ++ map (c: "Value #${c.ref}") columns)
            );
            renameByName = lib.listToAttrs (map (c: lib.nameValuePair "Value #${c.ref}" c.name) columns);
          };
        }
      ];
      fieldConfig = {
        defaults = {
          inherit noValue;
          custom = {
            filterable = true;
            align = "auto";
          };
        };
        overrides = map (c: column c.ref c.name c.unit (c.thresholds or null)) columns ++ extraOverrides;
      };
      options = {
        showHeader = true;
        cellHeight = "sm";
        inherit sortBy;
      };
    };

  fleetHint = "Host numbers come from node_exporter; vCPU and memory limits are the cgroup limits of running VMs (reservations, not use).";

  banner = {
    id = 1;
    title = "";
    description = "Hosts with a sample in the last 5 minutes. Red: no firecracker-host series reach Mimir, so every panel below is empty for lack of telemetry, not because hosts are idle.";
    inherit datasource;
    type = "stat";
    gridPos = pos 0 0 24 3;
    targets = [
      {
        refId = "A";
        expr = "count(node_memory_MemTotal_bytes{${host}}) or vector(0)";
        instant = true;
        range = false;
      }
    ];
    fieldConfig.defaults = {
      color.mode = "thresholds";
      thresholds = steps [
        [ "red" ]
        [
          "green"
          1
        ]
      ];
      mappings = [
        {
          type = "value";
          options."0" = {
            text = "No Firecracker host is reporting: no firecracker-host series in Mimir. Panels below are blank because telemetry is missing.";
            color = "red";
            index = 0;
          };
        }
        {
          type = "range";
          options = {
            from = 1;
            to = null;
            result = {
              text = "Telemetry flowing: see Hosts reporting and Hosts silent";
              color = "green";
              index = 1;
            };
          };
        }
      ];
    };
    options = {
      graphMode = "none";
      colorMode = "background";
      textMode = "value";
      justifyMode = "center";
      reduceOptions = {
        calcs = [ "lastNotNull" ];
        fields = "";
        values = false;
      };
    };
  };

  # Fleet summary tiles, six to a line.
  summary =
    lib.imap0
      (
        i: tile:
        stat (
          tile
          // {
            id = 10 + i;
            gridPos = pos (lib.mod i 6 * 4) (4 + builtins.div i 6 * 4) 4 4;
          }
        )
      )
      [
        {
          title = "Hosts reporting";
          description = "Hosts with a node_exporter sample now (node_exporter).";
          expr = "count(node_memory_MemTotal_bytes{${host}}) or vector(0)";
          thresholds = steps [
            [ "red" ]
            [
              "green"
              1
            ]
          ];
        }
        {
          title = "Hosts silent";
          description = "Hosts seen in the last 24 h with no sample in the last 2 minutes: down, or their Alloy can't reach Mimir.";
          expr = "count(max by (host) (max_over_time(node_memory_MemTotal_bytes{${host}}[1d])) unless on (host) max by (host) (max_over_time(node_memory_MemTotal_bytes{${host}}[2m]))) or (count(max_over_time(node_memory_MemTotal_bytes{${host}}[1d])) * 0)";
          thresholds = steps [
            [ "green" ]
            [
              "red"
              1
            ]
          ];
        }
        {
          title = "Running VMs";
          description = "VMs with a cgroup now (cAdvisor). Hibernated and stopped computers have none and are not counted.";
          expr = runningVms fleet;
        }
        {
          title = "Host cores";
          description = "Logical CPUs of the reporting hosts (node_exporter).";
          expr = cores fleet;
        }
        {
          title = "RAM";
          description = "MemTotal of the reporting hosts (node_exporter).";
          expr = memTotal fleet;
          unit = "bytes";
        }
        {
          title = "CPU busy";
          description = "Share of all host cores not idle over 5 minutes (node_exporter).";
          expr = cpuBusy fleet;
          unit = "percent";
          thresholds = loadSteps;
          decimals = 1;
        }
        {
          title = "RAM in use";
          description = "MemTotal - MemAvailable over MemTotal, all hosts together: what the admission watermarks are measured on (node_exporter).";
          expr = ramUsed fleet;
          unit = "percent";
          thresholds = loadSteps;
          decimals = 1;
        }
        {
          title = "Storage in use";
          description = "The filesystem computers' disks live on (the ZFS dataset <pool>/firecracker and its clones, or the XFS mount at /var/lib/firecracker-host). On ZFS used counts each clone's shared golden blocks, so it is an upper bound; free space is exact (node_exporter).";
          expr = storageUsed fleet;
          noValue = "No telemetry for the computers' filesystem";
          unit = "percent";
          thresholds = storageSteps;
          decimals = 1;
        }
        {
          title = "vCPUs committed per core";
          description = "CPU limits of running VMs (reservations) over host cores. Default allocation ratio: 6.";
          expr = vcpuPerCore fleet;
          thresholds = vcpuSteps;
          decimals = 2;
        }
        {
          title = "Memory limits / RAM";
          description = "Memory limits of running VMs (reservations) over host RAM. Default allocation ratio: 400 %.";
          expr = memoryCommitted fleet;
          unit = "percent";
          thresholds = memoryCommitSteps;
          decimals = 0;
        }
        {
          title = "Headroom to 80 % (default watermark)";
          description = "Memory each host can still take before the default admission watermark (80 % of MemTotal), summed; a host past it counts 0. A host whose row sets another watermark differs (docs/runbooks/computer-overcommit.md).";
          expr = headroom fleet;
          unit = "bytes";
        }
        {
          title = "Hosts at or over 80 %";
          description = "Reporting hosts whose memory in use is at or over the default admission watermark: they admit no start or wake.";
          expr = "count(${ramUsed byHost} >= 80) or ${zeroIfReporting fleet}";
          thresholds = steps [
            [ "green" ]
            [
              "red"
              1
            ]
          ];
        }
      ];

  links = [
    {
      title = "Macro computers fleet";
      type = "link";
      url = "/d/macro-computers-fleet";
      tooltip = "Per-computer noisy neighbours and overcommit tuning";
    }
  ];

  nodeRowY = 12;
  nodeColumns = [
    {
      ref = "A";
      name = "Cores";
      unit = "short";
      expr = cores byHost;
    }
    {
      ref = "B";
      name = "RAM";
      unit = "bytes";
      expr = memTotal byHost;
    }
    {
      ref = "C";
      name = "CPU busy";
      unit = "percent";
      expr = cpuBusy byHost;
      thresholds = loadSteps;
    }
    {
      ref = "D";
      name = "RAM used";
      unit = "percent";
      expr = ramUsed byHost;
      thresholds = loadSteps;
    }
    {
      ref = "E";
      name = "Storage used";
      unit = "percent";
      expr = storageUsed byHost;
      thresholds = storageSteps;
    }
    {
      ref = "F";
      name = "Running VMs";
      unit = "short";
      expr = runningVms byHost;
    }
    {
      ref = "G";
      name = "vCPU / core";
      unit = "short";
      expr = vcpuPerCore byHost;
      thresholds = vcpuSteps;
    }
    {
      ref = "H";
      name = "Mem limits / RAM";
      unit = "percent";
      expr = memoryCommitted byHost;
      thresholds = memoryCommitSteps;
    }
    {
      ref = "I";
      name = "Headroom";
      unit = "bytes";
      expr = headroom byHost;
    }
    {
      ref = "J";
      name = "PSI cpu";
      unit = "percentunit";
      expr = psi "cpu";
      thresholds = steps [
        [ "green" ]
        [
          "orange"
          0.1
        ]
        [
          "red"
          0.25
        ]
      ];
    }
    {
      ref = "K";
      name = "PSI memory";
      unit = "percentunit";
      expr = psi "memory";
      thresholds = steps [
        [ "green" ]
        [
          "orange"
          0.01
        ]
        [
          "red"
          0.05
        ]
      ];
    }
    {
      ref = "L";
      name = "Last sample";
      unit = "s";
      expr = sampleAge;
      thresholds = steps [
        [ "green" ]
        [
          "red"
          120
        ]
      ];
    }
    {
      ref = "M";
      name = "Status";
      unit = "none";
      expr = "(${sampleAge}) > bool 120";
    }
  ];

  nodes = [
    (row 2 nodeRowY "Node distribution" { })
    (table {
      id = 30;
      title = "Hosts";
      description = "One row per host seen in the last day. Cores to RAM used, storage, headroom and PSI are node_exporter; vCPU / core and Mem limits / RAM are running VMs' cgroup limits (reservations). Headroom: memory left before the default 80 % admission watermark. PSI: share of time tasks waited. A host that stopped reporting shows only Last sample and Status.";
      gridPos = pos 0 (nodeRowY + 1) 24 8;
      columns = nodeColumns;
      keys = [
        "host"
        "deployment_environment"
      ];
      # Also every cell of a host that stopped reporting.
      noValue = "no telemetry";
      sortBy = [
        {
          displayName = "RAM used";
          desc = true;
        }
      ];
      extraOverrides = [
        {
          matcher = {
            id = "byName";
            options = "deployment_environment";
          };
          properties = [
            {
              id = "displayName";
              value = "env";
            }
          ];
        }
        {
          matcher = {
            id = "byName";
            options = "Status";
          };
          properties = [
            {
              id = "mappings";
              value = [
                {
                  type = "value";
                  options = {
                    "0" = {
                      text = "ok";
                      color = "green";
                      index = 0;
                    };
                    "1" = {
                      text = "stale > 2m";
                      color = "red";
                      index = 1;
                    };
                  };
                }
              ];
            }
            {
              id = "custom.cellOptions";
              value.type = "color-background";
            }
          ];
        }
      ];
    })
    {
      id = 31;
      title = "Running VMs per host";
      description = "VMs with a cgroup now, per host (cAdvisor).";
      inherit datasource;
      type = "bargauge";
      gridPos = pos 0 (nodeRowY + 9) 12 7;
      targets = [
        {
          refId = "A";
          expr = "sort_desc(sum by (host) (${runningVms byHost}))";
          legendFormat = "{{host}}";
          instant = true;
          range = false;
        }
      ];
      fieldConfig.defaults = {
        unit = "short";
        min = 0;
        noValue = noFleet;
        color.mode = "fixed";
        color.fixedColor = "blue";
      };
      options = {
        orientation = "horizontal";
        displayMode = "basic";
        showUnfilled = true;
        minVizHeight = 16;
        maxVizHeight = 32;
        reduceOptions = {
          calcs = [ "lastNotNull" ];
          fields = "";
          values = false;
        };
      };
    }
    {
      id = 32;
      title = "RAM used per host";
      description = "MemTotal - MemAvailable over MemTotal per host (node_exporter); orange at the default 70 % relief watermark, red at the 80 % admission one.";
      inherit datasource;
      type = "bargauge";
      gridPos = pos 12 (nodeRowY + 9) 12 7;
      targets = [
        {
          refId = "A";
          expr = "sort_desc(sum by (host) (${ramUsed byHost}))";
          legendFormat = "{{host}}";
          instant = true;
          range = false;
        }
      ];
      fieldConfig.defaults = {
        unit = "percent";
        min = 0;
        max = 100;
        noValue = noFleet;
        thresholds = loadSteps;
        color.mode = "thresholds";
      };
      options = {
        orientation = "horizontal";
        displayMode = "gradient";
        showUnfilled = true;
        minVizHeight = 16;
        maxVizHeight = 32;
        reduceOptions = {
          calcs = [ "lastNotNull" ];
          fields = "";
          values = false;
        };
      };
    }
    (timeseries {
      id = 33;
      title = "CPU busy per host";
      description = "Share of the host's cores not idle (node_exporter).";
      gridPos = pos 0 (nodeRowY + 16) 12 8;
      unit = "percent";
      thresholds = loadSteps;
      targets = [ (target "A" "{{host}}" (cpuBusy byHost)) ];
    })
    (timeseries {
      id = 34;
      title = "RAM used per host";
      description = "MemTotal - MemAvailable over MemTotal (node_exporter), against the default 70 % and 80 % watermarks.";
      gridPos = pos 12 (nodeRowY + 16) 12 8;
      unit = "percent";
      thresholds = loadSteps;
      targets = [ (target "A" "{{host}}" (ramUsed byHost)) ];
    })
  ];

  vmRowY = nodeRowY + 24;
  vmTableColumns = [
    {
      ref = "A";
      name = "CPU cores";
      unit = "short";
      expr = vmCpu;
    }
    {
      ref = "B";
      name = "CPU % of limit";
      unit = "percent";
      expr = vmCpuShare;
      thresholds = shareSteps;
    }
    {
      ref = "C";
      name = "Memory held";
      unit = "bytes";
      expr = vmMemory;
    }
    {
      ref = "D";
      name = "Memory % of limit";
      unit = "percent";
      expr = vmMemoryShare;
      thresholds = shareSteps;
    }
    {
      ref = "E";
      name = "Throttled s/s";
      unit = "short";
      expr = vmThrottled;
      thresholds = steps [
        [ "green" ]
        [
          "orange"
          0.1
        ]
        [
          "red"
          0.5
        ]
      ];
    }
    {
      ref = "F";
      name = "vCPU limit";
      unit = "short";
      expr = vmVcpus;
    }
    {
      ref = "G";
      name = "Memory limit";
      unit = "bytes";
      expr = vmMemoryLimit;
    }
  ];

  vmRow = [
    (row 4 vmRowY "Running VMs on $host" { repeat = "host"; })
    {
      id = 40;
      title = "VMs on $host by $sort";
      description = "One tile per running VM (first 8 hex digits of its computer id): the chosen resource as a share of the VM's own cgroup limit (its reservation), with its last hours. Pick cpu or memory with Sort; absolute numbers are in the table.";
      inherit datasource;
      type = "stat";
      gridPos = pos 0 (vmRowY + 1) 12 10;
      targets = [
        (target "A" "{{vm}}" (whenSort 1 vmCpuShare))
        (target "B" "{{vm}}" (whenSort 0 vmMemoryShare))
      ];
      fieldConfig.defaults = {
        unit = "percent";
        min = 0;
        max = 100;
        decimals = 0;
        noValue = noHost;
        mappings = missing noHost;
        thresholds = shareSteps;
        color.mode = "thresholds";
      };
      options = {
        graphMode = "area";
        colorMode = "background";
        textMode = "value_and_name";
        justifyMode = "center";
        orientation = "auto";
        wideLayout = true;
        minVizWidth = 110;
        minVizHeight = 60;
        reduceOptions = {
          calcs = [ "lastNotNull" ];
          fields = "";
          values = false;
        };
      };
    }
    (table {
      id = 41;
      title = "VMs on $host";
      description = "Each running VM's use against its cgroup limits (reservations), from cAdvisor. Sort by any column; filter in the header. Throttled: seconds per second the VM wanted CPU its limit refused.";
      gridPos = pos 12 (vmRowY + 1) 12 10;
      columns = vmTableColumns;
      keys = [ "vm" ];
      noValue = noHost;
      sortBy = [
        {
          displayName = "Memory held";
          desc = true;
        }
      ];
      extraOverrides = [
        {
          matcher = {
            id = "byName";
            options = "host";
          };
          properties = [
            {
              id = "custom.hidden";
              value = true;
            }
          ];
        }
      ];
    })
  ];

  dashboard = {
    uid = "macro-firecracker-capacity";
    title = "Firecracker hosts: capacity";
    schemaVersion = 39;
    version = 1;
    editable = false;
    tags = [
      "macro"
      "computers"
      "capacity"
    ];
    timezone = "browser";
    refresh = "1m";
    time = {
      from = "now-6h";
      to = "now";
    };
    description = "How full each Firecracker host is and where its running VMs sit: fleet summary, one row per host, then each host's VMs. ${fleetHint} Watermarks are the defaults in docs/runbooks/computer-overcommit.md.";
    inherit links;
    templating.list = [
      {
        name = "env";
        label = "Environment";
        type = "query";
        inherit datasource;
        query = ''label_values(node_memory_MemTotal_bytes{job="firecracker-host/host"}, deployment_environment)'';
        refresh = 2;
        includeAll = true;
        allValue = ".*";
        multi = true;
        current = {
          text = "All";
          value = "$__all";
        };
      }
      {
        name = "host";
        label = "Host";
        type = "query";
        inherit datasource;
        query = ''label_values(node_memory_MemTotal_bytes{job="firecracker-host/host",deployment_environment=~"$env"}, host)'';
        refresh = 2;
        includeAll = true;
        allValue = ".*";
        multi = true;
        current = {
          text = "All";
          value = "$__all";
        };
      }
      {
        name = "vm";
        label = "VM id prefix";
        type = "textbox";
        query = "";
        current = {
          text = "";
          value = "";
        };
      }
      {
        name = "sort";
        label = "Sort";
        type = "custom";
        query = "cpu : 1,memory : 0";
        current = {
          text = "memory";
          value = "0";
        };
        options = [
          {
            text = "cpu";
            value = "1";
            selected = false;
          }
          {
            text = "memory";
            value = "0";
            selected = true;
          }
        ];
      }
    ];
    panels = [
      banner
      (row 5 3 "Fleet summary" { })
    ]
    ++ summary
    ++ nodes
    ++ [
      (
        text 3 "Not in Mimir yet" (pos 0 (nodeRowY + 24) 24 3)
          "**Scheduler capacity is not in Mimir.** The control plane's `computer.capacity.*` gauges and hibernated or stopped computer counts go to Datadog only, so this dashboard shows running VMs (they have a cgroup) and hosts, not what the scheduler would still place. Admission uses each host's own `hosted_runtime_host` watermarks; the 70 / 80 % lines here are the defaults. Per-computer detail: [Macro computers fleet](/d/macro-computers-fleet)."
        // {
          description = "What this dashboard can't show yet.";
        }
      )
    ]
    ++ map (
      p:
      p
      // {
        gridPos = p.gridPos // {
          y = p.gridPos.y + 3;
        };
      }
    ) vmRow;
  };
in
dashboard
