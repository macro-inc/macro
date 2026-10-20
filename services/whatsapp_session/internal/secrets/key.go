// Package secrets loads account-bound envelope keys from AWS KMS.
package secrets

import (
	"context"
	"errors"
	"os"
	"path/filepath"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/kms"
	"github.com/aws/aws-sdk-go-v2/service/kms/types"
)

type KMS interface {
	GenerateDataKey(context.Context, *kms.GenerateDataKeyInput, ...func(*kms.Options)) (*kms.GenerateDataKeyOutput, error)
	Decrypt(context.Context, *kms.DecryptInput, ...func(*kms.Options)) (*kms.DecryptOutput, error)
}

// Key never implements String or MarshalJSON. Call Close immediately after the
// SQLCipher connection has consumed the key; no unencrypted key file is written.
type Key struct{ bytes []byte }

func (k *Key) Bytes() []byte  { return k.bytes }
func (k *Key) Close()         { clear(k.bytes); k.bytes = nil }
func (k *Key) String() string { return "[redacted]" }
func Load(ctx context.Context, client KMS, kmsID, dir, account, owner string) (*Key, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "store-key.kms")
	ec := map[string]string{"purpose": "macro-whatsapp-session-v1", "account_id": account, "user_id": owner, "authorization_generation": filepath.Base(dir)}
	sealed, err := os.ReadFile(path)
	if err == nil {
		result, err := client.Decrypt(ctx, &kms.DecryptInput{KeyId: aws.String(kmsID), CiphertextBlob: sealed, EncryptionContext: ec})
		if err != nil {
			return nil, errors.New("key_unavailable")
		}
		if len(result.Plaintext) != 32 {
			clear(result.Plaintext)
			return nil, errors.New("invalid_key")
		}
		return &Key{bytes: result.Plaintext}, nil
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	result, err := client.GenerateDataKey(ctx, &kms.GenerateDataKeyInput{KeyId: aws.String(kmsID), KeySpec: types.DataKeySpecAes256, EncryptionContext: ec})
	if err != nil {
		return nil, errors.New("key_unavailable")
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		clear(result.Plaintext)
		return nil, err
	}
	_, writeErr := file.Write(result.CiphertextBlob)
	syncErr := file.Sync()
	closeErr := file.Close()
	if writeErr != nil || syncErr != nil || closeErr != nil {
		clear(result.Plaintext)
		return nil, errors.New("key_persistence_failed")
	}
	directory, err := os.Open(dir)
	if err != nil {
		clear(result.Plaintext)
		return nil, err
	}
	err = directory.Sync()
	directory.Close()
	if err != nil {
		clear(result.Plaintext)
		return nil, err
	}
	return &Key{bytes: result.Plaintext}, nil
}
