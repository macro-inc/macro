# Grafana: two replicas on the RDS Postgres the AWS layer creates, with HA
# alerting between them (Alertmanager gossip over a headless Service, so one
# notification goes out, not two). It provisions exactly what the host's
# Grafana does, from infra/stacks/observability/nixos/grafana-provisioning:
# the same datasource UIDs (`prometheus` is Mimir here), dashboards, alert
# rules and contact points. Login is the host's Google OAuth with its admin
# mapping (nixos/grafana.nix).
#
# Notifications: until the switch only the host's Grafana notifies. With
# `macro.grafana.notify = false` every route but the watchdog's is muted, so
# rules evaluate and show state here, but nothing reaches GoAlert, SNS or
# anyone. The switch sets it to true.
#
# Watchdog: an always-firing rule whose only receiver is a GoAlert heartbeat
# monitor, pinged every two minutes (a repeat waits for the next 1m group
# tick). If this Grafana, its alerting or its path to GoAlert dies, the
# heartbeat expires and GoAlert pages. It is live in both modes; the
# monitor's ID is `goalert_cluster_heartbeat_id` in the secret.
{
  charts,
  config,
  lib,
  ...
}:
let
  cfg = config.macro.grafana;
  cluster = config.macro.cluster;
  namespace = "observability";
  workload = import ./lib/workload.nix { inherit lib; };
  host = ../../../../stacks/observability/nixos;

  selector = {
    "app.kubernetes.io/name" = "grafana";
    "app.kubernetes.io/instance" = "grafana";
  };

  provisioning = import "${host}/grafana-provisioning" {
    inherit lib;
    inherit (cfg) goalertUrl;
    datasourceUrls = config.macro.edge.datasourceUrls;
  };

  # Alerting: the shared documents plus the watchdog, with the routing
  # muted unless `notify`.
  watchdog = {
    contactPoint = {
      orgId = 1;
      name = "GoAlert heartbeat";
      receivers = [
        {
          uid = "goalert-heartbeat";
          type = "webhook";
          # A heartbeat only needs the ping; a resolve would be another ping.
          disableResolveMessage = true;
          settings = {
            url = "${cfg.goalertUrl}/api/v2/heartbeat/$GOALERT_CLUSTER_HEARTBEAT_ID";
            httpMethod = "POST";
          };
        }
      ];
    };
    route = {
      receiver = watchdog.contactPoint.name;
      object_matchers = [
        [
          "watchdog"
          "="
          "true"
        ]
      ];
      group_by = [ "alertname" ];
      group_wait = "0s";
      group_interval = "1m";
      repeat_interval = "1m";
    };
    group = {
      orgId = 1;
      name = "Cluster watchdog";
      folder = "Macro";
      interval = "1m";
      rules = [
        {
          uid = "cluster-watchdog";
          title = "Watchdog (observability cluster)";
          # A constant: firing as long as rules are evaluated at all.
          condition = "A";
          data = [
            {
              refId = "A";
              datasourceUid = "__expr__";
              relativeTimeRange = {
                from = 0;
                to = 0;
              };
              model = {
                refId = "A";
                type = "math";
                expression = "1";
              };
            }
          ];
          for = "0s";
          noDataState = "Alerting";
          execErrState = "Alerting";
          isPaused = false;
          labels.watchdog = "true";
          annotations = {
            summary = "Always firing. GoAlert pages when its heartbeat stops.";
            description = "Pings the GoAlert heartbeat monitor for the cluster's Grafana every two minutes. If it stops, this Grafana's alerting or its path to GoAlert is down.";
          };
        }
      ];
    };
  };
  muteAlways = "always";
  rootPolicy = builtins.head provisioning.alerting.policies.policies;
  alerting = {
    "contact-points.yaml" = provisioning.alerting.contactPoints // {
      contactPoints = provisioning.alerting.contactPoints.contactPoints ++ [ watchdog.contactPoint ];
    };
    "mute-timings.yaml" = {
      apiVersion = 1;
      muteTimes = [
        {
          orgId = 1;
          name = muteAlways;
          time_intervals = [
            {
              times = [
                {
                  start_time = "00:00";
                  end_time = "24:00";
                }
              ];
            }
          ];
        }
      ];
    };
    "policies.yaml" = provisioning.alerting.policies // {
      policies = [
        (
          rootPolicy
          // {
            routes = [
              watchdog.route
            ]
            ++ (
              if cfg.notify then
                rootPolicy.routes
              else
                # Matches everything the watchdog didn't, and sends nothing.
                [
                  {
                    inherit (rootPolicy) receiver;
                    mute_time_intervals = [ muteAlways ];
                  }
                ]
            );
          }
        )
      ];
    };
    "rules.yaml" = provisioning.alerting.rules // {
      groups = provisioning.alerting.rules.groups ++ [ watchdog.group ];
    };
  };

  dashboardDir = name: "/etc/grafana/dashboards/${name}";
  dashboardConfigMap = name: "grafana-dashboards-${name}";
  dashboardProviders = {
    apiVersion = 1;
    providers = map (provider: {
      inherit (provider) name folder;
      orgId = 1;
      type = "file";
      disableDeletion = true;
      allowUiUpdates = false;
      options.path = dashboardDir provider.name;
    }) provisioning.dashboards;
  };

  # ConfigMaps the pods mount: name -> { mountPath, data }.
  toYaml = builtins.mapAttrs (_: builtins.toJSON);
  configMaps = {
    grafana-datasources = {
      mountPath = "/etc/grafana/provisioning/datasources";
      data."datasources.yaml" = builtins.toJSON provisioning.datasources;
    };
    grafana-alerting = {
      mountPath = "/etc/grafana/provisioning/alerting";
      data = toYaml alerting;
    };
    grafana-dashboard-providers = {
      mountPath = "/etc/grafana/provisioning/dashboards";
      data."providers.yaml" = builtins.toJSON dashboardProviders;
    };
    grafana-rds-ca = {
      mountPath = "/etc/grafana/rds";
      # RDS's CA bundle for the region, so the database connection verifies
      # the server's name and certificate. Committed rather than fetched:
      # AWS republishes the file when it adds CAs, which would break every
      # render. From
      # https://truststore.pki.rds.amazonaws.com/us-east-2/us-east-2-bundle.pem
      data."ca.pem" =
        assert lib.assertMsg (
          cluster.region == "us-east-2"
        ) "rds-ca-us-east-2.pem is us-east-2's RDS CA bundle; add ${cluster.region}'s";
        builtins.readFile ./rds-ca-us-east-2.pem;
    };
  }
  // builtins.listToAttrs (
    map (
      provider:
      lib.nameValuePair (dashboardConfigMap provider.name) {
        mountPath = dashboardDir provider.name;
        data = builtins.listToAttrs (
          map (file: lib.nameValuePair file.name (builtins.toJSON file.dashboard)) provider.files
        );
      }
    ) provisioning.dashboards
  );

  # Secrets: name -> mount path (null: environment only).
  secrets = {
    # Required: Grafana doesn't start without them.
    grafana = "/etc/grafana/secrets";
    # The RDS-managed database secret: `username`, `password`. RDS rotates
    # the password (yearly, ../aws/); Reloader then rolls Grafana.
    grafana-db = "/etc/grafana/database";
    # Optional, each its own ExternalSecret so a missing key leaves the rest.
    grafana-goalert = null;
    grafana-watchdog = null;
  };
  secretFile = secret: key: "$__file{${secrets.${secret}}/${key}}";

  databaseReady = cfg.database.host != null && cfg.database.secret != null;

  # With `localTesting` Grafana is reached through `kubectl port-forward` at
  # http://localhost:3000, and Google signs in back to that address. Browsers
  # accept its secure cookies there, since localhost counts as secure.
  server =
    if cfg.localTesting then
      lib.throwIf cfg.notify
        "macro.grafana: localTesting is for before the switch; turn it off with notify on, or notifications link to localhost."
        {
          domain = "localhost";
          root_url = "http://localhost:3000/";
        }
    else
      {
        domain = cfg.hostname;
        root_url = "https://${cfg.hostname}/";
      };

  # The host's settings (nixos/grafana.nix), with the cluster's paths,
  # hostname, database and HA alerting.
  ini = lib.recursiveUpdate (import "${host}/grafana.nix") {
    server = server // {
      http_addr = "0.0.0.0";
    };
    security.secret_key = secretFile "grafana" "grafana_secret_key";
    "auth.google" = {
      client_id = secretFile "grafana" "google_client_id";
      client_secret = secretFile "grafana" "google_client_secret";
    };
    # The host installs these from Nix; here Grafana fetches the same
    # versions before it starts, and never updates them.
    plugins = {
      preinstall_disabled = false;
      preinstall_auto_update = false;
      preinstall_sync = lib.concatStringsSep "," (
        lib.mapAttrsToList (id: version: "${id}@${version}") cfg.plugins
      );
    };
    database = {
      type = "postgres";
      host = "${toString cfg.database.host}:5432";
      name = "grafana";
      user = secretFile "grafana-db" "username";
      password = secretFile "grafana-db" "password";
      ssl_mode = "verify-full";
      ca_cert_path = "${configMaps.grafana-rds-ca.mountPath}/ca.pem";
    };
    unified_alerting = {
      enabled = true;
      ha_peers = "grafana-headless.${namespace}.svc.cluster.local:9094";
      ha_listen_address = "$__env{POD_IP}:9094";
      ha_advertise_address = "$__env{POD_IP}:9094";
      # A replaced pod's address never comes back.
      ha_reconnect_timeout = "2m";
    };
  };

  optionalSecretEnv = secret: key: {
    secretKeyRef = {
      name = secret;
      inherit key;
      optional = true;
    };
  };
in
{
  options.macro.grafana = with lib; {
    hostname = mkOption {
      type = types.str;
      description = "Grafana's public hostname (domain, root URL and the OAuth redirect URI).";
    };
    goalertUrl = mkOption {
      type = types.str;
      description = "GoAlert's base URL, without a trailing slash, for the contact points and the watchdog heartbeat.";
    };
    localTesting = mkOption {
      type = types.bool;
      default = false;
      description = ''
        Serve Grafana at http://localhost:3000 for testing through
        `kubectl port-forward` before the ALB sends `hostname` here. Google
        sign-in then needs http://localhost:3000/login/google as a redirect
        URI of the OAuth client. Off at the switch; can't be on with `notify`.
      '';
    };
    notify = mkOption {
      type = types.bool;
      default = false;
      description = ''
        Whether contact points send. False mutes every route except the
        watchdog heartbeat: only one Grafana may notify, and until the switch
        that is the host's.
      '';
    };
    alertTopicArn = mkOption {
      type = types.str;
      description = "SNS topic of the `Macro team email` contact point.";
    };
    plugins = mkOption {
      type = types.attrsOf types.str;
      description = "App plugins and their versions; the host's from nixpkgs.";
    };
    database = {
      host = mkOption {
        type = types.nullOr types.str;
        description = "RDS address (`../aws/` output `grafana_db_address`). Null until the AWS layer is applied: Grafana is scaled to 0.";
      };
      secret = mkOption {
        type = types.nullOr types.str;
        description = "ARN of the RDS-managed password secret (`../aws/` output `grafana_db_secret_arn`).";
      };
      cidrs = mkOption {
        type = types.listOf types.str;
        description = "The private subnets the database can be in, for the egress policy.";
      };
    };
  };

  config.applications.grafana = {
    inherit namespace;

    helm.releases.grafana = {
      chart = charts.grafana-community.grafana;
      values = {
        # The host's version, so both show the same thing side by side.
        image = {
          tag = "13.0.9-distroless";
          sha = "1872f0afe4085c9648715dc95dd334fe0e7b2dd6902d6a94a5d215c5ec48a2af";
        };

        replicas = if databaseReady then 2 else 0;
        deploymentStrategy = workload.surgeOne;
        podDisruptionBudget.maxUnavailable = 1;
        topologySpreadConstraints = workload.spread selector;
        # Peers for HA alerting.
        headlessService = true;

        serviceAccount = {
          create = true;
          name = "grafana";
        };
        # Nothing here reads the Kubernetes API.
        rbac.create = false;
        automountServiceAccountToken = false;
        enableServiceLinks = false;
        securityContext = workload.podSecurity 472;
        # The chart's `helm test` pod; Argo CD would run it as a plain Pod.
        testFramework.enabled = false;
        podLabels."observability.macro.com/aws-apis" = "true";

        # No admin user: everyone signs in with Google (nixos/grafana.nix).
        # This also keeps the chart from generating a random admin password.
        env = {
          GF_SECURITY_DISABLE_INITIAL_ADMIN_CREATION = "true";
          GRAFANA_ALERT_TOPIC_ARN = cfg.alertTopicArn;
          AWS_REGION = cluster.region;
        };
        envValueFrom = {
          GOALERT_GRAFANA_KEY = optionalSecretEnv "grafana-goalert" "goalert_grafana_integration_key";
          GOALERT_GRAFANA_NOTIFY_KEY = optionalSecretEnv "grafana-goalert" "goalert_grafana_notify_integration_key";
          GOALERT_CLUSTER_HEARTBEAT_ID = optionalSecretEnv "grafana-watchdog" "goalert_cluster_heartbeat_id";
        };

        "grafana.ini" = ini;

        extraSecretMounts = lib.mapAttrsToList (name: mountPath: {
          inherit name mountPath;
          secretName = name;
          readOnly = true;
        }) (lib.filterAttrs (_: mountPath: mountPath != null) secrets);
        extraConfigmapMounts = lib.mapAttrsToList (name: map: {
          inherit name;
          inherit (map) mountPath;
          configMap = name;
          readOnly = true;
        }) configMaps;

        # Restart on changes the chart's own checksums don't cover:
        # provisioning (read at startup) and rotated secrets (Reloader).
        podAnnotations."checksum/provisioning" = workload.checksum (
          builtins.toJSON (builtins.mapAttrs (_: map: map.data) configMaps)
        );

        # enforce_domain redirects any other Host; probes come by pod IP.
        readinessProbe = {
          httpGet = {
            path = "/api/health";
            port = "grafana";
            httpHeaders = [
              {
                name = "Host";
                value = server.domain;
              }
            ];
          };
          periodSeconds = 5;
          failureThreshold = 3;
        };
        livenessProbe.httpGet.httpHeaders = [
          {
            name = "Host";
            value = server.domain;
          }
        ];
        # Stay in the Service until every proxy has dropped this pod.
        lifecycleHooks.preStop.sleep.seconds = 10;

        resources = {
          requests = {
            cpu = "100m";
            memory = "256Mi";
          };
          limits.memory = "1Gi";
        };
      };
    };

    resources = {
      configMaps = builtins.mapAttrs (_: map: { inherit (map) data; }) configMaps;

      # Only on the Deployment (the chart's `annotations` go on everything).
      deployments.grafana.metadata.annotations."secret.reloader.stakater.com/reload" =
        lib.concatStringsSep "," (builtins.attrNames secrets);

      networkPolicies.grafana.spec = {
        podSelector.matchLabels = selector;
        policyTypes = [
          "Ingress"
          "Egress"
        ];
        ingress = [
          {
            from = [ (workload.pods { "app.kubernetes.io/name" = "edge"; }) ];
            ports = workload.tcpPorts [ 3000 ];
          }
          {
            from = [ (workload.pods selector) ];
            ports = [
              {
                protocol = "TCP";
                port = 9094;
              }
              {
                protocol = "UDP";
                port = 9094;
              }
            ];
          }
        ];
        # HTTPS (Google, grafana.com plugins, GoAlert, AWS) comes from the
        # namespace's `aws-apis` policy.
        egress = [
          {
            to = [ (workload.pods { "app.kubernetes.io/name" = "query-gateway"; }) ];
            ports = workload.tcpPorts [ config.macro.edge.gatewayPort ];
          }
          {
            to = [ (workload.pods selector) ];
            ports = [
              {
                protocol = "TCP";
                port = 9094;
              }
              {
                protocol = "UDP";
                port = 9094;
              }
            ];
          }
          {
            to = workload.cidrs cfg.database.cidrs;
            ports = workload.tcpPorts [ 5432 ];
          }
        ];
      };
    };

    yamls = [
      (workload.externalSecret cluster {
        name = "grafana";
        properties = [
          "google_client_id"
          "google_client_secret"
          "grafana_secret_key"
        ];
      })
      (workload.externalSecret cluster {
        name = "grafana-goalert";
        properties = [
          "goalert_grafana_integration_key"
          "goalert_grafana_notify_integration_key"
        ];
      })
      (workload.externalSecret cluster {
        name = "grafana-watchdog";
        properties = [ "goalert_cluster_heartbeat_id" ];
      })
    ]
    ++ lib.optional databaseReady (
      workload.externalSecret cluster {
        name = "grafana-db";
        extract = cfg.database.secret;
        # A rotation invalidates the old password at once: new database
        # connections fail until this refresh and the rollout it triggers.
        refreshInterval = "1m";
      }
    );
  };
}
