import { beforeAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import { createTestPluginApi } from "../../../test/helpers/plugins/plugin-api.js";
import type { OpenClawPluginApi, PluginRuntime } from "../runtime-api.js";
import { createToolFactoryHarness } from "./tool-factory-test-harness.js";

const downloadImageFeishuMock = vi.hoisted(() => vi.fn());
const downloadMessageResourceFeishuMock = vi.hoisted(() => vi.fn());
const detectMimeMock = vi.hoisted(() => vi.fn());
const saveMediaBufferMock = vi.hoisted(() => vi.fn());

vi.mock("./media.js", () => ({
  downloadImageFeishu: downloadImageFeishuMock,
  downloadMessageResourceFeishu: downloadMessageResourceFeishuMock,
}));

vi.mock("./runtime.js", () => ({
  getFeishuRuntime: () => ({
    media: { detectMime: detectMimeMock },
    channel: { media: { saveMediaBuffer: saveMediaBufferMock } },
  }),
}));

let registerFeishuMediaTools: typeof import("./media-tool.js").registerFeishuMediaTools;

function createFeishuToolRuntime(): PluginRuntime {
  return {} as PluginRuntime;
}

function createMediaToolApi(params: {
  config: OpenClawPluginApi["config"];
  registerTool: OpenClawPluginApi["registerTool"];
}): OpenClawPluginApi {
  return createTestPluginApi({
    id: "feishu-test",
    name: "Feishu Test",
    source: "local",
    config: params.config,
    runtime: createFeishuToolRuntime(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerTool: params.registerTool,
  });
}

function createConfig(params?: {
  mediaEnabled?: boolean;
  mediaEnabledB?: boolean;
  defaultAccount?: string;
}) {
  return {
    channels: {
      feishu: {
        enabled: true,
        defaultAccount: params?.defaultAccount,
        accounts: {
          a: {
            appId: "app-a",
            appSecret: "sec-a", // pragma: allowlist secret
            tools: { media: params?.mediaEnabled ?? true },
          },
          b: {
            appId: "app-b",
            appSecret: "sec-b", // pragma: allowlist secret
            tools: { media: params?.mediaEnabledB ?? params?.mediaEnabled ?? true },
          },
        },
      },
    },
  } as OpenClawPluginApi["config"];
}

describe("registerFeishuMediaTools", () => {
  beforeAll(async () => {
    ({ registerFeishuMediaTools } = await import("./media-tool.js"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    detectMimeMock.mockResolvedValue("image/png");
    saveMediaBufferMock.mockResolvedValue({
      path: "/tmp/openclaw-feishu-image.png",
      contentType: "image/png",
      fileName: "openclaw-feishu-image.png",
    });
  });

  it("registers feishu_media and downloads direct image keys to local files", async () => {
    const registerTool = vi.fn();
    registerFeishuMediaTools(
      createMediaToolApi({
        config: createConfig(),
        registerTool,
      }),
    );

    expect(registerTool).toHaveBeenCalledTimes(1);
    const toolFactory = registerTool.mock.calls[0]?.[0];
    const tool =
      typeof toolFactory === "function" ? toolFactory({ agentAccountId: "a" }) : toolFactory;
    expect(tool?.name).toBe("feishu_media");

    downloadImageFeishuMock.mockResolvedValueOnce({
      buffer: Buffer.from("image-bytes"),
      contentType: "image/png",
    });

    const result = await tool.execute("tc_1", { action: "download", image_key: "img_key_1" });
    expect(downloadImageFeishuMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: expect.any(Object),
        imageKey: "img_key_1",
        accountId: "a",
      }),
    );
    expect(saveMediaBufferMock).toHaveBeenCalledWith(
      Buffer.from("image-bytes"),
      "image/png",
      "inbound",
      30 * 1024 * 1024,
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        status: "ok",
        mode: "image",
        image_key: "img_key_1",
        file_path: "/tmp/openclaw-feishu-image.png",
        mime_type: "image/png",
      }),
    );
  });

  it("downloads message-scoped resources to local files", async () => {
    const registerTool = vi.fn();
    registerFeishuMediaTools(
      createMediaToolApi({
        config: createConfig(),
        registerTool,
      }),
    );

    const toolFactory = registerTool.mock.calls[0]?.[0];
    const tool =
      typeof toolFactory === "function" ? toolFactory({ agentAccountId: "a" }) : toolFactory;

    downloadMessageResourceFeishuMock.mockResolvedValueOnce({
      buffer: Buffer.from("message-image-bytes"),
      contentType: "image/jpeg",
      fileName: "from-message.jpg",
    });

    const result = await tool.execute("tc_2", {
      action: "download",
      message_id: "om_msg_1",
      image_key: "img_key_2",
    });
    expect(downloadMessageResourceFeishuMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: expect.any(Object),
        messageId: "om_msg_1",
        fileKey: "img_key_2",
        type: "image",
        accountId: "a",
      }),
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        status: "ok",
        mode: "message_resource",
        message_id: "om_msg_1",
        image_key: "img_key_2",
        file_path: "/tmp/openclaw-feishu-image.png",
        mime_type: "image/png",
      }),
    );
  });

  it("skips registration when media tool is disabled", () => {
    const registerTool = vi.fn();
    registerFeishuMediaTools(
      createMediaToolApi({
        config: createConfig({ mediaEnabled: false, mediaEnabledB: false }),
        registerTool,
      }),
    );
    expect(registerTool).not.toHaveBeenCalled();
  });

  test("routes media downloads to the active Feishu account context", async () => {
    const { api, resolveTool } = createToolFactoryHarness(createConfig());
    registerFeishuMediaTools(api);

    downloadImageFeishuMock.mockResolvedValueOnce({
      buffer: Buffer.from("image-bytes"),
      contentType: "image/png",
    });

    const tool = resolveTool("feishu_media", { agentAccountId: "b" });
    await tool.execute("call", { action: "download", image_key: "img_key_ctx" });

    expect(downloadImageFeishuMock).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "b" }),
    );
  });
});
