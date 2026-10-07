# Rust 可行性调研（0.1.11 发布时）

## 结论

**Rust 有机会比当前 Python worker 更适合长期的可选计算核心，尤其是启动与常驻内存；但还没有证据证明它比默认 TS 的整个 pitools 更快/更省。** 0.1.11 不集成 Rust，不改变默认 TS。下面的 Rust 程序只是独立协议探针，不是活动状态机或功能完成的替代核心。

当前成本不只是 Python 语言：TS 同步回退仍执行，宿主事件遍历、累计文本处理、JSON 编码、管道、视图调度与原生 Pi 渲染均存在。换 Rust 不会自动消除这些成本，也不会替代已经约 0.58ms/帧的缓存热详情。

## 实际做过的小范围验证

本地已存在 Rust 1.92.0、Cargo 与缓存的 serde_json 1.0.147；离线构建独立 release 探针，没有安装/升级工具链，没有把二进制或 Cargo 依赖加入插件。探针与 Python 3.13.14 程序做相同工作：逐行 JSON 解码、统计 64 个字符串的 UTF-16 单元数、编码 JSON 回复，私有 stdin/stdout；无业务状态/UI/TS 镜像。

Windows 上每种程序交替重复五次，共十个样本。每个样本 800 帧 × 64 字符串 × 301 UTF-16 单元；输入用相同 Unicode 转义 JSON，语义结果全部核对，进程全部退出。

| 五次中位数 | Python 协议探针 | Rust 协议探针 |
|---|---:|---:|
| 子进程启动至 ready | 91.70ms | 5.24ms |
| 800 帧往返墙钟 | 241.03ms | 185.58ms |
| 仅 worker CPU 时间 | 234.375ms | 156.25ms |
| 仅 worker CPU 周期 | 787.62 百万 | 586.70 百万 |
| worker 工作集 | 25.43MiB | 4.02MiB |
| worker 私有提交 | 9.84MiB | 1.03MiB |

Rust 优化二进制约 214KiB。阶段整机 CPU 中位约 Python 8.13%、Rust 7.92%，仍非完全空闲；Rust 启动有 50.14ms 离群样本。墙钟范围 Python 239.56–246.58ms、Rust 143.66–185.97ms。

**解释边界：** 该特定协议/统计场景 Rust 往返约少 23%，启动和进程基线内存更低。不是“pitools 快 23%”，不能把探针的 4MiB 当完整 Rust 核心内存，也不能把两份独立中位数相加预测宿主总量。缺少真实活动状态、短语资产、完整 golden parity、Pi/HUD 与 macOS 的 Rust 实测；未与等价 TS 协议/算法实现比较。

机器工件留在本地审计目录的 `rust-research-011/`：两份探针、Cargo.lock、release 构建、测量框架、十个原始样本与摘要。公开仓库只包含本文，不包含这些实验二进制或机器配置。

## 必须先解决的兼容问题

1. **孤立 UTF-16 代理项已经实证不兼容。** Python json 接受 `"\ud83d"`，并能保持一个 UTF-16 单元；本次 Rust `serde_json::Value` 因 Rust String 的 Unicode scalar 要求返回 parse_error。pitools 的最后 301 单元切片可能产生这种输入，不能用丢弃或 U+FFFD 替换掩盖。需要可保留 `Vec<u16>` 的协议字段或定制解码，不直接将现有 JSON String 全部映射为 Rust String。数组/base64/自定义解码本身也有成本，必须重测。
2. JS `mixSlot` 的 ToInt32、固定宽度溢出与逻辑右移需明确实现。不能依赖 Rust debug/release 溢出行为差异。
3. JS `\s`/trim、正则非 Unicode 大小写行为、UTF-16 截断、toFixed 边界、本地日历/星期、列宽、FE0E、opaque signature、消息 identity/epoch 都须复用既有 golden 和实时对照，而不是“近似一样”。
4. 保留 BSD-3-Clause 数据资产和 upstream notice；不把真实参数/正文写入错误诊断、日志或崩溃转储。
5. 异常必须及时切回 TS，不能改写已有工具完成事实、usage、历史时间或原始消息。

## 三种集成方式

| 方式 | 收益可能 | 成本与风险 | 建议 |
|---|---|---|---|
| Rust 独立 worker | 不需要 Python 解释器，低进程基线，复用进程隔离/回退架构 | TS 镜像、JSON 编码/解析/管道仍在；要分平台分架构二进制 | 先做可选实验原型，最接近现有边界 |
| Rust Node-API addon（napi-rs） | 可避免外部 worker 和 JSONL，适合已证实 CPU 密集的批量纯函数 | 原生 crash 可影响 Pi；同步大调用仍阻塞事件循环；分平台二进制/ABI/卸载热重载和安全审计更复杂 | 不建议直接替换当前活动 UI 核心；以后评估纯函数热路径 |
| Rust → Wasm | 无子进程、较统一的产物，故障隔离优于原生 addon 的某些路径 | JS/Wasm 字符串/内存复制、初始化与协议成本；并非天然比 V8 快；阻塞/资源边界仍需设计 | 可作为算法原型的第二条路线，不宣称自动优势 |

Node-API 的 ABI 稳定性不代表任意系统/架构二进制互通，也不消除 napi-rs feature 所需 Node-API 版本要求。Windows x64/arm64、macOS arm64/x64、Linux glibc/musl 等要明确支持范围。用户安装时不应被隐式要求装 Cargo；可选 Rust 不可在插件运行中自动下载/编译可执行文件。worker 与 native addon 都不是权限沙箱。

## 下一步建议（未实施）

1. 先把 worker 适配接口从 Python 具体实现抽象出来，维持默认 TS。
2. 实验性 Rust 活动 worker：全 golden 24 场景/1,157 视图、随机 parity、取消启动、坏帧/超额/旧 epoch/断管清理，尤其是孤立代理项。
3. 用同一个真实宿主框架测 TS/Python/Rust 三组，完整异步排空、独立 CPU/周期/工作集/私有提交；至少 Windows 与已授权 Mac 实机。
4. 只有功能一致且真实场景收益明确才考虑发行 optional Rust；默认切换需另行决定。
5. 不直接删除同步 TS。要减少双重计算，先设计 snapshot/ack/unconfirmed replay 和有界恢复，作为独立架构改动审查。

## 一手资料

- [Rust Book：zero-cost abstractions 的具体含义](https://doc.rust-lang.org/book/ch13-04-performance.html)：不是任意 Rust 程序相对 JS/Python 的速度保证。
- [Cargo profiles](https://doc.rust-lang.org/cargo/reference/profiles.html)：探针使用 release opt-level=3、thin LTO；优化级别需按目标测量。
- [rustc 平台支持](https://doc.rust-lang.org/rustc/platform-support.html)：包括 Apple Silicon 与 Windows MSVC 的 tier 信息。
- [serde_json Value](https://docs.rs/serde_json/latest/serde_json/)：动态 JSON 字符串落入 Rust String；孤立代理项问题由本次探针额外实证。
- [napi-rs 项目说明](https://github.com/napi-rs/napi-rs)：Node-API 集成路线。
- [Node-API 官方文档](https://nodejs.org/api/n-api.html)：ABI 稳定性与线程安全函数等边界，原生 addon 仍需平台支持。
