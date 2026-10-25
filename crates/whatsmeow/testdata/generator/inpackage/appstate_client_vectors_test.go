// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//go:build rustport

package whatsmeow

import (
	"context"
	"encoding/hex"
	"fmt"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"

	"go.mau.fi/whatsmeow/appstate"
	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waServerSync"
	"go.mau.fi/whatsmeow/proto/waSyncAction"
	"go.mau.fi/whatsmeow/socket"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// appStateMemory follows whatsmeow's sqlstore semantics for app state keys,
// versions and mutation MACs.
type appStateMemory struct {
	keys     map[string]store.AppStateSyncKey
	latest   []byte
	versions map[string]appstate.HashState
	macs     map[string][]appStateStoredMAC
}

type appStateStoredMAC struct {
	version uint64
	mac     store.AppStateMutationMAC
}

func newAppStateMemory() *appStateMemory {
	return &appStateMemory{
		keys:     make(map[string]store.AppStateSyncKey),
		versions: make(map[string]appstate.HashState),
		macs:     make(map[string][]appStateStoredMAC),
	}
}

func (m *appStateMemory) PutAppStateSyncKey(_ context.Context, id []byte, key store.AppStateSyncKey) error {
	m.keys[string(id)] = key
	m.latest = id
	return nil
}

func (m *appStateMemory) GetAppStateSyncKey(_ context.Context, id []byte) (*store.AppStateSyncKey, error) {
	key, ok := m.keys[string(id)]
	if !ok {
		return nil, nil
	}
	return &key, nil
}

func (m *appStateMemory) GetLatestAppStateSyncKeyID(context.Context) ([]byte, error) {
	return m.latest, nil
}

func (m *appStateMemory) GetAllAppStateSyncKeys(context.Context) ([]*store.AppStateSyncKey, error) {
	return nil, nil
}

func (m *appStateMemory) PutAppStateVersion(_ context.Context, name string, version uint64, hash [128]byte) error {
	m.versions[name] = appstate.HashState{Version: version, Hash: hash}
	return nil
}

func (m *appStateMemory) GetAppStateVersion(_ context.Context, name string) (uint64, [128]byte, error) {
	state := m.versions[name]
	return state.Version, state.Hash, nil
}

func (m *appStateMemory) DeleteAppStateVersion(_ context.Context, name string) error {
	delete(m.versions, name)
	delete(m.macs, name)
	return nil
}

func (m *appStateMemory) PutAppStateMutationMACs(_ context.Context, name string, version uint64, mutations []store.AppStateMutationMAC) error {
	for _, mutation := range mutations {
		m.macs[name] = append(m.macs[name], appStateStoredMAC{version: version, mac: mutation})
	}
	return nil
}

func (m *appStateMemory) DeleteAppStateMutationMACs(_ context.Context, name string, indexMACs [][]byte) error {
	kept := m.macs[name][:0]
	for _, stored := range m.macs[name] {
		removed := false
		for _, indexMAC := range indexMACs {
			if string(indexMAC) == string(stored.mac.IndexMAC) {
				removed = true
			}
		}
		if !removed {
			kept = append(kept, stored)
		}
	}
	m.macs[name] = kept
	return nil
}

func (m *appStateMemory) GetAppStateMutationMAC(_ context.Context, name string, indexMAC []byte) ([]byte, error) {
	var found *appStateStoredMAC
	for i, stored := range m.macs[name] {
		if string(stored.mac.IndexMAC) == string(indexMAC) && (found == nil || stored.version >= found.version) {
			found = &m.macs[name][i]
		}
	}
	if found == nil {
		return nil, nil
	}
	return found.mac.ValueMAC, nil
}

type noopContainer struct{}

func (noopContainer) PutDevice(context.Context, *store.Device) error    { return nil }
func (noopContainer) DeleteDevice(context.Context, *store.Device) error { return nil }

// appStateCaptureLogger records the nodes the client logs right before sending them.
type appStateCaptureLogger struct {
	waLog.Logger
	nodes []waBinary.Node
}

func (c *appStateCaptureLogger) Debugf(_ string, args ...any) {
	if len(args) == 1 {
		if node, ok := args[0].(*waBinary.Node); ok {
			c.nodes = append(c.nodes, *node)
		}
	}
}

func (c *appStateCaptureLogger) last(t *testing.T) waBinary.Node {
	t.Helper()
	if len(c.nodes) == 0 {
		t.Fatal("no node was sent")
	}
	node := c.nodes[len(c.nodes)-1]
	c.nodes = nil
	return node
}

func protoHex(t *testing.T, message proto.Message) string {
	t.Helper()
	data, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(data)
}

func appStateEventVector(t *testing.T, evt any) map[string]any {
	t.Helper()
	switch evt := evt.(type) {
	case *events.AppState:
		return map[string]any{"type": "AppState", "index": evt.Index, "action": protoHex(t, evt.SyncActionValue)}
	case *events.Contact:
		return map[string]any{"type": "Contact", "jid": evt.JID.String(), "timestamp": evt.Timestamp.UnixMilli(), "action": protoHex(t, evt.Action), "from_full_sync": evt.FromFullSync}
	case *events.Mute:
		return map[string]any{"type": "Mute", "jid": evt.JID.String(), "timestamp": evt.Timestamp.UnixMilli(), "action": protoHex(t, evt.Action), "from_full_sync": evt.FromFullSync}
	case *events.Pin:
		return map[string]any{"type": "Pin", "jid": evt.JID.String(), "timestamp": evt.Timestamp.UnixMilli(), "action": protoHex(t, evt.Action), "from_full_sync": evt.FromFullSync}
	case *events.Archive:
		return map[string]any{"type": "Archive", "jid": evt.JID.String(), "timestamp": evt.Timestamp.UnixMilli(), "action": protoHex(t, evt.Action), "from_full_sync": evt.FromFullSync}
	case *events.MarkChatAsRead:
		return map[string]any{"type": "MarkChatAsRead", "jid": evt.JID.String(), "timestamp": evt.Timestamp.UnixMilli(), "action": protoHex(t, evt.Action), "from_full_sync": evt.FromFullSync}
	case *events.ClearChat:
		return map[string]any{"type": "ClearChat", "jid": evt.JID.String(), "timestamp": evt.Timestamp.UnixMilli(), "action": protoHex(t, evt.Action), "from_full_sync": evt.FromFullSync, "delete_media": evt.DeleteMedia}
	case *events.DeleteChat:
		return map[string]any{"type": "DeleteChat", "jid": evt.JID.String(), "timestamp": evt.Timestamp.UnixMilli(), "action": protoHex(t, evt.Action), "from_full_sync": evt.FromFullSync, "delete_media": evt.DeleteMedia}
	case *events.Star:
		return map[string]any{"type": "Star", "jid": evt.ChatJID.String(), "sender_jid": evt.SenderJID.String(), "is_from_me": evt.IsFromMe, "message_id": evt.MessageID, "timestamp": evt.Timestamp.UnixMilli(), "action": protoHex(t, evt.Action), "from_full_sync": evt.FromFullSync}
	case *events.DeleteForMe:
		return map[string]any{"type": "DeleteForMe", "jid": evt.ChatJID.String(), "sender_jid": evt.SenderJID.String(), "is_from_me": evt.IsFromMe, "message_id": evt.MessageID, "timestamp": evt.Timestamp.UnixMilli(), "action": protoHex(t, evt.Action), "from_full_sync": evt.FromFullSync}
	case *events.PushNameSetting:
		return map[string]any{"type": "PushNameSetting", "timestamp": evt.Timestamp.UnixMilli(), "action": protoHex(t, evt.Action), "from_full_sync": evt.FromFullSync}
	case *events.UnarchiveChatsSetting:
		return map[string]any{"type": "UnarchiveChatsSetting", "timestamp": evt.Timestamp.UnixMilli(), "action": protoHex(t, evt.Action), "from_full_sync": evt.FromFullSync}
	case *events.UserStatusMute:
		return map[string]any{"type": "UserStatusMute", "jid": evt.JID.String(), "timestamp": evt.Timestamp.UnixMilli(), "action": protoHex(t, evt.Action), "from_full_sync": evt.FromFullSync}
	case *events.LabelEdit:
		return map[string]any{"type": "LabelEdit", "label_id": evt.LabelID, "timestamp": evt.Timestamp.UnixMilli(), "action": protoHex(t, evt.Action), "from_full_sync": evt.FromFullSync}
	case *events.LabelAssociationChat:
		return map[string]any{"type": "LabelAssociationChat", "jid": evt.JID.String(), "label_id": evt.LabelID, "timestamp": evt.Timestamp.UnixMilli(), "action": protoHex(t, evt.Action), "from_full_sync": evt.FromFullSync}
	case *events.LabelAssociationMessage:
		return map[string]any{"type": "LabelAssociationMessage", "jid": evt.JID.String(), "label_id": evt.LabelID, "message_id": evt.MessageID, "timestamp": evt.Timestamp.UnixMilli(), "action": protoHex(t, evt.Action), "from_full_sync": evt.FromFullSync}
	default:
		t.Fatalf("unexpected event %T", evt)
		return nil
	}
}

func appStateEventVectors(t *testing.T, evts []any) []map[string]any {
	t.Helper()
	out := make([]map[string]any, len(evts))
	for i, evt := range evts {
		out[i] = appStateEventVector(t, evt)
	}
	return out
}

func appStateKeyID(id byte) []byte {
	return []byte{0, 0, 0, id}
}

func appStateKeyData(id byte) []byte {
	data := make([]byte, 32)
	for i := range data {
		data[i] = id*0x10 + byte(i)
	}
	return data
}

// encodeAppStatePatch encodes the patch on top of the stored state and
// decodes it, like a client receiving it, so the store holds the MACs the
// next patch builds on.
func encodeAppStatePatch(t *testing.T, proc *appstate.Processor, mem *appStateMemory, keyID []byte, info appstate.PatchInfo) ([]byte, []appstate.Mutation) {
	t.Helper()
	ctx := context.Background()
	state := mem.versions[string(info.Type)]
	encoded, err := proc.EncodePatch(ctx, keyID, state, info)
	if err != nil {
		t.Fatal(err)
	}
	var patch waServerSync.SyncdPatch
	if err = proto.Unmarshal(encoded, &patch); err != nil {
		t.Fatal(err)
	}
	// The server assigns the version.
	patch.Version = &waServerSync.SyncdVersion{Version: proto.Uint64(state.Version + 1)}
	if encoded, err = proto.Marshal(&patch); err != nil {
		t.Fatal(err)
	}
	mutations, newState, err := proc.DecodePatches(ctx, &appstate.PatchList{Name: info.Type, Patches: []*waServerSync.SyncdPatch{&patch}}, state, true)
	if err != nil {
		t.Fatal(err)
	}
	if newState.Version != state.Version+1 {
		t.Fatalf("unexpected version %d", newState.Version)
	}
	return encoded, mutations
}

func mutationsOf(infos ...appstate.PatchInfo) []appstate.MutationInfo {
	var out []appstate.MutationInfo
	for _, info := range infos {
		out = append(out, info.Mutations...)
	}
	return out
}

func TestGenerateAppStateClient(t *testing.T) {
	ctx := context.Background()
	values := vectors{}

	chat := mustJID(t, "1111@s.whatsapp.net")
	group := mustJID(t, "120363000000000001@g.us")
	sender := mustJID(t, "2222@s.whatsapp.net")
	contact := mustJID(t, "3333@s.whatsapp.net")
	timestamp := time.UnixMilli(1700000000123)
	lastMessageKey := &waCommon.MessageKey{RemoteJID: proto.String(chat.String()), FromMe: proto.Bool(true), ID: proto.String("LASTMSG")}

	mem := newAppStateMemory()
	if err := mem.PutAppStateSyncKey(ctx, appStateKeyID(1), store.AppStateSyncKey{Data: appStateKeyData(1)}); err != nil {
		t.Fatal(err)
	}
	device := &store.Device{AppStateKeys: mem, AppState: mem, Container: noopContainer{}, PushName: "Tester"}
	cli := NewClient(device, nil)
	cli.EmitAppStateEventsOnFullSync = true
	proc := appstate.NewProcessor(device, waLog.Noop)

	values["key_1_id"] = hex.EncodeToString(appStateKeyID(1))
	values["key_1_data"] = hex.EncodeToString(appStateKeyData(1))
	values["key_2_id"] = hex.EncodeToString(appStateKeyID(2))
	values["key_2_data"] = hex.EncodeToString(appStateKeyData(2))

	muteEnd := int64(1700003600000)
	firstInfo := appstate.PatchInfo{
		Timestamp: timestamp,
		Type:      appstate.WAPatchRegularHigh,
		Mutations: mutationsOf(
			appstate.BuildMuteAbs(chat, true, &muteEnd),
			appstate.BuildPin(group, true),
			appstate.BuildArchive(chat, true, timestamp, lastMessageKey),
			appstate.BuildMarkChatAsRead(chat, true, timestamp, lastMessageKey),
			appstate.BuildStar(group, sender, "STARRED", false, true),
			appstate.BuildDeleteChat(chat, timestamp, lastMessageKey, true),
			appstate.BuildLabelEdit("5", "Work", 3, false),
			appstate.BuildLabelChat(chat, "5", true),
			appstate.BuildLabelMessage(chat, "5", "LABELED", true),
			appstate.BuildSettingPushName("New Name"),
		),
	}
	firstInfo.Mutations = append(firstInfo.Mutations,
		appstate.MutationInfo{
			Index:   []string{appstate.IndexContact, contact.String()},
			Version: 2,
			Value: &waSyncAction.SyncActionValue{ContactAction: &waSyncAction.ContactAction{
				FullName:  proto.String("Contact Full"),
				FirstName: proto.String("Contact"),
			}},
		},
		appstate.MutationInfo{
			Index:   []string{appstate.IndexClearChat, chat.String(), "1", "1"},
			Version: 6,
			Value:   &waSyncAction.SyncActionValue{ClearChatAction: &waSyncAction.ClearChatAction{}},
		},
		appstate.MutationInfo{
			Index:   []string{appstate.IndexDeleteMessageForMe, group.String(), "DELETED", "1", "0"},
			Version: 3,
			Value: &waSyncAction.SyncActionValue{DeleteMessageForMeAction: &waSyncAction.DeleteMessageForMeAction{
				DeleteMedia:      proto.Bool(true),
				MessageTimestamp: proto.Int64(1699999999),
			}},
		},
		appstate.MutationInfo{
			Index:   []string{appstate.IndexSettingUnarchiveChats},
			Version: 4,
			Value:   &waSyncAction.SyncActionValue{UnarchiveChatsSetting: &waSyncAction.UnarchiveChatsSetting{UnarchiveChats: proto.Bool(true)}},
		},
		appstate.MutationInfo{
			Index:   []string{appstate.IndexUserStatusMute, sender.String()},
			Version: 7,
			Value:   &waSyncAction.SyncActionValue{UserStatusMuteAction: &waSyncAction.UserStatusMuteAction{Muted: proto.Bool(true)}},
		},
	)
	firstPatch, firstMutations := encodeAppStatePatch(t, proc, mem, appStateKeyID(1), firstInfo)
	values["regular_high_v1_patch"] = hex.EncodeToString(firstPatch)
	var firstEvents []any
	if err := cli.collectEventsToDispatch(ctx, appstate.WAPatchRegularHigh, firstMutations, true, &firstEvents); err != nil {
		t.Fatal(err)
	}
	values["regular_high_v1_events"] = appStateEventVectors(t, firstEvents)
	if device.PushName != "New Name" {
		t.Fatalf("push name not updated: %q", device.PushName)
	}

	secondInfo := appstate.PatchInfo{
		Timestamp: timestamp.Add(time.Minute),
		Type:      appstate.WAPatchRegularHigh,
		Mutations: mutationsOf(appstate.BuildMute(chat, false, 0), appstate.BuildPin(chat, false)),
	}
	secondPatch, secondMutations := encodeAppStatePatch(t, proc, mem, appStateKeyID(1), secondInfo)
	values["regular_high_v2_patch"] = hex.EncodeToString(secondPatch)
	var secondEvents []any
	if err := cli.collectEventsToDispatch(ctx, appstate.WAPatchRegularHigh, secondMutations, false, &secondEvents); err != nil {
		t.Fatal(err)
	}
	values["regular_high_v2_events"] = appStateEventVectors(t, secondEvents)

	contactsInfo := appstate.PatchInfo{
		Timestamp: timestamp,
		Type:      appstate.WAPatchCriticalUnblockLow,
		Mutations: []appstate.MutationInfo{{
			Index:   []string{appstate.IndexContact, contact.String()},
			Version: 2,
			Value: &waSyncAction.SyncActionValue{ContactAction: &waSyncAction.ContactAction{
				FullName:  proto.String("Contact Full"),
				FirstName: proto.String("Contact"),
			}},
		}, {
			Index:   []string{appstate.IndexPin, chat.String()},
			Version: 5,
			Value:   &waSyncAction.SyncActionValue{PinAction: &waSyncAction.PinAction{Pinned: proto.Bool(true)}},
		}},
	}
	contactsPatch, _ := encodeAppStatePatch(t, proc, mem, appStateKeyID(1), contactsInfo)
	values["critical_unblock_low_v1_patch"] = hex.EncodeToString(contactsPatch)

	// A patch with a key the client doesn't have yet.
	otherMem := newAppStateMemory()
	if err := otherMem.PutAppStateSyncKey(ctx, appStateKeyID(2), store.AppStateSyncKey{Data: appStateKeyData(2)}); err != nil {
		t.Fatal(err)
	}
	otherProc := appstate.NewProcessor(&store.Device{AppStateKeys: otherMem, AppState: otherMem}, waLog.Noop)
	missingKeyPatch, _ := encodeAppStatePatch(t, otherProc, otherMem, appStateKeyID(2), appstate.PatchInfo{
		Timestamp: timestamp,
		Type:      appstate.WAPatchRegularLow,
		Mutations: mutationsOf(appstate.BuildArchive(chat, true, timestamp, lastMessageKey)),
	})
	values["regular_low_v1_patch_key_2"] = hex.EncodeToString(missingKeyPatch)

	// The requests, captured right before the (cancelled) send.
	capture := &appStateCaptureLogger{Logger: waLog.Noop}
	cli.sendLog = capture
	cli.socket = &socket.NoiseSocket{}
	cli.uniqueID = "1.2-"
	cancelled, cancel := context.WithCancel(ctx)
	cancel()

	_, _ = cli.fetchAppStatePatches(cancelled, appstate.WAPatchRegularHigh, 0, true)
	values["fetch_snapshot_iq"] = marshalHex(t, capture.last(t))
	_, _ = cli.fetchAppStatePatches(cancelled, appstate.WAPatchRegularHigh, 1, false)
	values["fetch_version_iq"] = marshalHex(t, capture.last(t))
	_ = cli.MarkNotDirty(cancelled, "groups", time.Unix(1700000000, 0))
	values["mark_not_dirty_iq"] = marshalHex(t, capture.last(t))

	// Sending from a client that has only key 1 and no synced state.
	sendMem := newAppStateMemory()
	if err := sendMem.PutAppStateSyncKey(ctx, appStateKeyID(1), store.AppStateSyncKey{Data: appStateKeyData(1)}); err != nil {
		t.Fatal(err)
	}
	sendCli := NewClient(&store.Device{AppStateKeys: sendMem, AppState: sendMem, Container: noopContainer{}}, nil)
	sendCli.sendLog = capture
	sendCli.socket = &socket.NoiseSocket{}
	sendCli.uniqueID = "1.2-"
	_ = sendCli.sendAppState(cancelled, appstate.BuildPin(chat, true), true)
	sendNode := capture.last(t)
	sendNode.Content.([]waBinary.Node)[0].Content.([]waBinary.Node)[0].Content.([]waBinary.Node)[0].Content = nil
	values["send_app_state_iq_without_patch"] = marshalHex(t, sendNode)

	recovery := BuildAppStateRecoveryRequest(appstate.WAPatchRegularHigh)
	recovery.ProtocolMessage.PeerDataOperationRequestMessage.SyncdCollectionFatalRecoveryRequest.Timestamp = proto.Int64(1700000000)
	values["recovery_request"] = protoHex(t, recovery)

	writeVectors(t, "appstate_client.json", values)
	fmt.Println("wrote appstate_client.json")
}
