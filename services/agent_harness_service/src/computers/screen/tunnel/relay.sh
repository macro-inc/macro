# The left side owns the pid printed in the marker, keeps stdin as the RFB
# input, and sends only stderr through the classifier. Its stdout is the
# unmodified RFB stream. The outer shell combines the two exit statuses.
export LC_ALL=C
exec 3>&1
{
    printf 'macro-screen-tunnel-ready %s\n' "$BASHPID" >&3 || exit
    exec socat -t 1 STDIO "TCP:127.0.0.1:$1,nodelay" 2>&1 >&3 3>&-
} | {
    refused=0
    while IFS= read -r line; do
        case "$line" in
            *" E TCP:127.0.0.1:$1: Connection refused"|*" E connect("*"127.0.0.1:$1"*"Connection refused") refused=1 ;;
        esac
    done
    exit "$refused"
}
status=("${PIPESTATUS[@]}")
# Reserve 111 for a classified refusal. Preserve helper-not-found (127)
# and all other socat exit statuses.
if [[ ${status[0]} == 1 && ${status[1]} == 1 ]]; then exit 111; fi
if [[ ${status[0]} == 111 ]]; then exit 1; fi
exit "${status[0]}"
