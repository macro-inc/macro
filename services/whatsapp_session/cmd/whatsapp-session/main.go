// whatsapp-session is the control service and its independently supervised worker.
package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"flag"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/kms"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"macro.com/whatsapp-session/internal/journal"
	"macro.com/whatsapp-session/internal/protocol"
	"macro.com/whatsapp-session/internal/secrets"
	"macro.com/whatsapp-session/internal/supervisor"
	"macro.com/whatsapp-session/internal/telemetry"
	"macro.com/whatsapp-session/internal/worker"
)

func main() {
	if err := run(); err != nil {
		_, _ = os.Stderr.WriteString("whatsapp-session startup or shutdown failed\n")
		os.Exit(1)
	}
}
func run() error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	shutdown, err := telemetry.Init(ctx)
	if err != nil {
		return err
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = shutdown(ctx)
	}()
	if len(os.Args) > 1 && os.Args[1] == "worker" {
		return runWorker(ctx)
	}
	values := map[string]string{}
	if data, ok := os.LookupEnv("APP_SECRETS_JSON"); ok {
		if json.Unmarshal([]byte(data), &values) != nil {
			return errors.New("invalid_config")
		}
	} else {
		for _, name := range []string{"WHATSAPP_CONTROL_DATABASE_URL", "WHATSAPP_KMS_KEY", "WHATSAPP_SESSION_DIRECTORY", "WHATSAPP_TLS_CERT", "WHATSAPP_TLS_KEY", "WHATSAPP_CLIENT_CA", "WHATSAPP_LISTEN"} {
			values[name] = os.Getenv(name)
		}
	}
	for _, name := range []string{"WHATSAPP_CONTROL_DATABASE_URL", "WHATSAPP_KMS_KEY", "WHATSAPP_SESSION_DIRECTORY", "WHATSAPP_TLS_CERT", "WHATSAPP_TLS_KEY", "WHATSAPP_CLIENT_CA", "WHATSAPP_LISTEN"} {
		if values[name] == "" {
			return errors.New("configuration_required")
		}
	}
	pool, err := pgxpool.New(ctx, values["WHATSAPP_CONTROL_DATABASE_URL"])
	if err != nil {
		return err
	}
	defer pool.Close()
	if err = pool.Ping(ctx); err != nil {
		return err
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	if err = os.MkdirAll(values["WHATSAPP_SESSION_DIRECTORY"], 0700); err != nil {
		return err
	}
	awsConfig, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return err
	}
	control := supervisor.New(ctx, pool, supervisor.Config{Executable: executable, Directory: values["WHATSAPP_SESSION_DIRECTORY"], KMSKey: values["WHATSAPP_KMS_KEY"], Keys: kms.NewFromConfig(awsConfig)})
	defer control.Close()
	ca, err := os.ReadFile(values["WHATSAPP_CLIENT_CA"])
	if err != nil {
		return err
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(ca) {
		return errors.New("invalid_ca")
	}
	server := &http.Server{Addr: values["WHATSAPP_LISTEN"], Handler: otelhttp.NewHandler(control.Handler(), "whatsapp.control"), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 60 * time.Second, WriteTimeout: 70 * time.Second, MaxHeaderBytes: 8192, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS13, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: roots}}
	go func() {
		<-ctx.Done()
		shutdown, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_ = server.Shutdown(shutdown)
	}()
	err = server.ListenAndServeTLS(values["WHATSAPP_TLS_CERT"], values["WHATSAPP_TLS_KEY"])
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
func runWorker(ctx context.Context) error {
	flags := flag.NewFlagSet("worker", flag.ContinueOnError)
	var account, owner, pairing, expires, directory, socket, kmsKey string
	var generation, epoch int64
	flags.StringVar(&account, "account", "", "")
	flags.StringVar(&owner, "owner", "", "")
	flags.StringVar(&pairing, "pairing", "", "")
	flags.StringVar(&expires, "expires", "", "")
	flags.StringVar(&directory, "directory", "", "")
	flags.StringVar(&socket, "socket", "", "")
	flags.StringVar(&kmsKey, "kms-key", "", "")
	flags.Int64Var(&generation, "generation", 0, "")
	flags.Int64Var(&epoch, "epoch", 0, "")
	if err := flags.Parse(os.Args[2:]); err != nil {
		return err
	}
	end, err := time.Parse(time.RFC3339Nano, expires)
	if err != nil {
		return err
	}
	awsConfig, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return err
	}
	path := filepath.Join(directory, account, strconv.FormatInt(generation, 10))
	key, err := secrets.Load(ctx, kms.NewFromConfig(awsConfig), kmsKey, path, account, owner)
	if err != nil {
		return err
	}
	store, err := journal.Open(ctx, filepath.Join(path, "protocol.db"), key.Bytes())
	key.Close()
	if err != nil {
		return err
	}
	defer store.DB.Close()
	session, err := worker.New(ctx, store, protocol.Scope{AccountID: account, Generation: generation, Epoch: epoch}, pairing, end)
	if err != nil {
		return err
	}
	defer session.Close()
	listener, err := net.Listen("unix", socket)
	if err != nil {
		return err
	}
	defer listener.Close()
	if err = os.Chmod(socket, 0600); err != nil {
		return err
	}
	server := &http.Server{Handler: otelhttp.NewHandler(session.Handler(), "whatsapp.worker"), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 60 * time.Second, WriteTimeout: 65 * time.Second, MaxHeaderBytes: 8192}
	go func() {
		select {
		case <-ctx.Done():
		case <-session.Done():
		}
		_ = server.Close()
	}()
	go func() {
		if session.Start() != nil {
			_ = server.Close()
		}
	}()
	err = server.Serve(listener)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
