# Registry-carried artifact bundle for a running preview machine. The image is
# never started: hot-update.sh creates a stopped container and copies /update
# out of it. Scratch keeps every layer limited to actual application artifacts,
# and stable COPY ordering maximizes registry/inner-Docker dedup across pushes.
FROM scratch

COPY bin/xtask /update/xtask
COPY preload/manifest.txt /update/manifest.txt
COPY deployment.json /update/deployment.json
COPY artifacts/frontend-dist/ /update/frontend-dist/
COPY artifacts/binaries/ /update/binaries/

CMD ["/update/xtask"]
