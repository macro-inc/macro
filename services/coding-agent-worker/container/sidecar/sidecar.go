// ACP sidecar
//
// A dumb byte pipe between one websocket connection and one `opencode acp`
// process's stdio. opencode speaks ndjson on stdio; we forward raw bytes both
// ways and let the client's ACP SDK do all framing.

// Process-per-connection: connect spawns opencode, disconnect kills it. GET
// /ping is a readiness probe callers poll before connecting.
package main

import (
	"log"
	"net/http"
	"os"
	"os/exec"
	"sync/atomic"

	"github.com/coder/websocket"
)

const port = "8700"

// Only one agent connection at a time (ACP is 1:1).
var busy atomic.Bool

func workspace() string {
	if w := os.Getenv("ACP_WORKSPACE"); w != "" {
		return w
	}
	return "/workspace"
}

func bridge(w http.ResponseWriter, r *http.Request) {
	if !busy.CompareAndSwap(false, true) {
		http.Error(w, "an agent connection is already active", http.StatusServiceUnavailable)
		return
	}
	defer busy.Store(false)

	c, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(-1) // ACP frames (with file contents), don't limit

	ctx := r.Context()
	cmd := exec.CommandContext(ctx, "opencode", "acp", "--cwd", workspace())
	cmd.Stderr = os.Stderr // → sandbox logs
	stdin, err := cmd.StdinPipe()
	if err != nil {
		log.Printf("stdin pipe: %v", err)
		return
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Printf("stdout pipe: %v", err)
		return
	}
	if err := cmd.Start(); err != nil {
		log.Printf("spawn failed: %v", err)
		return
	}
	log.Println("agent connected, opencode spawned")
	defer func() {
		_ = cmd.Process.Kill()
		log.Println("agent disconnected, killing opencode")
	}()

	// opencode stdout → ws
	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				if c.Write(ctx, websocket.MessageBinary, buf[:n]) != nil {
					return
				}
			}
			if err != nil {
				c.Close(websocket.StatusNormalClosure, "agent exited")
				return
			}
		}
	}()

	// ws → opencode stdin
	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			return
		}
		if _, err := stdin.Write(data); err != nil {
			return
		}
	}
}

func main() {
	http.HandleFunc("/ping", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})
	http.HandleFunc("/", bridge)

	log.Printf("acp-sidecar listening on :%s, workspace=%s", port, workspace())
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal(err)
	}
}
