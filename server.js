const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ─── In-memory user config ─────────────────────────────────
const userConfig = {};
const PORT = process.env.PORT || 3456;

// ─── Load .env ─────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  try {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (k) process.env[k] = v;
    }
  } catch (_) {}
}
loadEnv();

function getKey(envName, platform) {
  return userConfig[platform] || process.env[envName] || "";
}

// ─── MIME types ────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// ─── Helpers ───────────────────────────────────────────────
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
  const signedHeadersStr = "host;x-date";
  const canonicalHeaders = "host:" + host + "\n" + "x-date:" + ts + "\n";
  const canonicalRequest = [method, pathname, query, canonicalHeaders, signedHeadersStr, bodyHash].join("\n");
  const credentialScope = dateStamp + "/" + region + "/" + service + "/request";
  const stringToSign = [algorithm, ts, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmacHex(sk, dateStamp);
  const kRegion = hmacHex(kDate, region);
  const kService = hmacHex(kRegion, service);
  const kSigning = hmacHex(kService, "request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const authorization = algorithm + " Credential=" + ak + "/" + credentialScope + ", SignedHeaders=" + signedHeadersStr + ", Signature=" + signature;
  return { authorization, xDate: ts };
}

// ─── HTTP fetch helper ─────────────────────────────────────
function httpFetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? require("https") : require("http");
    const headers = opts.headers || {};
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: opts.method || "GET",
      headers,
    };
    const req = mod.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          // Include status code for error handling
          parsed._status = res.statusCode;
          resolve(parsed);
        } catch (_) {
          resolve({ _raw: data, _status: res.statusCode });
        }
      });
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ─── DeepSeek ──────────────────────────────────────────────
async function fetchDeepSeek() {
  const key = getKey("DEEPSEEK_API_KEY", "deepseek");
  if (!key) return { ok: false, error: "未配置 DEEPSEEK_API_KEY" };
  try {
    const data = await httpFetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${key}` },
    });
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

// ─── Volcano Engine ────────────────────────────────────────
async function queryArkModels(apiKey) {
  if (!apiKey) return { ok: false, activeModels: 0 };
  try {
    const data = await httpFetch("https://ark.cn-beijing.volces.com/api/v3/models", {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });
    if (data._status >= 400) return { ok: false, activeModels: 0 };
    return { ok: true, activeModels: data?.data?.length || 0 };
  } catch (_) {
    return { ok: false, activeModels: 0 };
  }
}

function parseVolcanoBalance(result) {
  if (!result) return null;
  const raw = result.AvailableBalance ?? result.AccountBalance ?? null;
  return raw == null ? null : fmtNumber(Number(raw));
}

function classifyBillingError(error) {
  if (!error) return null;
  const code = error.Code || "";
  if (code === "SignatureDoesNotMatch") return { code: "SIGNATURE_MISMATCH", detail: "AK/SK 签名验证失败，请确认 SK 完整正确且已授权 BillingFullAccess 权限" };
  if (code === "InvalidCredential" || code === "Unauthorized") return { code: "UNAUTHORIZED", detail: "AK/SK 无权访问计费API，请在控制台为该密钥授权 Billing 权限" };
  return { code: "BILLING_ERROR", detail: error.Message || code || "未知错误" };
}

async function queryBillingBalance(ak, sk) {
  if (!ak || !sk) return { ok: true, balance: null, diagnostics: { code: "AK_SK_MISSING", detail: "未配置 AK/SK，仅显示 Ark API 状态。" } };
  try {
    const host = "billing.volcengineapi.com";
    const query = "Action=QueryBalanceAcct&Version=2022-01-01";
    const sig = volcSign("GET", host, "/", query, ak, sk);
    const data = await httpFetch(`https://${host}/?${query}`, {
      headers: { Host: host, "X-Date": sig.xDate, Authorization: sig.authorization },
    });
    const billingErr = data.ResponseMetadata?.Error;
    if (billingErr) return { ok: true, balance: null, diagnostics: classifyBillingError(billingErr) };
    const balance = parseVolcanoBalance(data.Result);
    return { ok: true, balance, diagnostics: balance != null ? null : { code: "BALANCE_NOT_FOUND", detail: "未查询到余额数据" } };
  } catch (_) {
    return { ok: true, balance: null, diagnostics: { code: "BILLING_REQUEST_FAILED", detail: "计费API请求失败" } };
  }
}

function presentVolcanoResult(arkResult, billingResult) {
  return { ok: true, activeModels: arkResult.activeModels, balance: billingResult.balance, currency: "CNY", diagnostics: billingResult.diagnostics, hint: billingResult.diagnostics?.detail || "", billingOk: billingResult.balance != null };
}

async function fetchVolcano() {
  const arkKey = getKey("VOLCANO_API_KEY", "volcano_ark");
  if (!arkKey) return { ok: false, error: "未配置 VOLCANO_API_KEY" };
  try {
    const arkResult = await queryArkModels(arkKey);
    const ak = userConfig["volcano_ak"] || process.env["VOLCANO_AK"] || "";
    const sk = userConfig["volcano_sk"] || process.env["VOLCANO_SK"] || "";
    const billingResult = await queryBillingBalance(ak, sk);
    return presentVolcanoResult(arkResult, billingResult);
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── Kimi ──────────────────────────────────────────────────
async function fetchKimi() {
  const key = getKey("KIMI_API_KEY", "kimi");
  if (!key) return { ok: false, error: "未配置 KIMI_API_KEY" };
  try {
    const data = await httpFetch("https://api.moonshot.cn/v1/users/me/balance", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (data && data.data && data.data.available_balance != null) {
      const cash = +data.data.cash_balance || 0;
      const voucher = +data.data.voucher_balance || 0;
      const available = +data.data.available_balance;
      return { ok: true, balance: fmtNumber(available), used: fmtNumber(cash + voucher - available), currency: "CNY" };
    }
    return { ok: false, error: data?.message || "未知错误" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── Static file serving ───────────────────────────────────
function serveStatic(urlPath, res) {
  // Security: prevent path traversal
  const safe = path.normalize(urlPath).replace(/^[/\\]/, "");
  const filePath = path.join(__dirname, "public", safe);
  
  // Don't serve outside public/
  if (!filePath.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Fallback to index.html for SPA
      fs.readFile(path.join(__dirname, "public", "index.html"), (err2, html) => {
        if (err2) { res.writeHead(404); res.end("Not Found"); return; }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

// ─── HTTP Server ───────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ─── API routes ──────────────────────────────────────────
  if (pathname === "/api/config" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { platform, key } = JSON.parse(body);
        if (!platform || key == null) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "缺少 platform 或 key" }));
          return;
        }
        if (key === "") delete userConfig[platform];
        else userConfig[platform] = key;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, platform, configured: !!userConfig[platform] }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (pathname === "/api/config" && req.method === "GET") {
    const r = {
      deepseek: !!userConfig["deepseek"] || !!process.env.DEEPSEEK_API_KEY,
      kimi: !!userConfig["kimi"] || !!process.env.KIMI_API_KEY,
      volcano_ark: !!userConfig["volcano_ark"] || !!process.env.VOLCANO_API_KEY,
      volcano_ak: !!userConfig["volcano_ak"] || !!process.env.VOLCANO_AK,
      volcano_sk: !!userConfig["volcano_sk"] || !!process.env.VOLCANO_SK,
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(r));
    return;
  }

  if (pathname === "/api/deepseek") {
    fetchDeepSeek().then((d) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); });
    return;
  }

  if (pathname === "/api/volcano") {
    fetchVolcano().then((d) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); });
    return;
  }

  if (pathname === "/api/kimi") {
    fetchKimi().then((d) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); });
    return;
  }

  if (pathname === "/api/all") {
    Promise.allSettled([fetchDeepSeek(), fetchVolcano(), fetchKimi()]).then((results) => {
      const uw = (r) => r.status === "fulfilled" ? r.value : { ok: false, error: r.reason?.message || "请求失败" };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ deepseek: uw(results[0]), volcano: uw(results[1]), kimi: uw(results[2]) }));
    });
    return;
  }

  // ─── Static files ────────────────────────────────────────
  serveStatic(pathname, res);
});

// ─── Startup ───────────────────────────────────────────────
const os = require("os");
function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`token-cost running at:`);
  console.log(`  http://localhost:${PORT}`);
  getLocalIPs().forEach((ip) => console.log(`  http://${ip}:${PORT}`));
});
