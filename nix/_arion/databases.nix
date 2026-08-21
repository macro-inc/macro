{ lib }:
{
  postgres = lib.nixImage lib.images.postgres {
    ports = [ "5432:5432" ];
    expose = [ "5432" ];
    environment = {
      POSTGRES_USER = "user";
      POSTGRES_PASSWORD = "password";
      PGPASSWORD = "password";
    };
    volumes = [ "db:/var/lib/postgresql" ];
    networks = [ "databases" ];
    healthcheck = {
      test = [
        "CMD-SHELL"
        "pg_isready -U user"
      ];
      interval = "2s";
      timeout = "5s";
      retries = 15;
    };
  };

  redis = lib.nixImage lib.images.redis {
    ports = [
      "6379:6379"
      "8001:8001"
    ];
    volumes = [ "cache:/data" ];
    networks = [ "databases" ];
    healthcheck = {
      test = [
        "CMD-SHELL"
        "redis-cli ping"
      ];
      interval = "2s";
      timeout = "3s";
      retries = 10;
    };
  };

  kafka = lib.nixImage lib.images.kafka {
    environment = {
      KAFKA_NODE_ID = 1;
      KAFKA_PROCESS_ROLES = "broker,controller";
      KAFKA_CONTROLLER_QUORUM_VOTERS = "1@kafka:29093";
      KAFKA_CONTROLLER_QUORUM_BOOTSTRAP_SERVERS = "kafka:29093";
      KAFKA_CONTROLLER_LISTENER_NAMES = "CONTROLLER";
      KAFKA_LISTENERS = "PLAINTEXT://0.0.0.0:29092,PLAINTEXT_HOST://0.0.0.0:9092,CONTROLLER://0.0.0.0:29093";
      KAFKA_ADVERTISED_LISTENERS = "PLAINTEXT://kafka:29092,PLAINTEXT_HOST://localhost:9092,CONTROLLER://kafka:29093";
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP = "PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT,CONTROLLER:PLAINTEXT";
      KAFKA_INTER_BROKER_LISTENER_NAME = "PLAINTEXT";
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR = 1;
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR = 1;
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR = 1;
      KAFKA_AUTO_CREATE_TOPICS_ENABLE = "true";
      KAFKA_LOG_DIRS = "/var/lib/kafka/data";
      CLUSTER_ID = "TWFjcm9Mb2NhbEthZmthMQ";
    };
    ports = [ "9092:9092" ];
    volumes = [ "kafka_data:/var/lib/kafka/data" ];
    networks = [ "databases" ];
    healthcheck = {
      test = [
        "CMD-SHELL"
        "/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server localhost:9092 > /dev/null 2>&1"
      ];
      interval = "5s";
      timeout = "10s";
      retries = 20;
    };
  };

  search =
    lib.nixImage lib.images.opensearch {
      environment = {
        OPENSEARCH_JAVA_OPTS = "-Xms512m -Xmx512m";
      };
      ports = [
        "9200:9200"
        "9600:9600"
      ];
      volumes = [
        "opensearch_data:/usr/share/opensearch/data"
      ];
      networks = [ "databases" ];
      healthcheck = {
        test = [
          "CMD-SHELL"
          "curl --write-out 'HTTP %{http_code}' --fail --silent --output /dev/null http://localhost:9200/"
        ];
        interval = "10s";
        retries = 80;
      };
    }
    // {
      out.service = {
        ulimits = {
          memlock = {
            soft = -1;
            hard = -1;
          };
          nofile = {
            soft = 65536;
            hard = 65536;
          };
        };
      };
    };
}
