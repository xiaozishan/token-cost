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

// ─── Shared fetch helpers ──────────────────────────────────
async function fetchDeepSeek() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return { ok: false, error: "未配置 DEEPSEEK_API_KEY" };
  try {
    const r = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await r.json();
    if (data && data.is_available) {
      const b = data.balance_infos[0];
      return {
        ok: true,
        balance: fmtNumber(b.total_balance),
        used: fmtNumber(+b.topped_up_balance + +b.granted_balance - +b.total_balance),
        currency: "CNY",
      };
    }
    return { ok: false, error: data?.error?.message || "未知错误" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── Volcano Engine: Ark client ────────────────────────────
async function queryArkModels(apiKey) {
  if (!apiKey) return { ok: false, activeModels: 0 };
  try {
    const r = await fetch("https://ark.cn-beijing.volces.com/api/v3/models", {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });
    if (!r.ok) return { ok: false, activeModels: 0 };
    const data = await r.json();
    return { ok: true, activeModels: data?.data?.length || 0 };
  } catch (_) {
    return { ok: false, activeModels: 0 };
  }
}

// ─── Volcano Engine: Billing client ────────────────────────
function parseVolcanoBalance(result) {
  if (!result) return null;
  const raw = result.AvailableBalance ?? result.AccountBalance ?? null;
  return raw == null ? null : fmtNumber(Number(raw));
}

function classifyBillingError(error) {
  if (!error) return null;
  const code = error.Code || "";
  if (code === "SignatureDoesNotMatch") {
    return {
      code: "SIGNATURE_MISMATCH",
      detail: "AK/SK 签名验证失败，请确认：1) SK 完整正确 2) 该密钥已在火山引擎控制台授权 BillingFullAccess 权限",
    };
  }
  if (code === "InvalidCredential" || code === "Unauthorized") {
    return {
      code: "UNAUTHORIZED",
      detail: "AK/SK 无权访问计费API，请在控制台为该密钥授权 Billing 权限",
    };
  }
  return { code: "BILLING_ERROR", detail: error.Message || code || "未知错误" };
}

async function queryBillingBalance(ak, sk) {
  if (!ak || !sk) {
    return {
      ok: true,
      balance: null,
      diagnostics: {
        code: "AK_SK_MISSING",
        detail: "未配置 AK/SK，仅显示 Ark API 状态。配置后可查询账户余额。",
      },
    };
  }
  try {
    const host = "billing.volcengineapi.com";
    const query = "Action=QueryBalanceAcct&Version=2022-01-01";
    const sig = volcSign("GET", host, "/", query, ak, sk);
    const r = await fetch(`https://${host}/?${query}`, {
      headers: { Host: host, "X-Date": sig.xDate, Authorization: sig.authorization },
    });
    const data = await r.json();

    const billingErr = data.ResponseMetadata?.Error;
    if (billingErr) {
      return { ok: true, balance: null, diagnostics: classifyBillingError(billingErr) };
    }

    const balance = parseVolcanoBalance(data.Result);
    return {
      ok: true,
      balance,
      diagnostics: balance != null ? null : { code: "BALANCE_NOT_FOUND", detail: "未查询到余额数据" },
    };
  } catch (_) {
    return { ok: true, balance: null, diagnostics: { code: "BILLING_REQUEST_FAILED", detail: "计费API请求失败" } };
  }
}

// ─── Volcano Engine: Presenter ─────────────────────────────
function presentVolcanoResult(arkResult, billingResult) {
  const diag = billingResult.diagnostics;
  return {
    ok: true,
    activeModels: arkResult.activeModels,
    balance: billingResult.balance,
    currency: "CNY",
    diagnostics: diag,
    hint: diag ? diag.detail : "",
    billingOk: billingResult.balance != null,
  };
}

// ─── Volcano Engine: Orchestrator ──────────────────────────
async function fetchVolcano() {
  const arkKey = process.env.VOLCANO_API_KEY;
  if (!arkKey) return { ok: false, error: "未配置 VOLCANO_API_KEY" };
  try {
    const arkResult = await queryArkModels(arkKey);
    const billingResult = await queryBillingBalance(
      process.env.VOLCANO_AK,
      process.env.VOLCANO_SK,
    );
    return presentVolcanoResult(arkResult, billingResult);
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function fetchKimi() {
  const key = process.env.KIMI_API_KEY;
  if (!key) return { ok: false, error: "未配置 KIMI_API_KEY" };
  try {
    const r = await fetch("https://api.moonshot.cn/v1/users/me/balance", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await r.json();
    if (data && data.data && data.data.available_balance != null) {
      const cash = +data.data.cash_balance || 0;
      const voucher = +data.data.voucher_balance || 0;
      const available = +data.data.available_balance;
      return {
        ok: true,
        balance: fmtNumber(available),
        used: fmtNumber(cash + voucher - available),
        currency: "CNY",
      };
    }
    return { ok: false, error: data?.message || "未知错误" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── Routes ────────────────────────────────────────────────
app.get("/api/deepseek", async (_req, res) => { res.json(await fetchDeepSeek()); });
app.get("/api/volcano", async (_req, res) => { res.json(await fetchVolcano()); });
app.get("/api/kimi", async (_req, res) => { res.json(await fetchKimi()); });

app.get("/api/all", async (_req, res) => {
  const results = await Promise.allSettled([
    fetchDeepSeek(), fetchVolcano(), fetchKimi(),
  ]);
  const unwrap = (r) => r.status === "fulfilled" ? r.value : { ok: false, error: r.reason?.message || "请求失败" };
  res.json({
    deepseek: unwrap(results[0]),
    volcano: unwrap(results[1]),
    kimi: unwrap(results[2]),
  });
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
