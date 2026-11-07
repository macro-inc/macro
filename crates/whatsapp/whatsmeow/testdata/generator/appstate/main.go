// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Command appstate writes the test vectors for the Rust port of whatsmeow's
// appstate package by running whatsmeow's own code. Unexported functions are
// reached with go:linkname, so it must be run with -ldflags=-checklinkname=0
// (see ../README.md).
package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"hash"
	"os"
	"slices"
	"time"
	_ "unsafe"

	"google.golang.org/protobuf/proto"

	"go.mau.fi/whatsmeow/appstate"
	"go.mau.fi/whatsmeow/appstate/lthash"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waServerSync"
	"go.mau.fi/whatsmeow/proto/waSyncAction"
	"go.mau.fi/whatsmeow/proto/waSyncdSnapshotRecovery"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/util/cbcutil"
	waLog "go.mau.fi/whatsmeow/util/log"
)

//go:linkname expandAppStateKeys go.mau.fi/whatsmeow/appstate.expandAppStateKeys
func expandAppStateKeys(keyData []byte) appstate.ExpandedAppStateKeys

//go:linkname concatAndHMAC go.mau.fi/whatsmeow/appstate.concatAndHMAC
func concatAndHMAC(alg func() hash.Hash, key []byte, data ...[]byte) []byte

//go:linkname generateSnapshotMAC go.mau.fi/whatsmeow/appstate.(*HashState).generateSnapshotMAC
func generateSnapshotMAC(hs *appstate.HashState, name appstate.WAPatchName, key []byte) []byte

//go:linkname updateHash go.mau.fi/whatsmeow/appstate.(*HashState).updateHash
func updateHash(hs *appstate.HashState, mutations []*waServerSync.SyncdMutation, getPrevSetValueMAC func(indexMAC []byte, maxIndex int) ([]byte, error)) ([]error, error)

//go:linkname generatePatchMAC go.mau.fi/whatsmeow/appstate.generatePatchMAC
func generatePatchMAC(patch *waServerSync.SyncdPatch, name appstate.WAPatchName, key []byte, version uint64) []byte

//go:linkname generateContentMAC go.mau.fi/whatsmeow/appstate.generateContentMAC
func generateContentMAC(operation waServerSync.SyncdMutation_SyncdOperation, data, keyID, key []byte) []byte

// memoryStore follows whatsmeow's sqlstore semantics for app state keys,
// versions and mutation MACs.
type memoryStore struct {
	keys     map[string]store.AppStateSyncKey
	versions map[string]appstate.HashState
	macs     map[string][]storedMAC
}

type storedMAC struct {
	version uint64
	mac     store.AppStateMutationMAC
}

func newMemoryStore(keys map[string][]byte) *memoryStore {
	mem := &memoryStore{
		keys:     make(map[string]store.AppStateSyncKey),
		versions: make(map[string]appstate.HashState),
		macs:     make(map[string][]storedMAC),
	}
	for id, data := range keys {
		mem.keys[id] = store.AppStateSyncKey{Data: data}
	}
	return mem
}

func (m *memoryStore) PutAppStateSyncKey(_ context.Context, id []byte, key store.AppStateSyncKey) error {
	m.keys[string(id)] = key
	return nil
}

func (m *memoryStore) GetAppStateSyncKey(_ context.Context, id []byte) (*store.AppStateSyncKey, error) {
	key, ok := m.keys[string(id)]
	if !ok {
		return nil, nil
	}
	return &key, nil
}

func (m *memoryStore) GetLatestAppStateSyncKeyID(context.Context) ([]byte, error) {
	panic("unused")
}

func (m *memoryStore) GetAllAppStateSyncKeys(context.Context) ([]*store.AppStateSyncKey, error) {
	panic("unused")
}

func (m *memoryStore) PutAppStateVersion(_ context.Context, name string, version uint64, hash [128]byte) error {
	m.versions[name] = appstate.HashState{Version: version, Hash: hash}
	return nil
}

func (m *memoryStore) GetAppStateVersion(_ context.Context, name string) (uint64, [128]byte, error) {
	state := m.versions[name]
	return state.Version, state.Hash, nil
}

func (m *memoryStore) DeleteAppStateVersion(_ context.Context, name string) error {
	delete(m.versions, name)
	return nil
}

func (m *memoryStore) PutAppStateMutationMACs(_ context.Context, name string, version uint64, mutations []store.AppStateMutationMAC) error {
	for _, mutation := range mutations {
		m.macs[name] = append(m.macs[name], storedMAC{version, mutation})
	}
	return nil
}

func (m *memoryStore) DeleteAppStateMutationMACs(_ context.Context, name string, indexMACs [][]byte) error {
	m.macs[name] = slices.DeleteFunc(m.macs[name], func(stored storedMAC) bool {
		return slices.ContainsFunc(indexMACs, func(indexMAC []byte) bool {
			return bytes.Equal(indexMAC, stored.mac.IndexMAC)
		})
	})
	return nil
}

func (m *memoryStore) GetAppStateMutationMAC(_ context.Context, name string, indexMAC []byte) ([]byte, error) {
	var found *storedMAC
	for i, stored := range m.macs[name] {
		if bytes.Equal(stored.mac.IndexMAC, indexMAC) && (found == nil || stored.version >= found.version) {
			found = &m.macs[name][i]
		}
	}
	if found == nil {
		return nil, nil
	}
	return found.mac.ValueMAC, nil
}

func newProcessor(mem *memoryStore) *appstate.Processor {
	return appstate.NewProcessor(&store.Device{AppStateKeys: mem, AppState: mem}, waLog.Noop)
}

func must[T any](value T, err error) T {
	if err != nil {
		panic(err)
	}
	return value
}

func marshal(message proto.Message) string {
	return hex.EncodeToString(must(proto.MarshalOptions{Deterministic: true}.Marshal(message)))
}

func bytesRange(start, length int) []byte {
	out := make([]byte, length)
	for i := range out {
		out[i] = byte(start + i)
	}
	return out
}

type hexBytes []byte

func (h hexBytes) MarshalJSON() ([]byte, error) {
	if h == nil {
		return []byte("null"), nil
	}
	return json.Marshal(hex.EncodeToString(h))
}

type lthashVector struct {
	Base     hexBytes   `json:"base"`
	Subtract []hexBytes `json:"subtract"`
	Add      []hexBytes `json:"add"`
	Result   hexBytes   `json:"result"`
}

type expandedKeysVector struct {
	KeyData         hexBytes `json:"key_data"`
	Index           hexBytes `json:"index"`
	ValueEncryption hexBytes `json:"value_encryption"`
	ValueMAC        hexBytes `json:"value_mac"`
	SnapshotMAC     hexBytes `json:"snapshot_mac"`
	PatchMAC        hexBytes `json:"patch_mac"`
}

type snapshotMACVector struct {
	Hash    hexBytes `json:"hash"`
	Version uint64   `json:"version"`
	Name    string   `json:"name"`
	Key     hexBytes `json:"key"`
	MAC     hexBytes `json:"mac"`
}

type patchMACVector struct {
	Patch   string   `json:"patch"`
	Name    string   `json:"name"`
	Key     hexBytes `json:"key"`
	Version uint64   `json:"version"`
	MAC     hexBytes `json:"mac"`
}

type contentMACVector struct {
	Operation int32    `json:"operation"`
	Data      hexBytes `json:"data"`
	KeyID     hexBytes `json:"key_id"`
	Key       hexBytes `json:"key"`
	MAC       hexBytes `json:"mac"`
}

type indexMACVector struct {
	Key   hexBytes `json:"key"`
	Index hexBytes `json:"index"`
	MAC   hexBytes `json:"mac"`
}

type indexJSONVector struct {
	Index []string `json:"index"`
	JSON  string   `json:"json"`
}

type keyVector struct {
	ID   hexBytes `json:"id"`
	Data hexBytes `json:"data"`
}

type stateVector struct {
	Version uint64   `json:"version"`
	Hash    hexBytes `json:"hash"`
}

type mutationVector struct {
	KeyID        hexBytes `json:"key_id"`
	Operation    int32    `json:"operation"`
	Action       *string  `json:"action"`
	Version      int32    `json:"version"`
	Index        []string `json:"index"`
	IndexMAC     hexBytes `json:"index_mac"`
	ValueMAC     hexBytes `json:"value_mac"`
	PatchVersion uint64   `json:"patch_version"`
}

type lookupVector struct {
	IndexMAC hexBytes `json:"index_mac"`
	ValueMAC hexBytes `json:"value_mac"`
}

type patchListVector struct {
	Snapshot *string  `json:"snapshot"`
	Patches  []string `json:"patches"`
}

type decodeStepVector struct {
	List         patchListVector  `json:"list"`
	InitialState stateVector      `json:"initial_state"`
	Mutations    []mutationVector `json:"mutations"`
	State        stateVector      `json:"state"`
	StoredState  stateVector      `json:"stored_state"`
	Lookups      []lookupVector   `json:"lookups"`
}

type sequenceVector struct {
	Name  string             `json:"name"`
	Keys  []keyVector        `json:"keys"`
	Steps []decodeStepVector `json:"steps"`
}

type decodeErrorVector struct {
	Description  string          `json:"description"`
	List         patchListVector `json:"list"`
	InitialState stateVector     `json:"initial_state"`
	Error        string          `json:"error"`
	KeyNotFound  bool            `json:"key_not_found"`
	MissingKeys  []hexBytes      `json:"missing_keys"`
}

type patchInfoVector struct {
	Type      string               `json:"type"`
	Mutations []mutationInfoVector `json:"mutations"`
}

type mutationInfoVector struct {
	Index   []string `json:"index"`
	Version int32    `json:"version"`
	Value   string   `json:"value"`
}

type recoveryVector struct {
	CollectionSnapshot hexBytes         `json:"collection_snapshot"`
	IsCompressed       bool             `json:"is_compressed"`
	Name               string           `json:"name"`
	Mutations          []mutationVector `json:"mutations"`
	StoredState        stateVector      `json:"stored_state"`
	Lookups            []lookupVector   `json:"lookups"`
	InvalidLTHash      hexBytes         `json:"invalid_lthash_snapshot"`
	InvalidLTHashError string           `json:"invalid_lthash_error"`
}

type vectors struct {
	LTHash       []lthashVector       `json:"lthash"`
	ExpandedKeys []expandedKeysVector `json:"expanded_keys"`
	SnapshotMAC  []snapshotMACVector  `json:"snapshot_mac"`
	PatchMAC     []patchMACVector     `json:"patch_mac"`
	ContentMAC   []contentMACVector   `json:"content_mac"`
	IndexMAC     []indexMACVector     `json:"index_mac"`
	IndexJSON    []indexJSONVector    `json:"index_json"`
	Builders     []patchInfoVector    `json:"builders"`
	Sequence     sequenceVector       `json:"sequence"`
	DecodeErrors []decodeErrorVector  `json:"decode_errors"`
	Recovery     recoveryVector       `json:"recovery"`
}

const name = appstate.WAPatchRegularHigh

var (
	key1ID   = []byte{0, 0, 0, 1, 0xaa}
	key1Data = bytesRange(0x10, 32)
	key2ID   = []byte{0, 0, 0, 2, 0xbb}
	key2Data = bytesRange(0x50, 32)
	key3ID   = []byte{0, 0, 0, 3, 0xcc}
	chatA    = types.NewJID("111111111", types.DefaultUserServer)
	chatB    = types.NewJID("222222222", types.DefaultUserServer)
	chatC    = types.NewJID("333333333", types.DefaultUserServer)
	group    = types.NewJID("120363000000000000", types.GroupServer)
	ivCount  = byte(0)
)

func nextIV() []byte {
	ivCount++
	return bytesRange(int(ivCount)*16, 16)
}

// record encrypts one mutation with a fixed IV, the way EncodePatch does with
// a random one.
func record(op waServerSync.SyncdMutation_SyncdOperation, keyID []byte, index []string, version int32, value *waSyncAction.SyncActionValue) *waServerSync.SyncdMutation {
	keys := expandAppStateKeys(keyData(keyID))
	indexBytes := must(json.Marshal(index))
	content := must(proto.Marshal(&waSyncAction.SyncActionData{
		Index:   indexBytes,
		Value:   value,
		Padding: []byte{},
		Version: &version,
	}))
	iv := nextIV()
	encrypted := append(iv, must(cbcutil.Encrypt(keys.ValueEncryption, iv, content))...)
	valueMAC := generateContentMAC(op, encrypted, keyID, keys.ValueMAC)
	return &waServerSync.SyncdMutation{
		Operation: op.Enum(),
		Record: &waServerSync.SyncdRecord{
			Index: &waServerSync.SyncdIndex{Blob: concatAndHMAC(sha256.New, keys.Index, indexBytes)},
			Value: &waServerSync.SyncdValue{Blob: append(encrypted, valueMAC...)},
			KeyID: &waServerSync.KeyId{ID: keyID},
		},
	}
}

func keyData(keyID []byte) []byte {
	switch {
	case bytes.Equal(keyID, key1ID):
		return key1Data
	case bytes.Equal(keyID, key2ID):
		return key2Data
	}
	panic("unknown key")
}

// snapshot builds a snapshot of SET records on top of the zero state.
func snapshot(version uint64, keyID []byte, mutations []*waServerSync.SyncdMutation) *waServerSync.SyncdSnapshot {
	state := appstate.HashState{Version: version}
	must(updateHash(&state, mutations, func([]byte, int) ([]byte, error) { return nil, nil }))
	records := make([]*waServerSync.SyncdRecord, len(mutations))
	for i, mutation := range mutations {
		records[i] = mutation.Record
	}
	return &waServerSync.SyncdSnapshot{
		Version: &waServerSync.SyncdVersion{Version: &version},
		Records: records,
		Mac:     generateSnapshotMAC(&state, name, expandAppStateKeys(keyData(keyID)).SnapshotMAC),
		KeyID:   &waServerSync.KeyId{ID: keyID},
	}
}

// patch builds a patch on top of state, looking previous values up in the
// patch and then in mem, as the decoder does.
func patch(mem *memoryStore, state appstate.HashState, keyID []byte, mutations []*waServerSync.SyncdMutation) *waServerSync.SyncdPatch {
	state.Version++
	must(updateHash(&state, mutations, func(indexMAC []byte, maxIndex int) ([]byte, error) {
		for i := maxIndex - 1; i >= 0; i-- {
			if bytes.Equal(mutations[i].GetRecord().GetIndex().GetBlob(), indexMAC) {
				if mutations[i].GetOperation() == waServerSync.SyncdMutation_SET {
					value := mutations[i].GetRecord().GetValue().GetBlob()
					return value[len(value)-32:], nil
				}
				return nil, nil
			}
		}
		return mem.GetAppStateMutationMAC(context.Background(), string(name), indexMAC)
	}))
	keys := expandAppStateKeys(keyData(keyID))
	result := &waServerSync.SyncdPatch{
		Version:     &waServerSync.SyncdVersion{Version: proto.Uint64(state.Version)},
		Mutations:   mutations,
		SnapshotMAC: generateSnapshotMAC(&state, name, keys.SnapshotMAC),
		KeyID:       &waServerSync.KeyId{ID: keyID},
	}
	result.PatchMAC = generatePatchMAC(result, name, keys.PatchMAC, state.Version)
	return result
}

func mutationVectors(mutations []appstate.Mutation) []mutationVector {
	out := make([]mutationVector, len(mutations))
	for i, mutation := range mutations {
		var action *string
		if mutation.Action != nil {
			action = proto.String(marshal(mutation.Action))
		}
		out[i] = mutationVector{
			KeyID:        mutation.KeyID,
			Operation:    int32(mutation.Operation),
			Action:       action,
			Version:      mutation.Version,
			Index:        mutation.Index,
			IndexMAC:     mutation.IndexMAC,
			ValueMAC:     mutation.ValueMAC,
			PatchVersion: mutation.PatchVersion,
		}
	}
	return out
}

func lookups(mem *memoryStore, collection string, indexMACs [][]byte) []lookupVector {
	out := make([]lookupVector, len(indexMACs))
	for i, indexMAC := range indexMACs {
		out[i] = lookupVector{IndexMAC: indexMAC, ValueMAC: must(mem.GetAppStateMutationMAC(context.Background(), collection, indexMAC))}
	}
	return out
}

func listVector(list *appstate.PatchList) patchListVector {
	out := patchListVector{Patches: []string{}}
	if list.Snapshot != nil {
		out.Snapshot = proto.String(marshal(list.Snapshot))
	}
	for _, p := range list.Patches {
		out.Patches = append(out.Patches, marshal(p))
	}
	return out
}

func stateOf(state appstate.HashState) stateVector {
	return stateVector{Version: state.Version, Hash: state.Hash[:]}
}

func allIndexMACs(list *appstate.PatchList) [][]byte {
	var out [][]byte
	if list.Snapshot != nil {
		for _, r := range list.Snapshot.Records {
			out = append(out, r.GetIndex().GetBlob())
		}
	}
	for _, p := range list.Patches {
		for _, m := range p.Mutations {
			out = append(out, m.GetRecord().GetIndex().GetBlob())
		}
	}
	return out
}

func decodeStep(mem *memoryStore, list *appstate.PatchList, initial appstate.HashState) decodeStepVector {
	mutations, state, err := newProcessor(mem).DecodePatches(context.Background(), list, initial, true)
	if err != nil {
		panic(err)
	}
	stored := must2(mem.GetAppStateVersion(context.Background(), string(list.Name)))
	return decodeStepVector{
		List:         listVector(list),
		InitialState: stateOf(initial),
		Mutations:    mutationVectors(mutations),
		State:        stateOf(state),
		StoredState:  stateOf(stored),
		Lookups:      lookups(mem, string(list.Name), allIndexMACs(list)),
	}
}

func must2(version uint64, hash [128]byte, err error) appstate.HashState {
	if err != nil {
		panic(err)
	}
	return appstate.HashState{Version: version, Hash: hash}
}

func keysStore() *memoryStore {
	return newMemoryStore(map[string][]byte{string(key1ID): key1Data, string(key2ID): key2Data})
}

func buildSequence() (sequenceVector, *appstate.PatchList) {
	// The generator's own copy of the store, to build patches against.
	builder := keysStore()
	ctx := context.Background()
	at := time.UnixMilli(1760000000123)

	snapshotMutations := []*waServerSync.SyncdMutation{
		record(waServerSync.SyncdMutation_SET, key1ID, []string{appstate.IndexMute, chatA.String()}, 2, &waSyncAction.SyncActionValue{
			Timestamp:  proto.Int64(at.UnixMilli()),
			MuteAction: &waSyncAction.MuteAction{Muted: proto.Bool(true), MuteEndTimestamp: proto.Int64(-1)},
		}),
		record(waServerSync.SyncdMutation_SET, key1ID, []string{appstate.IndexStar, chatA.String(), "3EB0STARRED", "1", "0"}, 2, &waSyncAction.SyncActionValue{
			Timestamp:  proto.Int64(at.UnixMilli()),
			StarAction: &waSyncAction.StarAction{Starred: proto.Bool(true)},
		}),
		record(waServerSync.SyncdMutation_SET, key2ID, []string{appstate.IndexMute, chatB.String()}, 2, &waSyncAction.SyncActionValue{
			Timestamp:  proto.Int64(at.UnixMilli()),
			MuteAction: &waSyncAction.MuteAction{Muted: proto.Bool(true), MuteEndTimestamp: proto.Int64(1760003600000)},
		}),
		// An index that needs JSON escaping.
		record(waServerSync.SyncdMutation_SET, key1ID, []string{appstate.IndexClearChat, group.String(), "<&>", "1"}, 6, &waSyncAction.SyncActionValue{
			Timestamp:       proto.Int64(at.UnixMilli()),
			ClearChatAction: &waSyncAction.ClearChatAction{},
		}),
	}
	ss := snapshot(3, key1ID, snapshotMutations)
	firstList := &appstate.PatchList{Name: name, Snapshot: ss}
	must3(newProcessor(builder).DecodePatches(ctx, firstList, appstate.HashState{}, true))
	stateAfterSnapshot := must2(builder.GetAppStateVersion(ctx, string(name)))

	newIndex := []string{appstate.IndexMute, chatC.String()}
	patch4 := patch(builder, stateAfterSnapshot, key2ID, []*waServerSync.SyncdMutation{
		// Overwrites the snapshot's mute of chat A (same key, so same index MAC).
		record(waServerSync.SyncdMutation_SET, key1ID, []string{appstate.IndexMute, chatA.String()}, 2, &waSyncAction.SyncActionValue{
			Timestamp:  proto.Int64(at.UnixMilli() + 1000),
			MuteAction: &waSyncAction.MuteAction{Muted: proto.Bool(false)},
		}),
		// Removes the snapshot's star.
		record(waServerSync.SyncdMutation_REMOVE, key1ID, []string{appstate.IndexStar, chatA.String(), "3EB0STARRED", "1", "0"}, 2, &waSyncAction.SyncActionValue{
			Timestamp:  proto.Int64(at.UnixMilli() + 1000),
			StarAction: &waSyncAction.StarAction{Starred: proto.Bool(false)},
		}),
		// Set and removed again within the patch.
		record(waServerSync.SyncdMutation_SET, key2ID, newIndex, 2, &waSyncAction.SyncActionValue{
			Timestamp:  proto.Int64(at.UnixMilli() + 1000),
			MuteAction: &waSyncAction.MuteAction{Muted: proto.Bool(true)},
		}),
		record(waServerSync.SyncdMutation_REMOVE, key2ID, newIndex, 2, &waSyncAction.SyncActionValue{
			Timestamp: proto.Int64(at.UnixMilli() + 1000),
		}),
		// A REMOVE without a previous SET: only a warning.
		record(waServerSync.SyncdMutation_REMOVE, key1ID, []string{appstate.IndexMute, "nobody@s.whatsapp.net"}, 2, &waSyncAction.SyncActionValue{
			Timestamp: proto.Int64(at.UnixMilli() + 1000),
		}),
	})
	must3(newProcessor(builder).DecodePatches(ctx, &appstate.PatchList{Name: name, Patches: []*waServerSync.SyncdPatch{patch4}}, stateAfterSnapshot, true))
	stateAfter4 := must2(builder.GetAppStateVersion(ctx, string(name)))

	// Patch 5 comes from EncodePatch itself, with random IVs.
	encoded5 := must(newProcessor(builder).EncodePatch(ctx, key1ID, stateAfter4, appstate.PatchInfo{
		Timestamp: at.Add(2 * time.Second),
		Type:      name,
		Mutations: []appstate.MutationInfo{
			appstate.BuildMuteAbs(chatB, false, nil).Mutations[0],
			appstate.BuildStar(chatC, chatA, "3EB0OTHER", false, true).Mutations[0],
		},
	}))
	var patch5 waServerSync.SyncdPatch
	must(0, proto.Unmarshal(encoded5, &patch5))
	patch5.Version = &waServerSync.SyncdVersion{Version: proto.Uint64(stateAfter4.Version + 1)}
	firstList.Patches = []*waServerSync.SyncdPatch{patch4, &patch5}
	must3(newProcessor(builder).DecodePatches(ctx, &appstate.PatchList{Name: name, Patches: []*waServerSync.SyncdPatch{&patch5}}, stateAfter4, true))
	stateAfter5 := must2(builder.GetAppStateVersion(ctx, string(name)))

	// A second fetch: removes the snapshot's mute of chat B, which is only
	// in the store, and overwrites the clear chat.
	patch6 := patch(builder, stateAfter5, key1ID, []*waServerSync.SyncdMutation{
		record(waServerSync.SyncdMutation_REMOVE, key1ID, []string{appstate.IndexMute, chatB.String()}, 2, &waSyncAction.SyncActionValue{
			Timestamp: proto.Int64(at.UnixMilli() + 3000),
		}),
		record(waServerSync.SyncdMutation_SET, key1ID, []string{appstate.IndexClearChat, group.String(), "<&>", "1"}, 6, &waSyncAction.SyncActionValue{
			Timestamp:       proto.Int64(at.UnixMilli() + 3000),
			ClearChatAction: &waSyncAction.ClearChatAction{MessageRange: &waSyncAction.SyncActionMessageRange{LastMessageTimestamp: proto.Int64(1760000003)}},
		}),
	})
	secondList := &appstate.PatchList{Name: name, HasMorePatches: false, Patches: []*waServerSync.SyncdPatch{patch6}}

	// The expected values come from decoding everything with a fresh store.
	mem := keysStore()
	step1 := decodeStep(mem, firstList, appstate.HashState{})
	step2 := decodeStep(mem, secondList, must2(mem.GetAppStateVersion(ctx, string(name))))
	return sequenceVector{
		Name:  string(name),
		Keys:  []keyVector{{key1ID, key1Data}, {key2ID, key2Data}},
		Steps: []decodeStepVector{step1, step2},
	}, firstList
}

func must3(_ []appstate.Mutation, _ appstate.HashState, err error) {
	if err != nil {
		panic(err)
	}
}

func decodeError(description string, list *appstate.PatchList, initial appstate.HashState) decodeErrorVector {
	mem := keysStore()
	proc := newProcessor(mem)
	_, _, err := proc.DecodePatches(context.Background(), list, initial, true)
	if err == nil {
		panic("expected an error for " + description)
	}
	missing := proc.GetMissingKeyIDs(context.Background(), list)
	missingKeys := make([]hexBytes, len(missing))
	for i, keyID := range missing {
		missingKeys[i] = keyID
	}
	return decodeErrorVector{
		Description:  description,
		List:         listVector(list),
		InitialState: stateOf(initial),
		Error:        err.Error(),
		KeyNotFound:  errorsIsKeyNotFound(err),
		MissingKeys:  missingKeys,
	}
}

func errorsIsKeyNotFound(err error) bool {
	for err != nil {
		if err == appstate.ErrKeyNotFound {
			return true
		}
		unwrapper, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = unwrapper.Unwrap()
	}
	return false
}

func buildDecodeErrors(list *appstate.PatchList) []decodeErrorVector {
	clone := func() *appstate.PatchList {
		out := &appstate.PatchList{Name: list.Name, Snapshot: proto.Clone(list.Snapshot).(*waServerSync.SyncdSnapshot)}
		for _, p := range list.Patches {
			out.Patches = append(out.Patches, proto.Clone(p).(*waServerSync.SyncdPatch))
		}
		return out
	}
	var out []decodeErrorVector

	badSnapshotMAC := clone()
	badSnapshotMAC.Snapshot.Mac[0] ^= 1
	out = append(out, decodeError("snapshot MAC mismatch", badSnapshotMAC, appstate.HashState{}))

	badContent := clone()
	badContent.Snapshot.Records[1].Value.Blob[20] ^= 1
	out = append(out, decodeError("content MAC mismatch", badContent, appstate.HashState{}))

	badIndex := clone()
	badIndex.Snapshot.Records[0].Index.Blob[0] ^= 1
	out = append(out, decodeError("index MAC mismatch", badIndex, appstate.HashState{}))

	badPatchMAC := clone()
	badPatchMAC.Patches[0].PatchMAC[0] ^= 1
	out = append(out, decodeError("patch MAC mismatch", badPatchMAC, appstate.HashState{}))

	badPatchLTHash := clone()
	badPatchLTHash.Patches[1].SnapshotMAC[0] ^= 1
	out = append(out, decodeError("patch LT hash mismatch", badPatchLTHash, appstate.HashState{}))

	missingSnapshotKey := clone()
	missingSnapshotKey.Snapshot.KeyID.ID = key3ID
	out = append(out, decodeError("missing snapshot key", missingSnapshotKey, appstate.HashState{}))

	missingRecordKey := clone()
	missingRecordKey.Snapshot.Records[2].KeyID.ID = key3ID
	missingRecordKey.Patches[1].KeyID.ID = []byte{0, 0, 0, 4}
	out = append(out, decodeError("missing record key", missingRecordKey, appstate.HashState{}))
	return out
}

func buildRecovery() recoveryVector {
	mutations := []*waSyncdSnapshotRecovery.SyncdPlainTextRecord{
		{
			Value: &waSyncAction.SyncActionData{
				Index:   must(json.Marshal([]string{appstate.IndexPin, chatA.String()})),
				Value:   &waSyncAction.SyncActionValue{Timestamp: proto.Int64(1760000000000), PinAction: &waSyncAction.PinAction{Pinned: proto.Bool(true)}},
				Version: proto.Int32(5),
			},
			KeyID: key1ID,
			Mac:   bytesRange(0x70, 32),
		},
		{
			Value: &waSyncAction.SyncActionData{
				Index:   must(json.Marshal([]string{appstate.IndexArchive, chatB.String()})),
				Value:   &waSyncAction.SyncActionValue{Timestamp: proto.Int64(1760000000001), ArchiveChatAction: &waSyncAction.ArchiveChatAction{Archived: proto.Bool(true)}},
				Version: proto.Int32(3),
			},
			KeyID: key2ID,
			Mac:   bytesRange(0x90, 32),
		},
	}
	recovery := &waSyncdSnapshotRecovery.SyncdSnapshotRecovery{
		Version:          &waSyncdSnapshotRecovery.SyncdVersion{Version: proto.Uint64(42)},
		CollectionName:   proto.String(string(appstate.WAPatchRegularLow)),
		MutationRecords:  mutations,
		CollectionLthash: bytesRange(0x01, 128),
	}
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	must(writer.Write(must(proto.Marshal(recovery))))
	must(0, writer.Close())

	resp := &waE2E.PeerDataOperationRequestResponseMessage_PeerDataOperationResult_SyncDSnapshotFatalRecoveryResponse{
		CollectionSnapshot: compressed.Bytes(),
		IsCompressed:       proto.Bool(true),
	}
	parsed := must(appstate.ParseRecovery(resp))
	mem := keysStore()
	result := must(newProcessor(mem).ProcessRecovery(context.Background(), parsed))
	indexMACs := make([][]byte, len(result))
	for i, mutation := range result {
		indexMACs[i] = mutation.IndexMAC
	}

	invalid := proto.Clone(recovery).(*waSyncdSnapshotRecovery.SyncdSnapshotRecovery)
	invalid.CollectionLthash = bytesRange(0, 127)
	_, invalidErr := newProcessor(keysStore()).ProcessRecovery(context.Background(), invalid)

	return recoveryVector{
		CollectionSnapshot: compressed.Bytes(),
		IsCompressed:       true,
		Name:               parsed.GetCollectionName(),
		Mutations:          mutationVectors(result),
		StoredState:        stateOf(must2(mem.GetAppStateVersion(context.Background(), parsed.GetCollectionName()))),
		Lookups:            lookups(mem, parsed.GetCollectionName(), indexMACs),
		InvalidLTHash:      must(proto.Marshal(invalid)),
		InvalidLTHashError: invalidErr.Error(),
	}
}

func patchInfoVectorOf(info appstate.PatchInfo) patchInfoVector {
	out := patchInfoVector{Type: string(info.Type)}
	for _, mutation := range info.Mutations {
		out.Mutations = append(out.Mutations, mutationInfoVector{
			Index:   mutation.Index,
			Version: mutation.Version,
			Value:   marshal(mutation.Value),
		})
	}
	return out
}

func buildBuilders() []patchInfoVector {
	at := time.Unix(1760000000, 0)
	key := &waCommon.MessageKey{RemoteJID: proto.String(chatA.String()), FromMe: proto.Bool(true), ID: proto.String("3EB0KEY")}
	end := int64(1760003600000)
	return []patchInfoVector{
		patchInfoVectorOf(appstate.BuildMuteAbs(chatA, true, nil)),
		patchInfoVectorOf(appstate.BuildMuteAbs(chatA, true, &end)),
		patchInfoVectorOf(appstate.BuildMuteAbs(chatA, false, nil)),
		patchInfoVectorOf(appstate.BuildPin(chatB, true)),
		patchInfoVectorOf(appstate.BuildArchive(chatA, true, at, key)),
		patchInfoVectorOf(appstate.BuildArchive(chatA, false, at, nil)),
		patchInfoVectorOf(appstate.BuildMarkChatAsRead(chatB, false, at, key)),
		patchInfoVectorOf(appstate.BuildLabelChat(chatA, "7", true)),
		patchInfoVectorOf(appstate.BuildLabelMessage(chatA, "7", "3EB0MSG", false)),
		patchInfoVectorOf(appstate.BuildLabelEdit("7", "Work", 3, false)),
		patchInfoVectorOf(appstate.BuildSettingPushName("Wolf")),
		patchInfoVectorOf(appstate.BuildStar(chatA, chatA, "3EB0MSG", true, true)),
		patchInfoVectorOf(appstate.BuildStar(group, chatB, "3EB0MSG", false, false)),
		patchInfoVectorOf(appstate.BuildDeleteChat(chatC, at, key, true)),
	}
}

func main() {
	out := flag.String("out", "../appstate/vectors.json", "where to write the vectors")
	flag.Parse()

	var v vectors
	for i, base := range [][]byte{make([]byte, 128), bytesRange(0xf0, 128)} {
		subtract := [][]byte{bytesRange(i, 32)}
		add := [][]byte{bytesRange(0x40, 32), []byte("value mac")}
		v.LTHash = append(v.LTHash, lthashVector{
			Base: base, Subtract: []hexBytes{subtract[0]}, Add: []hexBytes{add[0], add[1]},
			Result: lthash.WAPatchIntegrity.SubtractThenAdd(base, subtract, add),
		})
	}
	for _, keyData := range [][]byte{key1Data, key2Data} {
		keys := expandAppStateKeys(keyData)
		v.ExpandedKeys = append(v.ExpandedKeys, expandedKeysVector{keyData, keys.Index, keys.ValueEncryption, keys.ValueMAC, keys.SnapshotMAC, keys.PatchMAC})
	}
	keys := expandAppStateKeys(key1Data)
	state := appstate.HashState{Version: 0x0102030405060708}
	copy(state.Hash[:], bytesRange(0x80, 128))
	v.SnapshotMAC = append(v.SnapshotMAC, snapshotMACVector{state.Hash[:], state.Version, string(name), keys.SnapshotMAC, generateSnapshotMAC(&state, name, keys.SnapshotMAC)})
	for _, op := range []waServerSync.SyncdMutation_SyncdOperation{waServerSync.SyncdMutation_SET, waServerSync.SyncdMutation_REMOVE, 255} {
		data := bytesRange(int(op), 80)
		v.ContentMAC = append(v.ContentMAC, contentMACVector{int32(op), data, key1ID, keys.ValueMAC, generateContentMAC(op, data, key1ID, keys.ValueMAC)})
	}
	indexBytes := must(json.Marshal([]string{appstate.IndexMute, chatA.String()}))
	v.IndexMAC = append(v.IndexMAC, indexMACVector{keys.Index, indexBytes, concatAndHMAC(sha256.New, keys.Index, indexBytes)})
	for _, index := range [][]string{
		{appstate.IndexMute, chatA.String()},
		{},
		{"a<b>&c", "quote\"back\\slash", "\b\f\n\r\t\x01\x1f\x7f", "  ", "ünï😀"},
	} {
		v.IndexJSON = append(v.IndexJSON, indexJSONVector{index, string(must(json.Marshal(index)))})
	}
	v.Builders = buildBuilders()

	sequence, firstList := buildSequence()
	v.Sequence = sequence
	for _, p := range firstList.Patches {
		v.PatchMAC = append(v.PatchMAC, patchMACVector{
			Patch: marshal(p), Name: string(name), Key: expandAppStateKeys(keyData(p.GetKeyID().GetID())).PatchMAC,
			Version: p.GetVersion().GetVersion(),
			MAC:     generatePatchMAC(p, name, expandAppStateKeys(keyData(p.GetKeyID().GetID())).PatchMAC, p.GetVersion().GetVersion()),
		})
	}
	v.DecodeErrors = buildDecodeErrors(firstList)
	v.Recovery = buildRecovery()

	data := must(json.MarshalIndent(v, "", "  "))
	must(0, os.WriteFile(*out, append(data, '\n'), 0o644))
	fmt.Fprintln(os.Stderr, "wrote", *out)
}
