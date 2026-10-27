# BBPlayer

BBPlayer 是一个基于 React Native 开发的 BiliBili 流媒体音乐软件，整个仓库为 monorepo

## 命令

注意，所有命令都应当在项目根目录运行

```bash
pnpm install                   # Only pnpm — npm/yarn breaks workspace resolution
pnpm lint                      # oxlint
pnpm lint:fix                  # Auto-fix
pnpm format                    # oxfmt
pnpm type-check             # TypeScript type checking
```

## 最佳实践

### 运行检查和构建

如果任务涉及 TypeScript / JavaScript，你应当在每个任务完成后都**在项目根目录**运行一次 `pnpm type-check` 与 `pnpm lint`，检查是否引入了新的错误。

如果任务涉及原生代码，你应当在每个任务完成后**只对那个包**运行一次 `gradlew build`，并检查是否有构建错误。

### 搜索文件和 symbol

我们推荐使用 `codedb` mcp 搜索，而非使用 grep 手动搜索

### 推送并触发 Nightly 构建

当用户说“推送并构建”“推动并构建”“推送 GitHub 并触发 nightly”或含义相同的话时，视为用户明确授权完成以下整套流程，不要停在只推送代码或让用户手动点击 Actions：

1. 按本文件要求完成当前任务适用的检查。只暂存并提交属于当前任务的文件；保留用户已有的无关改动。若当前任务已经提交，则不要创建空提交。
2. 确认当前分支是 `dev`，运行 `git fetch origin dev` 并检查远端是否有新提交。不得 force push；若无法安全 fast-forward，停止并报告分歧。
3. 使用合适的 Conventional Commit 信息提交，然后用标准 `git` 推送到 `origin/dev`。不要使用或推荐 GitHub CLI。
4. 推送成功后，以刚推送的完整 commit SHA 为目标，先检查是否已经存在同一 SHA 的 `Nightly Build` 且状态为 `queued` 或 `in_progress`；存在时复用该运行，不重复派发。
5. 若不存在，调用 GitHub 官方 REST API：
   - `POST https://api.github.com/repos/xjz6626/BBPlayer/actions/workflows/nightly.yml/dispatches`
   - 请求体为 `{"ref":"dev"}`
   - 使用现有 HTTPS git credential（通过 `git credential fill` 获取）进行 Bearer 认证。凭据只允许保存在进程内存中；不得输出、记录、写入仓库或出现在最终回复里。可通过 stdin 向 `curl --config -` 传入认证 header，避免令牌出现在命令行参数中。
   - 接口返回 HTTP 204 表示派发成功。
6. 通过可用的 GitHub 连接器或官方 REST GET 接口查询 Actions runs，必须确认新运行同时满足：工作流是 `Nightly Build`、事件是 `workflow_dispatch`、`head_sha` 等于刚推送的 SHA。最终回复提供 commit 链接、run 链接和当前状态。

触发失败时，应报告实际 API 或权限错误。不要因为缺少 workflow-dispatch 专用工具就断言无法自动触发；本仓库的既有流程就是使用上述官方 API。除非用户明确要求等待，否则确认运行进入 `queued` 或 `in_progress` 后即可交付，不必等待 APK 构建完成。

## 仓库结构

### /apps

- mobile - React Native 移动应用（技术栈：Expo + Drizzle ORM + Material Design 3 + Zustand + TanStack Query）
- backend - 后端服务，主要提供歌单共享与软件更新查询（技术栈：Hono + ArkType + Drizzle ORM + CloudFlare Worker）
- docs - VuePress 文档网站
- update-publisher - 用于发布更新的工具

### /packages

- bottom-tabs-react-navigation — React Native 原生底部标签栏与 React Navigation 的桥接适配层
- eslint-plugin — 项目自定义 lint 规则（经 oxlint jsPlugins 运行）
- expo-wavy-slider — Android 原生波形滑动条（Jetpack Compose）的 Expo 模块封装
- heatmap — 基于 SVG 的日期热力图组件
- image-theme-colors — 从图片中提取主题色的 Expo 原生模块
- logs — React Native 日志库
- native — BBPlayer 原生能力集成模块
- orpheus — BBPlayer 核心音频播放引擎
- react-native-bottom-tabs — 跨平台原生底部标签栏组件
- splash — 歌词转换与解析库
