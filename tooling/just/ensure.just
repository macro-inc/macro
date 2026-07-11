ensure_redis container_name="my-redis":
    #!/usr/bin/env bash
    set -e
    
    # Check if container exists (running or stopped)
    if docker ps -a | grep -q {{ container_name }}; then
        # Check if it's already running
        if docker ps | grep -q {{ container_name }}; then
            echo "Redis container already running"
        else
            # Container exists but is stopped - check if port is available
            if lsof -Pi :6379 -sTCP:LISTEN -t >/dev/null 2>&1 || nc -z localhost 6379 2>/dev/null; then
                echo "Port 6379 is already in use"
                # Check if another Redis container is using the port
                REDIS_CONTAINERS=$(docker ps --filter "publish=6379" -q)
                if [ -n "$REDIS_CONTAINERS" ]; then
                    for container in $REDIS_CONTAINERS; do
                        CONTAINER_NAME=$(docker inspect $container | grep '"Name":' | head -1 | cut -d'"' -f4 | sed 's/^\///')
                        echo "Found container using port 6379: $CONTAINER_NAME"
                        # Test if it's actually Redis by using docker exec
                        if docker exec "$CONTAINER_NAME" redis-cli ping 2>/dev/null | grep -q PONG; then
                            echo "Redis is already running in container '$CONTAINER_NAME' on port 6379"
                            echo "Removing stopped container {{ container_name }} since Redis is available elsewhere"
                            docker rm {{ container_name }}
                            exit 0
                        fi
                    done
                fi
                # Try redis-cli if available
                if command -v redis-cli >/dev/null 2>&1 && redis-cli ping 2>/dev/null | grep -q PONG; then
                    echo "Redis is already running and accessible on port 6379"
                    echo "Removing stopped container {{ container_name }} since Redis is available elsewhere"
                    docker rm {{ container_name }}
                    exit 0
                else
                    echo "Port 6379 is in use but Redis is not accessible"
                    echo "Either free the port or remove the stopped container with: docker rm {{ container_name }}"
                    exit 1
                fi
            else
                # Port is free, start the stopped container
                docker start {{ container_name }}
                echo "Started existing Redis container"
            fi
        fi
    else
        # Container doesn't exist - check if port is available
        if lsof -Pi :6379 -sTCP:LISTEN -t >/dev/null 2>&1 || nc -z localhost 6379 2>/dev/null; then
            echo "Port 6379 is already in use"
            # Check if another Redis container is using the port
            REDIS_CONTAINERS=$(docker ps --filter "publish=6379" -q)
            if [ -n "$REDIS_CONTAINERS" ]; then
                for container in $REDIS_CONTAINERS; do
                    CONTAINER_NAME=$(docker inspect $container | grep '"Name":' | head -1 | cut -d'"' -f4 | sed 's/^\///')
                    echo "Found container using port 6379: $CONTAINER_NAME"
                    # Test if it's actually Redis by using docker exec
                    if docker exec "$CONTAINER_NAME" redis-cli ping 2>/dev/null | grep -q PONG; then
                        echo "Redis is already running in container '$CONTAINER_NAME' on port 6379"
                        exit 0
                    fi
                done
            fi
            # Try redis-cli if available
            if command -v redis-cli >/dev/null 2>&1 && redis-cli ping 2>/dev/null | grep -q PONG; then
                echo "Redis is already running and accessible on port 6379"
                exit 0
            else
                echo "Port 6379 is in use but Redis is not accessible"
                echo "Please free the port or use the existing Redis service."
                exit 1
            fi
        else
            # Create and run new container
            docker run -d --name {{ container_name }} -p 6379:6379 redis
            echo "Created new Redis container"
        fi
    fi
    # Wait for Redis to be ready
    echo "Waiting for Redis to be ready..."
    if docker ps | grep -q {{ container_name }}; then
        until docker exec {{ container_name }} redis-cli ping | grep -q PONG; do
            sleep 1
        done
    else
        until redis-cli ping 2>/dev/null | grep -q PONG; do
            sleep 1
        done
    fi
    echo "Redis is ready on port 6379"

ensure_postgres container_name="my-postgres" db_user="user" db_password="password":
    #!/usr/bin/env bash
    set -e
    
    # Check if container exists (running or stopped)
    if docker ps -a | grep -q {{ container_name }}; then
        # Start it if it's stopped
        if ! docker ps | grep -q {{ container_name }}; then
            docker start {{ container_name }}
            echo "Started existing PostgreSQL container"
        else
            echo "PostgreSQL container already running"
        fi
    else
        # Create and run new container
        docker run -d --name {{ container_name }} \
            -e POSTGRES_USER={{ db_user }} \
            -e POSTGRES_PASSWORD={{ db_password }} \
            -p 5432:5432 postgres
        echo "Created new PostgreSQL container"
    fi
    # Wait for DB to be ready
    echo "Waiting for PostgreSQL to be ready..."
    until docker exec {{ container_name }} pg_isready -U {{ db_user }}; do
        sleep 1
    done
    echo "PostgreSQL is ready on port 5432"

ensure_dynamodb container_name="my-dynamodb" port="8000":
    #!/usr/bin/env bash
    set -e
    
    # Check if container exists (running or stopped)
    if docker ps -a | grep -q {{ container_name }}; then
        # Start it if it's stopped
        if ! docker ps | grep -q {{ container_name }}; then
            docker start {{ container_name }}
            echo "Started existing DynamoDB container"
        else
            echo "DynamoDB container already running"
        fi
    else
        # Create and run new container
        docker run -d --name {{ container_name }} \
            -p {{ port }}:8000 \
            amazon/dynamodb-local \
            -jar DynamoDBLocal.jar -inMemory -sharedDb
        echo "Created new DynamoDB container"
    fi
    # Wait for DynamoDB to be ready
    echo "Waiting for DynamoDB to be ready..."
    until curl -s http://localhost:{{ port }} > /dev/null 2>&1; do
        sleep 1
    done
    echo "DynamoDB is ready on port {{ port }}"
