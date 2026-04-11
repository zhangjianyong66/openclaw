import type { OpenClawPluginApi } from "../runtime-api.js";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { FeishuMediaSchema, type FeishuMediaParams } from "./media-schema.js";
import { downloadImageFeishu, downloadMessageResourceFeishu } from "./media.js";
import { getFeishuRuntime } from "./runtime.js";
import { resolveFeishuToolAccount, resolveAnyEnabledFeishuToolsConfig } from "./tool-account.js";
import {
  jsonToolResult,
  toolExecutionErrorResult,
  unknownToolActionResult,
} from "./tool-result.js";

type FeishuMediaExecuteParams = FeishuMediaParams & { accountId?: string };

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function inferMessageResourceType(params: {
  resourceType?: "image" | "file";
  imageKey?: string;
}): "image" | "file" {
  if (params.resourceType) {
    return params.resourceType;
  }
  return params.imageKey ? "image" : "file";
}

async function saveDownloadedMedia(params: {
  api: Pick<OpenClawPluginApi, "config">;
  executeParams: FeishuMediaExecuteParams;
  defaultAccountId?: string;
}) {
  if (!params.api.config) {
    throw new Error("Feishu config unavailable");
  }

  const account = resolveFeishuToolAccount({
    api: params.api,
    executeParams: params.executeParams,
    defaultAccountId: params.defaultAccountId,
  });
  const messageId = trimToUndefined(params.executeParams.message_id);
  const imageKey = trimToUndefined(params.executeParams.image_key);
  const fileKey = trimToUndefined(params.executeParams.file_key);

  if (!imageKey && !fileKey) {
    throw new Error("Provide image_key or file_key");
  }

  const runtime = getFeishuRuntime();
  const maxBytes = (account.config.mediaMaxMb ?? 30) * 1024 * 1024;

  if (!messageId) {
    if (!imageKey) {
      throw new Error("message_id is required when downloading by file_key");
    }
    const result = await downloadImageFeishu({
      cfg: params.api.config,
      imageKey,
      accountId: account.accountId,
    });
    const contentType =
      result.contentType ?? (await runtime.media.detectMime({ buffer: result.buffer }));
    const saved = await runtime.channel.media.saveMediaBuffer(
      result.buffer,
      contentType,
      "inbound",
      maxBytes,
    );
    return {
      status: "ok" as const,
      source: "feishu" as const,
      action: "download" as const,
      mode: "image" as const,
      account_id: account.accountId,
      image_key: imageKey,
      file_path: saved.path,
      mime_type: saved.contentType,
      file_name: saved.id,
    };
  }

  const resolvedKey = fileKey ?? imageKey;
  if (!resolvedKey) {
    throw new Error("Provide image_key or file_key when message_id is set");
  }
  const resourceType = inferMessageResourceType({
    resourceType: params.executeParams.resource_type,
    imageKey,
  });
  const result = await downloadMessageResourceFeishu({
    cfg: params.api.config,
    messageId,
    fileKey: resolvedKey,
    type: resourceType,
    accountId: account.accountId,
  });
  const contentType =
    result.contentType ?? (await runtime.media.detectMime({ buffer: result.buffer }));
  const saved = await runtime.channel.media.saveMediaBuffer(
    result.buffer,
    contentType,
    "inbound",
    maxBytes,
    result.fileName,
  );
  return {
    status: "ok" as const,
    source: "feishu" as const,
    action: "download" as const,
    mode: "message_resource" as const,
    account_id: account.accountId,
    message_id: messageId,
    resource_type: resourceType,
    image_key: imageKey,
    file_key: fileKey,
    file_path: saved.path,
    mime_type: saved.contentType,
    file_name: result.fileName ?? saved.id,
  };
}

export function registerFeishuMediaTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_media: No config available, skipping media tools");
    return;
  }

  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    api.logger.debug?.("feishu_media: No Feishu accounts configured, skipping media tools");
    return;
  }

  const toolsCfg = resolveAnyEnabledFeishuToolsConfig(accounts);
  if (!toolsCfg.media) {
    api.logger.debug?.("feishu_media: media tool disabled in config");
    return;
  }

  api.registerTool(
    (ctx) => {
      const defaultAccountId = ctx.agentAccountId;
      return {
        name: "feishu_media",
        label: "Feishu Media",
        description:
          "Download a Feishu image/file resource to a local file path for use with tools that require file_path or image_path.",
        parameters: FeishuMediaSchema,
        async execute(_toolCallId, params) {
          const p = params as FeishuMediaExecuteParams;
          try {
            switch (p.action) {
              case "download":
                return jsonToolResult(
                  await saveDownloadedMedia({
                    api,
                    executeParams: p,
                    defaultAccountId,
                  }),
                );
              default:
                return unknownToolActionResult((p as { action?: unknown }).action);
            }
          } catch (err) {
            return toolExecutionErrorResult(err);
          }
        },
      };
    },
    { name: "feishu_media" },
  );

  api.logger.info?.("feishu_media: Registered feishu_media tool");
}
