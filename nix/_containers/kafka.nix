# Apache Kafka from Nixpkgs (currently 4.3.1, KRaft combined node).
#
# Not an Apache tarball and not a registry image. The NixOS-wrapped scripts
# already export JAVA_HOME. Named-instance advertised listeners still come
# from compose env.
{ pkgs }:
let
  imageLib = pkgs.callPackage ./image-lib.nix { };
  kafka = pkgs.apacheKafka;

  entrypoint = pkgs.writeShellScriptBin "kafka-entrypoint" ''
    set -euo pipefail
    export PATH="${kafka}/bin:$PATH"
    export LOG_DIR="''${KAFKA_LOG_DIRS:-/var/lib/kafka/data}"
    mkdir -p "$LOG_DIR" /etc/kafka
    props=/etc/kafka/server.properties
    cat > "$props" <<EOF
    process.roles=''${KAFKA_PROCESS_ROLES:-broker,controller}
    node.id=''${KAFKA_NODE_ID:-1}
    controller.quorum.voters=''${KAFKA_CONTROLLER_QUORUM_VOTERS:-1@kafka:29093}
    controller.quorum.bootstrap.servers=''${KAFKA_CONTROLLER_QUORUM_BOOTSTRAP_SERVERS:-kafka:29093}
    controller.listener.names=''${KAFKA_CONTROLLER_LISTENER_NAMES:-CONTROLLER}
    listeners=''${KAFKA_LISTENERS:-PLAINTEXT://0.0.0.0:29092,PLAINTEXT_HOST://0.0.0.0:9092,CONTROLLER://0.0.0.0:29093}
    advertised.listeners=''${KAFKA_ADVERTISED_LISTENERS:-PLAINTEXT://kafka:29092,PLAINTEXT_HOST://localhost:9092,CONTROLLER://kafka:29093}
    listener.security.protocol.map=''${KAFKA_LISTENER_SECURITY_PROTOCOL_MAP:-PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT,CONTROLLER:PLAINTEXT}
    inter.broker.listener.name=''${KAFKA_INTER_BROKER_LISTENER_NAME:-PLAINTEXT}
    offsets.topic.replication.factor=''${KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR:-1}
    transaction.state.log.replication.factor=''${KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR:-1}
    transaction.state.log.min.isr=''${KAFKA_TRANSACTION_STATE_LOG_MIN_ISR:-1}
    auto.create.topics.enable=''${KAFKA_AUTO_CREATE_TOPICS_ENABLE:-true}
    log.dirs=$LOG_DIR
    EOF
    cluster_id="''${CLUSTER_ID:-TWFjcm9Mb2NhbEthZmthMQ}"
    ${kafka}/bin/kafka-storage.sh format -t "$cluster_id" -c "$props" --ignore-formatted
    exec ${kafka}/bin/kafka-server-start.sh "$props"
  '';
in
imageLib.mk {
  name = "macro-local-kafka";
  extraContents = [
    kafka
    entrypoint
  ];
  extraPath = [ kafka ];
  extraCommands = ''
    mkdir -p ./var/lib/kafka/data ./etc/kafka ./opt
    ln -s ${kafka} ./opt/kafka
  '';
  config = {
    Cmd = [ "${entrypoint}/bin/kafka-entrypoint" ];
    ExposedPorts = {
      "9092/tcp" = { };
    };
    Volumes = {
      "/var/lib/kafka/data" = { };
    };
  };
}
