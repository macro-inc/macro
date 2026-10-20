package supervisor

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"macro.com/whatsapp-session/internal/journal"
	"macro.com/whatsapp-session/internal/protocol"
	"macro.com/whatsapp-session/internal/secrets"
)

func (s *Supervisor) retainOutcome(ctx context.Context, account string, generation int64, r protocol.Result) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO whatsapp_transport_outcome(account_id,authorization_generation,command_id,source_id,state)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,authorization_generation,command_id)
      DO UPDATE SET state=CASE WHEN whatsapp_transport_outcome.state='accepted' THEN 'accepted' ELSE excluded.state END
      WHERE whatsapp_transport_outcome.source_id=excluded.source_id`, account, generation, r.CommandID, r.SourceID, r.State)
	return err
}
func (s *Supervisor) outcome(ctx context.Context, account string, generation int64, command string) (protocol.Result, error) {
	result := protocol.Result{CommandID: command}
	err := s.pool.QueryRow(ctx, "SELECT source_id,state FROM whatsapp_transport_outcome WHERE account_id=$1 AND authorization_generation=$2 AND command_id=$3", account, generation, command).Scan(&result.SourceID, &result.State)
	if err == nil && result.State == "accepted" {
		return result, nil
	}
	s.mu.Lock()
	c := s.children[account]
	s.mu.Unlock()
	if c == nil || c.scope.Generation != generation {
		lock := s.accountLock(account)
		lock.Lock()
		defer lock.Unlock()
		if retryErr := s.retryRetirements(ctx, account); retryErr != nil {
			return result, retryErr
		}
		err = s.pool.QueryRow(ctx, "SELECT source_id,state FROM whatsapp_transport_outcome WHERE account_id=$1 AND authorization_generation=$2 AND command_id=$3", account, generation, command).Scan(&result.SourceID, &result.State)
		return result, err
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, "unix", c.socket)
	}}
	defer transport.CloseIdleConnections()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://worker/commands/"+command, nil)
	if err != nil {
		return result, err
	}
	response, err := (&http.Client{Transport: transport, Timeout: 5 * time.Second}).Do(request)
	if err != nil {
		return result, err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return result, protocol.ErrUnavailable
	}
	if err = json.NewDecoder(response.Body).Decode(&result); err != nil {
		return result, err
	}
	if result.CommandID != command {
		return result, protocol.ErrConflict
	}
	return result, s.retainOutcome(ctx, account, generation, result)
}

// This is called only after Wait proves the process and all its physical writers
// are gone. Failure preserves an encrypted quarantine; it never starts a sender.
func (s *Supervisor) archiveOutcomes(c *child) error {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	var owner, state string
	var generation int64
	if err := s.pool.QueryRow(ctx, "SELECT user_id,state,authorization_generation FROM whatsapp_linked_account WHERE id=$1", c.scope.AccountID).Scan(&owner, &state, &generation); err != nil {
		return err
	}
	dir := filepath.Join(s.config.Directory, c.scope.AccountID, strconv.FormatInt(c.scope.Generation, 10))
	if _, err := os.Stat(filepath.Join(dir, "store-key.kms")); err != nil {
		if os.IsNotExist(err) {
			return removeRetirement(dir)
		}
		return err
	}
	key, err := secrets.Load(ctx, s.config.Keys, s.config.KMSKey, dir, c.scope.AccountID, owner)
	if err != nil {
		return err
	}
	store, err := journal.OpenReadOnly(ctx, filepath.Join(dir, "protocol.db"), key.Bytes())
	key.Close()
	if err != nil {
		return err
	}
	after := ""
	for {
		results, err := store.Outcomes(ctx, after)
		if err != nil {
			store.DB.Close()
			return err
		}
		for _, result := range results {
			if result.State == "dispatching" {
				result.State = "unknown"
			}
			if err = s.retainOutcome(ctx, c.scope.AccountID, c.scope.Generation, result); err != nil {
				store.DB.Close()
				return err
			}
			after = result.CommandID
		}
		if len(results) < 128 {
			break
		}
	}
	store.DB.Close()
	if state == "disconnected" || state == "reconnect" || generation > c.scope.Generation {
		// Only these fixed per-generation live files are erased. Backup retention
		// is an operator policy, not an instantaneous remote-erasure claim.
		for _, name := range []string{"protocol.db-wal", "protocol.db-shm", "protocol.db", "store-key.kms"} {
			if err = os.Remove(filepath.Join(dir, name)); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
		return removeRetirement(dir)
	}
	// Retain proof while consent is still active: it also lets a later offline
	// disconnect/expiry purge keys when no child remains to receive Stop.
	return nil
}

// A marker is written only after process Wait. It contains no credentials or
// content and survives PostgreSQL/KMS outages and control-service restarts.
func (s *Supervisor) markRetirement(c *child) error {
	dir := filepath.Join(s.config.Directory, c.scope.AccountID, strconv.FormatInt(c.scope.Generation, 10))
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	data, err := json.Marshal(c.scope)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(dir, "retirement.json"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}
func removeRetirement(dir string) error {
	err := os.Remove(filepath.Join(dir, "retirement.json"))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}
func (s *Supervisor) retryRetirements(ctx context.Context, account string) error {
	if _, err := uuid.Parse(account); err != nil {
		return protocol.ErrInvalid
	}
	files, err := filepath.Glob(filepath.Join(s.config.Directory, account, "*", "retirement.json"))
	if err != nil {
		return err
	}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		var scope protocol.Scope
		if json.Unmarshal(data, &scope) != nil || scope.AccountID != account || scope.Generation < 1 {
			return protocol.ErrInvalid
		}
		// A marker alone is insufficient to override a live durable owner. A later
		// epoch proves that a previous owner was explicitly marked terminated.
		var safe bool
		err = s.pool.QueryRow(ctx, "SELECT o.state='terminated' OR (o.epoch>$2 AND a.authorization_generation>$3) FROM whatsapp_session_owner o JOIN whatsapp_linked_account a ON a.id=o.account_id WHERE o.account_id=$1", account, scope.Epoch, scope.Generation).Scan(&safe)
		if err != nil {
			return err
		}
		if !safe {
			return errors.New("retirement_fencing_pending")
		}
		if err = s.archiveOutcomes(&child{scope: scope}); err != nil {
			return err
		}
	}
	return nil
}
