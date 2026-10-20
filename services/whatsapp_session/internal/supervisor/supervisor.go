// Package supervisor fences sessions using both a durable ownership row and an
// independently killable process. A lease never proves an old writer has stopped.
package supervisor

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"macro.com/whatsapp-session/internal/protocol"
	"macro.com/whatsapp-session/internal/secrets"
	"macro.com/whatsapp-session/internal/telemetry"
)

type Config struct {
	Executable, Directory, KMSKey string
	Keys                          secrets.KMS
}
type Supervisor struct {
	pool      *pgxpool.Pool
	config    Config
	mu        sync.Mutex
	children  map[string]*child
	ctx       context.Context
	cancel    context.CancelFunc
	closing   bool
	workers   sync.WaitGroup
	lifecycle sync.Map
	starting  int
}
type child struct {
	cmd    *exec.Cmd
	scope  protocol.Scope
	worker string
	socket string
	done   chan struct{}
}
type Start struct {
	UserID     string    `json:"userId"`
	Generation int64     `json:"authorizationGeneration"`
	PairingID  string    `json:"pairingId"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

func New(ctx context.Context, pool *pgxpool.Pool, config Config) *Supervisor {
	workerCtx, cancel := context.WithCancel(ctx)
	s := &Supervisor{pool: pool, config: config, children: map[string]*child{}, ctx: workerCtx, cancel: cancel}
	s.workers.Add(1)
	go func() {
		defer s.workers.Done()
		tick := time.NewTicker(30 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-workerCtx.Done():
				return
			case <-tick.C:
				entries, err := os.ReadDir(config.Directory)
				if err != nil {
					continue
				}
				for _, entry := range entries {
					if workerCtx.Err() != nil {
						return
					}
					if !entry.IsDir() {
						continue
					}
					lock := s.accountLock(entry.Name())
					lock.Lock()
					s.mu.Lock()
					active := s.children[entry.Name()] != nil
					s.mu.Unlock()
					if !active {
						_ = s.retryRetirements(workerCtx, entry.Name())
					}
					lock.Unlock()
				}
			}
		}
	}()
	return s
}
func (s *Supervisor) accountLock(account string) *sync.Mutex {
	value, _ := s.lifecycle.LoadOrStore(account, &sync.Mutex{})
	return value.(*sync.Mutex)
}
func (s *Supervisor) Start(ctx context.Context, account string, request Start) (protocol.Scope, error) {
	if _, err := uuid.Parse(account); err != nil {
		return protocol.Scope{}, protocol.ErrInvalid
	}
	if request.Generation < 1 || request.UserID == "" {
		return protocol.Scope{}, protocol.ErrInvalid
	}
	lock := s.accountLock(account)
	lock.Lock()
	defer lock.Unlock()
	s.mu.Lock()
	if s.closing || s.ctx.Err() != nil {
		s.mu.Unlock()
		return protocol.Scope{}, protocol.ErrUnavailable
	}
	if current := s.children[account]; current != nil {
		s.mu.Unlock()
		if current.scope.Generation != request.Generation {
			return protocol.Scope{}, protocol.ErrConflict
		}
		return current.scope, nil
	}
	if len(s.children)+s.starting >= 32 {
		s.mu.Unlock()
		return protocol.Scope{}, protocol.ErrUnavailable
	}
	s.starting++
	s.workers.Add(1)
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.starting--; s.mu.Unlock(); s.workers.Done() }()
	if err := s.retryRetirements(ctx, account); err != nil {
		return protocol.Scope{}, protocol.ErrUnavailable
	}
	if s.ctx.Err() != nil {
		return protocol.Scope{}, protocol.ErrUnavailable
	}
	worker, err := uuid.NewV7()
	if err != nil {
		return protocol.Scope{}, err
	}
	scope := protocol.Scope{AccountID: account, Generation: request.Generation}
	// The account owner/generation are independently checked against Rust-owned
	// state. 'running' and expired leases cannot be stolen by a new supervisor.
	err = s.pool.QueryRow(ctx, `INSERT INTO whatsapp_session_owner(account_id,worker_id,epoch,state,lease_until)
      SELECT id,$2,1,'starting',now()+interval '20 seconds' FROM whatsapp_linked_account
      WHERE id=$1 AND user_id=$3 AND authorization_generation=$4 AND state<>'disconnected'
      ON CONFLICT(account_id) DO UPDATE SET worker_id=excluded.worker_id,epoch=whatsapp_session_owner.epoch+1,state='starting',lease_until=excluded.lease_until,terminated_at=NULL
      WHERE whatsapp_session_owner.state='terminated' RETURNING epoch`, account, worker.String(), request.UserID, request.Generation).Scan(&scope.Epoch)
	if err != nil {
		return scope, protocol.ErrConflict
	}
	socket := filepath.Join(s.config.Directory, account+".sock")
	_ = os.Remove(socket) // only after durable proof that its previous owner terminated
	c := &child{scope: scope, worker: worker.String(), socket: socket, done: make(chan struct{})}
	c.cmd = exec.Command(s.config.Executable, "worker", "--account", account, "--owner", request.UserID, "--generation", strconv.FormatInt(request.Generation, 10), "--epoch", strconv.FormatInt(scope.Epoch, 10), "--pairing", request.PairingID, "--expires", request.ExpiresAt.Format(time.RFC3339Nano), "--directory", s.config.Directory, "--socket", socket, "--kms-key", s.config.KMSKey)
	// Workers need AWS/telemetry context, not the control-plane database or TLS
	// secrets. They can access Macro only through their supervised Unix endpoint.
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if key != "APP_SECRETS_JSON" && key != "WHATSAPP_CONTROL_DATABASE_URL" && key != "WHATSAPP_TLS_KEY" && key != "WHATSAPP_TLS_CERT" && key != "WHATSAPP_CLIENT_CA" {
			c.cmd.Env = append(c.cmd.Env, entry)
		}
	}
	c.cmd.Stdout = os.Stdout
	c.cmd.Stderr = os.Stderr // protocol logging is disabled; only bounded app telemetry is emitted
	if err = c.cmd.Start(); err != nil {
		s.terminated(c)
		return scope, protocol.ErrUnavailable
	}
	// A successfully started successor supersedes retained same-generation
	// retirement proof. Its Wait path writes fresh proof under the account lock.
	_ = removeRetirement(filepath.Join(s.config.Directory, account, strconv.FormatInt(scope.Generation, 10)))
	s.mu.Lock()
	s.children[account] = c
	s.mu.Unlock()
	s.workers.Add(1)
	go func() {
		defer s.workers.Done()
		_ = c.cmd.Wait()
		guard := s.accountLock(account)
		guard.Lock()
		s.terminated(c)
		guard.Unlock()
		close(c.done)
		s.mu.Lock()
		if s.children[account] == c {
			delete(s.children, account)
		}
		s.mu.Unlock()
	}()
	go s.supervise(c)
	return scope, nil
}
func (s *Supervisor) terminated(c *child) {
	markerErr := s.markRetirement(c)
	if markerErr != nil {
		telemetry.Event(context.Background(), "session.retirement_marker_failed", c.scope.AccountID, c.worker, 1)
	}
	archiveErr := s.archiveOutcomes(c)
	if archiveErr != nil {
		telemetry.Event(context.Background(), "session.retired_store_pending", c.scope.AccountID, c.worker, 1)
	}
	// Without either durable retry proof or completed export, leave ownership
	// blocked for explicit operator recovery instead of losing live-store cleanup.
	if markerErr != nil && archiveErr != nil {
		return
	}
	telemetry.Event(context.Background(), "session.terminated", c.scope.AccountID, c.worker, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = s.pool.Exec(ctx, "UPDATE whatsapp_session_owner SET state='terminated',terminated_at=now() WHERE account_id=$1 AND worker_id=$2 AND epoch=$3", c.scope.AccountID, c.worker, c.scope.Epoch)
	// Failure deliberately leaves ownership blocked. The operator must establish
	// physical fencing before repairing that row after a database outage.
}
func (s *Supervisor) supervise(c *child) {
	tick := time.NewTicker(5 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-s.ctx.Done():
			s.stop(c)
			return
		case <-c.done:
			return
		case <-tick.C:
			ctx, cancel := context.WithTimeout(s.ctx, 3*time.Second)
			result, err := s.pool.Exec(ctx, `UPDATE whatsapp_session_owner o SET state='running',lease_until=now()+interval '20 seconds' FROM whatsapp_linked_account a WHERE o.account_id=$1 AND o.worker_id=$2 AND o.epoch=$3 AND o.state IN ('starting','running') AND a.id=o.account_id AND a.authorization_generation=$4 AND a.state<>'disconnected'`, c.scope.AccountID, c.worker, c.scope.Epoch, c.scope.Generation)
			cancel()
			if err != nil || result.RowsAffected() != 1 {
				s.stop(c)
				return
			}
		}
	}
}
func (s *Supervisor) stop(c *child) {
	// SIGKILL plus Wait is the actual fencing barrier, including a blocked or
	// stalled physical writer. No successor starts based only on a timeout.
	_ = c.cmd.Process.Kill()
	<-c.done
}
func (s *Supervisor) Stop(account string) error {
	s.mu.Lock()
	c := s.children[account]
	s.mu.Unlock()
	if c == nil {
		return protocol.ErrConflict
	}
	s.stop(c)
	return nil
}

// Close rejects new starts and waits through physical fencing and durable
// retirement before the caller closes PostgreSQL or exits the control process.
func (s *Supervisor) Close() {
	s.mu.Lock()
	s.closing = true
	s.cancel()
	s.mu.Unlock()
	s.workers.Wait()
}
func (s *Supervisor) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/accounts/{account}/outcomes/{generation}/{command}", func(out http.ResponseWriter, r *http.Request) {
		account := r.PathValue("account")
		if _, err := uuid.Parse(account); err != nil {
			http.Error(out, "invalid_request", 400)
			return
		}
		generation, err := strconv.ParseInt(r.PathValue("generation"), 10, 64)
		if err != nil || generation < 1 {
			http.Error(out, "invalid_request", 400)
			return
		}
		command := r.PathValue("command")
		if _, err = uuid.Parse(command); err != nil {
			http.Error(out, "invalid_request", 400)
			return
		}
		result, err := s.outcome(r.Context(), account, generation, command)
		if err != nil {
			http.Error(out, "outcome_unavailable", 503)
			return
		}
		out.Header().Set("Content-Type", "application/json")
		json.NewEncoder(out).Encode(result)
	})
	mux.HandleFunc("POST /v1/accounts/{account}/start", func(out http.ResponseWriter, r *http.Request) {
		var request Start
		decoder := json.NewDecoder(http.MaxBytesReader(out, r.Body, 65536))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&request) != nil {
			http.Error(out, "invalid_request", 400)
			return
		}
		scope, err := s.Start(r.Context(), r.PathValue("account"), request)
		if err != nil {
			http.Error(out, "ownership_unavailable", 409)
			return
		}
		out.Header().Set("Content-Type", "application/json")
		json.NewEncoder(out).Encode(scope)
	})
	mux.HandleFunc("POST /v1/accounts/{account}/stop", func(out http.ResponseWriter, r *http.Request) {
		account := r.PathValue("account")
		s.mu.Lock()
		c := s.children[account]
		s.mu.Unlock()
		generation, _ := strconv.ParseInt(r.Header.Get("X-Authorization-Generation"), 10, 64)
		epoch, _ := strconv.ParseInt(r.Header.Get("X-Owner-Epoch"), 10, 64)
		if c == nil || c.scope.Generation != generation || c.scope.Epoch != epoch {
			http.Error(out, "ownership_unavailable", 409)
			return
		}
		var body struct {
			Unlink bool `json:"unlink"`
		}
		if json.NewDecoder(http.MaxBytesReader(out, r.Body, 1024)).Decode(&body) != nil {
			http.Error(out, "invalid_request", 400)
			return
		}
		confirmed := false
		if body.Unlink {
			ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
			transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "unix", c.socket)
			}}
			client := &http.Client{Transport: transport}
			request, _ := http.NewRequestWithContext(ctx, http.MethodPost, "http://worker/logout", nil)
			response, err := client.Do(request)
			if err == nil {
				var result struct {
					Confirmed bool `json:"remoteUnlinkConfirmed"`
				}
				if json.NewDecoder(response.Body).Decode(&result) == nil {
					confirmed = result.Confirmed
				}
				response.Body.Close()
			}
			cancel()
			transport.CloseIdleConnections()
		}
		s.stop(c)
		out.Header().Set("Content-Type", "application/json")
		json.NewEncoder(out).Encode(map[string]bool{"remoteUnlinkConfirmed": confirmed})
	})
	mux.HandleFunc("/v1/accounts/{account}/{rest...}", func(out http.ResponseWriter, r *http.Request) {
		account := r.PathValue("account")
		s.mu.Lock()
		c := s.children[account]
		s.mu.Unlock()
		if c == nil {
			http.Error(out, "session_unavailable", 503)
			return
		}
		generation, err := strconv.ParseInt(r.Header.Get("X-Authorization-Generation"), 10, 64)
		if err != nil || generation != c.scope.Generation {
			http.Error(out, "stale_generation", 409)
			return
		}
		epoch, err := strconv.ParseInt(r.Header.Get("X-Owner-Epoch"), 10, 64)
		if err != nil || epoch != c.scope.Epoch {
			http.Error(out, "stale_epoch", 409)
			return
		}
		// Control-store loss fails each request closed, before it reaches a socket.
		var valid bool
		err = s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM whatsapp_session_owner o JOIN whatsapp_linked_account a ON a.id=o.account_id WHERE o.account_id=$1 AND o.epoch=$2 AND o.worker_id=$3 AND o.state='running' AND o.lease_until>now() AND a.authorization_generation=$4 AND a.state<>'disconnected')`, account, epoch, c.worker, generation).Scan(&valid)
		if err != nil || !valid {
			http.Error(out, "session_unavailable", 503)
			if err != nil {
				go s.stop(c)
			}
			return
		}
		target := &url.URL{Scheme: "http", Host: "worker"}
		proxy := httputil.NewSingleHostReverseProxy(target)
		transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, "unix", c.socket)
		}}
		proxy.Transport = otelhttp.NewTransport(transport)
		defer transport.CloseIdleConnections()
		proxy.ErrorHandler = func(out http.ResponseWriter, _ *http.Request, _ error) { http.Error(out, "session_unavailable", 503) }
		r.URL.Path = "/" + r.PathValue("rest")
		r.URL.RawPath = ""
		r.URL.RawQuery = ""
		proxy.ServeHTTP(out, r)
	})
	return http.HandlerFunc(func(out http.ResponseWriter, r *http.Request) {
		out.Header().Set("Cache-Control", "no-store")
		// Dedicated client CA: a valid leaf is the DSS service identity. No public
		// endpoint or user bearer token reaches this control surface.
		if r.TLS == nil || len(r.TLS.VerifiedChains) == 0 {
			http.Error(out, "service_authentication_required", 401)
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/v1/") {
			http.NotFound(out, r)
			return
		}
		mux.ServeHTTP(out, r)
	})
}
