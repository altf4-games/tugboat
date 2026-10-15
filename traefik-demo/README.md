# Traefik demo

Two small Docker Compose stacks that show what Traefik does on its own, without Tugboat. They back the DevOps Theory IA case study on Traefik. Both stacks use only Docker and public images. Nothing is mocked.

## 1. Service discovery (`discovery/`)

Traefik reads routing rules from container labels through the Docker socket. Nothing lists the apps in a config file.

```bash
cd traefik-demo/discovery
docker compose up -d                          # Traefik only. Dashboard: http://localhost:8081/dashboard/
docker compose --profile apps up -d whoami    # a route appears, Traefik is not restarted
curl -i -H "Host: whoami.127.0.0.1.nip.io" localhost:8000/
docker compose --profile apps up -d hello     # a second app, a second route
docker compose --profile apps up -d --scale whoami=3 whoami   # three servers behind one router
docker compose --profile apps stop hello      # the route disappears (404)
docker compose --profile apps down
```

In a browser, `http://whoami.127.0.0.1.nip.io:8000` works too, because nip.io resolves the name to `127.0.0.1`.

## 2. Automatic HTTPS (`https/`)

Traefik asks an ACME server for a certificate when a labeled container starts. The ACME server here is Pebble, Let's Encrypt's own test server, so the whole flow runs for real on a laptop: account registration, HTTP-01 challenge, issuance and storage.

```bash
cd traefik-demo/https
docker compose up -d
docker compose --profile apps up -d secure
docker compose logs traefik | grep -i "obtaining\|validations\|certificate"

curl -sk https://localhost:15000/roots/0 > pebble-root.pem
curl --cacert pebble-root.pem --resolve secure.demo.test:8443:127.0.0.1 https://secure.demo.test:8443/
echo | openssl s_client -connect 127.0.0.1:8443 -servername secure.demo.test -CAfile pebble-root.pem 2>/dev/null | openssl x509 -noout -issuer -dates
docker compose --profile apps down -v
```

The same request without `--cacert` fails verification, because the Pebble root is not in any trust store. The dashboard for this stack is at `http://localhost:8082/dashboard/`.

`pebble/pebble.minica.pem` is Pebble's public test CA, copied out of its image. Traefik trusts it only for its connection to the ACME directory.
