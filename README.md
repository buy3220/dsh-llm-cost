# dsh-llm-cost

给 [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) 的 Web 界面加一颗**人民币消费胶囊**，就放在内置 token 用量胶囊旁边：一眼看到**本对话累计消费**和**当前轮消费**，点开看按模型、时段、上下文档位拆开的明细。

内置那颗「用量 3.0M · 96.5%」胶囊完全不动，缓存命中率照旧。

```
底部 dock：
  ⏱ 12 轮 36 步 · 45.2 tok/s     🗄 3.0M · 96.5%     累计 ￥1.130393 · 本轮 ￥0.66917
                                ↑ 内置，未改动        ↑ 本插件新增

点击弹层：
  对话消费                                    ￥1.130393
  ─────────────────────────────────────────────────────
  本轮 #5
    消费                                        ￥0.66917
    输入（未缓存）                               233,228 tok
    缓存读取                                   9,290,112 tok
    输出                                          62,535 tok
    缓存命中率                                      97.6%
    deepseek-account/deepseek-flash · 空闲 ×44    ￥0.66917
  ─────────────────────────────────────────────────────
  本对话累计                          ￥1.130393 · 16.6M tok
```

## 功能

- **两个数字**：会话累计消费、当前轮消费，均为人民币。
- **明细**：未缓存输入 / 缓存读取 / 缓存写入 / 输出、缓存命中率，以及本轮和累计按 `模型 · 时段或上下文档位 × 次数` 分组的金额。
- **混合计费正确**：一轮里既有高峰又有空闲调用、或既有短上下文又有长上下文调用时，按**每次请求**分别计价再合并，分组如实展示。
- **完整模型调用**：普通助手请求，以及带 provider usage 的上下文压缩摘要，都计入 token 和金额。
- **每轮读数（可选）**：在每轮回复下方显示 `本轮 ￥…`，默认关闭。
- **开关**：插件行停用即整体移除（页面回到安装前原样）；插件页另有「在对话中显示消费」软开关。
- **价表自动更新**：插件页一键抓取 DeepSeek 与 xAI 官方价目页，带超时、重试、结构校验与回滚。
- **零依赖、零构建**：只用 Node 内置模块与浏览器里现成的 React，不需要 `npm install`，不需要打包。

## 安装

前置：DeepSeek Harness `>= 0.2.2-rc.5`，已能打开 Web 界面（`dsh web`）。

### 方式一：直接从 GitHub 安装（推荐）

在 DSH 的 **设置 → 插件 → 添加插件**，粘贴仓库地址：

```
github:buy3220/dsh-llm-cost
```

也接受 `https://github.com/buy3220/dsh-llm-cost`。需要固定版本时加 tag：

```
github:buy3220/dsh-llm-cost#v1.0.0
```

装完刷新一次页面即可看到胶囊（新客户端模块在页面加载时挂载）。

### 方式二：克隆后按本地目录安装

```bash
git clone https://github.com/buy3220/dsh-llm-cost.git
cd dsh-llm-cost
```

然后在 **设置 → 插件 → 添加插件** 里填**绝对路径**（例如 `/home/you/code/dsh-llm-cost`）。

### 方式三：让 Agent 装（等价于方式一）

在任意会话里让 Agent 执行：

```
plugin_manager install_bundle target="github:buy3220/dsh-llm-cost"
```

### 方式四：发布到 npm 之后按包名安装

```bash
npm publish
```

之后在「添加插件」里填 `dsh-llm-cost`（或 `@scope/dsh-llm-cost`，见文末改名清单）。

### 验证安装

- **设置 → 插件** 里出现「对话计费」一行，状态为启用。
- 任意对话底部出现第三颗胶囊：`累计 ￥… · 本轮 ￥…`。
- 设置 → 插件 → **对话计费** 页能看到当前价表与「从官网更新计费规则」按钮。

## 使用

| 位置 | 作用 |
| --- | --- |
| 底部胶囊 | 显示累计与本轮消费，点击打开明细 |
| 明细弹层 | 本轮 / 累计两组 token 与金额，按模型与档位分组 |
| 每轮回复下方 | 可选的本轮读数（插件页开启） |
| 设置 → 插件 → 对话计费 | 显示开关、每轮读数开关、更新价表、恢复内置价表、当前价表与状态 |

弹层按触发按钮的实测位置摆放：优先出现在胶囊上方，空间不够时出现在下方，始终限制在 12px 视口内边距里；Esc 或点击外部关闭。

## 计费口径

| 提供方 | 币种 | 分档 |
| --- | --- | --- |
| DeepSeek | **人民币，官网原价，不做汇率折算** | 北京时间周一至周五 `09:00–12:00`、`14:00–18:00` 为高峰，其余（含周末）为空闲 |
| Grok / xAI | 美元价 × 固定汇率（默认 **6.7**） | 单次请求 prompt ≥ 200,000 tokens 时，**整次请求**按长档计价 |

内置价表（`lib/table.js`，元 / 百万 tokens）：

| 模型 | 缓存命中（空闲/高峰） | 缓存未命中（空闲/高峰） | 输出（空闲/高峰） |
| --- | --- | --- | --- |
| `deepseek-flash` | 0.02 / 0.04 | 1 / 2 | 4 / 8 |
| `deepseek-v4-pro` | 0.15 / 0.30 | 4.5 / 9 | 13.5 / 27 |

官方注明仍可调用的 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 也按 `deepseek-flash` 的费率计入。

Grok（美元 / 百万 tokens，短档 <200k / 长档 ≥200k）：`grok-4.7`、`grok-4.6` 为 2.00 / 4.00 输入、0.50 / 1.00 缓存、6.00 / 12.00 输出；`grok-4.5`、`grok-4.3`、`grok-build-0.1`、`grok-4.20-*` 见 `lib/table.js`。

计费细节：

- 金额保留 **6 位小数**，第 7 位四舍五入，**去尾零**：`0.218679520 → ￥0.21868`。
- 非零但不足 `0.000001` 的显示 `￥<0.000001`，不显示 `￥0`。
- 逐项用整数（`BigInt`）累加后统一取整；明细里各分组行单独取整，因此各行相加可能与合计相差 `0.000001`，属正常取整。
- 缓存写入在两家都没有独立费率，按输入价计。
- 推理 token 是输出子集，不重复计价。
- **没有配置价格的模型不计入合计**，并在明细里单列。主胶囊不会把它显示成 ￥0：完全没有可定价调用时显示 `￥—`，只有部分可定价时显示 `￥已知金额+`。

## 配置

插件行支持可选配置（写在你自己的 profile patch 层里，升级不丢）：

```yaml
- id: llm-cost
  name: dsh-llm-cost
  config:
    fxRateCnyPerUsd: 6.7      # 只影响 Grok 等美元计价模型
    fetchTimeoutMs: 8000      # 单次抓取超时
    fetchAttempts: 3          # 抓取重试次数（含首次）
    dataDir: /path/to/dsh-home # 可选，默认 $DSH_HOME
```

## 数据位置

- 价表、开关、上次更新结果：`$DSH_HOME/storages/llm-cost/state.json`
- 会话数字不从客户端窗口计算，而由宿主的 `llmCost` 会话投影对**完整耐久日志**折叠，因此分页、上下文压缩都不影响结果。

## 从官网更新计费规则

插件页的「从官网更新计费规则」会并发抓取：

- <https://api-docs.deepseek.com/zh-cn/quick_start/pricing>（人民币）
- <https://docs.x.ai/developers/pricing>（请求 markdown，必要时回退 HTML）

抓取策略：单次 8 秒超时，最多 3 次尝试，退避 400 / 1200 / 3000ms，仅对网络错误、5xx、429 重试；4xx 与解析失败不重试。

抓完先做**基础结构签名校验**（币种、主要计价维度、双时段/双档行），结果分三类。计价单位、峰值窗口和档位阈值的动态校验仍是已知限制：

| 结果 | 含义 |
| --- | --- |
| `ok` | 结构与已知计价框架一致，价表已更新并立即用于历史与后续对话 |
| `partial` | 一方更新成功、另一方失败，成功的部分生效，失败的保留旧表 |
| `mismatch` | 官网计价框架变了（维度增减、改为按次或阶梯计价等）。**不写入**，旧价表继续生效，页面提示「计费规则不匹配」——这时需要更新代码适配 |

价表改动超过 ±50% 时会额外提示「价表变动较大，请核对」，但不会阻断；随时可点「恢复内置默认价表」回滚。

## 关闭与卸载

- **停用插件行**（设置 → 插件 → 对话计费 → 停用）：客户端模块卸载，胶囊与每轮读数消失，页面回到安装前原样；内置胶囊始终未被改动。
- **软开关**（插件页「在对话中显示消费」）：只隐藏界面，宿主继续计算，重新打开数字连续。
- **卸载**：价表文件保留在 `$DSH_HOME/storages/llm-cost/`，重装后沿用。

## 已知限制

1. 点完「更新计费规则」后，**价表页立刻显示新表**，但底部数字要等下一次模型调用结算才刷新——客户端投影按会话事件推送，宿主不会为改价单独广播。
2. DeepSeek 的**中国法定节假日与调休不单独处理**，只区分工作日与周末。节假日里的工作日会按高峰计价（偏高，最多约 ×2）。
3. 本地接口只允许回环地址访问，但没有额外鉴权——本机其它进程也能读取价表或触发一次抓取。
4. 抓取依赖官方页面结构。当前能识别明显的维度、币种和两档结构变化；对计价单位、峰值窗口和档位阈值的动态校验仍不完整，这部分需要后续补强。
5. 这里计的是“模型 token 费”。没有记录 provider usage 的辅助模型请求（例如 DSH 自动生成会话标题）无法精确计价；图片、语音、OCR、批处理、优先处理和服务端工具调用等非文本 token 费用也不在本插件口径内。

## 开发与测试

```bash
npm test     # 30 条用例：计价、档位、重试替换、压缩、路由、状态落盘、解析和结构签名
npm run check  # 逐文件 node --check
```

目录：

```
index.js            宿主入口：注册 llmCost 投影、加载价表、注册接口
lib/table.js        内置价表（人民币 / 美元）
lib/period.js       DeepSeek 北京时区高峰窗口
lib/cost.js         BigInt 计价与 6 位四舍五入、去尾零
lib/projection.js   会话投影：折叠 + wire 视图
lib/fetch-rules.js  官网抓取、解析、结构签名校验、重试
lib/store.js        状态落盘（原子写）
lib/routes.js       本地接口（/plugins/llm-cost/*）
client.js           胶囊、弹层、插件页（自绘控件，仅用主题 token）
test/               node --test 用例
docs/DETAIL.md      插件详情页文档
```

## 发布与改名清单

包名默认 `dsh-llm-cost`（客户端模块 id 必须与包名一致）。如果要改成 `@yourname/dsh-llm-cost` 或别的名字，**三处同时改**：

| 文件 | 字段 |
| --- | --- |
| `package.json` | `"name"` |
| `client.js` | `window.__ModuleLoader__.load({ id: '…' })` |
| `cordis.patch.yml` | `name: '…'` |

另外把 `package.json` 里的 `homepage` / `repository` / `bugs` 和 `LICENSE` 里的 `YOUR_NAME` 换成你自己的。

## English

`dsh-llm-cost` adds a CNY cost pill next to DeepSeek Harness's built-in token usage pill. It shows the conversation total and the current turn, with a click-open breakdown by model, DeepSeek peak/off-peak period and xAI context tier. The built-in pill is never touched.

Install from the Plugins settings section: add `github:buy3220/dsh-llm-cost` (or a cloned absolute directory path), then reload the page. No build step and no runtime dependencies.

Pricing: DeepSeek uses its official CNY table with no FX conversion; Grok uses its USD table multiplied by a configurable fixed rate (default 6.7). Amounts keep six decimals, rounded half up, trailing zeros trimmed. The plugin page can refresh both price tables from the official pages, validating the billing framework first and refusing to apply a structure it no longer understands.

## License

MIT — see [LICENSE](LICENSE).
