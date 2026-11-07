// Command generator is a test oracle for crates/whatsmeow_signal: it runs
// go.mau.fi/libsignal v0.2.2, the Signal implementation whatsmeow
// b2b1e71d45e2ff171153b025b5a42f475bb30ef8 uses, behind a line-oriented JSON
// protocol on stdin/stdout. The Rust interop test drives it as the other side
// of a conversation and records the exchange; see README.md.
//
// Test tooling only; never built in CI.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"

	"go.mau.fi/libsignal/ecc"
	"go.mau.fi/libsignal/groups"
	groupRecord "go.mau.fi/libsignal/groups/state/record"
	"go.mau.fi/libsignal/keys/identity"
	"go.mau.fi/libsignal/keys/prekey"
	"go.mau.fi/libsignal/protocol"
	"go.mau.fi/libsignal/serialize"
	"go.mau.fi/libsignal/session"
	"go.mau.fi/libsignal/state/record"
	"go.mau.fi/libsignal/util/keyhelper"
	"go.mau.fi/libsignal/util/optional"
)

// The serializer whatsmeow uses (store.SignalProtobufSerializer).
var serializer = serialize.NewProtoBufSerializer()

// device is one Go party: an in-memory version of whatsmeow's store.Device.
type device struct {
	identity       *identity.KeyPair
	registrationID uint32
	identities     map[string][32]byte
	preKeys        map[uint32]*record.PreKey
	signedPreKeys  map[uint32]*record.SignedPreKey
	sessions       map[string][]byte
	senderKeys     map[string][]byte
}

func (d *device) GetIdentityKeyPair() *identity.KeyPair { return d.identity }
func (d *device) GetLocalRegistrationID() uint32        { return d.registrationID }

func (d *device) SaveIdentity(_ context.Context, address *protocol.SignalAddress, key *identity.Key) error {
	d.identities[address.String()] = key.PublicKey().PublicKey()
	return nil
}

// IsTrustedIdentity trusts on first use, like whatsmeow's SQL store.
func (d *device) IsTrustedIdentity(_ context.Context, address *protocol.SignalAddress, key *identity.Key) (bool, error) {
	known, ok := d.identities[address.String()]
	return !ok || known == key.PublicKey().PublicKey(), nil
}

func (d *device) LoadPreKey(_ context.Context, id uint32) (*record.PreKey, error) {
	return d.preKeys[id], nil
}
func (d *device) StorePreKey(_ context.Context, id uint32, key *record.PreKey) error {
	d.preKeys[id] = key
	return nil
}
func (d *device) ContainsPreKey(_ context.Context, id uint32) (bool, error) {
	_, ok := d.preKeys[id]
	return ok, nil
}
func (d *device) RemovePreKey(_ context.Context, id uint32) error {
	delete(d.preKeys, id)
	return nil
}

func (d *device) LoadSession(_ context.Context, address *protocol.SignalAddress) (*record.Session, error) {
	raw, ok := d.sessions[address.String()]
	if !ok {
		return record.NewSession(serializer.Session, serializer.State), nil
	}
	return record.NewSessionFromBytes(raw, serializer.Session, serializer.State)
}
func (d *device) GetSubDeviceSessions(context.Context, string) ([]uint32, error) {
	panic("not implemented")
}
func (d *device) StoreSession(_ context.Context, address *protocol.SignalAddress, session *record.Session) error {
	d.sessions[address.String()] = session.Serialize()
	return nil
}
func (d *device) ContainsSession(_ context.Context, address *protocol.SignalAddress) (bool, error) {
	_, ok := d.sessions[address.String()]
	return ok, nil
}
func (d *device) DeleteSession(_ context.Context, address *protocol.SignalAddress) error {
	delete(d.sessions, address.String())
	return nil
}
func (d *device) DeleteAllSessions(context.Context) error {
	d.sessions = map[string][]byte{}
	return nil
}

func (d *device) LoadSignedPreKey(_ context.Context, id uint32) (*record.SignedPreKey, error) {
	return d.signedPreKeys[id], nil
}
func (d *device) LoadSignedPreKeys(context.Context) ([]*record.SignedPreKey, error) {
	panic("not implemented")
}
func (d *device) StoreSignedPreKey(_ context.Context, id uint32, key *record.SignedPreKey) error {
	d.signedPreKeys[id] = key
	return nil
}
func (d *device) ContainsSignedPreKey(_ context.Context, id uint32) (bool, error) {
	_, ok := d.signedPreKeys[id]
	return ok, nil
}
func (d *device) RemoveSignedPreKey(_ context.Context, id uint32) error {
	delete(d.signedPreKeys, id)
	return nil
}

func senderKeyID(name *protocol.SenderKeyName) string {
	return name.GroupID() + "|" + name.Sender().String()
}

func (d *device) StoreSenderKey(_ context.Context, name *protocol.SenderKeyName, key *groupRecord.SenderKey) error {
	d.senderKeys[senderKeyID(name)] = key.Serialize()
	return nil
}

func (d *device) LoadSenderKey(_ context.Context, name *protocol.SenderKeyName) (*groupRecord.SenderKey, error) {
	raw, ok := d.senderKeys[senderKeyID(name)]
	if !ok {
		return groupRecord.NewSenderKey(serializer.SenderKeyRecord, serializer.SenderKeyState), nil
	}
	return groupRecord.NewSenderKeyFromBytes(raw, serializer.SenderKeyRecord, serializer.SenderKeyState)
}

// hexBytes is a byte slice that travels as a hex string.
type hexBytes []byte

func (h hexBytes) MarshalJSON() ([]byte, error) { return json.Marshal(hex.EncodeToString(h)) }
func (h *hexBytes) UnmarshalJSON(data []byte) error {
	var text string
	if err := json.Unmarshal(data, &text); err != nil {
		return err
	}
	decoded, err := hex.DecodeString(text)
	*h = decoded
	return err
}

type address struct {
	Name   string `json:"name"`
	Device uint32 `json:"device"`
}

func (a address) signal() *protocol.SignalAddress { return protocol.NewSignalAddress(a.Name, a.Device) }

type keyWithID struct {
	ID     uint32   `json:"id"`
	Public hexBytes `json:"public"`
}

type bundle struct {
	RegistrationID        uint32     `json:"registration_id"`
	DeviceID              uint32     `json:"device_id"`
	PreKey                *keyWithID `json:"pre_key,omitempty"`
	SignedPreKey          keyWithID  `json:"signed_pre_key"`
	SignedPreKeySignature hexBytes   `json:"signed_pre_key_signature"`
	IdentityKey           hexBytes   `json:"identity_key"`
}

// request is one line of input. Every field but Op is optional; each op
// reads the ones it needs.
type request struct {
	Op             string   `json:"op"`
	Device         string   `json:"device,omitempty"`
	RegistrationID uint32   `json:"registration_id,omitempty"`
	Peer           *address `json:"peer,omitempty"`
	Bundle         *bundle  `json:"bundle,omitempty"`
	SignedPreKeyID uint32   `json:"signed_pre_key_id,omitempty"`
	PreKeyID       uint32   `json:"pre_key_id,omitempty"`
	Group          string   `json:"group,omitempty"`
	Type           string   `json:"type,omitempty"`
	Plaintext      hexBytes `json:"plaintext,omitempty"`
	Ciphertext     hexBytes `json:"ciphertext,omitempty"`
	Message        hexBytes `json:"message,omitempty"`
	PrivateKey     hexBytes `json:"private_key,omitempty"`
	PublicKey      hexBytes `json:"public_key,omitempty"`
	Signature      hexBytes `json:"signature,omitempty"`
}

// response is one line of output: Error is set when the operation failed.
type response struct {
	Error       string   `json:"error,omitempty"`
	Bundle      *bundle  `json:"bundle,omitempty"`
	Type        string   `json:"type,omitempty"`
	Plaintext   hexBytes `json:"plaintext,omitempty"`
	Ciphertext  hexBytes `json:"ciphertext,omitempty"`
	Message     hexBytes `json:"message,omitempty"`
	Signature   hexBytes `json:"signature,omitempty"`
	Valid       *bool    `json:"valid,omitempty"`
	IdentityKey hexBytes `json:"identity_key,omitempty"`
}

type oracle struct {
	devices map[string]*device
}

func (o *oracle) device(name string) (*device, error) {
	d, ok := o.devices[name]
	if !ok {
		return nil, fmt.Errorf("unknown device %q", name)
	}
	return d, nil
}

func publicKey(raw []byte) (ecc.ECPublicKeyable, error) {
	if len(raw) != 32 {
		return nil, fmt.Errorf("public key is %d bytes, want 32", len(raw))
	}
	return ecc.NewDjbECPublicKey([32]byte(raw)), nil
}

func (o *oracle) handle(ctx context.Context, req request) (response, error) {
	switch req.Op {
	case "new_device":
		identityKey, err := keyhelper.GenerateIdentityKeyPair()
		if err != nil {
			return response{}, err
		}
		o.devices[req.Device] = &device{
			identity:       identityKey,
			registrationID: req.RegistrationID,
			identities:     map[string][32]byte{},
			preKeys:        map[uint32]*record.PreKey{},
			signedPreKeys:  map[uint32]*record.SignedPreKey{},
			sessions:       map[string][]byte{},
			senderKeys:     map[string][]byte{},
		}
		public := identityKey.PublicKey().PublicKey().PublicKey()
		return response{IdentityKey: public[:]}, nil

	case "make_bundle":
		d, err := o.device(req.Device)
		if err != nil {
			return response{}, err
		}
		signed, err := keyhelper.GenerateSignedPreKey(d.identity, req.SignedPreKeyID, serializer.SignedPreKeyRecord)
		if err != nil {
			return response{}, err
		}
		d.signedPreKeys[req.SignedPreKeyID] = signed
		signedPublic := signed.KeyPair().PublicKey().PublicKey()
		signature := signed.Signature()
		identityPublic := d.identity.PublicKey().PublicKey().PublicKey()
		out := &bundle{
			RegistrationID:        d.registrationID,
			DeviceID:              0,
			SignedPreKey:          keyWithID{ID: req.SignedPreKeyID, Public: signedPublic[:]},
			SignedPreKeySignature: signature[:],
			IdentityKey:           identityPublic[:],
		}
		if req.PreKeyID != 0 {
			pair, err := ecc.GenerateKeyPair()
			if err != nil {
				return response{}, err
			}
			d.preKeys[req.PreKeyID] = record.NewPreKey(req.PreKeyID, pair, serializer.PreKeyRecord)
			preKeyPublic := pair.PublicKey().PublicKey()
			out.PreKey = &keyWithID{ID: req.PreKeyID, Public: preKeyPublic[:]}
		}
		return response{Bundle: out}, nil

	case "process_bundle":
		d, err := o.device(req.Device)
		if err != nil {
			return response{}, err
		}
		b := req.Bundle
		signedPreKey, err := publicKey(b.SignedPreKey.Public)
		if err != nil {
			return response{}, err
		}
		identityKey, err := publicKey(b.IdentityKey)
		if err != nil {
			return response{}, err
		}
		preKeyID := optional.NewEmptyUint32()
		var preKey ecc.ECPublicKeyable
		if b.PreKey != nil {
			preKeyID = optional.NewOptionalUint32(b.PreKey.ID)
			if preKey, err = publicKey(b.PreKey.Public); err != nil {
				return response{}, err
			}
		}
		goBundle := prekey.NewBundle(b.RegistrationID, b.DeviceID, preKeyID, b.SignedPreKey.ID,
			preKey, signedPreKey, [64]byte(b.SignedPreKeySignature), identity.NewKey(identityKey))
		builder := session.NewBuilderFromSignal(d, req.Peer.signal(), serializer)
		return response{}, builder.ProcessBundle(ctx, goBundle)

	case "encrypt":
		d, err := o.device(req.Device)
		if err != nil {
			return response{}, err
		}
		builder := session.NewBuilderFromSignal(d, req.Peer.signal(), serializer)
		message, err := session.NewCipher(builder, req.Peer.signal()).Encrypt(ctx, req.Plaintext)
		if err != nil {
			return response{}, err
		}
		kind := "msg"
		if message.Type() == protocol.PREKEY_TYPE {
			kind = "pkmsg"
		}
		return response{Type: kind, Ciphertext: message.Serialize()}, nil

	case "decrypt":
		d, err := o.device(req.Device)
		if err != nil {
			return response{}, err
		}
		builder := session.NewBuilderFromSignal(d, req.Peer.signal(), serializer)
		cipher := session.NewCipher(builder, req.Peer.signal())
		var plaintext []byte
		switch req.Type {
		case "pkmsg":
			message, err := protocol.NewPreKeySignalMessageFromBytes(req.Ciphertext, serializer.PreKeySignalMessage, serializer.SignalMessage)
			if err != nil {
				return response{}, err
			}
			if plaintext, err = cipher.DecryptMessage(ctx, message); err != nil {
				return response{}, err
			}
		case "msg":
			message, err := protocol.NewSignalMessageFromBytes(req.Ciphertext, serializer.SignalMessage)
			if err != nil {
				return response{}, err
			}
			if plaintext, err = cipher.Decrypt(ctx, message); err != nil {
				return response{}, err
			}
		default:
			return response{}, fmt.Errorf("unknown message type %q", req.Type)
		}
		return response{Plaintext: plaintext}, nil

	case "create_sender_key":
		d, err := o.device(req.Device)
		if err != nil {
			return response{}, err
		}
		name := protocol.NewSenderKeyName(req.Group, req.Peer.signal())
		message, err := groups.NewGroupSessionBuilder(d, serializer).Create(ctx, name)
		if err != nil {
			return response{}, err
		}
		return response{Message: message.Serialize()}, nil

	case "process_sender_key":
		d, err := o.device(req.Device)
		if err != nil {
			return response{}, err
		}
		name := protocol.NewSenderKeyName(req.Group, req.Peer.signal())
		message, err := protocol.NewSenderKeyDistributionMessageFromBytes(req.Message, serializer.SenderKeyDistributionMessage)
		if err != nil {
			return response{}, err
		}
		return response{}, groups.NewGroupSessionBuilder(d, serializer).Process(ctx, name, message)

	case "delete_sender_key":
		d, err := o.device(req.Device)
		if err != nil {
			return response{}, err
		}
		delete(d.senderKeys, senderKeyID(protocol.NewSenderKeyName(req.Group, req.Peer.signal())))
		return response{}, nil

	case "group_encrypt":
		d, err := o.device(req.Device)
		if err != nil {
			return response{}, err
		}
		name := protocol.NewSenderKeyName(req.Group, req.Peer.signal())
		builder := groups.NewGroupSessionBuilder(d, serializer)
		message, err := groups.NewGroupCipher(builder, name, d).Encrypt(ctx, req.Plaintext)
		if err != nil {
			return response{}, err
		}
		return response{Ciphertext: message.SignedSerialize()}, nil

	case "group_decrypt":
		d, err := o.device(req.Device)
		if err != nil {
			return response{}, err
		}
		name := protocol.NewSenderKeyName(req.Group, req.Peer.signal())
		message, err := protocol.NewSenderKeyMessageFromBytes(req.Ciphertext, serializer.SenderKeyMessage)
		if err != nil {
			return response{}, err
		}
		builder := groups.NewGroupSessionBuilder(d, serializer)
		plaintext, err := groups.NewGroupCipher(builder, name, d).Decrypt(ctx, message)
		if err != nil {
			return response{}, err
		}
		return response{Plaintext: plaintext}, nil

	case "sign":
		if len(req.PrivateKey) != 32 {
			return response{}, fmt.Errorf("private key is %d bytes, want 32", len(req.PrivateKey))
		}
		signature := ecc.CalculateSignature(ecc.NewDjbECPrivateKey([32]byte(req.PrivateKey)), req.Message)
		return response{Signature: signature[:]}, nil

	case "verify":
		key, err := publicKey(req.PublicKey)
		if err != nil {
			return response{}, err
		}
		if len(req.Signature) != 64 {
			return response{}, fmt.Errorf("signature is %d bytes, want 64", len(req.Signature))
		}
		valid := ecc.VerifySignature(key, req.Message, [64]byte(req.Signature))
		return response{Valid: &valid}, nil
	}
	return response{}, fmt.Errorf("unknown op %q", req.Op)
}

func main() {
	ctx := context.Background()
	o := &oracle{devices: map[string]*device{}}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 1<<20), 1<<24)
	out := bufio.NewWriter(os.Stdout)
	// libsignal's default logger prints to stdout; keep stdout for responses.
	os.Stdout = os.Stderr
	for scanner.Scan() {
		var req request
		decoder := json.NewDecoder(bytes.NewReader(scanner.Bytes()))
		decoder.DisallowUnknownFields()
		resp := response{}
		if err := decoder.Decode(&req); err != nil {
			resp.Error = "bad request: " + err.Error()
		} else if r, err := o.handle(ctx, req); err != nil {
			resp = response{Error: err.Error()}
		} else {
			resp = r
		}
		line, err := json.Marshal(resp)
		if err != nil {
			panic(err)
		}
		out.Write(line)
		out.WriteByte('\n')
		out.Flush()
	}
	if err := scanner.Err(); err != nil {
		panic(err)
	}
}
