# pitools 替换为 Python 核心：技术思路

> 状态：方案研究，尚未实施。基线为 pitools 0.1.9。本轮不做重构、原型、模型请求或压测。
>
> **当前版本的性能分析单独放在 [current-performance-analysis.md](current-performance-analysis.md)**。本文只讨论如何替换业务核心，不把迁移后的预测当成目前的性能结论。

## 1. 可行性结论

Python 可以承担轨迹状态、工具配对、搜索、活动状态机、短语选择和回放投影。但是当前 Pi 原生扩展通过 Node.js 中的 JS/TS 接口接收事件、注册快捷键、使用主题和绘制自定义组件，不能直接把 entry 改成 `.py`。

推荐候选架构：**保留必要的 JS/TS 宿主接口和原生 UI，把业务核心逐步替换成 Python worker。** 接口层可以是普通 JavaScript，不一定要 TypeScript；但要维持现有原生界面，就不能无条件承诺完全没有 JS。

目标是提高 Python 使用者的可维护性，不是改变 GitHub 语言比例，也不是承诺 CPU/RSS 自动下降。

## 2. 两条路线

| 路线 | 能保留什么 | 主要代价 |
|---|---|---|
| 原生 Pi 插件 + Python worker（推荐研究） | 现有 widget/详情、主题、快捷键、HUD 共存 | 需要 JS/TS 适配层、解释器分发、内部通信与生命周期管理 |
| 独立 Python TUI + Pi 官方 RPC | Python 可负责完整前端，通过协议控制 Pi | 是新的客户端架构，需要重做终端输入、主题和 UI；现有 HUD 不能原样沿用 |

官方 RPC 文档说明：`custom()` 不提供原生自定义界面，footer/editor/theme 等有 no-op 或降级；widget 只接受字符串数组，不接受当前 component factory。不能把 RPC 说成现有原生 UI 的等价接口。

推荐路线中，Python worker **不再启动一套 Pi RPC 或模型会话**；模型、工具、会话仍由现有 Pi 管理。内部 worker 协议与官方 Pi RPC 是不同协议。

## 3. 模块如何拆分

```text
Pi 原生 Node 进程
  └─ JS/TS 宿主适配层 + 原生 UI
       ├─ 事件接入、时钟观测、消息对象身份
       ├─ 原始对象句柄、Schema、元数据提交
       ├─ 命令/快捷键、主题/高亮/Markdown
       ├─ 同步 render 读取已准备的视图缓存
       └─ 私有 stdin/stdout JSONL
            └─ Python worker
                 ├─ TraceStore / 工具配对 / 索引
                 ├─ 搜索与分支回放投影
                 ├─ 活动状态 / 旁白 / 短语选择
                 └─ 返回视图增量和受限诊断
```

| 当前模块 | 拟迁移内容 | 留在宿主的内容 |
|---|---|---|
| `index.ts` | 业务状态和视图投影逻辑 | Pi 事件、命令/快捷键、widget/详情组件、appendEntry、身份绑定、观测时间 |
| `core.ts` | store、索引、配对、校验、搜索、回放投影 | 与原始消息引用和 Pi 条目绑定相关的部分 |
| `activity.ts` | 状态机、确定性短语、并行工具、旁白、完成统计 | 调度与最终列宽校验；可按 worker 返回的锚点在宿主绘帧 |
| `rendering.ts` | 第一阶段不迁移 | 继续使用 Pi 的 Theme、Markdown、高亮和 ANSI 排版 |
| `data/activity/data.ts` | Python 使用现有 JSON 数据 | 在回滚/契约依赖解除前，不贸然删除旧 TS 数据模块 |

核心可以 Python 化，但接口层不一定只有几十行；事件兼容、完整详情、取消和 UI 都需要代码。不能用“很薄”掩盖实际维护成本。

## 4. 数据归属与完整性

- **原始完整参数、结果、Schema、消息对象：** 优先留在 Pi/宿主侧，以受限句柄引用，不每次把所有大 JSON 复制到 Python。
- **索引、工具生命周期、活动状态、匹配结果：** Python 核心维护。
- **全文搜索：** 需要投影相关文本或索引，因此可能有额外表示；不能宣称完全零拷贝。
- **完整详情：** 宿主按句柄获取原始数据并渲染。短摘要可以限制长度，完整详情不能因此被截断。
- **计时/配置元数据：** 仍由宿主校验后通过 Pi API 写入，不允许 worker 任意写会话文件或任意 appendEntry。
- **主题与排版：** 初期只有 Pi 一套权威实现，避免 JS/Python 两边宽度、ANSI 和 Markdown 行为分叉。

缓存与句柄要有生命周期/字节预算。不能在两个进程分别常驻完整工具结果、全文、JSON、搜索副本和排版结果，然后说只是换了一种语言。

## 5. 内部协议设计

### 5.1 示意字段（不是已存在的接口）

```json
{"protocol":1,"epoch":4,"seq":27,"type":"text_delta","messageKey":"m-8","contentIndex":0,"observedAtMs":1733234401000,"delta":"检查结果"}
```

- `protocol`：hello/ready 时校验的协议版本，独立于业务版本。
- `epoch`：当前会话/分支代次，切换后递增；旧回包不能写进新分支。
- `seq`：事件有序序号；并行请求另有 request ID。
- `messageKey`：宿主按对象身份分配的临时 ID，不按文本/时间戳猜测。
- `observedAtMs`：宿主本地事件观察点，不是 Python 收到数据的时刻或 provider 时刻。

### 5.2 必须处理的时序

1. `message_end` 后 Pi 才持久化助手条目；在 `turn_end` 收到确切 entry ID 后绑定。中断 fallback 仍由宿主在当前分支按相同对象身份查找。
2. 初期保持现有计时口径。若未来用单调时钟计算时长，应单独定义版本并保留墙钟显示，不能混算 JS/Python 的单调时钟原点。
3. UTF-8 字节流只按 LF 分帧，可去掉 LF 前的 CR；U+2028/U+2029 不应被错误当作协议行界。stdout 只发协议，诊断走 stderr。
4. 异步、有界队列与 drain；Pi render 不同步等 worker，普通模型事件回调也不等待 Python 完成排版/搜索。
5. 过载可合并可重建的临时显示状态，但 start/end、身份绑定和首可见内容标记不能丢。合并 delta 必须有权威快照重同步，不能悄悄损失最终正文。
6. `partialResult` 依工具契约表示最新结果，不能统一按字符串增量追加。
7. 必须传输的大数据使用受控分块与校验；不能用过小的行上限把合法完整详情截断。
8. ready 超时、EOF、崩溃、坏 JSON、请求超时、版本不匹配和 reload 必须清理，不无限自动重启。
9. 视图未准备好/过期时明确显示状态，不伪造待机、完成或历史耗时；worker 故障不等于整个模型任务失败。

## 6. 跨语言兼容陷阱

| 项目 | 必须保持的语义 |
|---|---|
| `mixSlot` | JS Math.imul/位运算固定 32 位；Python int 不溢出，需精确掩码、signed/unsigned 转换和逻辑右移 |
| 300 单位旁白尾部 | JS slice/length 按 UTF-16 code unit，Python 字符串通常按 code point；严格兼容或明确版本化改变 |
| Unicode/列宽 | len 不等于终端宽度；中文、emoji、组合字符和 FE0E 不能丢，最终以宿主列宽校验 |
| 周末/节日/夜间 | JS getDay 与 Python weekday 编号不同，时区和 locale 必须统一 |
| 中/英工具正则 | 保持各语言有序匹配，不改为无序规则或不同的 fullmatch；校验 flags 与 Unicode 行为 |
| JSON 缺失值 | undefined 的省略与 None/null 不同；协议显式区分缺失，禁止 NaN/Infinity |
| 去重 | JS WeakSet 是对象身份；跨进程用 messageKey/epoch，不按内容合并两条真实消息 |
| 增量清洗 | CRLF、控制序列和 Unicode 可跨 delta，需有状态处理或权威结束快照校正 |

原始 JSON 数据和 BSD 许可完整保留；不合并语言池、不重排动作表、不擅自更换抽样算法、不删帧变体选择符，不宣称上游作者背书。

## 7. 必须保留的产品约束

- 工具完整 ID 配对、并行乱序结束、未记录数据明确缺失。
- 可见思考与 opaque signature 分开，空思考收起，不解码隐藏内容。
- 思考/回复共用整条助手消息 usage，不重复统计、不估算未知 Token。
- 输入时间、工具耗时和模型本地首内容延迟不混用，不冒充 provider TTFT。
- 当前分支重放，原始消息不修改，元数据不重复保存完整正文，也不进入模型上下文。
- 原生 widget 名称、Alt 快捷键和 `/pitools` 命令兼容；不接管其他插件的页脚、编辑器和工作指示器。
- 标题文字统一 accent，只有状态圆点变色；正常待机/完成无动画时钟，隐藏继续记录。
- shutdown/reload 不遗留 worker、监听器、队列或计时器；切换模式不重复计时和 usage。

## 8. 分发与安全边界

- Git 包仍提供 JS/TS entry，附 Python 文件；初期研究仅标准库实现和 Python >= 3.11，最低版本尚未验证。
- Python 不存在时明确提示并回退旧核心/关闭候选模式，不自动 pip install 或下载解释器。
- 用明确解释器与 worker 路径、参数数组、shell:false；Conda/pyenv/Windows launcher 需要专项兼容，不能假定 python 名称总指向预期解释器。
- 环境变量按最小允许集合传递，不转发所有宿主环境，worker 不需要模型 token、账号文件或 hook 密钥。
- 私有管道，不开放 TCP/HTTP；不提供任意读文件/执行命令能力，不把工具参数当 Python 代码。
- 可以读取自己的静态数据资产，但不扫描用户会话、凭证、模型配置或任意工具路径。
- 返回内容采用白名单/schema/epoch/handle/大小/超时校验，日志只记计数和诊断类别，默认不写正文、结果或 signature。
- 不替换 Pi 启动器，不静默 reload 工作中的任务，不安装后台更新服务。

**采用 worker 后，“不启动子进程”的现有声明必须更新。** 隔离进程不是权限沙箱：同一用户的 Python 默认具有该用户的文件权限。需要审查，而不是因为是本地进程就当作绝对安全。

## 9. 分阶段实施与回滚

1. **先定义基线和 golden fixtures。** 原有排序、空思考、计时、完整详情和活动规则先固化；当前性能热点见独立报告。
2. **拆出宿主接口与业务逻辑。** 保持 TS 现有默认实现，不同时重写 UI、存储和协议。
3. **非默认 Python 原型。** 先迁移活动状态、配对和索引；UI 保持 Pi 原生。
4. **协议/故障验收。** 测反压、旧 epoch、未知 ID、崩溃、缺解释器、版本混装、取消和重复 reload。shadow 双核心只用于隔离验证，不默认运行。
5. **跨平台与共存验收。** Windows/macOS、两种 Pi 加载器、多主题、窄宽屏、HUD 及实际终端；不是只测 Python 单元函数。
6. **可选切换，再决定默认。** 保留旧核心可回滚，沿用旧元数据，缺失的历史数据仍明确缺失。

维护性收益、运行代价和分发复杂度都透明后，再决定是否正式默认。若完全不愿保留 JS/TS，就应单独规划 Python TUI + Pi RPC，而不是称作现有原生插件的等价替换。

## 10. 参考

本研究已阅读目标宿主对应的 SDK、CLI Integration、RPC、RPC Extension UI、JSON Event Stream、Message Types、Session Format 文档和扩展示例。在线 main 文档会变化，实施时必须核对目标宿主版本：

- [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
- [RPC Extension UI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-extension-ui.md)
- [JSON Event Stream](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md)
- [Message Types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/message-types.md)
- [Session Format](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md)

原有 23 项单元测试、宿主与热重载验证脚本是后续迁移的回归基础；本轮没有执行它们，也没有新增 Python 运行实现。
