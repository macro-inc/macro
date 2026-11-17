# Hosted Passwords provisioning (dev)

Provision one team in the hosted dev OpenBao. Run this only for teams you mean
to enable; creating a Macro team does not create its namespace. Runs are
idempotent: a repeat run keeps existing values and versions and reapplies the
mounts, policies, and roles.

Once per environment, the document storage service's dev Doppler config
(`cloud-storage-service/dev`) must hold `OPENBAO_ADDRESS`,
`PASSWORDS_JWT_ISSUER`, and `PASSWORDS_JWT_KMS_KEY_ID`, set together because
the service refuses a partial set. `PASSWORDS_JWT_KMS_KEY_ID` is the ARN of the
asymmetric KMS key the service signs ES256 JWTs with: the
`passwordsJwtKmsKeyArn` output of the openbao stack. It is not a secret, and no
private key exists outside KMS. The roles trust that key's public half, which
the stack exports (operators can't call `kms:GetPublicKey` themselves):

```sh
umask 077
public_key=$(mktemp)
pulumi stack output passwordsJwtPublicKeyPem --stack macro-inc/dev \
  --cwd infra/stacks/openbao > "$public_key"
issuer=$(doppler secrets get PASSWORDS_JWT_ISSUER -p cloud-storage-service -c dev --plain)
```

## Changing the signing key

`--jwt-public-key` and `--jwt-alg` repeat, and each run replaces what the
roles trust, so a key change needs no outage. Every step needs explicit
permission:

1. Create the new key (a `pulumi up` of the openbao stack).
2. Provision every team with both keys: `--jwt-public-key old.pem
   --jwt-public-key new.pem`, with `--jwt-alg` for each key's algorithm
   (`RS256` for the old RSA key, `ES256` for a KMS key). This also updates the
   parent `macro-lifecycle` mount. For the one-time move off the RSA key, its
   public half is `doppler secrets get PASSWORDS_JWT_SIGNING_KEY -p
   cloud-storage-service -c dev --plain | openssl pkey -pubout`.
3. Point the document storage service at the new key in Doppler
   (`PASSWORDS_JWT_KMS_KEY_ID`; remove `PASSWORDS_JWT_SIGNING_KEY` if it is
   still set) and deploy it.
4. Check a vault read, a write and a verification code.
5. Provision every team again with only the new key and its algorithm, then
   schedule the old KMS key's deletion (or shred the old RSA key).

## Provisioning one team

1. Open the [operator tunnel](../stacks/openbao/README.md#operator-tunnel).
   It listens on local port 18443.
2. Read the public key and the issuer as shown above.
3. Run the provisioning with the root token from Doppler `openbao/dev`, passed
   in the environment only:

   ```sh
   doppler run -p openbao -c dev --only-secrets OPENBAO_ROOT_TOKEN -- \
     sh -c 'BAO_TOKEN="$OPENBAO_ROOT_TOKEN" exec python3 infra/openbao/provision.py \
       --connect 127.0.0.1:18443 --team-id "$0" \
       --jwt-public-key "$1" --jwt-alg ES256 --jwt-issuer "$2"' \
     <team-uuid> "$public_key" "$issuer"
   rm "$public_key"
   ```

It prints only the namespace it provisioned. The roles disable JWT clock
leeway, so the document storage service and the vault must keep synchronized
clocks (both run on Fargate with Amazon Time Sync).
