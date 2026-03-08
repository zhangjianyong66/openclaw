import type { PluginHookRunner } from "openclaw/plugin-sdk";
import { DEFAULT_RESET_TRIGGERS } from "../../../config/sessions/types.js";

/**
 * Handle Feishu command messages and trigger appropriate hooks
 */
export async function handleFeishuCommand(
  messageText: string,
  sessionKey: string,
  hookRunner: PluginHookRunner,
  context: {
    cfg: any;
    sessionEntry: any;
    previousSessionEntry?: any;
    commandSource: string;
    timestamp: number;
  },
): Promise<boolean> {
  // Check if message is a reset command
  const trimmed = messageText.trim().toLowerCase();
  const isResetCommand = DEFAULT_RESET_TRIGGERS.some(
    (trigger) => trimmed === trigger || trimmed.startsWith(`${trigger} `),
  );

  if (isResetCommand) {
    // Extract the actual command (without arguments)
    const command = trimmed.split(" ")[0];
    // Session key format: agent:<agentId>:<rest> — use second segment as agentId
    const agentId =
      sessionKey.startsWith("agent:") && sessionKey.split(":").length >= 2
        ? sessionKey.split(":")[1]
        : "main";

    // Trigger the before_reset hook
    await hookRunner.runBeforeReset(
      {
        type: "command",
        action: command.replace("/", "") as "new" | "reset",
        context: {
          ...context,
          commandSource: "feishu",
        },
      },
      {
        agentId,
        sessionKey,
      },
    );

    return true; // Command was handled
  }

  return false; // Not a command we handle
}
