const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwGn6jYZ5YIaliuIjdRllUjXfZGJVdoMqLF6LeDNMj4t-FfJ4CLKktQPyXAw4CegT1a/exec";

const EMPTY_DATA = {
  agents: [],
  coordinators: [],
  documents: [],
  fields: [],
  teamMembers: [],
  customTemplates: [],
  recentLogs: []
};

let appData = JSON.parse(localStorage.getItem("dft_cache_data")) || EMPTY_DATA;
let docSelections = {};
let selectedCustomTemplates = [];
let bypassHwClWarning = false;
let pendingCoordSaveAndReset = false;

function getScriptUrl() {
  const urlParam = new URLSearchParams(window.location.search).get("api");
  if (urlParam) {
    localStorage.setItem("dft_script_url", urlParam);
    return urlParam;
  }
  const saved = localStorage.getItem("dft_script_url");
  if (!saved || saved.includes("/a/macros/")) {
    localStorage.setItem("dft_script_url", DEFAULT_SCRIPT_URL);
    return DEFAULT_SCRIPT_URL;
  }
  return saved;
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("apiUrlInput").value = getScriptUrl();
  setupTabs();
  setupListeners();
  renderAll();
  loadSetupData(false);
});

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });
}

function setupListeners() {
  ["agentSelect", "priceMismatchChk", "dateMismatchChk",
   "ratifiedPrice", "interfacePrice", "ratifiedDate", "interfaceDate"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => {
        toggleSubInputs();
        buildAgentComment();
      });
    }
  });

  ["coordSelect", "askCoordChk"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => {
        toggleSubInputs();
        buildCoordComment();
      });
    }
  });

  document.querySelectorAll('input[name="hwOpt"], input[name="clOpt"]').forEach(r => {
    r.addEventListener("change", () => {
      bypassHwClWarning = false;
      buildCoordComment();
    });
  });

  document.getElementById("copyOnlyBtn").addEventListener("click", () => handleAgentAction(false));
  document.getElementById("saveStartNewBtn").addEventListener("click", () => handleAgentAction(true));

  document.getElementById("copyCoordBtn").addEventListener("click", () => handleCoordAction(false));
  document.getElementById("saveCoordNewBtn").addEventListener("click", () => handleCoordAction(true));

  document.getElementById("addSetupBtn").addEventListener("click", addSetupItem);
  document.getElementById("refreshBtn").addEventListener("click", () => loadSetupData(true));

  document.getElementById("saveApiUrlBtn").addEventListener("click", () => {
    const val = document.getElementById("apiUrlInput").value.trim();
    localStorage.setItem("dft_script_url", val);
    showToast("Web App URL Saved!");
    loadSetupData(true);
  });

  document.getElementById("modalBackBtn").addEventListener("click", () => {
    document.getElementById("warningModal").classList.add("hidden");
  });
  document.getElementById("modalProceedBtn").addEventListener("click", () => {
    bypassHwClWarning = true;
    document.getElementById("warningModal").classList.add("hidden");
    handleCoordAction(pendingCoordSaveAndReset);
  });

  document.getElementById("manualAgentSelect").addEventListener("change", e => {
    const agent = e.target.value;
    const editor = document.getElementById("manualEditorBox");
    if (!agent) {
      editor.classList.add("hidden");
      return;
    }
    editor.classList.remove("hidden");
    const firstName = agent.split(" ")[0];
    document.getElementById("manualCommentText").value =
      `Hi ${firstName},\n\n\n\nKindly update and upload it in FUB. Thank you!`;
  });

  document.getElementById("manualCopySaveBtn").addEventListener("click", () => {
    const agent = document.getElementById("manualAgentSelect").value;
    const text = document.getElementById("manualCommentText").value.trim();
    if (!agent || !text) return showToast("Select agent and enter comment");
    navigator.clipboard.writeText(text);
    showToast("Manual Comment Copied & Saved!");
    saveAuditPayload(agent, "", "Manual Comment", text);
    document.getElementById("manualAgentSelect").value = "";
    document.getElementById("manualEditorBox").classList.add("hidden");
  });

  document.getElementById("openLearnModalBtn").addEventListener("click", () => {
    updateLearnPreview();
    document.getElementById("learnModal").classList.remove("hidden");
  });
  document.getElementById("learnCancelBtn").addEventListener("click", () => {
    document.getElementById("learnModal").classList.add("hidden");
  });
  ["learnTypeSelect", "learnTemplateTitle", "learnWordValue"].forEach(id => {
    document.getElementById(id).addEventListener("input", updateLearnPreview);
  });
  document.getElementById("learnConfirmSaveBtn").addEventListener("click", confirmAndSaveLearn);
}

async function postToSheet(action, payloadObj) {
  const url = getScriptUrl();
  if (!url) {
    alert("Error: Web App URL is blank in Setup!");
    return null;
  }
  try {
    const res = await fetch(`${url}?action=${action}&t=${Date.now()}`, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payloadObj)
    });
    const text = await res.text();
    const json = JSON.parse(text);
    if (json.status !== "success") {
      alert("Google Sheet Error: " + (json.message || text));
    }
    return json;
  } catch (err) {
    alert("Sheet Sync Failed (" + action + "): " + err.message);
    return null;
  }
}

async function loadSetupData(notify = false) {
  const url = getScriptUrl();
  if (!url) return;
  try {
    const res = await fetch(`${url}?action=getSetup&t=${Date.now()}`, {
      method: "GET",
      redirect: "follow"
    });
    const text = await res.text();
    const json = JSON.parse(text);
    if (json.status === "success") {
      appData = json.data;
      saveLocalCache();
      renderAll();
      if (notify) showToast("Synced with Google Sheet!");
    } else {
      alert("Load Error: " + text);
    }
  } catch (err) {
    alert("Could not read Google Sheet: " + err.message);
  }
}

function updateLearnPreview() {
  const type = document.getElementById("learnTypeSelect").value;
  document.getElementById("learnCompleteFields").classList.toggle("hidden", type !== "complete");
  document.getElementById("learnWordFields").classList.toggle("hidden", type === "complete");

  const previewEl = document.getElementById("learnConfirmPreview");
  if (type === "complete") {
    const raw = document.getElementById("manualCommentText").value.trim();
    const lines = raw.split("\n");
    if (lines[0] && lines[0].startsWith("Hi ")) lines[0] = "Hi [Agent Name],";
    previewEl.textContent = lines.join("\n");
  } else {
    const word = document.getElementById("learnWordValue").value.trim() || "[Word]";
    previewEl.textContent = type === "document"
      ? `New Document Type "${word}" will be added to your Audit Checklist.`
      : `New Missing Field "${word}" will be added under Document Missing Fields.`;
  }
}

async function confirmAndSaveLearn() {
  const type = document.getElementById("learnTypeSelect").value;

  if (type === "complete") {
    const title = document.getElementById("learnTemplateTitle").value.trim();
    const templateBody = document.getElementById("learnConfirmPreview").textContent.trim();
    if (!title) return showToast("Please enter a short template title");

    appData.customTemplates.push({ title, body: templateBody });
    saveLocalCache();
    renderAll();
    await postToSheet("addCustomTemplate", { title, templateBody });
  } else {
    const word = document.getElementById("learnWordValue").value.trim();
    if (!word) return showToast("Please enter the word/name");

    if (type === "document" && !appData.documents.includes(word)) appData.documents.push(word);
    if (type === "field" && !appData.fields.includes(word)) appData.fields.push(word);
    saveLocalCache();
    renderAll();
    await postToSheet("addSetupItem", { category: type, value: word });
  }

  document.getElementById("learnTemplateTitle").value = "";
  document.getElementById("learnWordValue").value = "";
  document.getElementById("learnModal").classList.add("hidden");
  showToast("Confirmed & Saved to Sheet!");
  await loadSetupData(false);
}

function saveLocalCache() {
  localStorage.setItem("dft_cache_data", JSON.stringify(appData));
}

function toggleSubInputs() {
  document.getElementById("priceMismatchInputs").classList.toggle("hidden", !document.getElementById("priceMismatchChk").checked);
  document.getElementById("dateMismatchInputs").classList.toggle("hidden", !document.getElementById("dateMismatchChk").checked);
  document.getElementById("hwClSection").classList.toggle("hidden", document.getElementById("askCoordChk").checked);
}

function renderAll() {
  fillSelect("auditedBySelect", appData.teamMembers, false);
  fillSelect("agentSelect", appData.agents, true);
  fillSelect("coordSelect", appData.coordinators, true);
  fillSelect("manualAgentSelect", appData.agents, true);
  renderDocuments();
  renderCustomTemplates();
  renderManualQuickTags();
  renderHistory();
}

function fillSelect(id, list, includeBlank) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  el.innerHTML = includeBlank ? `<option value="">-- Blank --</option>` : `<option value="">-- User --</option>`;
  (list || []).forEach(item => {
    const opt = document.createElement("option");
    opt.value = item;
    opt.textContent = item;
    el.appendChild(opt);
  });
  if (current) el.value = current;
}

function renderCustomTemplates() {
  const card = document.getElementById("customTemplatesCard");
  const list = document.getElementById("customTemplatesList");
  if (!appData.customTemplates || !appData.customTemplates.length) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");
  list.innerHTML = appData.customTemplates.map((t, idx) =>
    `<span class="role-chip ${selectedCustomTemplates.includes(idx) ? 'selected' : ''}" data-idx="${idx}">${t.title}</span>`
  ).join("");

  list.querySelectorAll(".role-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const idx = Number(chip.dataset.idx);
      selectedCustomTemplates = selectedCustomTemplates.includes(idx)
        ? selectedCustomTemplates.filter(x => x !== idx)
        : [...selectedCustomTemplates, idx];
      renderCustomTemplates();
      buildAgentComment();
    });
  });
}

function renderManualQuickTags() {
  const box = document.getElementById("manualQuickTags");
  const tags = [...(appData.documents || []), "is missing.", "signature is missing on page "];
  box.innerHTML = tags.map(t => `<span class="role-chip">${t}</span>`).join("");
  box.querySelectorAll(".role-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const ta = document.getElementById("manualCommentText");
      const lines = ta.value.split("\n");
      lines.splice(2, 0, chip.textContent);
      ta.value = lines.join("\n");
    });
  });
}

function renderDocuments() {
  const container = document.getElementById("documentsList");
  if (!appData.documents || !appData.documents.length) {
    container.innerHTML = "<p style='font-size:13px;color:#64748b;'>No documents added yet. Go to Setup tab to add documents.</p>";
    return;
  }
  container.innerHTML = "";
  appData.documents.forEach(doc => {
    if (!docSelections[doc]) {
      docSelections[doc] = { mode: "", page: "", position: "Bottom", roles: [], fields: [] };
    }
    const state = docSelections[doc];

    const div = document.createElement("div");
    div.className = "doc-item";
    div.innerHTML = `
      <div class="doc-header">${doc}</div>
      <div class="doc-modes">
        <button type="button" class="chip-btn ${state.mode === 'missing' ? 'active' : ''}" data-mode="missing">Missing</button>
        <button type="button" class="chip-btn ${state.mode === 'signature' ? 'active' : ''}" data-mode="signature">Signature Missing</button>
        <button type="button" class="chip-btn ${state.mode === 'fields' ? 'active' : ''}" data-mode="fields">Missing Fields</button>
        ${state.mode ? `<button type="button" class="chip-btn" data-mode="">Clear</button>` : ""}
      </div>
    `;

    div.querySelectorAll(".chip-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        state.mode = btn.dataset.mode;
        renderDocuments();
        buildAgentComment();
      });
    });

    if (state.mode === "signature") {
      const sub = document.createElement("div");
      sub.className = "sub-panel";
      sub.innerHTML = `
        <div class="grid-2">
          <div>
            <label>Page Number (e.g. 3)</label>
            <input type="text" class="page-inp" value="${state.page}" placeholder="Page #" />
          </div>
          <div>
            <label>Position</label>
            <select class="pos-sel">
              <option value="Bottom" ${state.position === 'Bottom' ? 'selected' : ''}>Bottom</option>
              <option value="Top" ${state.position === 'Top' ? 'selected' : ''}>Top</option>
              <option value="Middle" ${state.position === 'Middle' ? 'selected' : ''}>Middle</option>
              <option value="" ${state.position === '' ? 'selected' : ''}>Any / None</option>
            </select>
          </div>
        </div>
        <label style="margin-top:8px;">Whose Signature is Missing?</label>
        <div class="role-chips">
          ${["Buyer", "Seller", "Agent", "Seller Agent"].map(r =>
            `<span class="role-chip ${state.roles.includes(r) ? 'selected' : ''}" data-role="${r}">${r}</span>`
          ).join("")}
        </div>
      `;
      sub.querySelector(".page-inp").addEventListener("input", e => { state.page = e.target.value; buildAgentComment(); });
      sub.querySelector(".pos-sel").addEventListener("change", e => { state.position = e.target.value; buildAgentComment(); });
      sub.querySelectorAll(".role-chip").forEach(chip => {
        chip.addEventListener("click", () => {
          const r = chip.dataset.role;
          state.roles = state.roles.includes(r) ? state.roles.filter(x => x !== r) : [...state.roles, r];
          renderDocuments();
          buildAgentComment();
        });
      });
      div.appendChild(sub);
    }

    if (state.mode === "fields") {
      const sub = document.createElement("div");
      sub.className = "sub-panel";
      sub.innerHTML = `
        <label>Select Missing Fields in ${doc}:</label>
        <div class="role-chips">
          ${(appData.fields || []).map(f =>
            `<span class="role-chip ${state.fields.includes(f) ? 'selected' : ''}" data-field="${f}">${f}</span>`
          ).join("")}
        </div>
      `;
      sub.querySelectorAll(".role-chip").forEach(chip => {
        chip.addEventListener("click", () => {
          const f = chip.dataset.field;
          state.fields = state.fields.includes(f) ? state.fields.filter(x => x !== f) : [...state.fields, f];
          renderDocuments();
          buildAgentComment();
        });
      });
      div.appendChild(sub);
    }

    container.appendChild(div);
  });
}

function buildAgentComment() {
  const agent = document.getElementById("agentSelect").value;
  const greeting = agent ? `Hi ${agent.split(" ")[0]},` : "Hi,";

  let agentItems = [];
  let hasDocumentOrTemplate = false;

  Object.entries(docSelections).forEach(([doc, st]) => {
    if (st.mode === "missing") {
      agentItems.push(`${doc} is missing.`);
      hasDocumentOrTemplate = true;
    } else if (st.mode === "signature") {
      let loc = [];
      if (st.position) loc.push(`on the ${st.position.toLowerCase()}`);
      if (st.page.trim()) loc.push(`of page ${st.page.trim()}`);
      const locStr = loc.length ? `, ${loc.join(" ")}` : "";
      const roleStr = st.roles.length ? `the ${st.roles.join(" and ")}'s signature` : "signature";
      agentItems.push(`In ${doc}${locStr}, ${roleStr} is missing.`);
      hasDocumentOrTemplate = true;
    } else if (st.mode === "fields" && st.fields.length) {
      agentItems.push(`In ${doc}, the ${st.fields.join(", ")} ${st.fields.length > 1 ? "are" : "is"} missing.`);
      hasDocumentOrTemplate = true;
    }
  });

  if (document.getElementById("priceMismatchChk").checked) {
    const rp = document.getElementById("ratifiedPrice").value.trim() || "[Ratified Price]";
    const ip = document.getElementById("interfacePrice").value.trim() || "[Interface Price]";
    agentItems.push(`The price in the Ratified Contract is ${rp}, whereas in the FUB Interface Form it is ${ip}. Kindly confirm the exact price.`);
  }
  if (document.getElementById("dateMismatchChk").checked) {
    const rd = document.getElementById("ratifiedDate").value.trim() || "[Ratified Date]";
    const id = document.getElementById("interfaceDate").value.trim() || "[Interface Date]";
    agentItems.push(`The closing date in the Ratified Contract is ${rd}, whereas in the FUB Interface Form it is ${id}. Kindly confirm the exact closing date.`);
  }

  selectedCustomTemplates.forEach(idx => {
    const tpl = appData.customTemplates[idx];
    if (tpl) {
      const cleaned = tpl.body
        .replace(/^Hi .*?,?\n+/i, "")
        .replace(/Kindly update and upload it in FUB\.?\s*Thank you!?/gi, "")
        .trim();
      if (cleaned) {
        agentItems.push(cleaned);
        hasDocumentOrTemplate = true;
      }
    }
  });

  if (!agentItems.length) {
    document.getElementById("commentPreview").value = "";
    return "";
  }

  let bodyLines = [greeting, ""];
  if (agentItems.length === 1) {
    bodyLines.push(agentItems[0]);
  } else {
    agentItems.forEach((item, idx) => bodyLines.push(`${idx + 1}. ${item}`));
  }

  bodyLines.push("");
  if (hasDocumentOrTemplate) {
    bodyLines.push("Kindly update and upload it in FUB. Thank you!");
  } else {
    bodyLines.push("Thank you!");
  }

  const finalComment = bodyLines.join("\n");
  document.getElementById("commentPreview").value = finalComment;
  return finalComment;
}

function buildCoordComment() {
  const coord = document.getElementById("coordSelect").value;
  const askCoord = document.getElementById("askCoordChk").checked;
  const hw = document.querySelector('input[name="hwOpt"]:checked').value;
  const cl = document.querySelector('input[name="clOpt"]:checked').value;

  const greeting = coord ? `Hi ${coord.split(" ")[0]},` : "Hi,";
  let coordLine = "";

  if (askCoord) {
    coordLine = "Kindly confirm the coordinator.";
  } else if (hw || cl) {
    if (hw === "N/A" && cl === "N/A") {
      coordLine = "Regarding H/W and CL100, both are N/A.";
    } else {
      let parts = [];
      if (hw) parts.push(hw === "N/A" ? "Regarding H/W, it is N/A" : `Regarding H/W, it is ordered by the ${hw}`);
      if (cl) parts.push(cl === "N/A" ? "regarding CL100, it is N/A" : `regarding CL100, it is contingent upon the ${cl}`);
      let joined = parts.join(", and ");
      coordLine = joined.charAt(0).toUpperCase() + joined.slice(1) + ".";
    }
  }

  if (!coordLine) {
    document.getElementById("coordCommentPreview").value = "";
    return "";
  }

  const finalCoordComment = `${greeting}\n\n${coordLine}\n\nThank you!`;
  document.getElementById("coordCommentPreview").value = finalCoordComment;
  return finalCoordComment;
}

function handleAgentAction(saveAndReset) {
  const text = document.getElementById("commentPreview").value.trim();
  if (!text) return showToast("Nothing to copy in Agent Comment!");

  navigator.clipboard.writeText(text);
  showToast("Agent Comment copied!");

  if (saveAndReset) {
    const agent = document.getElementById("agentSelect").value;
    const summary = Object.entries(docSelections).filter(([_, v]) => v.mode).map(([k, v]) => `${k}(${v.mode})`).join(", ");
    resetAgentForm();
    saveAuditPayload(agent, "", summary, text);
  }
}

function handleCoordAction(saveAndReset) {
  const askCoord = document.getElementById("askCoordChk").checked;
  const hw = document.querySelector('input[name="hwOpt"]:checked').value;
  const cl = document.querySelector('input[name="clOpt"]:checked').value;

  if (!askCoord && !bypassHwClWarning && ((hw && !cl) || (!hw && cl))) {
    pendingCoordSaveAndReset = saveAndReset;
    const missingItem = !cl ? "CL100" : "H/W";
    const selectedItem = hw ? "H/W" : "CL100";
    document.getElementById("warningText").textContent =
      `${missingItem} is not selected! Please check if ${missingItem} applies. Do you want to proceed with ${selectedItem} only?`;
    document.getElementById("warningModal").classList.remove("hidden");
    return;
  }

  const text = document.getElementById("coordCommentPreview").value.trim();
  if (!text) return showToast("Nothing to copy in Coordinator Note!");

  navigator.clipboard.writeText(text);
  showToast("Coordinator Note copied!");

  if (saveAndReset) {
    const coord = document.getElementById("coordSelect").value;
    const summary = askCoord ? "Coordinator Confirmation" : `H/W: ${hw || "None"}, CL100: ${cl || "None"}`;
    resetCoordForm();
    saveAuditPayload("", coord, summary, text);
  }
}

async function saveAuditPayload(agent, coordinator, summary, comment) {
  const payload = {
    timestamp: new Date().toLocaleString(),
    auditedBy: document.getElementById("auditedBySelect").value,
    agent,
    coordinator,
    summary,
    comment
  };

  appData.recentLogs.unshift(payload);
  saveLocalCache();
  renderHistory();

  await postToSheet("saveAudit", payload);
  await loadSetupData(false);
}

function resetAgentForm() {
  document.getElementById("agentSelect").value = "";
  document.getElementById("priceMismatchChk").checked = false;
  document.getElementById("dateMismatchChk").checked = false;
  document.getElementById("ratifiedPrice").value = "";
  document.getElementById("interfacePrice").value = "";
  document.getElementById("ratifiedDate").value = "";
  document.getElementById("interfaceDate").value = "";
  selectedCustomTemplates = [];

  Object.keys(docSelections).forEach(k => {
    docSelections[k] = { mode: "", page: "", position: "Bottom", roles: [], fields: [] };
  });

  toggleSubInputs();
  renderAll();
  document.getElementById("commentPreview").value = "";
}

function resetCoordForm() {
  document.getElementById("coordSelect").value = "";
  document.getElementById("askCoordChk").checked = false;
  document.querySelector('input[name="hwOpt"][value=""]').checked = true;
  document.querySelector('input[name="clOpt"][value=""]').checked = true;
  bypassHwClWarning = false;
  toggleSubInputs();
  document.getElementById("coordCommentPreview").value = "";
}

async function addSetupItem() {
  const category = document.getElementById("setupCategory").value;
  const value = document.getElementById("setupValue").value.trim();
  if (!value) return showToast("Enter a value first");

  const map = { agent: "agents", coordinator: "coordinators", document: "documents", field: "fields", member: "teamMembers" };
  if (map[category] && !appData[map[category]].includes(value)) {
    appData[map[category]].push(value);
    saveLocalCache();
    renderAll();
  }

  document.getElementById("setupValue").value = "";
  showToast("Saving to Google Sheet...");

  const res = await postToSheet("addSetupItem", { category, value });
  if (res && res.status === "success") {
    showToast("Synced with Google Sheet!");
    await loadSetupData(false);
  }
}

function renderHistory() {
  const list = document.getElementById("historyList");
  if (!appData.recentLogs || !appData.recentLogs.length) {
    list.innerHTML = "<p>No audits saved yet.</p>";
    return;
  }
  list.innerHTML = appData.recentLogs.map(log => `
    <div class="history-item">
      <div class="history-meta">
        <strong>${log.auditedBy || "Team"}</strong> • Agent: ${log.agent || "-"} | Coord: ${log.coordinator || "-"}
      </div>
      <div class="history-text">${log.comment}</div>
    </div>
  `).join("");
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2500);
}
