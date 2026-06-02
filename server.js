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
    if (!data || data.is_available === false) {
      return res.json({
        ok: true,
        currency: "CNY",
        balance: fmtNumber(data?.balance_infos?.[0]?.total_balance),
        used: fmtNumber(data?.balance_infos?.[0]?.topped_up_balance),
        raw: data,
      });
    }
    return res.json({ ok: true, raw: data, currency: "CNY" });
  } catch (e) {
    return res.json({ ok: false, error: e.message });
  }
});

// ─── Volcano Engine (Ark) ──────────────────────────────────
app.get("/api/volcano", async (_req, res) => {
  const key = process.env.VOLCANO_API_KEY;
  if (!key) return res.json({ ok: false, error: "未配置 VOLCANO_API_KEY" });

  try {
    // Ark platform usage endpoint (ByteDance/Doubao)
    const r = await fetch(
      "https://ark.cn-beijing.volces.com/api/v3/usage?page_size=1&page_num=1",
      {
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
      }
    );
    const data = await r.json();
    return res.json({ ok: true, raw: data });
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
    return res.json({ ok: true, raw: data, currency: "CNY" });
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
