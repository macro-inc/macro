# Accessing Prod OpenSearch

The prod OpenSearch cluster sits behind a VPC. To access it, SSH tunnel through an EC2 instance in the same VPC.

## Creating a new EC2 tunnel instance

If you don't already have an instance, follow these steps to create one.

### 1. Create a key pair

```bash
aws ec2 create-key-pair --key-name yourname-opensearch-tunnel \
  --query 'KeyMaterial' --output text > ~/.ssh/yourname-opensearch-tunnel.pem
chmod 400 ~/.ssh/yourname-opensearch-tunnel.pem
```

### 2. Get your public IP

```bash
curl -s https://checkip.amazonaws.com
```

### 3. Create a security group

```bash
aws ec2 create-security-group \
  --group-name yourname-opensearch-tunnel \
  --description "SSH access for yourname to tunnel to OpenSearch prod" \
  --vpc-id vpc-0c7510191d4fc9263 \
  --query 'GroupId' --output text
```

Allow SSH from your IP (use the group ID from above):

```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-XXXX \
  --protocol tcp --port 22 --cidr YOUR_IP/32
```

### 4. Launch the instance

```bash
aws ec2 run-instances \
  --image-id $(aws ssm get-parameters \
    --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
    --query 'Parameters[0].Value' --output text) \
  --instance-type t4g.nano \
  --key-name yourname-opensearch-tunnel \
  --security-group-ids sg-XXXX \
  --subnet-id subnet-0269c74c37f76ddab \
  --associate-public-ip-address \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=yourname-opensearch-tunnel}]' \
  --query 'Instances[0].{InstanceId:InstanceId}' --output text
```

Get the public IP once it's running:

```bash
aws ec2 describe-instances --instance-ids i-XXXX \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
```

## Existing EC2 instances

| Instance | ID | Public IP | Key |
|---|---|---|---|
| gab-opensearch-tunnel | `i-06da2c07e612f064d` | `3.230.120.57` (changes on restart) | `~/.ssh/gab-opensearch-tunnel.pem` |
| hutch-instance | `i-016decd5dcd1423f5` | — | `hutch-ssh-key` |

## OpenSearch credentials

- **Username:** `macrouser`
- **Password:** stored in AWS Secrets Manager as `macro-opensearch-password-prod`

Fetch the password:

```bash
aws secretsmanager get-secret-value --secret-id macro-opensearch-password-prod \
  --query 'SecretString' --output text
```

## Usage

### 1. Start the EC2 instance (if stopped)

```bash
aws ec2 start-instances --instance-ids i-06da2c07e612f064d
```

Get the new public IP:

```bash
aws ec2 describe-instances --instance-ids i-06da2c07e612f064d \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
```

### 2. Open the SSH tunnel

```bash
ssh -L 9200:vpc-macro-opensearch-prod-yicl3rjwlq7opnh5hllwgskytq.us-east-1.es.amazonaws.com:443 \
  -i ~/.ssh/gab-opensearch-tunnel.pem \
  -N ec2-user@3.230.120.57
```

Keep this running in a terminal tab.

### 3. Query from Postman

- **URL:** `https://localhost:9200/emails/_search`
- **Method:** POST
- **Auth:** Basic Auth, username `macrouser`, password from Secrets Manager
- **SSL verification:** Disable (Settings > SSL certificate verification > OFF)
- **Headers:** `Content-Type: application/json`

### 4. Query from curl

```bash
# Generate the Basic auth header (needed because the password contains !!)
AUTH=$(echo -n "macrouser:$(aws secretsmanager get-secret-value \
  --secret-id macro-opensearch-password-prod --query 'SecretString' --output text)" | base64)

curl -k -X POST "https://localhost:9200/emails/_search" \
  -H "Authorization: Basic $AUTH" \
  -H "Content-Type: application/json" \
  -d '{"query": {"match_all": {}}, "size": 1}'
```

### 5. Stop the instance when done

```bash
aws ec2 stop-instances --instance-ids i-06da2c07e612f064d
```

## Updating your IP

If your public IP changes, update the security group:

```bash
# Remove old rule
aws ec2 revoke-security-group-ingress --group-id sg-0bbec920d97c370ea \
  --protocol tcp --port 22 --cidr OLD_IP/32

# Add new rule
aws ec2 authorize-security-group-ingress --group-id sg-0bbec920d97c370ea \
  --protocol tcp --port 22 --cidr NEW_IP/32
```

## Cluster info

- **Endpoint:** `vpc-macro-opensearch-prod-yicl3rjwlq7opnh5hllwgskytq.us-east-1.es.amazonaws.com`
- **VPC:** `vpc-0c7510191d4fc9263`
- **Version:** OpenSearch 2.19.0
