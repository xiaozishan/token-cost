# Token Cost 💰

API 余额监控仪表盘——实时查看 DeepSeek、火山引擎、Kimi 等 LLM 平台的账户余额。

![screenshot](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js)
![screenshot](https://img.shields.io/badge/license-MIT-blue)

## 功能

- **多平台支持**：DeepSeek / 火山引擎（含 Ark + Billing API）/ Kimi
- **实时余额**：一键刷新，自动 60 秒轮询
- **双主题**：跟随系统 / 亮色 / 暗色，手动切换
- **美观易用**：骨架屏加载、响应式设计，手机电脑均适配

## 快速开始

### 一键包（推荐）

从 [Releases](https://github.com/xiaozishan/token-cost/releases) 下载对应系统的可执行文件，
解压后 `public/` 文件夹和可执行文件放在同一目录，运行即可：

```bash
# Windows
token-cost-win.exe

# Linux
./token-cost-linux
```

打开浏览器访问 **http://localhost:3456**，在卡片中直接输入 API Key 即可查询余额。

### 源码运行

```bash
git clone https://github.com/xiaozishan/token-cost.git
cd token-cost
cp .env.example .env   # 或直接在网页卡片中输入 Key
node server.js         # 访问 http://localhost:3456
```

## 环境变量

| 变量 | 说明 | 获取地址 |
|------|------|----------|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | [platform.deepseek.com](https://platform.deepseek.com) |
| `VOLCANO_API_KEY` | 火山引擎 Ark 密钥 | [console.volcengine.com/ark](https://console.volcengine.com/ark) |
| `VOLCANO_AK` | 火山引擎 Access Key | [console.volcengine.com/iam/keymanage](https://console.volcengine.com/iam/keymanage) |
| `VOLCANO_SK` | 火山引擎 Secret Key | 同上 |
| `KIMI_API_KEY` | Kimi (Moonshot) API 密钥 | [platform.moonshot.cn](https://platform.moonshot.cn) |

> 火山引擎的 AK/SK 仅用于查询计费余额，需在控制台为密钥授权 **BillingFullAccess** 权限。

## 技术栈

- **后端**：Node.js 原生 http 模块（零外部依赖）
- **前端**：原生 HTML/CSS/JS（零依赖）
- **认证**：火山引擎 SigV4 签名
- **一键包**：使用 Node.js SEA 打包为单文件可执行程序

## License

MIT
