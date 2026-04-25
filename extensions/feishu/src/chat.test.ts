import { createTestPluginApi } from "openclaw/plugin-sdk/plugin-test-api";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi, PluginRuntime } from "../runtime-api.js";

const createFeishuClientMock = vi.hoisted(() => vi.fn());
const chatCreateMock = vi.hoisted(() => vi.fn());
const chatUpdateMock = vi.hoisted(() => vi.fn());
const chatDeleteMock = vi.hoisted(() => vi.fn());
const chatGetMock = vi.hoisted(() => vi.fn());
const chatListMock = vi.hoisted(() => vi.fn());
const chatMembersGetMock = vi.hoisted(() => vi.fn());
const chatMembersCreateMock = vi.hoisted(() => vi.fn());
const chatMembersDeleteMock = vi.hoisted(() => vi.fn());
const contactUserGetMock = vi.hoisted(() => vi.fn());

vi.mock("./client.js", () => ({
  createFeishuClient: createFeishuClientMock,
}));

let registerFeishuChatTools: typeof import("./chat.js").registerFeishuChatTools;

function createFeishuToolRuntime(): PluginRuntime {
  return {} as PluginRuntime;
}

describe("registerFeishuChatTools", () => {
  function createChatToolApi(params: {
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

  beforeAll(async () => {
    ({ registerFeishuChatTools } = await import("./chat.js"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    createFeishuClientMock.mockReturnValue({
      im: {
        chat: {
          create: chatCreateMock,
          update: chatUpdateMock,
          delete: chatDeleteMock,
          get: chatGetMock,
          list: chatListMock,
        },
        chatMembers: {
          get: chatMembersGetMock,
          create: chatMembersCreateMock,
          delete: chatMembersDeleteMock,
        },
      },
      contact: {
        user: { get: contactUserGetMock },
      },
    });
  });

  it("registers feishu_chat and handles migrated actions", async () => {
    const registerTool = vi.fn();
    registerFeishuChatTools(
      createChatToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret", // pragma: allowlist secret
              tools: { chat: true },
            },
          },
        },
        registerTool,
      }),
    );

    expect(registerTool).toHaveBeenCalledTimes(1);
    const toolFactory = registerTool.mock.calls[0]?.[0];
    expect(typeof toolFactory).toBe("function");
    const tool = toolFactory({ requesterSenderId: "ou_requester" });
    expect(tool?.name).toBe("feishu_chat");

    chatCreateMock.mockResolvedValueOnce({
      code: 0,
      data: { chat_id: "oc_new", name: "new group", chat_mode: "group", chat_type: "private" },
    });
    const createResult = await tool.execute("tc_create", {
      action: "create",
      name: "new group",
      description: "desc",
      user_ids: ["ou_a"],
    });
    expect(createResult.details).toEqual(
      expect.objectContaining({
        chat_id: "oc_new",
        name: "new group",
        user_id_list: expect.arrayContaining(["ou_a", "ou_requester"]),
      }),
    );

    chatUpdateMock.mockResolvedValueOnce({ code: 0, data: {} });
    const renameResult = await tool.execute("tc_rename", {
      action: "rename",
      chat_id: "oc_new",
      new_name: "renamed",
    });
    expect(renameResult.details).toEqual(
      expect.objectContaining({ chat_id: "oc_new", name: "renamed" }),
    );

    chatMembersCreateMock.mockResolvedValueOnce({ code: 0, data: {} });
    const addResult = await tool.execute("tc_add", {
      action: "add_members",
      chat_id: "oc_new",
      user_ids: ["ou_a", "ou_b"],
    });
    expect(addResult.details).toEqual(
      expect.objectContaining({ chat_id: "oc_new", user_ids: ["ou_a", "ou_b"] }),
    );

    chatMembersDeleteMock.mockResolvedValueOnce({ code: 0, data: {} });
    const removeResult = await tool.execute("tc_remove", {
      action: "remove_members",
      chat_id: "oc_new",
      user_ids: ["ou_a"],
    });
    expect(removeResult.details).toEqual(
      expect.objectContaining({ chat_id: "oc_new", user_ids: ["ou_a"] }),
    );

    chatListMock.mockResolvedValueOnce({
      code: 0,
      data: {
        has_more: false,
        page_token: "",
        items: [{ chat_id: "oc_new", name: "renamed" }],
      },
    });
    const listResult = await tool.execute("tc_list", { action: "list" });
    expect(listResult.details).toEqual(
      expect.objectContaining({
        has_more: false,
        items: [expect.objectContaining({ chat_id: "oc_new", name: "renamed" })],
      }),
    );

    chatGetMock.mockResolvedValueOnce({
      code: 0,
      data: { name: "renamed", user_count: "3" },
    });
    const getResult = await tool.execute("tc_get", { action: "get", chat_id: "oc_new" });
    expect(getResult.details).toEqual(
      expect.objectContaining({ chat_id: "oc_new", name: "renamed", user_count: "3" }),
    );

    chatMembersGetMock.mockResolvedValueOnce({
      code: 0,
      data: {
        has_more: false,
        page_token: "",
        items: [{ member_id: "ou_1", name: "member1", member_id_type: "open_id" }],
      },
    });
    const membersResult = await tool.execute("tc_members", {
      action: "members",
      chat_id: "oc_new",
    });
    expect(membersResult.details).toEqual(
      expect.objectContaining({
        chat_id: "oc_new",
        members: [expect.objectContaining({ member_id: "ou_1", name: "member1" })],
      }),
    );

    contactUserGetMock.mockResolvedValueOnce({
      code: 0,
      data: {
        user: {
          open_id: "ou_1",
          name: "member1",
          email: "member1@example.com",
          department_ids: ["od_1"],
        },
      },
    });
    const memberInfoResult = await tool.execute("tc_member", {
      action: "member_info",
      member_id: "ou_1",
    });
    expect(memberInfoResult.details).toEqual(
      expect.objectContaining({
        member_id: "ou_1",
        open_id: "ou_1",
        name: "member1",
        email: "member1@example.com",
        department_ids: ["od_1"],
      }),
    );

    chatDeleteMock.mockResolvedValueOnce({ code: 0, data: {} });
    const deleteResult = await tool.execute("tc_delete", { action: "delete", chat_id: "oc_new" });
    expect(deleteResult.details).toEqual(
      expect.objectContaining({ chat_id: "oc_new", deleted: true }),
    );
  });

  it("uses agentAccountId context for account routing", async () => {
    const registerTool = vi.fn();
    registerFeishuChatTools(
      createChatToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              defaultAccount: "a",
              accounts: {
                a: {
                  appId: "app-a",
                  appSecret: "sec-a", // pragma: allowlist secret
                  tools: { chat: true },
                },
                b: {
                  appId: "app-b",
                  appSecret: "sec-b", // pragma: allowlist secret
                  tools: { chat: true },
                },
              },
            },
          },
        },
        registerTool,
      }),
    );

    const toolFactory = registerTool.mock.calls[0]?.[0];
    const tool = toolFactory({ agentAccountId: "b" });

    chatListMock.mockResolvedValueOnce({
      code: 0,
      data: { items: [], has_more: false, page_token: "" },
    });
    await tool.execute("tc_route", { action: "list" });

    expect(createFeishuClientMock.mock.calls.at(-1)?.[0]?.appId).toBe("app-b");
  });

  it("returns clear validation errors for required fields", async () => {
    const registerTool = vi.fn();
    registerFeishuChatTools(
      createChatToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret", // pragma: allowlist secret
              tools: { chat: true },
            },
          },
        },
        registerTool,
      }),
    );

    const tool = registerTool.mock.calls[0]?.[0]({});
    const result = await tool.execute("tc_err", {
      action: "add_members",
      chat_id: "oc_x",
      user_ids: [],
    });

    const error = typeof result.details.error === "string" ? result.details.error : "";
    expect(error).toContain("user_ids is required for action add_members");
  });

  it("skips registration when chat tool is disabled across all accounts", () => {
    const registerTool = vi.fn();
    registerFeishuChatTools(
      createChatToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              accounts: {
                a: {
                  appId: "app-a",
                  appSecret: "sec-a", // pragma: allowlist secret
                  tools: { chat: false },
                },
                b: {
                  appId: "app-b",
                  appSecret: "sec-b", // pragma: allowlist secret
                  tools: { chat: false },
                },
              },
            },
          },
        },
        registerTool,
      }),
    );
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("preserves Feishu diagnostics from rejected member lookups", async () => {
    const registerTool = vi.fn();
    registerFeishuChatTools(
      createChatToolApi({
        config: {
          channels: {
            feishu: {
              enabled: true,
              appId: "app_id",
              appSecret: "app_secret", // pragma: allowlist secret
              tools: { chat: true },
            },
          },
        },
        registerTool,
      }),
    );

    const tool = registerTool.mock.calls[0]?.[0];
    contactUserGetMock.mockRejectedValueOnce(
      Object.assign(new Error("Request failed with status code 400"), {
        response: {
          status: 400,
          data: {
            code: 99992360,
            msg: "The request you send is not a valid {user_id} or not exists",
            error: {
              log_id: "20260429124800CHAT",
              troubleshooter: "https://open.feishu.cn/search?log_id=20260429124800CHAT",
            },
          },
        },
      }),
    );

    const result = await tool.execute("tc_4", {
      action: "member_info",
      member_id: "ou_1",
    });

    expect(result.details.error).toContain('"http_status":400');
    expect(result.details.error).toContain('"feishu_code":99992360');
    expect(result.details.error).toContain(
      '"feishu_msg":"The request you send is not a valid {user_id} or not exists"',
    );
    expect(result.details.error).toContain('"feishu_log_id":"20260429124800CHAT"');
    expect(result.details.error).toContain(
      '"feishu_troubleshooter":"https://open.feishu.cn/search?log_id=20260429124800CHAT"',
    );
  });
});
