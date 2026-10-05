# 安装、更新与迁移

## Git 包（推荐）

```sh
pi install git:github.com/ZSY007/pitools
```

跟随仓库默认分支更新，只更新 pitools：

```sh
pi update git:github.com/ZSY007/pitools
```

然后在已运行的 Pi 中执行 `/reload` 和 `/pitools version`。更新文件不会自动替换进程内的扩展；正在生成时应先结束/中断该轮，再 reload。

不要裸跑 `pi update` 来更新本插件，它更新 Pi 自身。`pi update --extensions` 更新所有已安装包，可能影响其他插件；只想更新 pitools 时使用上面的完整来源。

Git 包由 Pi 管理，源码检出位于 agent 目录下的 git 管理目录，具体路径通过 `pi list` 查看。无需再次复制目录或传 zip。

## 从手工目录迁移

如果存在 `~/.pi/agent/extensions/pitools`，它会自动加载。与 Git 包并存可能注册两份命令、快捷键和 widget。

1. 备份手工目录到 `~/Downloads/pitools-backups/` 或其他不被 Pi 发现的路径。
2. 将原目录移出 `~/.pi/agent/extensions/`；不能只在这个目录下改个名字。
3. 执行 `pi install git:github.com/ZSY007/pitools`。
4. 使用 `pi list` 确认 Git 来源，检查其他插件仍保留。
5. 在 Pi 中 `/reload`，再 `/pitools version`。

若安装失败，先清理本次新增的 Git 包声明（如有），再恢复原目录。不要覆盖账号、模型、会话或其他插件。

## 固定版本与回滚

需要固定版本时，例如：

```sh
pi install git:github.com/ZSY007/pitools@v0.1.9
```

Tag / commit 来源不会随默认分支前进。想恢复跟随最新版本时重新安装不带 tag 的来源。包身份按仓库 URL 区分，不应同时配置两个版本。

从 Git 包退回手工备份时，先：

```sh
pi remove git:github.com/ZSY007/pitools
```

然后恢复备份目录并 `/reload`。卸载不删除会话里已有的计时/偏好元数据。

## 不使用 Git 的安装

也可下载 release/源码 zip，将完整 pitools 目录放在 `~/.pi/agent/extensions/pitools` 后 `/reload`。已有目录先备份；不要把新目录复制成嵌套的 `pitools/pitools`，不要混用各版本的 TS helper/data 文件。

手工安装与 Git 安装二选一。

## 更新策略

仓库更新不会悄悄下载或替换运行中的扩展。推荐显式执行只针对 pitools 的更新命令，再手动 reload；若希望启动前自动检查更新，应由独立启动脚本完成，并保留原 Pi 启动器。当前仓库不安装定时任务、后台服务或替换用户启动命令。
