#!/usr/bin/env bash
# Same script on a Namespace runner and on the devbox. Needs cargo (rustup toolchain from rust-toolchain.toml), docker, openssl, python3.
# Prints one `RESULT key value` line per measurement.
set -uo pipefail
ROOT=${PROBE_DIR:-/tmp/ci-hw-probe}; mkdir -p "$ROOT"
r() { echo "RESULT $1 $2"; }
secs() { python3 -c "import time,sys; print(round(time.time()-float(sys.argv[1]),2))" "$1"; }
now() { python3 -c 'import time; print(time.time())'; }
lscpu | grep -E 'Model name|^CPU\(s\)|Thread|MHz' ; free -g | sed -n 2p; df -h / /tmp 2>/dev/null; uptime
r cpu_model "$(lscpu | sed -n 's/Model name: *//p' | tr ' ' _)"
r ncpu "$(nproc)"
# Single-thread CPU
r sha256_8k_kBps "$(openssl speed -seconds 3 sha256 2>/dev/null | awk '/^sha256/{print $(NF-1)}' | sed 's/k$//')"
s=$(now); python3 -c "
x=0
for i in range(40000000): x+=i*i%7
"; r python_loop_s "$(secs "$s")"
# Memory bandwidth, single thread
r mem_copy_MBps "$(python3 -c "
import time
b=bytearray(1<<30); t=time.time()
for _ in range(8): c=bytes(b)
print(round(8*1024/(time.time()-t)))")"
# Real single-core compile: fixed crate set, one job, clean target, no wrapper.
unset RUSTC_WRAPPER SCCACHE_WEBDAV_ENDPOINT
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 RUSTFLAGS=
for jobs in 1 "$(nproc)"; do
  rm -rf "$ROOT/t"
  cargo fetch --locked >/dev/null 2>&1
  s=$(now); CARGO_TARGET_DIR="$ROOT/t" cargo build --locked -q -j "$jobs" -p xtask_nextest_filter >"$ROOT/b.log" 2>&1; rc=$?
  r "cargo_build_j${jobs}_s" "$(secs "$s")"; r "cargo_build_j${jobs}_rc" "$rc"
done
du -sh "$ROOT/t" | cut -f1 | sed 's/^/target size /'; rm -rf "$ROOT/t"
# Filesystem: small files, like target/ and CREATE DATABASE
py='
import os,sys,time,shutil
d=sys.argv[1]; os.makedirs(d,exist_ok=True); t=time.time()
for i in range(20000):
    with open(f"{d}/{i}","wb") as f: f.write(b"x"*8192)
c=time.time()-t; t=time.time()
for i in range(20000):
    with open(f"{d}/{i}","rb") as f: f.read()
r=time.time()-t; t=time.time()
shutil.rmtree(d); u=time.time()-t
print(round(20000/c),round(20000/r),round(20000/u))
'
read -r a b c < <(python3 -c "$py" "$ROOT/small"); r fs_workdir_create_per_s "$a"; r fs_workdir_read_per_s "$b"; r fs_workdir_rm_per_s "$c"
mkdir -p "$ROOT/shm"; read -r a b c < <(python3 -c "$py" /dev/shm/ci-hw-probe-small); r fs_shm_create_per_s "$a"; r fs_shm_read_per_s "$b"; r fs_shm_rm_per_s "$c"
s=$(now); dd if=/dev/zero of="$ROOT/big" bs=1M count=4096 conv=fsync status=none; r seq_write_4g_fsync_s "$(secs "$s")"
s=$(now); dd if="$ROOT/big" of=/dev/null bs=1M status=none; r seq_read_4g_cached_s "$(secs "$s")"; rm -f "$ROOT/big"
# Postgres: create + drop database from a migrated template, CI's settings, disk then tmpfs.
pg() { local name=$1; shift
  docker rm -f "$name" >/dev/null 2>&1
  docker run -d --name "$name" -e POSTGRES_USER=user -e POSTGRES_PASSWORD=password -e POSTGRES_DB=macrodb --shm-size 1g "$@" pgvector/pgvector:pg14 >/dev/null
  until docker exec "$name" psql -U user -d macrodb -Atc 'select 1' >/dev/null 2>&1; do sleep 0.5; done
  docker exec -i "$name" psql -q -U user -d macrodb <<'SQL'
ALTER SYSTEM SET fsync = off;
ALTER SYSTEM SET synchronous_commit = off;
ALTER SYSTEM SET full_page_writes = off;
ALTER SYSTEM SET max_wal_size = '4GB';
ALTER SYSTEM SET checkpoint_timeout = '30min';
ALTER SYSTEM SET max_locks_per_transaction = 8192;
SQL
  docker restart "$name" >/dev/null; sleep 1
  until docker exec "$name" psql -U user -d macrodb -Atc 'select 1' >/dev/null 2>&1; do sleep 0.5; done
  for f in crates/macro_db_client/migrations/*.sql; do cat "$f"; echo ';'; done | docker exec -i "$name" psql -q -U user -d template1 >/dev/null 2>&1
  docker exec "$name" psql -U user -d macrodb -Atc "select count(*) from pg_class" -c "select pg_size_pretty(pg_database_size('template1'))"
}
bench() { local name=$1 w=$2 n=$3 label=$4
  docker exec -i -e W=$w -e R=$n "$name" bash -s <<'IN' | sed "s/^/RESULT pg_${label}_w${w} /"
export PGUSER=user PGDATABASE=macrodb
worker() { for n in $(seq 1 $R); do a=$(date +%s%N); psql -qAtc "create database b_$1_$n"; b=$(date +%s%N); psql -qAtc "drop database b_$1_$n"; d=$(date +%s%N); echo "$(( (b-a)/1000000 )) $(( (d-b)/1000000 ))"; done; }
s=$(date +%s%N); for i in $(seq 1 $W); do worker $i > /tmp/w$i.out & done; wait; e=$(date +%s%N)
cat /tmp/w*.out > /tmp/all.out; n=$(wc -l < /tmp/all.out)
c=$(cut -d' ' -f1 /tmp/all.out | sort -n | sed -n "$((n/2))p"); d=$(cut -d' ' -f2 /tmp/all.out | sort -n | sed -n "$((n/2))p")
echo "pairs_per_s=$(( n*1000000000/(e-s) )) create_p50_ms=$c drop_p50_ms=$d"
rm -f /tmp/w*.out /tmp/all.out
IN
}
pg probe-disk; for w in 1 32; do bench probe-disk $w 10 disk; done; docker rm -f probe-disk >/dev/null
pg probe-tmpfs --tmpfs /var/lib/postgresql/data:size=8g,uid=999,gid=999; for w in 1 32; do bench probe-tmpfs $w 10 tmpfs; done; docker rm -f probe-tmpfs >/dev/null
