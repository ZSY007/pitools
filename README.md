# pitools

[![tests](https://github.com/ZSY007/pitools/actions/workflows/test.yml/badge.svg)](https://github.com/ZSY007/pitools/actions/workflows/test.yml)
[![version](https://img.shields.io/badge/version-0.1.12-blue)](https://github.com/ZSY007/pitools/releases/tag/v0.1.12)
[![license](https://img.shields.io/badge/license-BSD--3--Clause-green)](LICENSE)

**在 Pi 终端里，看清模型做了什么、工具返回了什么，以及任务进行到哪里。**

pitools 是 Pi 原生的轨迹与工具详情插件。它把输入、可见思考、模型回复和工具调用整理成可浏览的事件列表，支持完整详情、搜索和历史回放，并在首行显示实时工作状态。无需打开浏览器，不替换 Pi 原生编辑器、页脚或工作行。

**我们借鉴了 DeepSeek Harness 的轨迹工具（Trajectory）**，尤其是轨迹视图的组织方式和工具详情的交互设计，并基于 Pi 原生终端能力独立实现了这套体验。感谢 DeepSeek Harness 带来的设计启发。

提供 **TS / Python / Rust 三个独立安装版本**，共用同一套界面与快捷键。本仓库维护共享源码、技术文档和构建流水线；日常使用请选择下面的成品包。

## 能做什么

- **浏览任务轨迹**：输入蓝色、模型紫色、工具橙色，失败红色；支持跟随最新事件和手动选择。
- **查看完整详情**：概述、原始参数、工具结果、可用的 Schema 与计时分栏呈现，支持代码高亮、Markdown 和原始 JSON 切换。
- **查看可见思考**：只展示 Pi 实际提供的内容；不把签名当作思考，也不补造模型未返回的内容。
- **搜索与回放**：详情内搜索，从当前会话分支恢复轨迹及已保存的计时数据。
- **观察工作状态**：月相动画、阶段短语、可见回复中的旁白、并行工具数量和完成统计。
- **适应终端布局**：宽屏左右分栏、窄屏上下排列，使用 Pi 主题配色；隐藏轨迹时仍继续记录。

## 选择一个版本

| 版本 | 默认活动核心 | 额外要求 | 适合谁 |
|---|---|---|---|
| [pitools-ts](https://github.com/ZSY007/pitools-ts) | TS | 无 Python/Rust 要求，不启动 worker | 推荐默认选择，安装最简单 |
| [pitools-python](https://github.com/ZSY007/pitools-python) | Python | 已安装 Python 3.11+，仅用标准库 | 想使用 Python 活动核心 |
| [pitools-rust](https://github.com/ZSY007/pitools-rust) | Rust | 自带匹配平台的可执行文件，无需 Cargo/Python | 想使用原生 Rust 活动核心 |

**三选一，不要同时安装。** 三个版本的功能与界面一致，区别只在首行活动状态的计算后端。轨迹、详情、搜索、主题和渲染都由 TS/Pi 实现；Python/Rust 并不是把整个插件换成另一种语言，也不意味着整体 CPU 或内存更低。

### 环境要求

- 已安装兼容的 Pi，Node.js ≥ 22.19。
- Git 安装方式需要 Git；也可使用 Release 成品归档。
- 0.1.12 的跨平台构建与加载器验收使用 Node 24.12.0 / Pi 1.0.4。

Rust 成品包包含：

| 平台 | 架构 | target |
|---|---|---|
| Windows | x64 | `x86_64-pc-windows-msvc` |
| macOS | Apple Silicon / arm64 | `aarch64-apple-darwin` |
| macOS | Intel / x64 | `x86_64-apple-darwin` |
| Linux GNU | x64 | `x86_64-unknown-linux-gnu` |

当前 Linux binary 要求 **glibc ≥ 2.34**，不包含 musl 版。Rust 核心要求宿主 Node 的 Unicode 版本为 **16.0**；已验证 Node 24.12.0。不支持的平台或版本不匹配会明确提示并回退 TS，不在运行时下载或编译。

## 安装

### 推荐：TS 版

```sh
pi install git:github.com/ZSY007/pitools-ts
```

### 其他版本：二选一

```sh
# Python 版：需要 Python 3.11+
pi install git:github.com/ZSY007/pitools-python
```

```sh
# Rust 版：已附带平台 binary，无需自己编译
pi install git:github.com/ZSY007/pitools-rust
```

安装完成后，先停止正在进行的生成，再在 Pi 中执行：

```text
/reload
/pitools version
/pitools core status
```

`version` 查看已加载的版本和包类型，`core status` 查看实际使用的活动核心。安装或更新文件不会自动重载当前会话。

### 从旧版或另一版本迁移

先用 `pi list` 确认当前来源。若安装的是旧的共享包：

```sh
pi remove git:github.com/ZSY007/pitools
pi install git:github.com/ZSY007/pitools-ts
```

切换 Python/Rust 版时，把安装命令换成对应来源；已安装独立版时，先 `pi remove` 该版本，再安装目标版本。

若是手工目录 `~/.pi/agent/extensions/pitools`，先备份并**移出自动发现目录**，再安装成品包。不要只在 `extensions` 下改名，也不要保留旧包与新包同时加载。详细步骤见 [迁移指南](docs/editions.md#从旧-pitools-或另一版迁移)。

### 不使用 Git

从 [Release](https://github.com/ZSY007/pitools/releases/tag/v0.1.12) 下载所选版本的 `.tgz`，对照 `SHA256SUMS` 校验，解压到稳定目录，再安装该目录，例如：

```sh
pi install /absolute/path/pitools-ts
```

Windows 可使用对应的绝对路径。请选择具名成品归档；主仓库 `ZSY007/pitools` 的源码 ZIP 不包含 Rust 成品 binary。本地目录安装不会自动跟随 Git 更新。

## 日常使用

### 轨迹与详情

| 操作 | 快捷键 / 命令 |
|---|---|
| 显示或隐藏轨迹 | `Alt+T` |
| 打开轨迹列表与完整详情 | `Alt+I` 或 `/pitools` |
| 选择上一 / 下一事件 | `Alt+,` / `Alt+.` |
| 恢复跟随最新事件 | `/pitools live` |
| 开启 / 关闭轨迹 | `/pitools on` / `/pitools off` |
| 查看帮助 | `/pitools help` |

详情窗口中：

| 操作 | 按键 |
|---|---|
| 切换事件 | `←` / `→` |
| 切换概述、参数、结果、Schema、计时页签 | `Tab` |
| 滚动内容 | `↑` / `↓` / `PgUp` / `PgDn` |
| 搜索 | `/` |
| 切换渲染内容 / 原始 JSON | `R` |
| 返回 | `Esc` |

macOS 终端的 Option 键若默认输入特殊字符，可将其设为 Meta / Esc+；也可以直接使用命令。

### 首行工作状态

```text
● 🌗 ⏵ 检查工具结果 · 总21s  │  pitools · 第 3 轮 · 12 个事件
● 🌑 ⏵ 待机中 · 等待任务  │  pitools · 第 0 轮 · 0 个事件
```

活动信息位于最左侧，文字统一使用主题强调色；只有 `●` 表示状态：

- **灰色**：待机或运行中。
- **绿色**：任务结束。
- **红色**：最近出现工具失败或请求错误，不一定表示整项任务失败。

默认使用 `moon8` 八帧月相，动画间隔 120ms，支持 35 套帧及 `random`。待机与完成后保持静态，不继续运行动画时钟。

旁白只提取可见回复中行首的 `⏵`，不读取隐藏思考或签名，不改写原始回复。默认通过独立提示词 section 约定旁白格式，可单独关闭。

```text
/pitools activity help
/pitools activity frames list
/pitools activity frames moon8
/pitools activity frames random
/pitools activity lang zh
/pitools activity lang en
/pitools activity lang auto
/pitools activity narrate off
/pitools activity contract off
/pitools activity phrases off
```

`narrate` 控制旁白显示，`contract` 控制旁白提示词约定，`phrases` 控制阶段短语；这些选项均支持 `on` / `off`。`activity on` / `off` 控制整项活动显示。默认中文，`auto` 使用系统 locale；活动偏好保存到当前会话分支，新会话使用默认值。

### Python / Rust 核心

安装对应独立版本后，在交互会话开始时自动使用该核心，无需额外设置 `PITOOLS_CORE`。

```text
/pitools core status
/pitools core ts
```

`core ts` 临时关闭 worker 并使用 TS；重新加载后恢复所装版本的默认核心。Python 包可用 `core python` 手动重试，Rust 包可用 `core rust` 手动重试。独立包不能启动另一个版本的 worker，换后端需要换包。

Python 解释器无法自动找到时，可用 `PITOOLS_PYTHON` 指定可信解释器的绝对路径或 PATH 名称。Rust 默认选择包内匹配平台的 binary；开发者可用 `PITOOLS_RUST_CORE` 显式指定可信 executable。

worker 启动失败、崩溃、协议/版本不符、超时或超预算时，保留 TS 状态并提示回退，不自动重启。诊断时可用 `/pitools core verify on` 开启逐视图 TS 对照；默认关闭，开启会增加计算开销。

## 更新与卸载

只操作所装版本，例如 TS：

```sh
pi update git:github.com/ZSY007/pitools-ts
pi remove git:github.com/ZSY007/pitools-ts
```

Python/Rust 使用各自来源。更新后手动 `/reload`，再检查 `/pitools version`。

**不要用裸 `pi update` 更新插件：它更新 Pi 自身。** `pi update --extensions` 会更新所有已安装包；只想更新 pitools 时应指定完整来源。需要固定版本可使用 `git:github.com/ZSY007/pitools-ts@v0.1.12`；tag/commit 安装不会随默认分支更新。

## 数据与安全边界

- 展示宿主实际提供的数据。未保存的历史计时、缺失的思考/Schema/Token 标为不可用，不猜测或补造。
- 模型计时是本地消息生命周期与首个非空可见内容的观测，**不是 provider TTFT 或模型内部推理耗时**；不重复统计 usage。
- 从当前会话分支恢复数据，通过 Pi 元数据 API 保存计时与偏好，不直接读写其他会话文件。
- 内存约保留最近 2,000 个事件，运行中调用不淘汰。详情不会为适配 worker 或缓存而裁剪原始参数/结果；宿主已经截断的输出无法恢复，图片仅展示元信息。
- 外部文字上屏前清洗终端控制字符与双向文字控制符；长内容无法安全高亮时回退纯文本，保留全文。
- 插件运行时不联网、不读凭证。TS 版不启动子进程；Python/Rust 通过私有 stdin/stdout 管道工作，不监听 TCP/HTTP、不自动安装解释器或编译器。
- worker 与 Pi 使用同一用户权限，**不是安全沙箱**。工具参数/结果可能含敏感内容，分享截图或 issue 前请检查，没有自动脱敏。

## 文档与开发

- [三包安装、迁移与分发](docs/editions.md)
- [Rust 活动核心：协议、UTF-16 与故障处理](docs/0.1.12-rust-activity-core.md)
- [Rust 优化测量：分场景、分轮次与性能限定](docs/0.1.12-rust-optimization-measurement.md)
- [Python 活动核心与实现范围](docs/0.1.11-python-activity-core.md)
- [Python 性能对照](docs/0.1.11-performance-comparison.md)
- [详情渲染缓存与测量](docs/0.1.10-render-optimization.md)

历史性能报告来自对应开发入口和指定工作负载，不等于三个成品包重新实测或整个插件的资源降幅。TS 仍是推荐默认选择。

开发验证：

```sh
git clone https://github.com/ZSY007/pitools.git
cd pitools
npm test
python -B -m unittest discover -s python/tests
node scripts/gen-rust-assets.mjs --check
cargo test --release --locked --manifest-path rust/pitools-core/Cargo.toml
cargo build --release --locked --manifest-path rust/pitools-core/Cargo.toml
```

真实 Rust worker 的 Node 测试需要用 `PITOOLS_RUST_CORE` 指定已构建的 executable；未提供时会明确跳过，不能将跳过视作通过。Python 测试需要可用解释器。宿主加载器验证见 [三包指南](docs/editions.md#构建与发布门禁) 及 `scripts/verify-*.mjs`。

[0.1.12 发布构建](https://github.com/ZSY007/pitools/actions/runs/37705289466) 通过 82 项 Node、13 项 Python、19 项 Rust release 测试及 Windows / macOS arm64+x64 / Linux 的原生构建、模块化与 bundled Pi 加载器验收。CI 不替代用户实际终端、HUD 或长会话验收。

## 许可

项目采用 [BSD-3-Clause](LICENSE)。活动短语、动画帧、语言模板及派生的 `mixSlot` 算法来自 **dsh-working-activity 0.5.1**，保留 1,241 条短语和 35 套帧。

Copyright (c) 2026, chimney (ccch1mneyyy)。上游 BSD-3-Clause 许可见 [data/activity/LICENSE](data/activity/LICENSE)，完整归属见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。Rust 成品包同时附带依赖许可证与标准库 copyright。不代表上游作者背书。
