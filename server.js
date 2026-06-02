require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3456;

app.use(express.static(path.join(__dirname, "public")));

function fmtNumber(n) {
  if (n == null || n === "") return null;
  const num = Number(n);
  if (isNaN(num)) return null;
  return +num.toFixed(4);
}

// ─── Volcengine SigV4 ──────────────────────────────────────
function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmacHex(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function volcSign(method, host, pathname, query, ak, sk) {
  const now = new Date();
  const isoStr = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const ts = isoStr.replace(/[:\-]|\.\d{3}/g, "");
  const dateStamp = ts.slice(0, 8);

  const region = "cn-beijing";
  const service = "billing";
  const algorithm = "HMAC-SHA256";

  const bodyHash = sha256Hex("");

  // Only host and x-date are signable (content-type is unsignable per Volcengine spec)
  const signedHeadersStr = "host;x-date";
  const canonicalHeaders =
    "host:" + host + "\n" +
    "x-date:" + ts + "\n";

  const canonicalRequest = [
    method,
    pathname,
    query,
    canonicalHeaders,
    signedHeadersStr,
    bodyHash,
  ].join("\n");

  const credentialScope = dateStamp + "/" + region + "/" + service + "/request";
  const stringToSign = [
    algorithm,
    ts,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmacHex(sk, dateStamp);
  const kRegion = hmacHex(kDate, region);
  const kService = hmacHex(kRegion, service);
  const kSigning = hmacHex(kService, "request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authorization =
    algorithm +
    " Credential=" + ak + "/" + credentialScope +
    ", SignedHeaders=" + signedHeadersStr +
    ", Signature=" + signature;

  return { authorization, xDate: ts };
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
    if (data && data.is_available) {
      const b = data.balance_infos[0];
      return res.json({
        ok: true,
        balance: fmtNumber(b.total_balance),
        used: fmtNumber(
          +b.topped_up_balance + +b.granted_balance - +b.total_balance
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
  const arkKey = process.env.VOLCANO_API_KEY;
  const ak = process.env.VOLCANO_AK;
  const sk = process.env.VOLCANO_SK;

  if (!arkKey)
    return res.json({ ok: false, error: "未配置 VOLCANO_API_KEY" });

  try {
    const headers = {
      Authorization: `Bearer ${arkKey}`,
      "Content-Type": "application/json",
    };

    // 1. List models to verify Ark key
    const modelsR = await fetch(
      "https://ark.cn-beijing.volces.com/api/v3/models",
      { headers }
    ).catch(() => null);
    const models = modelsR && modelsR.ok ? await modelsR.json() : null;
    const activeModels = models?.data?.length || 0;

    // 2. Query billing via Volcengine OpenAPI with AK/SK (SigV4)
    let balance = null, billingError = null;
    if (ak && sk) {
      try {
        const host = "billing.volcengineapi.com";
        const query = "Action=QueryBalanceAcct&Version=2022-01-01";
        const sig = volcSign("GET", host, "/", query, ak, sk);

        const billingR = await fetch(
          `https://${host}/?${query}`,
          {
            headers: {
              Host: host,
              "X-Date": sig.xDate,
              Authorization: sig.authorization,
            },
          }
        );
        const billingData = await billingR.json();

        if (billingData.ResponseMetadata?.Error) {
          const err = billingData.ResponseMetadata.Error;
          if (err.Code === "SignatureDoesNotMatch") {
            billingError = "AK/SK 签名验证失败，请确认：1) SK 完整正确 2) 该密钥已在火山引擎控制台授权 BillingFullAccess 权限";
          } else if (err.Code === "InvalidCredential" || err.Code === "Unauthorized") {
            billingError = "AK/SK 无权访问计费API，请在控制台为该密钥授权 Billing 权限";
          } else if (err.Code === "InvalidAction") {
            billingError = "QueryBalanceAcct API 不可用，可能已变更";
          } else {
            billingError = err.Message || err.Code || "未知错误";
          }
        } else if (billingData.Result?.AvailableBalance !== undefined) {
          balance = parseFloat(billingData.Result.AvailableBalance);
        } else if (billingData.Result?.AccountBalance !== undefined) {
          balance = parseFloat(billingData.Result.AccountBalance);
        }
      } catch (_) {
        billingError = "计费API请求失败";
      }
    }

    return res.json({
      ok: true,
      activeModels,
      balance: fmtNumber(balance),
      currency: "CNY",
      hint: billingError
        ? billingError
        : !ak || !sk
          ? "未配置 AK/SK，仅显示 Ark API 状态。配置后可查询账户余额。"
          : balance != null
            ? ""
            : "未查询到余额数据",
      billingOk: balance != null,
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
