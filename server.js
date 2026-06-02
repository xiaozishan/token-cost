require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3456;

app.use(express.static(path.join(__dirname, "public")));

function fmtNumber(n) {
  if (n == null || isNaN(n)) return null;
  return +n.toFixed(4);
}

// ─── DeepSeek ──────────────────────────────────────────────
app.get("/api/deepseek", async (_req, res) => {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return res.json({ ok: false, error: "未配置 DEEPSEEK_API_KEY" });

  try {
    const r = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await r.json();
    if (!data || !data.is_available) {
      return res.json({
        ok: true,
        balance: fmtNumber(data?.balance_infos?.[0]?.total_balance),
        used: fmtNumber(
          (+(data?.balance_infos?.[0]?.topped_up_balance || 0) +
            +(data?.balance_infos?.[0]?.granted_balance || 0)) -
            +(data?.balance_infos?.[0]?.total_balance || 0)
        ),
        currency: "CNY",
      });
    }
    return res.json({ ok: false, error: data?.error?.message || "未知错误" });
  } catch (e) {
    return res.json({ ok: false, error: e.message });
  }
});

// ─── Volcano Engine (Ark) ──────────────────────────────────
app.get("/api/volcano", async (_req, res) => {
  const key = process.env.VOLCANO_API_KEY;
  if (!key) return res.json({ ok: false, error: "未配置 VOLCANO_API_KEY" });

  try {
    // Ark platform doesn't expose billing/usage via API.
    // Verify key is valid by listing models, then try billing.
    const headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };

    const [modelsR, billingR] = await Promise.allSettled([
      fetch("https://ark.cn-beijing.volces.com/api/v3/models", { headers }),
      fetch(
        "https://open.volcengineapi.com/?Action=QueryBalanceAcct&Version=2022-01-01",
        { headers }
      ),
    ]);

    const models =
      modelsR.status === "fulfilled" && modelsR.value.ok
        ? await modelsR.value.json()
        : null;

    const billing =
      billingR.status === "fulfilled" && billingR.value.ok
        ? await billingR.value.json()
        : null;

    const activeModels = models?.data?.length || 0;

    return res.json({
      ok: true,
      activeModels,
      models,
      billing,
      hint: activeModels
        ? "API Key 有效。详细余额/消耗需在火山引擎控制台查看。"
        : "API Key 无效或已过期",
    });
  } catch (e) {
    return res.json({ ok: false, error: e.message });
  }
});

// ─── Kimi / Moonshot ──────────────────────────────────────
app.get("/api/kimi", async (_req, res) => {
  const key = process.env.KIMI_API_KEY;
  if (!key) return res.json({ ok: false, error: "未配置 KIMI_API_KEY" });

  try {
    const r = await fetch("https://api.moonshot.cn/v1/users/me/balance", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await r.json();
    if (data && data.data && data.data.available_balance != null) {
      const cash = +data.data.cash_balance || 0;
      const voucher = +data.data.voucher_balance || 0;
      const available = +data.data.available_balance;
      return res.json({
        ok: true,
        balance: fmtNumber(available),
        used: fmtNumber(cash + voucher - available),
        currency: "CNY",
      });
    }
    return res.json({ ok: false, error: data?.message || "未知错误" });
  } catch (e) {
    return res.json({ ok: false, error: e.message });
  }
});

// ─── Combined endpoint ────────────────────────────────────
app.get("/api/all", async (_req, res) => {
  const [deepseek, volcano, kimi] = await Promise.all([
    fetch(`http://localhost:${PORT}/api/deepseek`).then((r) => r.json()),
    fetch(`http://localhost:${PORT}/api/volcano`).then((r) => r.json()),
    fetch(`http://localhost:${PORT}/api/kimi`).then((r) => r.json()),
  ]);
  res.json({ deepseek, volcano, kimi });
});

const os = require("os");

function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`token-cost running at:`);
  console.log(`  http://localhost:${PORT}`);
  getLocalIPs().forEach((ip) => console.log(`  http://${ip}:${PORT}`));
  console.log("Other devices on the same network can use the IP addresses above.");
});
