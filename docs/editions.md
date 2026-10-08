# TS / Python / Rust：三个独立成品包

0.1.13 分发 TS / Python / Rust 三个独立成品包，完成发布以各自 release 回执为准。不是把开发备份发给用户。

| 产品 | 默认活动核心 | 用户要求 | 内容 |
|---|---|---|---|
| pitools-ts | TS | Pi、Node、Git | 纯 TS 适配，无外部 worker/解释器/二进制 |
| pitools-python | Python | 另需 Python 3.11+ | Python 标准库 worker + 完整 TS 回退 |
| pitools-rust | Rust | 无需 Cargo/Python | 匹配平台 executable、许可证 + 完整 TS 回退 |

三个产品使用逐字相同的 UI、轨迹、详情、搜索、时间/usage 和主题逻辑。默认动画为固定宽度的 `π` 点阵（240ms）；待机/完成清空点阵并停止动画。状态点蓝色表示待机/运行、绿色表示结束、红色表示最近失败，其余文字统一主题 accent。原有 35 套动画与随机选择顺序保留；已有会话可用 `/pitools activity frames pi` 切换。Python/Rust 只迁移活动状态计算，不是假装全插件变成对应语言；不宣称它们比 TS 更省资源。

## 安装：三选一

```sh
pi install git:github.com/ZSY007/pitools-ts
# 或：pi install git:github.com/ZSY007/pitools-python
# 或：pi install git:github.com/ZSY007/pitools-rust
```

然后在停止生成时手动 `/reload`，检查 `/pitools version` 和 `/pitools core status`。不升级 Pi、不触碰账号、会话或其他插件。

Python/Rust 产品的安装是对相应 worker 的显式选择；仅在交互 `session_start` 或明确命令中启动，不在模块加载、包安装或 print/JSON/RPC 模式偷偷启动。环境变量 `PITOOLS_CORE` 不替换独立包类型。可临时 `/pitools core ts` 回退，重载后再次使用该包默认核心；另一个外部核心的命令会提示换包，不加载未提供的 worker。

## 从旧 pitools 或另一版迁移

1. 备份旧包和 settings，备份必须在插件发现目录之外。
2. `pi list` 确认来源；对旧 `git:github.com/ZSY007/pitools` 或另一成品包，执行 `pi remove <该来源>`。只移除 pitools，不卸载其他插件。
3. 手工 `~/.pi/agent/extensions/pitools` 应移出发现目录，不能只在 extensions 下改名。
4. 安装所选成品包，再 `/reload`、检查版本/包类型/实际核心。

不要同装三份。新包在同一宿主 event bus 上声明互斥所有权，第二份在注册界面之前拒绝加载；Pi runtime invalidation/reload 释放该声明。旧 0.1.11 不含新互斥代码，仍必须按上面的步骤先移除。

更新只针对选中的包：

```sh
pi update git:github.com/ZSY007/pitools-ts
```

不要裸跑 `pi update`（升级 Pi）或更新所有插件。备份用于回滚，不是要求用户保存三份备份才能使用。

## 不使用 Git

Release 提供三个具名 `.tgz` 成品包及 `SHA256SUMS`。下载一个并校验、解压到稳定目录，再 `pi install /绝对路径/pitools-ts`（或另外两版）。本地路径安装不会自动跟随 Git 更新。不要把 archive 直接当作 TS 扩展加载，也不要形成 `pitools/pitools` 嵌套目录。

## Rust 平台与二进制边界

成品包必须同时包含以下经过各自平台 CI 构建/测试的 targets；少一个则装配失败，不用占位 exe 或跨平台伪装：

- `x86_64-pc-windows-msvc`
- `aarch64-apple-darwin`
- `x86_64-apple-darwin`
- `x86_64-unknown-linux-gnu`

其他架构/musl 暂不列为已分发支持；找不到匹配 binary 则明确回退 TS。binary 根据实际进程架构选择，macOS x64/arm64 分开，不伪称 universal Mach-O。当前 Mark 表要求 Node Unicode 16.0（CI 使用 Node 24.12.0）；不同 Unicode 不默默改变 JS 字符串/列宽语义。Linux 最低 glibc 从实际 ELF 的版本符号提取，写入 binary 的 `build-info.json` 和成品 README；不承诺所有 Linux 发行版。

插件不运行时下载、编译、安装 Cargo/解释器、联网监听或自动重启。Rust binary 不读凭证/会话；worker 同用户权限，不是沙箱。版本、Unicode、协议/帧、预算或超时错误保持完整 TS 状态并提示一次。

每个 native artifact 带 source commit、编译器、SHA-256 与原始依赖 LICENSE/Rust 标准库 copyright；打包器校验这些指纹，不复制机器路径、账号、日志、开发 target 或临时备份。归档保存 Unix executable 权限，Git 发布也须设置相同权限。

## 构建与发布门禁

共享仓库是维护源，成品通过 allowlist 生成而非手工复制整目录：

1. Cargo release + 20 项 Rust 测试、14 项 Python、85 项 Node。
2. 平台导出 executable 与许可证，Git source commit/版本/指纹匹配。
3. 生成当地三包，通过真实模块化/bundled Pi 加载器：默认核心、共用 UI、UTF-16、工具身份、usage、互斥、reload、退出。
4. 汇集四 target；生成三包，验证无多余文件，归档和 SHA256SUMS。
5. CI 全绿后发布三个独立仓库/tag/release。开发本地 dirty artifact 只能测试，禁止作为正式分发。

CI 不替代用户实际终端、HUD/compositor 或长会话验收。历史性能报告测的是拆包前开发入口；尤其纯 TS 成品适配已去掉外部 worker 代码，不能把旧比值伪装成三包重新测量。
