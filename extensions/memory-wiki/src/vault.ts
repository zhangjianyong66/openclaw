import fs from "node:fs/promises";
import path from "node:path";
import {
  replaceManagedMarkdownBlock,
  withTrailingNewline,
} from "openclaw/plugin-sdk/memory-host-markdown";
import type { ResolvedMemoryWikiConfig } from "./config.js";
import { appendMemoryWikiLog } from "./log.js";

export const WIKI_VAULT_DIRECTORIES = [
  "实体",
  "概念",
  "综合",
  "来源",
  "报告",
  "_attachments",
  "_views",
  ".openclaw-wiki",
  ".openclaw-wiki/locks",
  ".openclaw-wiki/cache",
] as const;

export type InitializeMemoryWikiVaultResult = {
  rootDir: string;
  created: boolean;
  createdDirectories: string[];
  createdFiles: string[];
};

function buildIndexMarkdown(): string {
  return withTrailingNewline(
    replaceManagedMarkdownBlock({
      original: "# 知识库索引\n",
      heading: "## 自动生成",
      startMarker: "<!-- openclaw:wiki:index:start -->",
      endMarker: "<!-- openclaw:wiki:index:end -->",
      body: "- 还没有编译后的页面。",
    }),
  );
}

function buildAgentsMarkdown(): string {
  return withTrailingNewline(`\
# 知识库代理指南

- 生成块视为插件维护内容。
- 人工笔记请保留在受管理标记之外。
- 优先使用有来源支撑的声明，不要在页面之间来回循环引用。
- 优先把关键判断写成带证据的结构化 \`claims\`，不要只埋在正文里。
- 机器读取请使用 \`.openclaw-wiki/cache/agent-digest.json\` 和 \`claims.jsonl\`；Markdown 页面是给人看的。
`);
}

function buildWikiOverviewMarkdown(config: ResolvedMemoryWikiConfig): string {
  return withTrailingNewline(`\
# 知识库

这个仓库由 OpenClaw 的 memory-wiki 插件维护。

- 仓库模式：\`${config.vaultMode}\`
- 渲染模式：\`${config.vault.renderMode}\`
- 默认搜索语料：\`${config.search.corpus}\`

## 架构
- 原始来源是证据层。
- 知识库页面是面向人的综合层。
- \`.openclaw-wiki/cache/agent-digest.json\` 是面向代理的编译摘要。

## 说明
<!-- openclaw:human:start -->
<!-- openclaw:human:end -->
`);
}

async function pathExists(inputPath: string): Promise<boolean> {
  try {
    await fs.access(inputPath);
    return true;
  } catch {
    return false;
  }
}

async function writeFileIfMissing(
  filePath: string,
  content: string,
  createdFiles: string[],
): Promise<void> {
  if (await pathExists(filePath)) {
    return;
  }
  await fs.writeFile(filePath, content, "utf8");
  createdFiles.push(filePath);
}

export async function initializeMemoryWikiVault(
  config: ResolvedMemoryWikiConfig,
  options?: { nowMs?: number },
): Promise<InitializeMemoryWikiVaultResult> {
  const rootDir = config.vault.path;
  const createdDirectories: string[] = [];
  const createdFiles: string[] = [];

  if (!(await pathExists(rootDir))) {
    createdDirectories.push(rootDir);
  }
  await fs.mkdir(rootDir, { recursive: true });

  for (const relativeDir of WIKI_VAULT_DIRECTORIES) {
    const fullPath = path.join(rootDir, relativeDir);
    if (!(await pathExists(fullPath))) {
      createdDirectories.push(fullPath);
    }
    await fs.mkdir(fullPath, { recursive: true });
  }

  await writeFileIfMissing(path.join(rootDir, "代理指南.md"), buildAgentsMarkdown(), createdFiles);
  await writeFileIfMissing(
    path.join(rootDir, "知识库.md"),
    buildWikiOverviewMarkdown(config),
    createdFiles,
  );
  await writeFileIfMissing(path.join(rootDir, "知识库索引.md"), buildIndexMarkdown(), createdFiles);
  await writeFileIfMissing(
    path.join(rootDir, "收件箱.md"),
    withTrailingNewline("# 收件箱\n\n把原始想法、问题和来源链接放在这里。\n"),
    createdFiles,
  );
  await writeFileIfMissing(
    path.join(rootDir, ".openclaw-wiki", "state.json"),
    withTrailingNewline(
      JSON.stringify(
        {
          version: 1,
          createdAt: new Date(options?.nowMs ?? Date.now()).toISOString(),
          renderMode: config.vault.renderMode,
        },
        null,
        2,
      ),
    ),
    createdFiles,
  );
  await writeFileIfMissing(path.join(rootDir, ".openclaw-wiki", "log.jsonl"), "", createdFiles);

  if (createdDirectories.length > 0 || createdFiles.length > 0) {
    await appendMemoryWikiLog(rootDir, {
      type: "init",
      timestamp: new Date(options?.nowMs ?? Date.now()).toISOString(),
      details: {
        createdDirectories: createdDirectories.map((dir) => path.relative(rootDir, dir) || "."),
        createdFiles: createdFiles.map((file) => path.relative(rootDir, file)),
      },
    });
  }

  return {
    rootDir,
    created: createdDirectories.length > 0 || createdFiles.length > 0,
    createdDirectories,
    createdFiles,
  };
}
