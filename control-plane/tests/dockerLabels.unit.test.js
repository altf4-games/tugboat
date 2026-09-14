import { describe, it, expect } from "vitest";
import { routerNameFor, hostnameFor, traefikLabelsFor } from "../src/dockerLabels.js";

describe("routerNameFor", () => {
  it("combines repo and branch into a sanitized router name", () => {
    expect(routerNameFor({ repo: "altf4-games/tugboat", branch: "feature/x" })).toBe(
      "altf4-games-tugboat-feature-x",
    );
  });
});

describe("hostnameFor", () => {
  it("builds a branch.127.0.0.1.nip.io hostname", () => {
    expect(hostnameFor({ branch: "my-feature" })).toBe("my-feature.127.0.0.1.nip.io");
  });

  it("sanitizes slashes and other unsafe characters out of the branch name", () => {
    expect(hostnameFor({ branch: "feature/cool_thing" })).toBe(
      "feature-cool-thing.127.0.0.1.nip.io",
    );
  });
});

describe("traefikLabelsFor", () => {
  it("produces the Docker labels Traefik needs to auto-route the container", () => {
    const labels = traefikLabelsFor({
      repo: "altf4-games/tugboat",
      branch: "my-feature",
      port: 3000,
    });

    expect(labels).toEqual({
      "traefik.enable": "true",
      "traefik.http.routers.altf4-games-tugboat-my-feature.rule":
        "Host(`my-feature.127.0.0.1.nip.io`)",
      "traefik.http.services.altf4-games-tugboat-my-feature.loadbalancer.server.port": "3000",
    });
  });
});
