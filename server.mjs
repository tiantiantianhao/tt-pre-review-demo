import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { createHash } from "node:crypto";

const root = process.cwd();
const port = Number(process.env.PORT || 8787);
const dataDir = join(root, ".data");
const uploadDir = join(dataDir, "uploads");
const storePath = join(dataDir, "tt-pre-review-store.json");
const materialPath = join(dataDir, "tt-materials.json");
const apiBase = "https://business-api.tiktok.com/open_api/v1.3";

let runtimeToken = process.env.TIKTOK_ACCESS_TOKEN || "";
let runtimeAdvertiserId = process.env.TIKTOK_ADVERTISER_ID || "";
let runtimeAdvertiserName = process.env.TIKTOK_ADVERTISER_NAME || "";

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
};

function resolvePath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://localhost:${port}`).pathname);
  if (pathname.startsWith("/uploads/")) {
    const filename = pathname.slice("/uploads/".length).replace(/[\\/]/g, "");
    return join(uploadDir, filename);
  }
  if (pathname === "/") return join(root, "tt-pre-review-app.html");
  const clean = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  return join(root, clean);
}

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(uploadDir, { recursive: true });
}

async function readJson(filePath, fallback) {
  await ensureDataDir();
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await ensureDataDir();
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function deriveLocation(name = "") {
  const first = String(name).split("-")[0]?.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(first) ? first : "";
}

function mapStatus(status) {
  const value = String(status || "").toUpperCase();
  if (value === "APPROVED") return "通过";
  if (value === "REJECTED") return "拒绝";
  if (value === "UNSURE") return "不确定";
  if (value === "UNAVAILABLE") return "暂无结果";
  return "处理中";
}

function parseTiktokTime(value) {
  if (!value) return null;
  const time = Date.parse(`${String(value).replace(" ", "T")}Z`);
  return Number.isNaN(time) ? null : time;
}

function isExpired(record) {
  const expiration = parseTiktokTime(record.resultExpirationTime);
  return Boolean(expiration && expiration <= Date.now());
}

function normalizeRecordStatus(record) {
  if (record.status === "通过" && isExpired(record)) {
    record.status = "已过期";
  }
  return record;
}

function isValidApproved(record) {
  return normalizeRecordStatus(record).status === "通过";
}

async function tiktokCreateTask(advertiserId, materials, locationCode) {
  const response = await fetch(`${apiBase}/creative/pre_review/task/create/`, {
    method: "POST",
    headers: {
      "Access-Token": runtimeToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      advertiser_id: advertiserId,
      material_list: materials.map((item) => ({
        material_type: item.type,
        material_id: item.ttMaterialId,
      })),
      location_codes: [locationCode],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.message || `TikTok create failed: HTTP ${response.status}`);
  }
  return payload;
}

async function tiktokGetTask(advertiserId, taskId) {
  const url = new URL(`${apiBase}/creative/pre_review/task/get/`);
  url.searchParams.set("advertiser_id", advertiserId);
  url.searchParams.set("task_id", taskId);
  const response = await fetch(url, {
    method: "GET",
    headers: { "Access-Token": runtimeToken },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.message || `TikTok query failed: HTTP ${response.status}`);
  }
  return payload;
}

function inferMaterialType(filename = "", mime = "") {
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(filename)) return "IMAGE";
  return "VIDEO";
}

function safeUploadName(filename) {
  return `${Date.now()}_${Math.random().toString(16).slice(2, 8)}_${filename.replace(/[\\/:*?"<>|]/g, "_")}`;
}

function tiktokUploadFileName(name) {
  const safeName = String(name || "material");
  const ext = extname(safeName);
  const base = ext ? safeName.slice(0, -ext.length) : safeName;
  const suffix = `_pre_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
  const maxBaseLength = Math.max(1, 100 - suffix.length - ext.length);
  return `${base.slice(0, maxBaseLength)}${suffix}${ext}`.slice(0, 100);
}

async function uploadLocalFiles(request) {
  await ensureDataDir();
  const req = new Request(`http://localhost${request.url}`, {
    method: request.method,
    headers: request.headers,
    body: request,
    duplex: "half",
  });
  const form = await req.formData();
  const files = form.getAll("files");
  const catalog = await getMaterials();
  const added = [];
  for (const file of files) {
    if (!file?.name) continue;
    const buffer = Buffer.from(await file.arrayBuffer());
    const storedName = safeUploadName(file.name);
    const filePath = join(uploadDir, storedName);
    await writeFile(filePath, buffer);
    const material = {
      id: makeId("mat"),
      name: file.name,
      type: inferMaterialType(file.name, file.type || ""),
      ttMaterialId: "",
      filePath,
      previewUrl: `/uploads/${encodeURIComponent(storedName)}`,
      mime: file.type || "application/octet-stream",
      size: buffer.length,
      thumbnail: inferMaterialType(file.name, file.type || "") === "IMAGE" ? "person" : "chart",
      spend: "-",
      roi: "-",
      createdAt: new Date().toISOString().slice(0, 10),
    };
    catalog.materials.unshift(material);
    added.push(material);
  }
  await writeJson(materialPath, catalog);
  return { ok: true, added, materials: catalog.materials };
}

async function uploadMaterialToTikTok(advertiserId, material) {
  if (material.ttMaterialId) return material.ttMaterialId;
  if (!material.filePath || !existsSync(material.filePath)) {
    throw new Error("缺少目标广告账户下的 TT 素材 ID，且未找到本地文件");
  }
  const buffer = await readFile(material.filePath);
  const signature = createHash("md5").update(buffer).digest("hex");
  const form = new FormData();
  form.set("advertiser_id", advertiserId);
  form.set("upload_type", "UPLOAD_BY_FILE");
  form.set("file_name", tiktokUploadFileName(material.name));
  if (material.type === "IMAGE") {
    form.set("image_signature", signature);
    form.set("image_file", new Blob([buffer], { type: material.mime || "application/octet-stream" }), material.name);
  } else {
    form.set("video_signature", signature);
    form.set("video_file", new Blob([buffer], { type: material.mime || "application/octet-stream" }), material.name);
  }
  const endpoint = material.type === "IMAGE" ? "/file/image/ad/upload/" : "/file/video/ad/upload/";
  const response = await fetch(`${apiBase}${endpoint}`, {
    method: "POST",
    headers: { "Access-Token": runtimeToken },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.message || `素材上传失败：HTTP ${response.status}`);
  }
  const data = Array.isArray(payload.data) ? payload.data[0] : payload.data;
  const id = material.type === "IMAGE" ? data?.image_id : data?.video_id;
  if (!id) throw new Error("素材上传成功但未返回 TT 素材 ID");
  return id;
}

async function persistMaterialTtId(materialId, ttMaterialId) {
  if (!materialId || !ttMaterialId) return;
  const catalog = await getMaterials();
  let changed = false;
  catalog.materials = catalog.materials.map((material) => {
    if (material.id !== materialId || material.ttMaterialId === ttMaterialId) return material;
    changed = true;
    return { ...material, ttMaterialId, ttAdvertiserId: runtimeAdvertiserId };
  });
  if (changed) await writeJson(materialPath, catalog);
}

function chunk(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

async function getStore() {
  const store = await readJson(storePath, { records: [] });
  let changed = false;
  store.records = (store.records || []).map((record) => {
    const before = record.status;
    normalizeRecordStatus(record);
    if (record.status !== before) changed = true;
    return record;
  });
  if (changed) await writeJson(storePath, store);
  return store;
}

async function getMaterials() {
  const saved = await readJson(materialPath, null);
  if (Array.isArray(saved?.materials)) return saved;
  return { materials: [] };
}

async function createFailedRecord(store, body, material, locationCode, error) {
  const record = {
    id: makeId("rec"),
    taskName: body.taskName,
    materialId: material.id,
    materialName: material.name,
    materialType: material.type,
    ttMaterialId: material.ttMaterialId,
    advertiserId: body.advertiser.id,
    advertiserName: body.advertiser.name,
    locationCode,
    status: "提交失败",
    resultCreationTime: "",
    resultExpirationTime: "",
    rejectInfo: "",
    error,
    previewUrl: material.previewUrl || "",
    preReviewTaskId: "",
    requestId: "",
    latest: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.records.unshift(record);
  return record;
}

async function submitPreReview(body, { force = false } = {}) {
  if (!runtimeToken) {
    return { ok: false, message: "请先配置 TikTok Access Token" };
  }
  if (!body?.taskName || !body?.advertiser?.id || !body?.materials?.length) {
    return { ok: false, message: "任务名称、广告账户、素材不能为空" };
  }

  const store = await getStore();
  const candidates = [];
  const failed = [];
  let skipped = 0;

  for (const material of body.materials) {
    const locationCode = deriveLocation(material.name);
    if (!locationCode) {
      failed.push(await createFailedRecord(store, body, material, "", "地区识别失败"));
      continue;
    }
    const existing = store.records.find((record) =>
      record.latest &&
      record.advertiserId === body.advertiser.id &&
      record.materialId === material.id &&
      record.locationCode === locationCode &&
      isValidApproved(record)
    );
    if (existing && !force) {
      skipped += 1;
      continue;
    }
    candidates.push({ ...material, locationCode });
  }

  const submitted = [];
  const byLocation = new Map();
  for (const material of candidates) {
    if (!byLocation.has(material.locationCode)) byLocation.set(material.locationCode, []);
    byLocation.get(material.locationCode).push(material);
  }

  for (const [locationCode, materials] of byLocation.entries()) {
    const readyMaterials = [];
    for (const material of materials) {
      try {
        const ttMaterialId = await uploadMaterialToTikTok(body.advertiser.id, material);
        await persistMaterialTtId(material.id, ttMaterialId);
        readyMaterials.push({ ...material, ttMaterialId });
      } catch (error) {
        failed.push(await createFailedRecord(store, body, material, locationCode, error.message));
      }
    }
    for (const group of chunk(readyMaterials, 5)) {
      try {
        const payload = await tiktokCreateTask(body.advertiser.id, group, locationCode);
        const taskId = payload.data?.pre_review_task_id || "";
        for (const material of group) {
          const record = {
            id: makeId("rec"),
            taskName: body.taskName,
            materialId: material.id,
            materialName: material.name,
            materialType: material.type,
            ttMaterialId: material.ttMaterialId,
            previewUrl: material.previewUrl || "",
            advertiserId: body.advertiser.id,
            advertiserName: body.advertiser.name,
            locationCode,
            status: "处理中",
            resultCreationTime: "",
            resultExpirationTime: "",
            rejectInfo: "",
            error: "",
            preReviewTaskId: taskId,
            requestId: payload.request_id || "",
            latest: true,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };
          store.records.unshift(record);
          submitted.push(record);
        }
      } catch (error) {
        for (const material of group) {
          failed.push(await createFailedRecord(store, body, material, locationCode, error.message));
        }
      }
    }
  }

  await writeJson(storePath, store);
  return { ok: true, submitted, failed, skipped, records: store.records };
}

async function queryProcessing() {
  if (!runtimeToken) {
    return { ok: false, message: "请先配置 TikTok Access Token" };
  }
  const store = await getStore();
  const targets = store.records.filter((item) =>
    ["处理中", "暂无结果"].includes(normalizeRecordStatus(item).status) && item.preReviewTaskId
  );
  const groups = new Map();
  for (const record of targets) {
    const key = `${record.advertiserId}::${record.preReviewTaskId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  let updated = 0;
  let checked = 0;
  for (const records of groups.values()) {
    const first = records[0];
    try {
      const payload = await tiktokGetTask(first.advertiserId, first.preReviewTaskId);
      checked += records.length;
      const list = payload.data?.pre_review_result_list || [];
      if (payload.data?.task_status === "PROCESSING" && !list.length) {
        for (const record of records) record.updatedAt = nowIso();
        continue;
      }
      const matchedRecordIds = new Set();
      for (const result of list) {
        const match = records.find((record) =>
          record.ttMaterialId === result.material_id &&
          record.materialType === result.material_type &&
          record.locationCode === result.location_code
        );
        if (!match) continue;
        matchedRecordIds.add(match.id);
        match.status = mapStatus(result.pre_review_status);
        match.resultCreationTime = result.result_creation_time || "";
        match.resultExpirationTime = result.result_expiration_time || "";
        match.rejectInfo = (result.reject_info_list || [])
          .map((item) => [item.reason, item.suggestion].filter(Boolean).join("："))
          .filter(Boolean)
          .join("；");
        match.updatedAt = nowIso();
        normalizeRecordStatus(match);
        updated += 1;
      }
      if (payload.data?.task_status === "SUCCESS") {
        for (const record of records) {
          if (matchedRecordIds.has(record.id)) continue;
          record.status = "暂无结果";
          record.updatedAt = nowIso();
        }
      }
    } catch (error) {
      for (const record of records) {
        record.error = error.message;
        record.updatedAt = nowIso();
      }
    }
  }

  await writeJson(storePath, store);
  return { ok: true, checked, updated, records: store.records };
}

async function handleApi(request, response, pathname) {
  try {
    if (request.method === "GET" && pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        tokenConfigured: Boolean(runtimeToken),
        advertiserConfigured: Boolean(runtimeAdvertiserId),
      });
      return;
    }

    if (request.method === "POST" && pathname === "/api/settings/token") {
      const body = await readBody(request);
      const nextToken = String(body.accessToken || "").trim();
      const nextAdvertiserId = String(body.advertiserId || "").trim();
      const nextAdvertiserName = String(body.advertiserName || "").trim();
      if (nextToken) runtimeToken = nextToken;
      if (nextAdvertiserId) runtimeAdvertiserId = nextAdvertiserId;
      if (nextAdvertiserName) runtimeAdvertiserName = nextAdvertiserName;
      sendJson(response, 200, {
        ok: Boolean(runtimeToken),
        tokenConfigured: Boolean(runtimeToken),
        advertiserConfigured: Boolean(runtimeAdvertiserId),
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/accounts") {
      if (runtimeToken && runtimeAdvertiserId) {
        sendJson(response, 200, {
          ok: true,
          accounts: [{
            id: runtimeAdvertiserId,
            name: runtimeAdvertiserName || runtimeAdvertiserId,
            source: "manual",
          }],
        });
        return;
      }
      sendJson(response, 200, {
        ok: true,
        accountFetchOk: false,
        message: runtimeToken ? "请配置广告账户 ID" : "请先配置 TikTok Access Token",
        accounts: [],
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/materials") {
      sendJson(response, 200, await getMaterials());
      return;
    }

    if (request.method === "POST" && pathname === "/api/materials/upload") {
      sendJson(response, 200, await uploadLocalFiles(request));
      return;
    }

    if (request.method === "GET" && pathname === "/api/previews") {
      sendJson(response, 200, await getStore());
      return;
    }

    if (request.method === "POST" && pathname === "/api/previews/submit") {
      const result = await submitPreReview(await readBody(request));
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && pathname === "/api/previews/query") {
      const result = await queryProcessing();
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && pathname.startsWith("/api/previews/") && pathname.endsWith("/retry")) {
      const id = pathname.split("/")[3];
      const store = await getStore();
      const record = store.records.find((item) => item.id === id);
      if (!record) {
        sendJson(response, 404, { ok: false, message: "明细不存在" });
        return;
      }
      const catalog = await getMaterials();
      const savedMaterial = (catalog.materials || []).find((item) => item.id === record.materialId) || {};
      const retryMaterial = {
        ...savedMaterial,
        id: record.materialId,
        name: record.materialName,
        type: record.materialType,
        ttMaterialId: record.ttMaterialId || savedMaterial.ttMaterialId || "",
        previewUrl: record.previewUrl || savedMaterial.previewUrl || "",
      };
      const result = await submitPreReview({
        taskName: `${record.taskName}-重提`,
        advertiser: { id: record.advertiserId, name: record.advertiserName },
        materials: [retryMaterial],
      }, { force: true });
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    sendJson(response, 404, { ok: false, message: "Not found" });
  } catch (error) {
    sendJson(response, 500, { ok: false, message: error.message || "Server error" });
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://localhost:${port}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url.pathname);
    return;
  }

  const filePath = resolvePath(request.url || "/");
  const target = existsSync(filePath) ? filePath : join(root, "tt-pre-review-app.html");

  try {
    const info = await stat(target);
    if (!info.isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": types[extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(target).pipe(response);
  } catch {
    response.writeHead(500);
    response.end("Server error");
  }
}).listen(port, () => {
  console.log(`TT pre-review app running at http://127.0.0.1:${port}`);
});
