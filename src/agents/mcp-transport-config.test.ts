import { describe, expect, it } from "vitest";
import { resolveMcpTransportConfig } from "./mcp-transport-config.js";

describe("resolveMcpTransportConfig", () => {
  it("resolves stdio config with connection timeout", () => {
    const resolved = resolveMcpTransportConfig("probe", {
      command: "node",
      args: ["./server.mjs"],
      connectionTimeoutMs: 12_345,
      requestTimeoutMs: 180_000,
    });

    expect(resolved).toMatchObject({
      kind: "stdio",
      transportType: "stdio",
      command: "node",
      args: ["./server.mjs"],
      connectionTimeoutMs: 12_345,
      requestTimeoutMs: 180_000,
    });
  });

  it("resolves SSE config by default", () => {
    const resolved = resolveMcpTransportConfig("probe", {
      url: "https://mcp.example.com/sse",
      headers: {
        Authorization: "Bearer token",
        "X-Count": 42,
      },
    });

    expect(resolved).toEqual({
      kind: "http",
      transportType: "sse",
      url: "https://mcp.example.com/sse",
      headers: {
        Authorization: "Bearer token",
        "X-Count": "42",
      },
      description: "https://mcp.example.com/sse",
      connectionTimeoutMs: 30_000,
      requestTimeoutMs: undefined,
    });
  });

  it("resolves explicit streamable HTTP config", () => {
    const resolved = resolveMcpTransportConfig("probe", {
      url: "https://mcp.example.com/http",
      transport: "streamable-http",
      requestTimeoutMs: 120_000,
    });

    expect(resolved).toMatchObject({
      kind: "http",
      transportType: "streamable-http",
      url: "https://mcp.example.com/http",
      requestTimeoutMs: 120_000,
    });
  });

  it("ignores invalid request timeout values", () => {
    const resolved = resolveMcpTransportConfig("probe", {
      command: "node",
      requestTimeoutMs: -1,
    });

    expect(resolved).toMatchObject({
      kind: "stdio",
      requestTimeoutMs: undefined,
    });
  });
});
