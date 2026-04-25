import type * as Lark from "@larksuiteoapi/node-sdk";
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
import type { OpenClawPluginApi } from "../runtime-api.js";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { FeishuChatSchema, type FeishuChatParams } from "./chat-schema.js";
import { createFeishuToolClient, resolveAnyEnabledFeishuToolsConfig } from "./tool-account.js";

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

type FeishuMemberIdType = "open_id" | "user_id" | "union_id";
type FeishuEnvelope<T> = { code?: number; msg?: string; data?: T };

function assertFeishuSuccess<T>(response: FeishuEnvelope<T>, action: string): T | undefined {
  if (response.code !== 0) {
    throw new Error(response.msg ?? `Feishu API request failed for action ${action}`);
  }
  return response.data;
}

function normalizeChatId(chatId: string | undefined, action: string): string {
  const value = normalizeOptionalString(chatId);
  if (!value) {
    throw new Error(`chat_id is required for action ${action}`);
  }
  return value;
}

function normalizeName(name: string | undefined, field: "name" | "new_name"): string {
  const value = normalizeOptionalString(name);
  if (!value) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function normalizePageSize(pageSize: number | undefined): number {
  if (typeof pageSize !== "number" || !Number.isFinite(pageSize)) {
    return 50;
  }
  return Math.min(100, Math.max(1, Math.floor(pageSize)));
}

function normalizeUserIds(userIds: string[] | undefined, action: string): string[] {
  const normalized = (userIds ?? [])
    .map((item) => normalizeOptionalString(item))
    .filter((item): item is string => Boolean(item));

  if (normalized.length === 0) {
    throw new Error(`user_ids is required for action ${action}`);
  }

  return [...new Set(normalized)];
}

function resolveRequesterOpenId(params: {
  requesterSenderId?: string;
  deliveryTo?: string;
}): string | undefined {
  const senderId = normalizeOptionalString(params.requesterSenderId);
  if (senderId) {
    return senderId;
  }

  const to = normalizeOptionalString(params.deliveryTo);
  if (to && to.startsWith("user:")) {
    const fromTo = normalizeOptionalString(to.slice("user:".length));
    if (fromTo) {
      return fromTo;
    }
  }

  return undefined;
}

function mergeMemberIds(
  userIds: string[] | undefined,
  requesterOpenId: string | undefined,
): string[] {
  const merged = [...(userIds ?? [])];
  const requester = normalizeOptionalString(requesterOpenId);
  if (requester) {
    merged.push(requester);
  }
  return merged.length > 0 ? [...new Set(merged)] : [];
}

export async function getChatInfo(client: Lark.Client, chatId: string) {
  const res = await client.im.chat.get({ path: { chat_id: chatId } });
  const chat = assertFeishuSuccess(res, "get") ?? {};

  return {
    chat_id: chatId,
    name: chat.name,
    description: chat.description,
    owner_id: chat.owner_id,
    tenant_key: chat.tenant_key,
    user_count: chat.user_count,
    chat_mode: chat.chat_mode,
    chat_type: chat.chat_type,
    join_message_visibility: chat.join_message_visibility,
    leave_message_visibility: chat.leave_message_visibility,
    membership_approval: chat.membership_approval,
    moderation_permission: chat.moderation_permission,
    avatar: chat.avatar,
  };
}

export async function getChatMembers(
  client: Lark.Client,
  chatId: string,
  pageSize?: number,
  pageToken?: string,
  memberIdType?: FeishuMemberIdType,
) {
  const page_size = normalizePageSize(pageSize);
  const res = await client.im.chatMembers.get({
    path: { chat_id: chatId },
    params: {
      page_size,
      page_token: pageToken,
      member_id_type: memberIdType ?? "open_id",
    },
  });

  const data = assertFeishuSuccess(res, "members") ?? {};

  return {
    chat_id: chatId,
    has_more: data.has_more,
    page_token: data.page_token,
    members:
      data.items?.map((item) => ({
        member_id: item.member_id,
        name: item.name,
        tenant_key: item.tenant_key,
        member_id_type: item.member_id_type,
      })) ?? [],
  };
}

export async function getFeishuMemberInfo(
  client: Lark.Client,
  memberId: string,
  memberIdType: FeishuMemberIdType = "open_id",
) {
  const res = await client.contact.user.get({
    path: { user_id: memberId },
    params: {
      user_id_type: memberIdType,
      department_id_type: "open_department_id",
    },
  });

  const user = assertFeishuSuccess(res, "member_info")?.user;
  return {
    member_id: memberId,
    member_id_type: memberIdType,
    open_id: user?.open_id,
    user_id: user?.user_id,
    union_id: user?.union_id,
    name: user?.name,
    en_name: user?.en_name,
    nickname: user?.nickname,
    email: user?.email,
    enterprise_email: user?.enterprise_email,
    mobile: user?.mobile,
    mobile_visible: user?.mobile_visible,
    status: user?.status,
    avatar: user?.avatar,
    department_ids: user?.department_ids,
    department_path: user?.department_path,
    leader_user_id: user?.leader_user_id,
    city: user?.city,
    country: user?.country,
    work_station: user?.work_station,
    join_time: user?.join_time,
    is_tenant_manager: user?.is_tenant_manager,
    employee_no: user?.employee_no,
    employee_type: user?.employee_type,
    description: user?.description,
    job_title: user?.job_title,
    geo: user?.geo,
  };
}

async function createChat(params: {
  client: Lark.Client;
  name: string;
  description?: string;
  userIds?: string[];
  requesterOpenId?: string;
}) {
  const mergedUserIds = mergeMemberIds(params.userIds, params.requesterOpenId);

  const res = await params.client.im.chat.create({
    data: {
      name: params.name,
      ...(params.description ? { description: params.description } : {}),
      chat_mode: "group",
      chat_type: "private",
      ...(mergedUserIds.length > 0 ? { user_id_list: mergedUserIds } : {}),
    },
    params: { user_id_type: "open_id" },
  });

  const data = assertFeishuSuccess(res, "create") ?? {};
  return {
    chat_id: data.chat_id,
    name: data.name,
    description: data.description,
    owner_id: data.owner_id,
    chat_mode: data.chat_mode,
    chat_type: data.chat_type,
    user_id_list: mergedUserIds,
    requester_open_id: params.requesterOpenId,
  };
}

async function renameChat(client: Lark.Client, chatId: string, newName: string) {
  const res = await client.im.chat.update({
    path: { chat_id: chatId },
    data: { name: newName },
  });

  assertFeishuSuccess(res, "rename");
  return { chat_id: chatId, name: newName };
}

async function deleteChat(client: Lark.Client, chatId: string) {
  const res = await client.im.chat.delete({ path: { chat_id: chatId } });
  assertFeishuSuccess(res, "delete");
  return { chat_id: chatId, deleted: true };
}

async function addChatMembers(client: Lark.Client, chatId: string, userIds: string[]) {
  const res = await client.im.chatMembers.create({
    path: { chat_id: chatId },
    params: { member_id_type: "open_id" },
    data: { id_list: userIds },
  });

  const data = assertFeishuSuccess(res, "add_members") ?? {};
  return {
    chat_id: chatId,
    user_ids: userIds,
    invalid_id_list: data.invalid_id_list ?? [],
    not_existed_id_list: data.not_existed_id_list ?? [],
    pending_approval_id_list: data.pending_approval_id_list ?? [],
  };
}

async function removeChatMembers(client: Lark.Client, chatId: string, userIds: string[]) {
  const res = await client.im.chatMembers.delete({
    path: { chat_id: chatId },
    params: { member_id_type: "open_id" },
    data: { id_list: userIds },
  });

  const data = assertFeishuSuccess(res, "remove_members") ?? {};
  return {
    chat_id: chatId,
    user_ids: userIds,
    invalid_id_list: data.invalid_id_list ?? [],
  };
}

async function listChats(client: Lark.Client, pageSize?: number, pageToken?: string) {
  const res = await client.im.chat.list({
    params: {
      user_id_type: "open_id",
      page_size: normalizePageSize(pageSize),
      page_token: normalizeOptionalString(pageToken),
    },
  });

  const data = assertFeishuSuccess(res, "list") ?? {};
  return {
    items:
      data.items?.map((item) => ({
        chat_id: item.chat_id,
        name: item.name,
        description: item.description,
        owner_id: item.owner_id,
        tenant_key: item.tenant_key,
        chat_status: item.chat_status,
      })) ?? [],
    has_more: data.has_more ?? false,
    page_token: data.page_token,
    page_size: normalizePageSize(pageSize),
  };
}

export function registerFeishuChatTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_chat: No config available, skipping chat tools");
    return;
  }

  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    api.logger.debug?.("feishu_chat: No Feishu accounts configured, skipping chat tools");
    return;
  }

  const toolsCfg = resolveAnyEnabledFeishuToolsConfig(accounts);
  if (!toolsCfg.chat) {
    api.logger.debug?.("feishu_chat: chat tool disabled in config");
    return;
  }

  type FeishuChatExecuteParams = FeishuChatParams & { accountId?: string };

  api.registerTool(
    (ctx) => {
      const defaultAccountId = ctx.agentAccountId;
      return {
        name: "feishu_chat",
        label: "Feishu Chat",
        description:
          "Feishu chat operations. Actions: create, rename, delete, add_members, remove_members, list, get, members, info, member_info",
        parameters: FeishuChatSchema,
        async execute(_toolCallId, params) {
          const p = params as FeishuChatExecuteParams;
          try {
            const client = createFeishuToolClient({
              api,
              executeParams: p,
              defaultAccountId,
            });

            switch (p.action) {
              case "create": {
                const name = normalizeName(p.name, "name");
                const description = normalizeOptionalString(p.description);
                const requesterOpenId = resolveRequesterOpenId({
                  requesterSenderId: ctx.requesterSenderId,
                  deliveryTo: ctx.deliveryContext?.to,
                });
                const userIds = p.user_ids
                  ? [
                      ...new Set(
                        p.user_ids
                          .map((item) => normalizeOptionalString(item))
                          .filter(Boolean) as string[],
                      ),
                    ]
                  : undefined;
                return json(
                  await createChat({
                    client,
                    name,
                    description,
                    userIds,
                    requesterOpenId,
                  }),
                );
              }
              case "rename": {
                const chatId = normalizeChatId(p.chat_id, "rename");
                const newName = normalizeName(p.new_name, "new_name");
                return json(await renameChat(client, chatId, newName));
              }
              case "delete": {
                const chatId = normalizeChatId(p.chat_id, "delete");
                return json(await deleteChat(client, chatId));
              }
              case "add_members": {
                const chatId = normalizeChatId(p.chat_id, "add_members");
                const userIds = normalizeUserIds(p.user_ids, "add_members");
                return json(await addChatMembers(client, chatId, userIds));
              }
              case "remove_members": {
                const chatId = normalizeChatId(p.chat_id, "remove_members");
                const userIds = normalizeUserIds(p.user_ids, "remove_members");
                return json(await removeChatMembers(client, chatId, userIds));
              }
              case "list":
                return json(await listChats(client, p.page_size, p.page_token));
              case "get": {
                const chatId = normalizeChatId(p.chat_id, "get");
                return json(await getChatInfo(client, chatId));
              }
              case "members": {
                const chatId = normalizeChatId(p.chat_id, "members");
                return json(
                  await getChatMembers(client, chatId, p.page_size, p.page_token, p.member_id_type),
                );
              }
              case "info": {
                const chatId = normalizeChatId(p.chat_id, "info");
                return json(await getChatInfo(client, chatId));
              }
              case "member_info": {
                const memberId = normalizeOptionalString(p.member_id);
                if (!memberId) {
                  return json({ error: "member_id is required for action member_info" });
                }
                return json(
                  await getFeishuMemberInfo(client, memberId, p.member_id_type ?? "open_id"),
                );
              }
              default:
                return json({
                  error: `Unknown action: ${String((p as { action?: unknown }).action)}`,
                });
            }
          } catch (err) {
            return json({ error: formatErrorMessage(err) });
          }
        },
      };
    },
    { name: "feishu_chat" },
  );

  api.logger.debug?.("feishu_chat: Registered feishu_chat tool");
}
