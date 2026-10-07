# pitools

[![tests](https://github.com/ZSY007/pitools/actions/workflows/test.yml/badge.svg)](https://github.com/ZSY007/pitools/actions/workflows/test.yml)

**Pi 终端里的轨迹、工具调用详情和工作状态。** Windows / macOS，终端原生，不打开浏览器。

**0.1.12 三包发布准备中；已发布旧版为 0.1.11。**独立实现，界面参考 DeepSeek Harness 的 Trajectory。

## 安装与更新

需要 Node >= 22.19、Git，以及兼容的 Pi。已验证 Windows Pi 1.0.4；历史版本另在 Pi 1.0.0 / 1.0.2 验证。

0.1.12 分成三个独立产品，**三选一，不要同时安装**：

```sh
pi install git:github.com/ZSY007/pitools-ts
# 或：pi install git:github.com/ZSY007/pitools-python
# 或：pi install git:github.com/ZSY007/pitools-rust
```

- TS：推荐，无 worker、无需 Python/Rust。
- Python：安装后在交互会话自动使用 Python 活动核心；需要 Python 3.11+，不自动安装解释器。
- Rust：附带经过平台构建/测试的 executable，自动选择匹配平台；无需 Cargo/Python，不让普通用户编译。

三个包的界面代码完全相同，不是三份备份。当前仓库维护共享源码与构建流水线；三个成品仓库/归档通过 CI 后发布，不能把下面的安装地址当作已完成发布的回执。旧 `git:github.com/ZSY007/pitools` 先移除声明，再安装目标版；完整迁移见 [三包指南](docs/editions.md)。

之后只更新选中的包，例如 TS：

```sh
pi update git:github.com/ZSY007/pitools-ts
```

然后在运行中的 Pi 输入：

```text
/reload
/pitools version
```

入口、核心、渲染、活动、数据五项应全部显示同一版本。Git 更新改变磁盘代码，不会自动替换运行中的扩展。

**不要把单独的 `pi update` 当成插件更新命令：它更新 Pi 本身。** 需要跟随最新代码时使用上面不带 tag 的 Git 来源；指定 tag/commit 的安装是固定版本。

如果之前把 pitools 手工复制到了 `~/.pi/agent/extensions/pitools`，先备份并移出自动发现目录，再安装 Git 包，避免加载两份。迁移、回滚和卸载见 [安装指南](docs/installation.md)。不需要另装 npm 包，也不要复制其他机器的账号或会话。

## 界面与快捷键

- 常驻轨迹：输入蓝、模型紫、工具橙，失败红。
- `Alt+T` 隐藏/显示轨迹；隐藏时继续记录。
- `Alt+,` / `Alt+.` 选择上一/下一事件。
- `Alt+I` 或 `/pitools` 打开轨迹列表和完整详情。
- 宽终端左右分栏，窄终端上下排列。
- 详情里 `←→` 选事件、`Tab` 换页签、`↑↓` / `PgUp` / `PgDn` 滚动、`/` 搜索、`R` 切换渲染/原始 JSON、`Esc` 返回。
- 工具显示命令/路径/参数摘要和输出；参数、结果、Schema、计时可完整查看。
- Shell / 代码高亮，Markdown 代码块渲染。单段超过 200,000 字符时保留全文、回退纯文本，避免高亮阻塞。

```text
/pitools help
/pitools on
/pitools off
/pitools live
/pitools prev
/pitools next
/pitools version
```

Mac 的 Option 键可能默认输入特殊字符；可以在终端中设置为 Meta / Esc+，也可以直接使用上述命令。

## 工作状态

状态位于轨迹首行最左侧，统计紧随其后：

```text
● 🌗 ⏵ 检查工具结果 · 总21s  │  pitools · 第 3 轮 · 12 个事件
● 🌑 ⏵ 待机中 · 等待任务  │  pitools · 第 0 轮 · 0 个事件
```

- 默认 moon8：八帧、120ms；支持 35 套帧和 random。
- 新会话显示静止月亮与待机标签，不虚构任务耗时。任务结束保留静止月相、最近真实可见旁白及实际总耗时；待机/完成没有动画时钟。
- 标题文字统一主题 accent。只有 `●` 变色：灰为待机/运行、绿为结束、红为最近工具失败或请求错误。红不一定代表整个任务失败；下方事件分类颜色不变。
- 只从可见 text 的行首 `⏵` 提取旁白，不读取 thinkingSignature，不用隐藏思考当旁白。流式旁白采用最近 300 字符、80 列上限，5 秒无流动回退阶段短语；原始回复不删改。
- 默认向独立的 `pitools_activity` 提示词 section 注入中/英旁白约定，不替换其他插件的 section。可单独关闭 contract。
- 并行工具按完整调用 ID 配对；短语按确定性时间槽选择，保留中/英有序工具动作表。
- 使用独立 widget；不替换原生工作行、页脚或编辑器。

```text
/pitools activity help
/pitools activity on
/pitools activity off
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

默认中文，auto 使用系统 locale。偏好只通过 Pi 元数据保存到当前会话分支，新会话使用默认值。纯 shell / SSH 窗口没有 Pi 插件界面，需要先运行 `pi`。

## 数据边界与隐私

- 只显示 Pi 实际提供的可见思考；实时空思考显示占位，定稿后仍为空则收起。签名不当作思考，也不把缺失思考 Token 当作零。
- 输入仅显示提交时间/来源。工具显示执行开始、结束与耗时。模型显示整体消息生命周期、首个非空可见内容 delta 延迟及后续耗时。
- 模型计时是本地观测，**不是 provider TTFT 或内部推理耗时**。模型计时按精确 messageEntryId 保存，思考/回复行共用，不重复统计 usage。
- 只从当前会话分支恢复；没有保存的历史计时、Schema、嵌套结果或 Token 数据明确标为不可用，不猜测。
- 通过 Pi appendEntry 保存计时及偏好，不直接读写会话文件。不修改工具参数/结果，不访问其他会话。
- 内存约保留最近 2,000 个事件，运行中调用不淘汰。时间轴按事件顺序排列，不是按秒缩放的图；暂不提供鼠标拖选/缩放或图片灯箱。
- 外部文字上屏前清洗终端控制字符及双向文字控制符。工具已截断的输出无法恢复；图片只显示元信息。

**插件运行时不联网、不读凭证；默认 TS 核心不启动子进程。** 只有用户主动启用可选 Python/Rust 独立包（或在共享开发入口手动启用后端）时，才在交互会话启动一个私有 worker（见下文）。安装/更新的网络操作由 Pi 的包管理 CLI 完成，不在插件内部下载和执行代码。

工具参数/结果本身可能包含敏感内容，分享截图或提交 issue 前请检查；没有自动脱敏。仓库不包含真实会话、账号、日志或机器配置。

## 0.1.12 可选 Rust 活动核心

新增 `/pitools core rust`，默认仍是 TS，也保留 Python。**Rust 独立成品包附带匹配平台 binary，无需用户编译。** 插件不会运行时下载或编译；不支持的平台、binary/Unicode 版本不符或故障都会明确提示并回退 TS。开发者仍可用 `PITOOLS_RUST_CORE` 显式指定可信 executable。

已接入紧凑 delta 编码、查询/绘制共享截止时间、单次类型化解析及许可数据静态生成；保留任意 JS UTF-16 码元、完整事件与同步 TS 回退。**Rust 当前仍不是比 TS 更省资源的默认方案。** 两轮前后对照及独立唯一尾部补测分别保留；93% 是重复文本合成场景的桥接字节降幅，不是整体 CPU 降幅。见 [四项优化测量](docs/0.1.12-rust-optimization-measurement.md)。

成品选择与迁移见 [三包指南](docs/editions.md)，范围和兼容边界见 [0.1.12 Rust 活动核心](docs/0.1.12-rust-activity-core.md)。仍使用 0.1.11 的用户应先更新包，再使用 Rust 命令。

## 0.1.11 可选 Python 活动核心

首行活动（月相、阶段短语、旁白、并行工具、完成统计）的状态机已有 Python 实现，**默认仍是 TS 核心**，需要主动启用：

```text
/pitools core status
/pitools core python
/pitools core ts
```

也可在启动 Pi 前设置 `PITOOLS_CORE=python`，会话开始时启动一次。需要 Python 3.11+，仅用标准库；解释器按 `PITOOLS_PYTHON`（绝对路径或 PATH 上的名称）→ Windows `py -3` / `python` / `python3` → macOS/Linux `python3` / `python` 的顺序显式解析。找不到时提示并继续用 TS，**不会自动安装 Python 或任何包**。

- Python worker 只负责活动状态；轨迹、详情、搜索、主题、Markdown/高亮渲染仍由 TS 与 Pi 原生实现，界面、快捷键和 widget 名称不变。
- 私有 stdin/stdout JSONL，`shell:false`、参数数组、`-I -B` 隔离模式、最小环境变量（不转发模型 token / 账号变量），不开 TCP/HTTP，不读会话或凭证，不写文件。只发送活动所需的最小字段：旁白只发可见文本末尾 301 个 UTF-16 单元，工具只发命令/路径等摘要字段。
- TS 核心持续运行作为回滚：worker 启动失败、崩溃、坏 JSON、版本不符、2 秒无响应或反压超限时，提示一次并回退 TS，**不自动重启**；`/pitools core python` 可手动重试。`session_shutdown` / `/reload` / `core ts` 会结束 worker。
- `/pitools core status` 显示 worker pid。逐视图 TS 对照默认关闭（会额外耗 CPU），诊断时用 `/pitools core verify on` 或 `PITOOLS_CORE_VERIFY=1` 打开，状态里显示一致/不一致计数。
- delta 采用有界事件批次（名义 4ms、64KiB/64 条上限），不丢事件或改观测时间；关键事件先冲刷旧 delta。事件全部按序发送，另外合并“观察”：同一时刻最多一个视图请求在途；流式 delta 最多每 120 ms 请求一次视图（与宿主绘制节流一致），工具/消息结束等关键事件立即请求；视图内容不变不重绘；超时看门狗只在有请求在途时运行。
- 偏好不写入会话；`/reload` 后回到默认 TS，除非设置了 `PITOOLS_CORE=python`。

worker 是同一用户的本地进程，不是权限沙箱。设计与验证边界见 [0.1.11 Python 活动核心](docs/0.1.11-python-activity-core.md)。

## 0.1.10 渲染优化

结果详情不再重复序列化；内容页签复用未变正文，滚动/月相更新无需重新高亮全文。缓存随更新事件 revision、宽度、模式、主题与组件 invalidate 失效；单条目、8 MiB 估算预算，超预算仍完整显示但不缓存。概述/计时/Schema 保持动态。

指定 64 KiB 结果详情的隔离对照约 **23.77 ms → 0.83 ms/帧**，渲染输出一致；不是整体 CPU 减少 96% 或总内存保证。实现与验证边界见 [0.1.10 优化记录](docs/0.1.10-render-optimization.md)。

## 技术文档

- [当前 0.1.9 性能分析](docs/current-performance-analysis.md)：目前代码的 CPU/内存热点、已有保护及优化顺序；静态分析，不冒充实测。
- [当前性能 Windows 隔离实测](docs/current-performance-measurement.md)：受控堆增量、详情/流式耗时、异常刷新复现与临时缓存对照；不等于真实会话精确独占占用。
- [Python 核心替换技术思路](docs/python-migration.md)：接口层分工、内部协议、兼容性、安全边界和分阶段实施。
- [0.1.11 Python 活动核心](docs/0.1.11-python-activity-core.md)：第一阶段落地范围、协议、对照测试与未迁移部分。
- [0.1.11 性能对照](docs/0.1.11-performance-comparison.md)：双模式实测、批处理/文本热路径优化与测量边界；不宣称 Python 更省资源。
- [Rust 可行性调研](docs/rust-feasibility.md)：集成前的协议探针和字符串问题历史记录，不等于当前实现的性能。
- [0.1.12 Rust 活动核心](docs/0.1.12-rust-activity-core.md)：显式 opt-in、UTF-16、紧凑协议、调度与故障边界。
- [0.1.12 四项优化测量](docs/0.1.12-rust-optimization-measurement.md)：独立前后轮次、唯一尾部补测与性能限定。

## 开发与验证

```sh
git clone https://github.com/ZSY007/pitools.git
cd pitools
npm test
```

82 项 Node 测试无需 npm install；Python worker 测试在找不到解释器时跳过（可用 `PITOOLS_PYTHON` 指定），真实 Rust worker 测试需要显式设置 `PITOOLS_RUST_CORE`。Python 侧：

```sh
python -m unittest discover -s python/tests
```

CI 配置在 Windows / macOS / Linux 上使用 Node 24.12.0、Python 3.11 / 3.13 和显式构建的 Rust worker 运行纯数据/协议测试，不访问真实模型或用户会话；执行状态见顶部 Actions badge；CI 不等于用户实际终端/compositor 长测。

实际宿主回归需设置 `PI_HOST_ROOT` 为已安装的 `@earendil-works/pi-coding-agent` 包目录：

```sh
node scripts/verify-host.mjs
node scripts/verify-reload.mjs
```

设置 `PI_BUNDLED_LOADER=1` 可测试 bundled 加载器；`PI_EXTENSION_ENTRY` 可指定安装后的 index.ts。覆盖真实 Theme / Markdown / 高亮 / 主屏与全屏 TUI（底层内存终端）、深浅色与真彩/256 色、窄屏、流式事件、空思考、计时回放、搜索、隐藏、异常隔离及重复关闭。

0.1.12 已在 Windows Node 24.12.0 / Pi 1.0.4 验证；历史版本在 Windows Pi 1.0.2 与 Darwin arm64 Node 26.10.0 / Pi 1.0.0 验证。尚未完成用户 Mac 的 0.1.12 实际宿主验收。字体和 emoji 的最终视觉效果以实际终端为准。

运行时模块均使用 `.ts`，避免同进程热重载沿用旧 `.mjs` 导出。升级应替换完整包；模块版本不一致时在加载阶段 fail-fast，不注册会反复报错的事件处理器。

## 许可与署名

项目采用 [BSD-3-Clause](LICENSE)。活动短语、帧、提示词模板及派生的 mixSlot 算法来自 **dsh-working-activity 0.5.1**：

Copyright (c) 2026, chimney (ccch1mneyyy)，BSD-3-Clause。

原始数据含 1,241 条短语和 35 套帧，完整上游许可保留在 [data/activity/LICENSE](data/activity/LICENSE)，归属说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。不宣称上游作者认可或背书。

对其他 UI 插件的独立本地补丁不属于本仓库，也不是 pitools 的运行依赖；更新 pitools 不会覆盖它们。
