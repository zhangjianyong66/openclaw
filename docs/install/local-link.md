---
summary: "使用 pnpm link 将本地仓库构建安装为全局 openclaw 命令"
read_when:
  - 你有本地克隆仓库并希望全局 openclaw 使用自己的构建
  - 你在测试本地代码修改（如修复或新功能）且尚未发布
title: "将本地构建安装为全局命令（pnpm link）"
---

# 将本地构建安装为全局命令（pnpm link）

使用 **pnpm link** 让全局的 `openclaw` 命令运行你本地仓库的代码，适合在开发或验证修改、且尚未发布时使用。

## 前置条件

- **Node 22+** 与 **pnpm**
- 已克隆 [OpenClaw 仓库](https://github.com/openclaw/openclaw) 并包含你的修改

若尚未安装 pnpm：

```bash
npm install -g pnpm
```

## 一次性配置 pnpm 全局目录

若从未使用过 `pnpm link --global`，需要先配置全局 bin 目录：

```bash
pnpm setup
```

然后将其输出的内容添加到你的 shell 配置并重新加载：

```bash
# 例如：在 ~/.zshrc（zsh）或 ~/.bashrc（bash）末尾追加后执行
source ~/.zshrc
```

`pnpm setup` 通常会输出类似：

```text
export PNPM_HOME="/Users/你的用户名/Library/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
```

若跳过这一步，执行 `pnpm link --global` 可能会报错：

```text
ERR_PNPM_NO_GLOBAL_BIN_DIR  Unable to find the global bin directory
```

## 操作步骤

<Steps>
  <Step title="安装依赖并构建">
    在仓库根目录执行：

    ```bash
    cd /path/to/openclaw
    pnpm install
    pnpm build
    ```

  </Step>
  <Step title="将本地包链接到全局">
    ```bash
    pnpm link --global
    ```

    成功后会出现类似输出：

    ```text
    /Users/你/Library/pnpm/global/5:
    + openclaw 2026.x.x <- ../../../../project/openclaw
    ```

  </Step>
  <Step title="验证">
    在新开终端中（或执行 `source ~/.zshrc` 后）：

    ```bash
    which openclaw
    openclaw --version
    ```

    `openclaw` 应指向 pnpm 全局目录，版本号与本地 `package.json` 一致。

  </Step>
</Steps>

## 链接之后

- 之后在新终端中执行 `openclaw` 都会使用**本地构建**。
- 若使用 **OpenClaw 网关**（如 macOS 菜单栏应用），需要**重启网关**才能加载新代码：完全退出应用后重新打开（或使用应用内的重启选项）。
- 仅使用 CLI 时无需重启，下次执行 `openclaw` 即已是链接后的版本。

## 恢复为已发布版本

若要改回使用 npm 上的版本、不再使用本地构建：

```bash
pnpm unlink --global
pnpm add -g openclaw@latest
```

若使用 npm：

```bash
npm install -g openclaw@latest
```

## 关于 peer 依赖警告

执行 `pnpm link --global` 时可能会看到：

```text
WARN  The package openclaw has the following peerDependencies specified in its package.json:
  - @napi-rs/canvas@^0.1.89
  - node-llama-cpp@3.16.2
The linked in dependency will not resolve the peer dependencies from the target node_modules.
```

这是正常现象。链接后的包会使用**仓库内**安装的依赖（即仓库里的 `node_modules`）。只有在你用到依赖这些可选 peer 的功能（如画布或本地 Llama）时才需关注；大多数 CLI 与网关场景可忽略该警告。

## 相关文档

- [安装](/install) — 其他安装方式（安装脚本、npm、从源码概览）
- [高级设置](/start/setup) — 开发工作流及从仓库运行网关
