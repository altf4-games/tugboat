#!/usr/bin/env bash
# Step-by-step runner for the two Traefik demos.
#   ./demo.sh 1    service discovery (Demo 1)
#   ./demo.sh 2    automatic HTTPS (Demo 2)
# Each step prints a one-line cue and the command, waits for Enter, then runs it.
# Short sleeps are built into the commands so Traefik has time to pick up each change.
# Set DEMO_AUTO=1 to run without pausing (used to test the script).

DIR="$(cd "$(dirname "$0")" && pwd)"
BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RESET=$'\033[0m'

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start OrbStack first (open -a OrbStack), then run this again."
  exit 1
fi

run_steps() {
  local comment="" line
  while IFS= read -r line; do
    case "$line" in
      "") ;;
      "# "*) comment="${line#\# }" ;;
      *)
        printf '\n%s# %s%s\n' "$DIM" "$comment" "$RESET"
        printf '%s$ %s%s' "$BOLD" "$line" "$RESET"
        if [ -z "$DEMO_AUTO" ]; then
          read -r _ </dev/tty
        else
          echo
          case "$line" in open\ *) echo "(skipped in auto mode)"; continue ;; esac
        fi
        eval "$line"
        ;;
    esac
  done
}

demo1() {
  cd "$DIR/discovery" || exit 1
  run_steps <<'STEPS'
# Start Traefik alone, with no apps
docker compose up -d && sleep 3
# Traefik knows only its own two routers
curl -s localhost:8081/api/http/routers | python3 -c "import sys,json; print([r['name'] for r in json.load(sys.stdin)])"
# An app hostname has no route yet, so 404
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: whoami.127.0.0.1.nip.io" localhost:8000/
# Start the first app. Traefik is not touched
docker compose --profile apps up -d whoami && sleep 3
# Same request: 200, with the header my middleware adds
curl -i -H "Host: whoami.127.0.0.1.nip.io" localhost:8000/
# A second app with its own hostname, no restart
docker compose --profile apps up -d hello && sleep 3
curl -s -H "Host: hello.127.0.0.1.nip.io" localhost:8000/ | head -3
# Scale the first app to three copies
docker compose --profile apps up -d --scale whoami=3 whoami && sleep 4
# Six requests rotate across all three containers
for i in 1 2 3 4 5 6; do curl -s -H "Host: whoami.127.0.0.1.nip.io" localhost:8000/ | grep Hostname; done
# The same in the dashboard
open http://localhost:8081/dashboard/#/http/services
# Stop an app: its route disappears
docker compose --profile apps stop hello && sleep 3
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: hello.127.0.0.1.nip.io" localhost:8000/
# Clean up
docker compose --profile apps down
STEPS
  printf '\n%sDemo 1 done.%s\n' "$GREEN" "$RESET"
}

demo2() {
  cd "$DIR/https" || exit 1
  run_steps <<'STEPS'
# Start Pebble (a Let's Encrypt test server), its challenge server, and Traefik
docker compose up -d && sleep 6
# Start an app whose router asks for a certificate
docker compose --profile apps up -d secure && sleep 10
# Traefik's log shows the whole ACME exchange
docker compose logs traefik | sed 's/\x1b\[[0-9;]*m//g' | grep -i "register\|obtaining\|validations\|server responded" | cut -c1-150
# Fetch Pebble's root certificate to use as the only trusted root
curl -sk https://localhost:15000/roots/0 > pebble-root.pem
# Request the app over HTTPS, trusting only that root
curl --cacert pebble-root.pem --resolve secure.demo.test:8443:127.0.0.1 https://secure.demo.test:8443/ | head -4
# Who issued the certificate, and for how long
echo | openssl s_client -connect 127.0.0.1:8443 -servername secure.demo.test -CAfile pebble-root.pem 2>/dev/null | openssl x509 -noout -issuer -dates
# The chain verifies
echo | openssl s_client -connect 127.0.0.1:8443 -servername secure.demo.test -CAfile pebble-root.pem 2>/dev/null | grep "Verify return code"
# Without the root, verification fails, as it should
curl --resolve secure.demo.test:8443:127.0.0.1 https://secure.demo.test:8443/
# The certificate in the dashboard
open http://localhost:8082/dashboard/#/certificates
# Clean up
docker compose --profile apps down -v && rm -f pebble-root.pem
STEPS
  printf '\n%sDemo 2 done.%s\n' "$GREEN" "$RESET"
}

case "$1" in
  1) demo1 ;;
  2) demo2 ;;
  *) echo "Usage: ./demo.sh 1   (service discovery)    ./demo.sh 2   (automatic HTTPS)"; exit 1 ;;
esac
