import { describe, it, expect } from "vitest";
import { buildProductionRouteConfig } from "../src/productionRoute.js";

describe("buildProductionRouteConfig", () => {
  it("declares a Traefik router+service pointing at the given container", () => {
    const config = buildProductionRouteConfig({ containerName: "tugboat-production-app-123", port: 3000 });

    expect(config).toContain("Host(`production.127.0.0.1.nip.io`)");
    expect(config).toContain("service: production");
    expect(config).toContain('url: "http://tugboat-production-app-123:3000"');
  });

  it("is valid YAML-shaped output (no tabs, consistent indentation)", () => {
    const config = buildProductionRouteConfig({ containerName: "c", port: 8080 });
    expect(config).not.toMatch(/\t/);
  });
});
