#!/usr/bin/env python3
"""Split target/ and the cargo registry into N file lists of similar size, for parallel transfer."""
import heapq, os, stat, sys

shards = int(sys.argv[1])
outdir = sys.argv[2]
workspace = os.environ["GITHUB_WORKSPACE"].lstrip("/")
home = os.path.expanduser("~").lstrip("/")


def size(path):
    total = 0
    for root, _, files in os.walk(path):
        for name in files:
            full = os.path.join(root, name)
            total += os.lstat(full).st_size
    return total


items = []


def add(path):
    full = "/" + path
    info = os.lstat(full)
    items.append((size(full) if stat.S_ISDIR(info.st_mode) else info.st_size, path))


def children(path):
    full = "/" + path
    return [f"{path}/{name}" for name in os.listdir(full)] if os.path.isdir(full) else []


debug = f"{workspace}/target/debug"
for group in ("incremental", "build", ".fingerprint"):
    for path in children(f"{debug}/{group}"):
        add(path)
for path in children(f"{debug}/deps"):
    full = "/" + path
    executable = os.access(full, os.X_OK) and not path.endswith(".so")
    if not executable:
        add(path)
for path in children(f"{workspace}/target"):
    if os.path.isfile("/" + path):
        add(path)
for path in children(debug):
    name = os.path.basename(path)
    if os.path.isfile("/" + path) and name.startswith("."):
        add(path)
for root in ("registry/src", "registry/cache"):
    for host in children(f"{home}/.cargo/{root}"):
        for path in children(host):
            add(path)
if os.path.isdir(f"/{home}/.cargo/registry/index"):
    add(f"{home}/.cargo/registry/index")
if os.path.isdir(f"/{home}/.cargo/git"):
    add(f"{home}/.cargo/git")

heap = [(0, i, []) for i in range(shards)]
heapq.heapify(heap)
for item_size, path in sorted(items, reverse=True):
    total, index, paths = heapq.heappop(heap)
    paths.append(path)
    heapq.heappush(heap, (total + item_size, index, paths))
for total, index, paths in heap:
    with open(f"{outdir}/shard{index}.list", "w") as out:
        out.write("\n".join(paths) + "\n")
    print(f"shard {index}: {total / 2**30:.2f} GB, {len(paths)} items")
print(f"total {sum(h[0] for h in heap) / 2**30:.1f} GB, {len(items)} items")
