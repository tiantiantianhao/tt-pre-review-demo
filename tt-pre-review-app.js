const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const statusOptions = ["通过", "提交中", "处理中", "拒绝", "已过期", "提交失败", "暂无结果", "不确定"];

let records = [];
let materials = [];
let accounts = [];
let selectedMaterialIds = new Set();

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function openLayer(id) {
  $("#" + id)?.classList.add("open");
}

function closeLayer(id) {
  $("#" + id)?.classList.remove("open");
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), 2200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "请求失败");
  }
  return payload;
}

function deriveLocation(name = "") {
  const first = String(name).split("-")[0]?.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(first) ? first : "";
}

function statusBadge(status) {
  const cls = status === "通过" ? "green" : status === "处理中" || status === "提交中" ? "orange" : status === "拒绝" || status === "提交失败" ? "red" : "gray";
  return `<span class="badge ${cls}">${status || "-"}</span>`;
}

function renderThumb(materialOrRecord) {
  const previewUrl = materialOrRecord.previewUrl;
  const type = materialOrRecord.materialType || materialOrRecord.type;
  if (previewUrl) {
    const safeUrl = escapeHtml(previewUrl);
    const media = type === "IMAGE"
      ? `<img src="${safeUrl}" alt="" />`
      : `<video src="${safeUrl}" muted playsinline preload="metadata"></video>`;
    return `<div class="thumb media">${media}</div>`;
  }
  const cls = materialOrRecord.thumbnail === "chart" || /HX|KR|US/.test(materialOrRecord.materialName || materialOrRecord.name || "") ? "chart" : "";
  return `<div class="thumb ${cls}"></div>`;
}

function accountLabel(account) {
  return `${account.name}（ID: ${account.id}）`;
}

function fillSelects() {
  const accountHtml = accounts.length
    ? accounts.map((item) => `<option value="${item.id}">${accountLabel(item)}</option>`).join("")
    : `<option value="">请先配置 Token 和广告账户 ID</option>`;
  $("#accountSelect").innerHTML = accountHtml;
  $("#accountSelect").disabled = !accounts.length;
  $("#filterAccount").innerHTML = accounts.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
  $("#filterStatus").innerHTML = statusOptions.map((item) => `<option value="${item}">${item}</option>`).join("");
}

function updateLocationFilters() {
  const locations = Array.from(new Set([
    ...records.map((item) => item.locationCode).filter(Boolean),
    ...materials.map((item) => deriveLocation(item.name)).filter(Boolean),
  ])).sort();
  $("#filterLocation").innerHTML = locations.map((item) => `<option value="${item}">${item}</option>`).join("");
  $("#materialLocationFilter").innerHTML = `<option value="">全部</option>${locations.map((item) => `<option value="${item}">${item}</option>`).join("")}`;
}

function getMultiValues(select) {
  return Array.from(select.selectedOptions).map((item) => item.value);
}

function filteredRecords() {
  const keyword = $("#filterMaterial").value.trim().toLowerCase();
  const accountIds = getMultiValues($("#filterAccount"));
  const locations = getMultiValues($("#filterLocation"));
  const statuses = getMultiValues($("#filterStatus"));
  return records.filter((item) => {
    const text = `${item.materialId} ${item.materialName}`.toLowerCase();
    return (!keyword || text.includes(keyword)) &&
      (!accountIds.length || accountIds.includes(item.advertiserId)) &&
      (!locations.length || locations.includes(item.locationCode)) &&
      (!statuses.length || statuses.includes(item.status));
  });
}

function renderRecords() {
  const list = filteredRecords();
  $("#recordCount").textContent = `共 ${list.length} 条`;
  $("#recordBody").innerHTML = list.map((item) => {
    const canRetry = ["拒绝", "已过期", "提交失败"].includes(item.status);
    const material = materials.find((recordMaterial) => recordMaterial.id === item.materialId) || {};
    const source = { ...material, ...item };
    const materialName = escapeHtml(item.materialName);
    const advertiserName = escapeHtml(item.advertiserName);
    const rejectInfo = escapeHtml(item.rejectInfo || item.error || "-");
    return `
      <tr>
        <td>${escapeHtml(item.materialId)}</td>
        <td>${renderThumb(source)}</td>
        <td><div class="ellipsis" title="${materialName}">${materialName}</div></td>
        <td><div>${advertiserName}</div><div class="subtext">ID: ${escapeHtml(item.advertiserId)}</div></td>
        <td>${item.locationCode || "-"}</td>
        <td>${statusBadge(item.status)}</td>
        <td>${item.resultCreationTime || "-"}</td>
        <td>${item.resultExpirationTime || "-"}</td>
        <td><div class="ellipsis" title="${rejectInfo}">${rejectInfo}</div></td>
        <td><div class="op-group"><button class="btn small preview-record" data-id="${item.id}" type="button">查看素材</button>${canRetry ? `<button class="btn small retry-record" data-id="${item.id}" type="button">重新提交</button>` : ""}</div></td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="10" class="muted">暂无预审明细</td></tr>`;
}

function getMaterialStatus(material) {
  const accountId = $("#accountSelect").value;
  const location = deriveLocation(material.name);
  const record = records.find((item) => item.advertiserId === accountId && item.materialId === material.id && item.locationCode === location);
  if (!record) return `<span class="badge gray">未预审</span>`;
  if (record.status === "通过") return `<span class="badge green">已过审</span><div class="subtext">有效期至 ${record.resultExpirationTime || "-"}</div>`;
  if (record.status === "处理中") return `<span class="badge orange">处理中</span><div class="subtext">提交于 ${record.createdAt?.slice(0, 10) || "-"}</div>`;
  if (record.status === "拒绝") return `<span class="badge red">已拒绝</span><div class="subtext ellipsis">${record.rejectInfo || "-"}</div>`;
  if (record.status === "提交失败") return `<span class="badge red">提交失败</span><div class="subtext ellipsis">${record.error || "-"}</div>`;
  return `<span class="badge gray">${record.status}</span>`;
}

function filteredMaterials() {
  const location = $("#materialLocationFilter").value;
  const type = $("#materialTypeFilter").value;
  const keyword = $("#materialKeyword").value.trim().toLowerCase();
  return materials.filter((item) => {
    const itemLocation = deriveLocation(item.name);
    return (!location || itemLocation === location) &&
      (!type || item.type === type) &&
      (!keyword || `${item.id} ${item.name}`.toLowerCase().includes(keyword));
  });
}

function renderMaterials() {
  const list = filteredMaterials();
  $("#materialBody").innerHTML = list.map((item) => {
    const materialName = escapeHtml(item.name);
    const ttIdText = item.ttMaterialId ? `TT素材ID：${escapeHtml(item.ttMaterialId)}` : "提交时自动上传到 TT";
    return `
      <tr>
        <td><input class="material-check" type="checkbox" value="${escapeHtml(item.id)}" ${selectedMaterialIds.has(item.id) ? "checked" : ""} /></td>
        <td>${escapeHtml(item.id)}</td>
        <td><div style="display:flex;align-items:center;gap:12px">${renderThumb(item)}<div><div class="ellipsis" title="${materialName}">${materialName}</div><div class="subtext">${ttIdText}</div></div></div></td>
        <td>${deriveLocation(item.name) || "-"}</td>
        <td>${item.type === "IMAGE" ? "图片" : "视频"}</td>
        <td>${getMaterialStatus(item)}</td>
        <td>${item.createdAt || "-"}</td>
        <td>${item.spend || "-"}</td>
        <td>${item.roi || "-"}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="9" class="muted">暂无本地素材，请点击上方批量选择本地素材</td></tr>`;
  updateSelectedHint();
}

function updateSelectedHint() {
  $("#selectedHint").textContent = `已选 ${selectedMaterialIds.size} 项`;
  $("#openMaterial").textContent = `+ 从本地批量选取素材（${selectedMaterialIds.size}）`;
}

function showPreview(source) {
  const savedMaterial = materials.find((item) => item.id === (source.materialId || source.id)) || {};
  const previewUrl = source.previewUrl || savedMaterial.previewUrl;
  const name = source.materialName || source.name;
  $("#previewTitle").textContent = name;
  $("#previewMeta").textContent = `素材ID：${source.materialId || source.id} ｜ 类型：${source.materialType || source.type || "-"} ｜ 地区：${source.locationCode || deriveLocation(name) || "-"}`;
  const art = $("#previewArt");
  art.innerHTML = "";
  art.classList.toggle("chart", !previewUrl && (source.thumbnail === "chart" || /HX|KR|US/.test(name || "")));
  art.classList.toggle("has-media", Boolean(previewUrl));
  if (previewUrl) {
    const type = source.materialType || source.type || savedMaterial.type;
    art.innerHTML = type === "IMAGE"
      ? `<img src="${escapeHtml(previewUrl)}" alt="" />`
      : `<video src="${escapeHtml(previewUrl)}" controls autoplay muted playsinline></video>`;
  }
  openLayer("previewModal");
}

function setButtonLoading(button, loading, text) {
  if (!button) return;
  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = text;
    button.disabled = true;
    button.classList.add("loading");
    return;
  }
  button.textContent = button.dataset.originalText || button.textContent;
  button.disabled = false;
  button.classList.remove("loading");
}

function makeOptimisticRecords(taskName, account, chosen) {
  const createdAt = new Date().toISOString();
  return chosen.map((material) => ({
    id: `tmp_${material.id}_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    taskName,
    materialId: material.id,
    materialName: material.name,
    materialType: material.type,
    previewUrl: material.previewUrl,
    advertiserId: account.id,
    advertiserName: account.name,
    locationCode: deriveLocation(material.name) || "-",
    status: "提交中",
    resultCreationTime: "",
    resultExpirationTime: "",
    rejectInfo: "正在上传素材并提交预审",
    error: "",
    createdAt,
    updatedAt: createdAt,
    optimistic: true,
  }));
}

async function uploadLocalFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  const form = new FormData();
  list.forEach((file) => form.append("files", file));
  const response = await fetch("/api/materials/upload", { method: "POST", body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "本地素材上传失败");
  }
  materials = payload.materials || materials;
  (payload.added || []).forEach((item) => selectedMaterialIds.add(item.id));
  updateLocationFilters();
  renderMaterials();
  toast(`已添加 ${payload.added?.length || 0} 个本地素材`);
}

async function loadAll() {
  const [health, accountPayload, materialPayload, recordPayload] = await Promise.all([
    api("/api/health"),
    api("/api/accounts"),
    api("/api/materials"),
    api("/api/previews"),
  ]);
  accounts = accountPayload.accounts || [];
  materials = materialPayload.materials || [];
  records = recordPayload.records || [];
  const ready = health.tokenConfigured && health.advertiserConfigured && accounts.length;
  $("#apiState").textContent = ready ? `已配置广告账户：${accounts[0].id}` : (accountPayload.message || "未配置广告账户");
  $("#apiState").className = `state-pill ${ready ? "ready" : "warn"}`;
  fillSelects();
  updateLocationFilters();
  renderRecords();
  renderMaterials();
}

async function submitTask() {
  const submitButton = $("#submitTask");
  const account = accounts.find((item) => item.id === $("#accountSelect").value);
  if (!account) {
    toast("请先获取真实广告账户");
    return;
  }
  const chosen = materials.filter((item) => selectedMaterialIds.has(item.id));
  if (!chosen.length) {
    toast("请先选择素材");
    return;
  }
  const taskName = $("#taskName").value.trim();
  if (!taskName) {
    toast("请先填写任务名称");
    return;
  }
  setButtonLoading(submitButton, true, "提交中...");
  const optimisticRecords = makeOptimisticRecords(taskName, account, chosen);
  records = [...optimisticRecords, ...records];
  updateLocationFilters();
  renderRecords();
  closeLayer("createDrawer");
  toast("已开始提交，列表会自动更新结果");
  try {
    const result = await api("/api/previews/submit", {
      method: "POST",
      body: JSON.stringify({
        taskName,
        advertiser: account,
        materials: chosen,
      }),
    });
    records = result.records || records.filter((item) => !item.optimistic);
    updateLocationFilters();
    renderRecords();
    toast(`提交完成：${result.submitted?.length || 0} 条，跳过 ${result.skipped || 0} 条，失败 ${result.failed?.length || 0} 条`);
    if (result.submitted?.length) {
      setTimeout(() => queryRecords({ silent: true }), 5000);
    }
  } catch (error) {
    records = records.map((item) => item.optimistic ? {
      ...item,
      status: "提交失败",
      rejectInfo: "",
      error: error.message,
      optimistic: false,
    } : item);
    renderRecords();
    toast(error.message);
  } finally {
    setButtonLoading(submitButton, false);
  }
}

async function queryRecords({ silent = false } = {}) {
  try {
    const result = await api("/api/previews/query", { method: "POST", body: "{}" });
    records = result.records || records;
    updateLocationFilters();
    renderRecords();
    if (!silent) {
      const checked = result.checked || 0;
      toast(checked ? `已查询 ${checked} 条，更新 ${result.updated || 0} 条结果` : "没有可刷新的处理中任务");
    }
  } catch (error) {
    renderRecords();
    if (!silent) toast(error.message);
  }
}

function bindEvents() {
  $$(".close, [data-close]").forEach((btn) => btn.addEventListener("click", () => closeLayer(btn.dataset.close || btn.closest(".drawer-mask,.modal-mask").id)));
  $("#openCreate").addEventListener("click", () => openLayer("createDrawer"));
  $("#openMaterial").addEventListener("click", () => { renderMaterials(); openLayer("materialModal"); });
  $("#openToken").addEventListener("click", () => openLayer("tokenModal"));
  $("#saveToken").addEventListener("click", async () => {
    await api("/api/settings/token", {
      method: "POST",
      body: JSON.stringify({
        accessToken: $("#tokenInput").value.trim(),
        advertiserId: $("#advertiserIdInput").value.trim(),
        advertiserName: $("#advertiserNameInput").value.trim(),
      }),
    });
    $("#tokenInput").value = "";
    closeLayer("tokenModal");
    await loadAll();
    toast("配置已保存");
  });
  $("#submitTask").addEventListener("click", () => submitTask().catch((error) => toast(error.message)));
  $("#queryRecords").addEventListener("click", () => queryRecords());
  $("#resetFilters").addEventListener("click", () => {
    $("#filterMaterial").value = "";
    ["filterAccount", "filterLocation", "filterStatus"].forEach((id) => Array.from($("#" + id).options).forEach((item) => { item.selected = false; }));
    renderRecords();
  });
  $("#filterMaterial").addEventListener("input", renderRecords);
  ["filterAccount", "filterLocation", "filterStatus"].forEach((id) => $("#" + id).addEventListener("change", renderRecords));
  ["materialLocationFilter", "materialTypeFilter", "materialKeyword"].forEach((id) => $("#" + id).addEventListener("input", renderMaterials));
  $("#filterMaterials").addEventListener("click", renderMaterials);
  $("#pickLocalFiles").addEventListener("click", () => $("#localFileInput").click());
  $("#localFileInput").addEventListener("change", (event) => {
    uploadLocalFiles(event.target.files).catch((error) => toast(error.message));
    event.target.value = "";
  });
  $("#confirmMaterials").addEventListener("click", () => { updateSelectedHint(); closeLayer("materialModal"); });
  $("#materialBody").addEventListener("change", (event) => {
    if (!event.target.classList.contains("material-check")) return;
    if (event.target.checked) selectedMaterialIds.add(event.target.value);
    else selectedMaterialIds.delete(event.target.value);
    updateSelectedHint();
  });
  $("#recordBody").addEventListener("click", async (event) => {
    const preview = event.target.closest(".preview-record");
    const retry = event.target.closest(".retry-record");
    if (preview) {
      const record = records.find((item) => item.id === preview.dataset.id);
      if (record) showPreview(record);
    }
    if (retry) {
      try {
        const result = await api(`/api/previews/${retry.dataset.id}/retry`, { method: "POST", body: "{}" });
        records = result.records || records;
        renderRecords();
        toast("已重新提交");
      } catch (error) {
        toast(error.message);
      }
    }
  });
}

bindEvents();
loadAll().catch((error) => toast(error.message));
