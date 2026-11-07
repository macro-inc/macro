// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Command media writes ../media/vectors.json: expected values for the Rust
// port of whatsmeow's mediaconn.go, download.go, download-to-file.go and
// upload.go, produced by running whatsmeow's own code at the pinned revision.
//
// Uploads and downloads go through a real whatsmeow Client against local TLS
// test servers; the media connection cache is filled in with reflection so no
// IQ is sent. Unexported helpers are reached with go:linkname.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"time"
	"unsafe"

	"go.mau.fi/whatsmeow"
	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
)

//go:linkname getMediaKeys go.mau.fi/whatsmeow.getMediaKeys
func getMediaKeys(mediaKey []byte, appInfo whatsmeow.MediaType) (iv, cipherKey, macKey, refKey []byte)

//go:linkname mediaTypeToMMSType go.mau.fi/whatsmeow.mediaTypeToMMSType
var mediaTypeToMMSType map[whatsmeow.MediaType]string

//go:linkname validateMedia go.mau.fi/whatsmeow.validateMedia
func validateMedia(iv, file, macKey, mac []byte) error

type hexBytes []byte

func (h hexBytes) MarshalJSON() ([]byte, error) {
	if h == nil {
		return []byte("null"), nil
	}
	return json.Marshal(hex.EncodeToString(h))
}

type mediaKeys struct {
	MediaType string   `json:"media_type"`
	MMSType   string   `json:"mms_type"`
	MediaKey  hexBytes `json:"media_key"`
	IV        hexBytes `json:"iv"`
	CipherKey hexBytes `json:"cipher_key"`
	MACKey    hexBytes `json:"mac_key"`
	RefKey    hexBytes `json:"ref_key"`
}

type validateCase struct {
	IV     hexBytes `json:"iv"`
	File   hexBytes `json:"file"`
	MACKey hexBytes `json:"mac_key"`
	MAC    hexBytes `json:"mac"`
	Error  string   `json:"error"`
}

type request struct {
	Host       int               `json:"host"`
	Method     string            `json:"method"`
	RequestURI string            `json:"request_uri"`
	Headers    map[string]string `json:"headers"`
	Body       hexBytes          `json:"body"`
}

type uploadVector struct {
	MediaType    string    `json:"media_type"`
	Plaintext    hexBytes  `json:"plaintext"`
	ResponseJSON string    `json:"response_json"`
	Requests     []request `json:"requests"`

	URL           string   `json:"url"`
	DirectPath    string   `json:"direct_path"`
	Handle        string   `json:"handle"`
	ObjectID      string   `json:"object_id"`
	MediaKey      hexBytes `json:"media_key"`
	FileEncSHA256 hexBytes `json:"file_enc_sha256"`
	FileSHA256    hexBytes `json:"file_sha256"`
	FileLength    uint64   `json:"file_length"`
}

// response is what a fake host answers for one request.
type response struct {
	Status     int    `json:"status"`
	RetryAfter string `json:"retry_after,omitempty"`
	// Body is the served body; null means the uploaded ciphertext.
	Body hexBytes `json:"body"`
}

type downloadVector struct {
	Name          string   `json:"name"`
	DirectPath    string   `json:"direct_path"`
	MediaKey      hexBytes `json:"media_key"`
	FileSHA256    hexBytes `json:"file_sha256"`
	FileEncSHA256 hexBytes `json:"file_enc_sha256"`
	// Responses per host, consumed in order; the last one repeats.
	Responses [][]response `json:"responses"`
	Requests  []request    `json:"requests"`
	Data      hexBytes     `json:"data"`
	Error     string       `json:"error"`
	ToFile    bool         `json:"to_file"`
}

type deleteVector struct {
	MediaType          string    `json:"media_type"`
	DirectPath         string    `json:"direct_path"`
	EncFileHash        hexBytes  `json:"enc_file_hash"`
	EncHandle          string    `json:"enc_handle"`
	CompanionMetaNonce string    `json:"companion_meta_nonce"`
	Requests           []request `json:"requests"`
}

type mediaConnHost struct {
	Hostname string `json:"hostname"`
}

type mediaConnVector struct {
	Response   hexBytes        `json:"response"`
	Auth       string          `json:"auth"`
	AuthTTL    int             `json:"auth_ttl"`
	TTL        int             `json:"ttl"`
	MaxBuckets int             `json:"max_buckets"`
	Hosts      []mediaConnHost `json:"hosts"`
	Request    hexBytes        `json:"request"`
}

type vectors struct {
	Auth       string           `json:"auth"`
	UserAgent  string           `json:"user_agent"`
	MediaKeys  []mediaKeys      `json:"media_keys"`
	Validate   []validateCase   `json:"validate"`
	Upload     uploadVector     `json:"upload"`
	Newsletter uploadVector     `json:"upload_newsletter"`
	Downloads  []downloadVector `json:"downloads"`
	Delete     deleteVector     `json:"delete"`
	MediaConn  mediaConnVector  `json:"media_conn"`
}

func seq(start byte, length int) []byte {
	out := make([]byte, length)
	for i := range out {
		out[i] = start + byte(i)
	}
	return out
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

// fakeHost is one media host: it records requests and answers from a script.
type fakeHost struct {
	index     int
	server    *httptest.Server
	lock      sync.Mutex
	script    []response
	requests  *[]request
	allLock   *sync.Mutex
	uploadAns string
}

func (h *fakeHost) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	headers := map[string]string{}
	for _, name := range []string{"Origin", "Referer", "User-Agent", "Companion_user_secret", "Content-Length"} {
		if value := r.Header.Get(name); value != "" {
			headers[name] = value
		}
	}
	if r.ContentLength > 0 {
		headers["Content-Length"] = fmt.Sprint(r.ContentLength)
	}
	h.allLock.Lock()
	*h.requests = append(*h.requests, request{
		Host:       h.index,
		Method:     r.Method,
		RequestURI: r.RequestURI,
		Headers:    headers,
		Body:       body,
	})
	h.allLock.Unlock()

	h.lock.Lock()
	var answer response
	if len(h.script) > 0 {
		answer = h.script[0]
		if len(h.script) > 1 {
			h.script = h.script[1:]
		}
	} else {
		answer = response{Status: 200, Body: []byte(h.uploadAns)}
	}
	h.lock.Unlock()
	if answer.RetryAfter != "" {
		w.Header().Set("Retry-After", answer.RetryAfter)
	}
	w.WriteHeader(answer.Status)
	_, _ = w.Write(answer.Body)
}

type harness struct {
	cli      *whatsmeow.Client
	hosts    []*fakeHost
	requests []request
	lock     sync.Mutex
}

func newHarness(hostCount int, auth string) *harness {
	h := &harness{}
	device := &store.Device{CompanionMetaNonce: "companion-nonce"}
	h.cli = whatsmeow.NewClient(device, nil)
	h.cli.UserAgent = "whatsmeow-rs-test/1.0"
	var conn whatsmeow.MediaConn
	conn.Auth = auth
	conn.TTL = 3600
	conn.FetchedAt = time.Now()
	for i := range hostCount {
		host := &fakeHost{index: i, requests: &h.requests, allLock: &h.lock}
		host.server = httptest.NewTLSServer(host)
		h.hosts = append(h.hosts, host)
		conn.Hosts = append(conn.Hosts, whatsmeow.MediaConnHost{Hostname: strings.TrimPrefix(host.server.URL, "https://")})
	}
	h.cli.SetMediaHTTPClient(h.hosts[0].server.Client())
	field := reflect.ValueOf(h.cli).Elem().FieldByName("mediaConnCache")
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(&conn))
	return h
}

func (h *harness) close() {
	for _, host := range h.hosts {
		host.server.Close()
	}
}

func (h *harness) takeRequests() []request {
	h.lock.Lock()
	defer h.lock.Unlock()
	out := h.requests
	h.requests = nil
	return out
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// fileBuffer is an in-memory whatsmeow.File.
type fileBuffer struct {
	data []byte
	pos  int64
}

func (f *fileBuffer) Read(p []byte) (int, error) {
	if f.pos >= int64(len(f.data)) {
		return 0, io.EOF
	}
	n := copy(p, f.data[f.pos:])
	f.pos += int64(n)
	return n, nil
}

func (f *fileBuffer) Write(p []byte) (int, error) {
	n, err := f.WriteAt(p, f.pos)
	f.pos += int64(n)
	return n, err
}

func (f *fileBuffer) Seek(offset int64, whence int) (int64, error) {
	switch whence {
	case io.SeekStart:
		f.pos = offset
	case io.SeekCurrent:
		f.pos += offset
	case io.SeekEnd:
		f.pos = int64(len(f.data)) + offset
	}
	return f.pos, nil
}

func (f *fileBuffer) ReadAt(p []byte, off int64) (int, error) {
	if off >= int64(len(f.data)) {
		return 0, io.EOF
	}
	n := copy(p, f.data[off:])
	if n < len(p) {
		return n, io.EOF
	}
	return n, nil
}

func (f *fileBuffer) WriteAt(p []byte, off int64) (int, error) {
	if end := off + int64(len(p)); end > int64(len(f.data)) {
		f.data = append(f.data, make([]byte, end-int64(len(f.data)))...)
	}
	return copy(f.data[off:], p), nil
}

func (f *fileBuffer) Truncate(size int64) error {
	f.data = f.data[:size]
	return nil
}

func (f *fileBuffer) Stat() (os.FileInfo, error) {
	return fileInfo{size: int64(len(f.data))}, nil
}

// fileInfo reports only the size, which is all cbcutil.DecryptFile reads.
type fileInfo struct {
	os.FileInfo
	size int64
}

func (i fileInfo) Size() int64 {
	return i.size
}

func main() {
	out := flag.String("out", "../media/vectors.json", "output file")
	flag.Parse()
	ctx := context.Background()

	var v vectors
	v.Auth = "AUTH token/with+odd=chars~*!"
	v.UserAgent = "whatsmeow-rs-test/1.0"

	mediaKey := seq(0x20, 32)
	for _, mediaType := range []whatsmeow.MediaType{
		whatsmeow.MediaImage, whatsmeow.MediaVideo, whatsmeow.MediaAudio, whatsmeow.MediaDocument,
		whatsmeow.MediaHistory, whatsmeow.MediaAppState, whatsmeow.MediaStickerPack, whatsmeow.MediaLinkThumbnail,
	} {
		iv, cipherKey, macKey, refKey := getMediaKeys(mediaKey, mediaType)
		v.MediaKeys = append(v.MediaKeys, mediaKeys{
			MediaType: string(mediaType),
			MMSType:   mediaTypeToMMSType[mediaType],
			MediaKey:  mediaKey,
			IV:        iv,
			CipherKey: cipherKey,
			MACKey:    macKey,
			RefKey:    refKey,
		})
	}

	iv, _, macKey, _ := getMediaKeys(mediaKey, whatsmeow.MediaImage)
	file := seq(0x50, 48)

	// Upload: a real Client.Upload against a fake host.
	plaintext := []byte(strings.Repeat("whatsmeow media upload ", 5))
	upload := newHarness(2, v.Auth)
	responseJSON := `{"url":"https://mmg.whatsapp.net/o1/v/t62.7118-24/f1/m231/up.enc?ccb=9-4","direct_path":"/o1/v/t62.7118-24/f1/m231/up.enc?ccb=9-4&oh=01_Q5&oe=68","handle":"","object_id":"obj-1","extra":true}`
	for _, host := range upload.hosts {
		host.uploadAns = responseJSON
	}
	resp, err := upload.cli.Upload(ctx, plaintext, whatsmeow.MediaImage)
	must(err)
	v.Upload = uploadVector{
		MediaType:     string(whatsmeow.MediaImage),
		Plaintext:     plaintext,
		ResponseJSON:  responseJSON,
		Requests:      upload.takeRequests(),
		URL:           resp.URL,
		DirectPath:    resp.DirectPath,
		Handle:        resp.Handle,
		ObjectID:      resp.ObjectID,
		MediaKey:      resp.MediaKey,
		FileEncSHA256: resp.FileEncSHA256,
		FileSHA256:    resp.FileSHA256,
		FileLength:    resp.FileLength,
	}
	uploaded := v.Upload.Requests[0].Body

	newsletterJSON := `{"url":"https://mmg.whatsapp.net/newsletter/x","direct_path":"/newsletter/x?a=b","handle":"handle-1"}`
	for _, host := range upload.hosts {
		host.uploadAns = newsletterJSON
	}
	newsResp, err := upload.cli.UploadNewsletter(ctx, plaintext, whatsmeow.MediaVideo)
	must(err)
	v.Newsletter = uploadVector{
		MediaType:    string(whatsmeow.MediaVideo),
		Plaintext:    plaintext,
		ResponseJSON: newsletterJSON,
		Requests:     upload.takeRequests(),
		URL:          newsResp.URL,
		DirectPath:   newsResp.DirectPath,
		Handle:       newsResp.Handle,
		ObjectID:     newsResp.ObjectID,
		FileSHA256:   newsResp.FileSHA256,
		FileLength:   newsResp.FileLength,
	}

	// Delete.
	v.Delete = deleteVector{
		MediaType:          string(whatsmeow.MediaHistory),
		DirectPath:         "/v/t62.15575-24/hist.enc?ccb=11-4&oh=01",
		EncFileHash:        resp.FileEncSHA256,
		EncHandle:          "enc-handle",
		CompanionMetaNonce: "companion-nonce",
	}
	must(upload.cli.DeleteMedia(ctx, whatsmeow.MediaHistory, v.Delete.DirectPath, v.Delete.EncFileHash, v.Delete.EncHandle))
	v.Delete.Requests = upload.takeRequests()
	upload.close()

	// validateMedia: the uploaded body is ciphertext || mac.
	ciphertext, mac := uploaded[:len(uploaded)-10], uploaded[len(uploaded)-10:]
	uploadIV, _, uploadMACKey, _ := getMediaKeys(resp.MediaKey, whatsmeow.MediaImage)
	badMAC := append([]byte{}, mac...)
	badMAC[0] ^= 1
	for _, c := range []validateCase{
		{IV: uploadIV, File: ciphertext, MACKey: uploadMACKey, MAC: mac},
		{IV: uploadIV, File: ciphertext, MACKey: uploadMACKey, MAC: badMAC},
		{IV: uploadIV, File: ciphertext, MACKey: uploadMACKey, MAC: mac[:9]},
		{IV: iv, File: file, MACKey: macKey, MAC: seq(0, 10)},
	} {
		c.Error = errString(validateMedia(c.IV, c.File, c.MACKey, c.MAC))
		v.Validate = append(v.Validate, c)
	}

	// Downloads.
	directPath := "/v/t62.7118-24/12345_67890_n.enc?ccb=11-4&oh=01_Q5Aa&oe=6700&_nc_sid=5e03e0"
	tampered := append([]byte{}, uploaded...)
	tampered[len(tampered)-1] ^= 1
	tamperedSHA := sha256.Sum256(tampered)
	wrongSHA := sha256.Sum256([]byte("wrong"))
	unencrypted := []byte("plain newsletter media")
	unencryptedSHA := sha256.Sum256(unencrypted)
	ok := response{Status: 200}
	cases := []downloadVector{
		{Name: "ok", Responses: [][]response{{ok}, {ok}}},
		{Name: "next_host_on_500", Responses: [][]response{{{Status: 500}}, {ok}}},
		{Name: "retry_on_503", Responses: [][]response{{{Status: 503, RetryAfter: "0"}, {Status: 429, RetryAfter: "0"}, ok}, {ok}}},
		{Name: "retries_exhausted", Responses: [][]response{{{Status: 502, RetryAfter: "0"}}, {ok}}},
		{Name: "not_found", Responses: [][]response{{{Status: 404}}, {ok}}},
		{Name: "gone", Responses: [][]response{{{Status: 410}}, {ok}}},
		{Name: "last_host_500", Responses: [][]response{{{Status: 500}}, {{Status: 500}}}},
		{Name: "bad_hmac", FileEncSHA256: tamperedSHA[:], Responses: [][]response{{{Status: 200, Body: tampered}}, {{Status: 200, Body: tampered}}}},
		{Name: "bad_enc_sha256", FileEncSHA256: wrongSHA[:], Responses: [][]response{{ok}, {ok}}},
		{Name: "bad_sha256", FileSHA256: wrongSHA[:], Responses: [][]response{{ok}, {ok}}},
		{Name: "too_short", Responses: [][]response{{{Status: 200, Body: seq(1, 10)}}, {ok}}},
		{Name: "unencrypted", MediaKey: []byte{}, FileEncSHA256: []byte{}, FileSHA256: unencryptedSHA[:], Responses: [][]response{{{Status: 200, Body: unencrypted}}, {ok}}},
		{Name: "unencrypted_bad_sha256", MediaKey: []byte{}, FileEncSHA256: []byte{}, FileSHA256: wrongSHA[:], Responses: [][]response{{{Status: 200, Body: unencrypted}}, {ok}}},
		{Name: "no_slash", DirectPath: "v/no-slash", Responses: [][]response{{ok}, {ok}}},
	}
	for _, toFile := range []bool{false, true} {
		for _, c := range cases {
			c.ToFile = toFile
			if c.DirectPath == "" {
				c.DirectPath = directPath
			}
			if c.MediaKey == nil {
				c.MediaKey = resp.MediaKey
			} else if len(c.MediaKey) == 0 {
				c.MediaKey = nil
			}
			if c.FileEncSHA256 == nil {
				c.FileEncSHA256 = resp.FileEncSHA256
			} else if len(c.FileEncSHA256) == 0 {
				c.FileEncSHA256 = nil
			}
			if c.FileSHA256 == nil {
				c.FileSHA256 = resp.FileSHA256
			}
			h := newHarness(len(c.Responses), v.Auth)
			for i, script := range c.Responses {
				for _, answer := range script {
					if answer.Body == nil {
						answer.Body = uploaded
					}
					h.hosts[i].script = append(h.hosts[i].script, answer)
				}
			}
			msg := &waE2E.ImageMessage{
				DirectPath:    &c.DirectPath,
				MediaKey:      c.MediaKey,
				FileSHA256:    c.FileSHA256,
				FileEncSHA256: c.FileEncSHA256,
			}
			if toFile {
				f := &fileBuffer{}
				err = h.cli.DownloadToFile(ctx, msg, f)
				if err == nil {
					c.Data = f.data
				}
			} else {
				c.Data, err = h.cli.Download(ctx, msg)
			}
			c.Error = errString(err)
			c.Requests = h.takeRequests()
			h.close()
			v.Downloads = append(v.Downloads, c)
		}
	}

	// Media conn: the response node as WhatsApp sends it, and the request.
	connNode := waBinary.Node{
		Tag: "iq",
		Attrs: waBinary.Attrs{
			"from": types.ServerJID,
			"id":   "1234.5678-1",
			"type": "result",
		},
		Content: []waBinary.Node{{
			Tag: "media_conn",
			Attrs: waBinary.Attrs{
				"auth":        v.Auth,
				"ttl":         "300",
				"auth_ttl":    "21600",
				"max_buckets": "12",
			},
			Content: []waBinary.Node{
				{Tag: "host", Attrs: waBinary.Attrs{"hostname": "mmg.whatsapp.net"}, Content: []waBinary.Node{{Tag: "download"}}},
				{Tag: "unknown"},
				{Tag: "host", Attrs: waBinary.Attrs{"hostname": "media-ams2-1.cdn.whatsapp.net", "type": "fallback"}},
			},
		}},
	}
	connBytes, err := waBinary.Marshal(connNode)
	must(err)
	v.MediaConn.Response = connBytes
	// Mirrors queryMediaConn's attribute reads.
	respMC := connNode.GetChildren()[0]
	ag := respMC.AttrGetter()
	v.MediaConn.Auth = ag.String("auth")
	v.MediaConn.TTL = ag.Int("ttl")
	v.MediaConn.AuthTTL = ag.Int("auth_ttl")
	v.MediaConn.MaxBuckets = ag.Int("max_buckets")
	for _, child := range respMC.GetChildren() {
		if child.Tag == "host" {
			v.MediaConn.Hosts = append(v.MediaConn.Hosts, mediaConnHost{Hostname: child.AttrGetter().String("hostname")})
		}
	}
	// Mirrors sendIQAsyncAndGetData's node for queryMediaConn's infoQuery.
	requestBytes, err := waBinary.Marshal(waBinary.Node{
		Tag: "iq",
		Attrs: waBinary.Attrs{
			"id":    "1234.5678-2",
			"xmlns": "w:m",
			"type":  "set",
			"to":    types.ServerJID,
		},
		Content: []waBinary.Node{{Tag: "media_conn"}},
	})
	must(err)
	v.MediaConn.Request = requestBytes

	data, err := json.MarshalIndent(v, "", "  ")
	must(err)
	must(os.MkdirAll(filepath.Dir(*out), 0o755))
	must(os.WriteFile(*out, append(data, '\n'), 0o644))
}
