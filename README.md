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

```bash
# 克隆仓库
git clone https://github.com/xiaozishan/token-cost.git
cd token-cost

# 安装依赖
npm install

# 配置 API Key（将 .env.example 复制为 .env 并填入）
cp .env.example .env

# 启动服务
npm start
```

打开浏览器访问 **http://localhost:3456** 即可。

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

- **后端**：Node.js + Express
- **前端**：原生 HTML/CSS/JS（零依赖）
- **认证**：火山引擎 SigV4 签名
- **代理**：默认走 socks5h://127.0.0.1:7897

## License

MIT
