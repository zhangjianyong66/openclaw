import { Type, type Static } from "@sinclair/typebox";

const FEISHU_MEDIA_ACTION_VALUES = ["download"] as const;
const FEISHU_MEDIA_RESOURCE_TYPE_VALUES = ["image", "file"] as const;

export const FeishuMediaSchema = Type.Object({
  action: Type.Unsafe<(typeof FEISHU_MEDIA_ACTION_VALUES)[number]>({
    type: "string",
    enum: [...FEISHU_MEDIA_ACTION_VALUES],
    description: "Action to run: download",
  }),
  message_id: Type.Optional(
    Type.String({
      description:
        "Feishu message ID. Required when downloading a message resource via file_key/image_key.",
    }),
  ),
  image_key: Type.Optional(
    Type.String({
      description:
        "Feishu image_key. Can be used directly, or with message_id for message resource downloads.",
    }),
  ),
  file_key: Type.Optional(
    Type.String({
      description: "Feishu file_key for files/audio/video or message-scoped image resources.",
    }),
  ),
  resource_type: Type.Optional(
    Type.Unsafe<(typeof FEISHU_MEDIA_RESOURCE_TYPE_VALUES)[number]>({
      type: "string",
      enum: [...FEISHU_MEDIA_RESOURCE_TYPE_VALUES],
      description: "Message resource type (default: inferred from image_key/file_key).",
    }),
  ),
  accountId: Type.Optional(
    Type.String({
      description: "Optional Feishu account override for multi-account setups.",
    }),
  ),
});

export type FeishuMediaParams = Static<typeof FeishuMediaSchema>;
