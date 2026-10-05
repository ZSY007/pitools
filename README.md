# pitools

[![tests](https://github.com/ZSY007/pitools/actions/workflows/test.yml/badge.svg)](https://github.com/ZSY007/pitools/actions/workflows/test.yml)

**Pi 终端里的轨迹、工具调用详情和工作状态。** Windows / macOS，终端原生，不打开浏览器。

当前版本 **0.1.10**。独立实现，界面参考 DeepSeek Harness 的 Trajectory。

## 安装与更新

需要 Node >= 22.19、Git，以及兼容的 Pi。已验证 Pi 1.0.0 / 1.0.2。

```sh
pi install git:github.com/ZSY007/pitools
```

之后更新 **只有 pitools**：

```sh
pi update git:github.com/ZSY007/pitools
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

**插件运行时不联网、不启动子进程、不读凭证。** 安装/更新的网络操作由 Pi 的包管理 CLI 完成，不在插件内部下载和执行代码。

工具参数/结果本身可能包含敏感内容，分享截图或提交 issue 前请检查；没有自动脱敏。仓库不包含真实会话、账号、日志或机器配置。

## 0.1.10 渲染优化

结果详情不再重复序列化；内容页签复用未变正文，滚动/月相更新无需重新高亮全文。缓存随更新事件 revision、宽度、模式、主题与组件 invalidate 失效；单条目、8 MiB 估算预算，超预算仍完整显示但不缓存。概述/计时/Schema 保持动态。

指定 64 KiB 结果详情的隔离对照约 **23.77 ms → 0.83 ms/帧**，渲染输出一致；不是整体 CPU 减少 96% 或总内存保证。实现与验证边界见 [0.1.10 优化记录](docs/0.1.10-render-optimization.md)。

## 技术文档

- [当前 0.1.9 性能分析](docs/current-performance-analysis.md)：目前代码的 CPU/内存热点、已有保护及优化顺序；静态分析，不冒充实测。
- [当前性能 Windows 隔离实测](docs/current-performance-measurement.md)：受控堆增量、详情/流式耗时、异常刷新复现与临时缓存对照；不等于真实会话精确独占占用。
- [Python 核心替换技术思路](docs/python-migration.md)：接口层分工、内部协议、兼容性、安全边界和分阶段实施；尚未重构。

## 开发与验证

```sh
git clone https://github.com/ZSY007/pitools.git
cd pitools
npm test
```

28 项单元测试无需 npm install。CI 在 Windows / macOS / Linux 上使用 Node 24 运行这些纯数据测试，不访问真实模型或用户会话。

实际宿主回归需设置 `PI_HOST_ROOT` 为已安装的 `@earendil-works/pi-coding-agent` 包目录：

```sh
node scripts/verify-host.mjs
node scripts/verify-reload.mjs
```

设置 `PI_BUNDLED_LOADER=1` 可测试 bundled 加载器；`PI_EXTENSION_ENTRY` 可指定安装后的 index.ts。覆盖真实 Theme / Markdown / 高亮 / 主屏与全屏 TUI（底层内存终端）、深浅色与真彩/256 色、窄屏、流式事件、空思考、计时回放、搜索、隐藏、异常隔离及重复关闭。

已在 Windows Node 24.12.0 / Pi 1.0.2 与 Darwin arm64 Node 26.10.0 / Pi 1.0.0 验证。字体和 emoji 的最终视觉效果以实际终端为准。

运行时模块均使用 `.ts`，避免同进程热重载沿用旧 `.mjs` 导出。升级应替换完整包；模块版本不一致时在加载阶段 fail-fast，不注册会反复报错的事件处理器。

## 许可与署名

项目采用 [BSD-3-Clause](LICENSE)。活动短语、帧、提示词模板及派生的 mixSlot 算法来自 **dsh-working-activity 0.5.1**：

Copyright (c) 2026, chimney (ccch1mneyyy)，BSD-3-Clause。

原始数据含 1,241 条短语和 35 套帧，完整上游许可保留在 [data/activity/LICENSE](data/activity/LICENSE)，归属说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。不宣称上游作者认可或背书。

对其他 UI 插件的独立本地补丁不属于本仓库，也不是 pitools 的运行依赖；更新 pitools 不会覆盖它们。
