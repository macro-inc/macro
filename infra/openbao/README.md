# Hosted Passwords provisioning (dev)

Provision one team in the hosted dev OpenBao. Run this only for teams you mean
to enable; creating a Macro team does not create its namespace. Runs are
idempotent: a repeat run keeps existing values and versions and reapplies the
mounts, policies, and roles.

Once per environment, the document storage service's dev Doppler config
(`cloud-storage-service/dev`) must hold `OPENBAO_ADDRESS`,
`PASSWORDS_JWT_ISSUER`, and `PASSWORDS_JWT_SIGNING_KEY`, set together because
the service refuses a partial set. The signing key is generated the way the
local stack does it, and never printed:

```sh
umask 077
key=$(mktemp)
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$key"
jq -n --rawfile key "$key" '{OPENBAO_ADDRESS: "https://openbao-dev.macro-internal.com",
  PASSWORDS_JWT_ISSUER: "macro-dev-passwords", PASSWORDS_JWT_SIGNING_KEY: $key}' \
  | doppler secrets upload -p cloud-storage-service -c dev /dev/stdin > /dev/null
shred -u "$key"
```

Rotating the key means re-running the provisioning for every team.

1. Open the operator tunnel from the openbao stack README ("Operator tunnel").
   It listens on local port 18443.
2. Derive the public key and read the issuer from the document storage
   service's dev Doppler config. Only the public half is written to disk:

   ```sh
   umask 077
   public_key=$(mktemp)
   doppler secrets get PASSWORDS_JWT_SIGNING_KEY -p cloud-storage-service -c dev --plain \
     | openssl pkey -pubout > "$public_key"
   issuer=$(doppler secrets get PASSWORDS_JWT_ISSUER -p cloud-storage-service -c dev --plain)
   ```

3. Run the provisioning with the root token from Doppler `openbao/dev`, passed
   in the environment only:

   ```sh
   doppler run -p openbao -c dev --only-secrets OPENBAO_ROOT_TOKEN -- \
     sh -c 'BAO_TOKEN="$OPENBAO_ROOT_TOKEN" exec python3 infra/openbao/provision.py \
       --connect 127.0.0.1:18443 --team-id "$0" \
       --jwt-public-key "$1" --jwt-issuer "$2"' \
     <team-uuid> "$public_key" "$issuer"
   rm "$public_key"
   ```

It prints only the namespace it provisioned. The roles disable JWT clock
leeway, so the document storage service and the vault must keep synchronized
clocks (both run on Fargate with Amazon Time Sync).
