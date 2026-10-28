const CODE_STORAGE_KEY = "recruitment-code-problems-v1";
const CODE_DRAFT_KEY = "recruitment-code-draft-v1";
const CODE_LAST_PROBLEM_KEY = "recruitment-code-last-problem-v1";
const CODE_LOCK_NAME = "recruitment-tracker/code-problems";
const CODE_LANGUAGES = { python: "Python3", c: "C" };
// 旧语言只用于读取历史题目，不再出现在新建题目的语言选项中。
const LEGACY_CODE_LANGUAGES = { java: "Java", rust: "Rust" };
function normalizeCodeLanguage(name) { return name === "cpp" ? "c" : name; }
function isStoredCodeLanguage(name) { return Object.hasOwn(CODE_LANGUAGES, normalizeCodeLanguage(name)) || Object.hasOwn(LEGACY_CODE_LANGUAGES, name); }
function codeLanguageLabel(name) { return CODE_LANGUAGES[name] || LEGACY_CODE_LANGUAGES[name] || "历史语言"; }
let codeProblems = [];
let projectCodeBackup;
let codeDraft = null;
let codeBaseline = null;
let codeEditor = null;
let codeUiReady = false;
let codePendingAction = null;
let codeDeleteId = null;
let codeDraftTimer;
let codeDraftStorageWarned = false;
let codeRecoverySaved = false;
const codeEditorPositions = new Map();
let codeStorageSnapshot = null;
let codeDeleteBaseline = null;
let codeDraftGeneration = 0;
let codeSavePending = null;
let codePythonRunner = null;
let codePythonBusy = false;
let codePythonOutput = "";
let codePythonOutputTimer;
let codePythonErrorStart = null;
let codePythonSource = null;

function stripCodeTimestamps(problem) {
  const content = { ...problem };
  delete content.createdAt;
  delete content.updatedAt;
  return content;
}
function codeProblemSnapshot(problem) {
  // 旧题目的时间字段已停用；跨标签页冲突仍比较完整题目内容。
  return JSON.stringify(stripCodeTimestamps(problem), (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value);
}
function readLatestCodeProblems() {
  const cached = localStorage.getItem(CODE_STORAGE_KEY);
  if (cached !== null) return parseCodeProblems(JSON.parse(cached));
  // 已读过缓存后再被清空，表示其他标签页删除了记录；不能把旧内存数据写回去。
  return codeStorageSnapshot === null ? codeProblems.map(stripCodeTimestamps) : [];
}
function writeCodeProblems(problems) {
  const text = JSON.stringify(problems.map(stripCodeTimestamps));
  localStorage.setItem(CODE_STORAGE_KEY, text);
  codeStorageSnapshot = text;
  if (typeof updateBackupStatus === "function") updateBackupStatus();
}
function withCodeStorageLock(action) {
  // 支持 Web Locks 时串行化跨标签页写入；其余环境仍在写入前读取并检查最新记录。
  if (typeof navigator === "undefined" || !navigator.locks?.request) return action();
  return navigator.locks.request(CODE_LOCK_NAME, { mode: "exclusive" }, action).catch((error) => {
    if (error.name === "SecurityError") return action(); // file:// 等环境可能无法取得 origin 锁。
    console.warn("题目存储锁无法取得。", error);
    showToast("题目操作未完成，编辑内容已保留，请重试");
    return false;
  });
}

function parseCodeProblems(value) {
  if (!Array.isArray(value)) throw new Error("题目备份必须是数组");
  const ids = new Set();
  return value.map((problem, i) => {
    const fail = (reason) => { throw new Error(`第 ${i + 1} 道题${reason}，未导入任何数据`); };
    if (!problem || typeof problem !== "object" || Array.isArray(problem)) fail("格式无效");
    if (typeof problem.id !== "string" || !problem.id.trim() || ids.has(problem.id)) fail("的 ID 无效或重复");
    ids.add(problem.id);
    if (typeof problem.title !== "string" || !problem.title.trim()) fail("缺少题目名称");
    if (!isStoredCodeLanguage(problem.language)) fail("的语言不支持");
    if (typeof problem.code !== "string") fail("的代码必须是文本");
    for (const field of ["url", "tags", "stdin"]) {
      if (problem[field] != null && typeof problem[field] !== "string") fail(`的 ${field} 字段必须是文本`);
    }
    return { ...stripCodeTimestamps(problem), language: normalizeCodeLanguage(problem.language), url: problem.url ?? "", tags: problem.tags ?? "" };
  });
}

function parseCompleteBackup(text) {
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw new Error("文件不是有效的 JSON，请选择“导出all”生成的 records.json 或 code_records.json"); }
  // 旧数组只恢复投递记录，不覆盖浏览器里已经保存的代码题目。
  if (Array.isArray(value)) return { records: parseAllRecordsBackup(text), codeProblems: null, directApplicationCount: 0 };
  if (value?.format === "recruitment-tracker-code" && value.version === 1) {
    return { records: null, codeProblems: parseCodeProblems(value.codeProblems), directApplicationCount: null };
  }
  if (!value || value.format !== "recruitment-tracker" || value.version !== 2 || !Array.isArray(value.records)) {
    throw new Error("备份格式错误：请选择本项目生成的投递或代码备份（也支持旧版完整备份）");
  }
  const directCount = Object.hasOwn(value, "directApplicationCount") ? value.directApplicationCount : 0;
  if (!Number.isSafeInteger(directCount) || directCount < 0 || directCount > 999999999) {
    throw new Error("备份中的直聘软件投递数量必须是 0 到 999999999 之间的整数");
  }
  return { records: parseAllRecordsBackup(JSON.stringify(value.records)), directApplicationCount: directCount,
    codeProblems: Object.hasOwn(value, "codeProblems") ? parseCodeProblems(value.codeProblems) : null };
}

function buildAllRecordsBackups() {
  let latestRecords = records;
  try { latestRecords = readLatestRecords(); }
  catch { showToast("无法读取最新投递缓存，备份使用本页已加载的记录"); }
  let latest = codeProblems;
  try { latest = readLatestCodeProblems(); }
  catch { showToast("无法读取最新题目缓存，备份将保留本页已加载的题目"); }
  const exportedAt = new Date().toISOString();
  return {
    recordsBackup: { format: "recruitment-tracker", version: 2, exportedAt, directApplicationCount: getDirectApplicationCount(), records: latestRecords },
    codeBackup: { format: "recruitment-tracker-code", version: 1, exportedAt, codeProblems: latest.map(stripCodeTimestamps) }
  };
}

async function loadCodeProblems() {
  try {
    const cached = localStorage.getItem(CODE_STORAGE_KEY);
    if (cached !== null) {
      const parsed = parseCodeProblems(JSON.parse(cached)); codeStorageSnapshot = cached; return parsed;
    }
  } catch (error) { console.warn("本地题目无法读取，尝试读取备份。", error); }
  try {
    let restored = null;
    const response = await fetch("./data/code_records.json", { cache: "no-store" });
    if (response.status === 404) {
      // 独立备份不存在时才兼容旧 records.json 中的代码题目。
      restored = projectCodeBackup;
      if (restored === undefined) {
        const legacy = await fetch("./data/records.json", { cache: "no-store" });
        if (legacy.status === 404) restored = null;
        else {
          if (!legacy.ok) throw new Error(`HTTP ${legacy.status}`);
          restored = parseCompleteBackup(await legacy.text()).codeProblems;
        }
      }
    } else {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const backup = parseCompleteBackup(await response.text());
      if (backup.records !== null) throw new Error("code_records.json 必须是独立代码备份");
      restored = backup.codeProblems;
    }
    return await withCodeStorageLock(() => {
      try {
        // 等待备份请求期间可能已有另一个标签页保存，优先使用新缓存。
        const cached = localStorage.getItem(CODE_STORAGE_KEY);
        if (cached !== null) {
          const parsed = parseCodeProblems(JSON.parse(cached)); codeStorageSnapshot = cached; return parsed;
        }
        if (restored !== null) writeCodeProblems(restored);
      } catch { showToast("已读取题目，但浏览器无法保存，请及时使用“导出all”备份"); }
      return restored ?? [];
    }) || [];
  } catch (error) {
    console.warn("题目备份无法读取。", error);
    showToast("无法读取代码题目备份 data/code_records.json，可使用“导入all”恢复");
    return [];
  }
}

function emptyCodeDraft() { return { id: null, title: "", language: "python", code: "", url: "", tags: "", stdin: "" }; }
function codeDraftContent(problem) {
  return { title: problem.title, language: problem.language, code: problem.code, url: problem.url || "", tags: problem.tags || "", stdin: problem.stdin ?? "" };
}
function isCodeDirty() {
  return Boolean(codeDraft && codeBaseline && JSON.stringify(codeDraftContent(codeDraft)) !== JSON.stringify(codeDraftContent(codeBaseline)));
}
function codeProblemUrl(value) {
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function clearCodeRecovery() {
  window.clearTimeout(codeDraftTimer);
  codeRecoverySaved = false;
  try { sessionStorage.removeItem(CODE_DRAFT_KEY); } catch { /* 正式保存与临时草稿分开。 */ }
}
function persistCodeRecovery() {
  window.clearTimeout(codeDraftTimer);
  if (!isCodeDirty()) { clearCodeRecovery(); return; }
  try {
    sessionStorage.setItem(CODE_DRAFT_KEY, JSON.stringify({ version: 2, draft: codeDraft, baseline: codeBaseline }));
    codeRecoverySaved = true;
  }
  catch {
    codeRecoverySaved = false;
    if (!codeDraftStorageWarned) showToast("临时草稿无法保存，请及时保存题目或复制代码");
    codeDraftStorageWarned = true;
  }
  updateCodeStatus();
}
function markCodeChanged() {
  if (!codeDraft) return;
  codeRecoverySaved = false;
  updateCodeStatus();
  window.clearTimeout(codeDraftTimer);
  codeDraftTimer = window.setTimeout(persistCodeRecovery, 300);
}
function updateCodeStatus() {
  if (!codeUiReady) return;
  const dirty = isCodeDirty();
  $("#code-save-state").textContent = dirty ? codeRecoverySaved ? "草稿已暂存" : "有未保存修改" : codeDraft.id ? "已保存" : "未保存";
  $("#code-save-state").title = dirty ? "修改尚未正式保存，点击保存后才会写入题目记录和导出文件。" : codeDraft.id ? "当前题目已正式保存。" : "填写题目名称与代码后点击保存。";
  $("#code-save-state").classList.toggle("unsaved", dirty || !codeDraft.id);
  $("#code-edit-heading").textContent = codeDraft.title.trim() || "新建题目";
  $("#code-edit-heading").title = codeDraft.title.trim() || "新建题目";
  $("#code-open-link").disabled = !codeProblemUrl(codeDraft.url);
}
function renderCodeList() {
  if (!codeUiReady) return;
  const query = $("#code-search").value.trim().toLowerCase();
  const visible = codeProblems.filter((problem) => `${problem.title} ${problem.tags} ${codeLanguageLabel(problem.language)}`.toLowerCase().includes(query));
  $("#code-count").textContent = `${codeProblems.length} 道题`;
  $("#code-problem-list").innerHTML = visible.map((problem) => `
    <li class="code-problem-item${problem.id === codeDraft?.id ? " selected" : ""}">
      <button type="button" class="code-problem-select" data-code-open="${escapeHtml(problem.id)}"${problem.id === codeDraft?.id ? ' aria-current="true"' : ""}>
        <span class="code-problem-title">${escapeHtml(problem.title)}</span>
        <span class="code-problem-tags"><span class="code-language-chip">${escapeHtml(codeLanguageLabel(problem.language))}</span>${problem.tags.split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</span>
      </button>
      <div class="code-problem-actions">
        <button type="button" class="icon-button code-problem-link" data-code-link="${escapeHtml(problem.id)}" aria-label="在新标签页打开 ${escapeHtml(problem.title)} 的题目链接" title="${codeProblemUrl(problem.url) ? "打开题目链接" : "未填写有效题目链接"}"${codeProblemUrl(problem.url) ? "" : " disabled"}><i data-lucide="external-link" size="18" aria-hidden="true"></i></button>
        <button type="button" class="icon-button" data-code-delete="${escapeHtml(problem.id)}" aria-label="删除 ${escapeHtml(problem.title)}" title="删除题目"><i data-lucide="trash-2" size="15" aria-hidden="true"></i></button>
      </div>
    </li>`).join("");
  $("#code-list-empty").hidden = visible.length > 0;
  $("#code-list-empty").textContent = query ? "没有匹配的题目" : "还没有题目，点击“添加题目”开始记录";
  refreshIcons();
}
function renderCodeDraft() {
  if (!codeUiReady) return;
  resetCodePython();
  const language = $("#code-language");
  language.querySelector("[data-legacy-language]")?.remove();
  if (!Object.hasOwn(CODE_LANGUAGES, codeDraft.language)) {
    const option = document.createElement("option");
    option.value = codeDraft.language; option.textContent = `${codeLanguageLabel(codeDraft.language)}（历史题目）`;
    option.disabled = true; option.dataset.legacyLanguage = "true"; language.appendChild(option);
  }
  for (const name of ["title", "url", "tags", "language"]) $("#code-" + name).value = codeDraft[name];
  $("#code-stdin").value = codeDraft.stdin ?? "";
  $("#code-title").setCustomValidity("");
  const previousPosition = codeEditorPositions.get(codeDraft.id);
  codeEditor?.setDocument(codeDraft.code, codeDraft.language, previousPosition?.code === codeDraft.code ? previousPosition.position : null);
  $("#code-details").open = !codeDraft.id;
  if (!codeDraft.id) $("#code-python-console").open = false;
  updateCodeStatus();
  renderCodeList();
}
function rememberCodePosition() {
  if (codeDraft?.id && codeEditor) codeEditorPositions.set(codeDraft.id, { code: codeEditor.getValue(), position: codeEditor.getPosition() });
}
function rememberCodeProblem() {
  try { localStorage.setItem(CODE_LAST_PROBLEM_KEY, codeDraft.id || ""); } catch { /* 选题偏好不影响正式保存。 */ }
}
function setCodeDraft(problem) {
  rememberCodePosition();
  codeDraftGeneration++;
  clearCodeRecovery();
  codeDraft = problem ? stripCodeTimestamps(problem) : emptyCodeDraft();
  codeBaseline = { ...codeDraft };
  rememberCodeProblem();
  renderCodeDraft();
}
function discardCodeDraft() {
  if (!codeBaseline) return;
  codeDraft = { ...codeBaseline };
  codeDraftGeneration++;
  clearCodeRecovery();
  renderCodeDraft();
}
function requestCodeAction(action) {
  if (!isCodeDirty()) { action(); return true; }
  codePendingAction = action;
  openModal("code-unsaved-modal");
  $("#code-unsaved-cancel").focus();
  return false;
}
function resolveCodeAction(choice) {
  const action = codePendingAction;
  if (!action) return;
  const finish = () => {
    if (codePendingAction !== action) return;
    if (choice === "save" && isCodeDirty()) { showToast("还有保存期间新增的修改，请再次保存后继续"); return; }
    if (choice === "discard") discardCodeDraft();
    codePendingAction = null;
    closeModal("code-unsaved-modal"); action();
  };
  if (choice === "save") {
    const result = saveCodeProblem();
    if (result?.then) { result.then((saved) => { if (saved) finish(); }); return; }
    if (!result) return;
  }
  finish();
}
function newCodeProblem() {
  requestCodeAction(() => {
    setCodeDraft(null);
    $("#code-workspace").classList.add("mobile-editing");
    $("#code-python-console").open = false;
    $("#code-title").focus();
    codeEditor?.refresh();
  });
}
function openCodeProblem(id) {
  const problem = codeProblems.find((item) => item.id === id);
  if (!problem) return;
  const action = () => {
    if (codeDraft?.id !== id) setCodeDraft(codeProblems.find((item) => item.id === id) || null);
    $("#code-workspace").classList.add("mobile-editing");
    codeEditor?.refresh();
    codeEditor?.focus();
  };
  if (codeDraft?.id === id) action(); else requestCodeAction(action);
}
function saveCodeProblem() {
  if (codeSavePending) return codeSavePending;
  if (!codeDraft) return false;
  const title = codeDraft.title.trim();
  if (!title) {
    const input = $("#code-title");
    $("#code-details").open = true;
    $("#code-python-console").open = false;
    input.setCustomValidity("请填写题目名称"); input.reportValidity(); input.focus();
    showToast("请填写题目名称后再保存");
    return false;
  }
  const draft = stripCodeTimestamps(codeDraft), baseline = { ...codeBaseline }, generation = codeDraftGeneration;
  const result = withCodeStorageLock(() => {
    try {
      const latest = readLatestCodeProblems();
      const previous = latest.find((problem) => problem.id === draft.id);
      if (draft.id && (!previous || codeProblemSnapshot(previous) !== codeProblemSnapshot(baseline))) {
        codeProblems = latest; renderCodeList(); persistCodeRecovery();
        if (generation === codeDraftGeneration) {
          closeModal("code-unsaved-modal");
          $("#code-conflict-summary").textContent = previous ? "这道题已在其他标签页修改，本页编辑内容已保留。" : "这道题已在其他标签页删除，本页编辑内容已保留。";
          openModal("code-conflict-modal"); $("#code-conflict-cancel").focus();
        }
        showToast("题目存在冲突，未覆盖其他标签页的记录"); return false;
      }
      const problem = { ...previous, ...draft, title,
        id: previous?.id || window.crypto?.randomUUID?.() || `code-${Date.now()}-${Math.random().toString(36).slice(2)}` };
      const next = previous ? latest.map((item) => item.id === problem.id ? problem : item) : [problem, ...latest];
      writeCodeProblems(next); codeProblems = next;
      if (generation === codeDraftGeneration) {
        // 等待锁期间用户仍可输入，新输入不能被保存完成后的 UI 更新抹掉。
        const unchanged = codeProblemSnapshot(codeDraft) === codeProblemSnapshot(draft);
        codeDraft = unchanged ? { ...problem } : { ...problem, ...stripCodeTimestamps(codeDraft), id: problem.id };
        codeBaseline = { ...problem };
        rememberCodeProblem();
        if (unchanged) clearCodeRecovery(); else persistCodeRecovery();
        $("#code-title").value = codeDraft.title; updateCodeStatus();
      }
      renderCodeList(); clearFeedback($("#code-workspace")); showToast("题目已保存"); return true;
    } catch {
      showToast("题目保存失败，编辑内容已保留，请检查浏览器存储空间、权限或备份格式", { retry: saveCodeProblem, target: $("#code-workspace") }); return false;
    }
  });
  if (result?.then) {
    $("#code-save").disabled = true; $("#code-save").setAttribute("aria-busy", "true");
    codeSavePending = result.finally(() => {
      codeSavePending = null; $("#code-save").disabled = !codeEditor; $("#code-save").removeAttribute("aria-busy");
    });
    return codeSavePending;
  }
  return result;
}
function resolveCodeConflict(choice) {
  if (choice === "copy") {
    codeDraft = { ...codeDraft, id: null };
    codeBaseline = emptyCodeDraft(); codeDraftGeneration++;
    closeModal("code-conflict-modal"); markCodeChanged(); return saveCodeProblem();
  }
  try {
    codeProblems = readLatestCodeProblems();
    const latest = codeProblems.find((item) => item.id === codeDraft.id);
    setCodeDraft(latest || null); closeModal("code-conflict-modal");
  } catch { showToast("最新题目无法读取，本页编辑内容已保留"); }
}
function askDeleteCodeProblem(id) {
  const problem = codeProblems.find((item) => item.id === id);
  if (!problem) return;
  codeDeleteId = id;
  codeDeleteBaseline = { ...problem };
  $("#code-delete-summary").textContent = `删除“${problem.title}”？${codeDraft?.id === id && isCodeDirty() ? "这道题未保存的修改也会被删除。" : ""}`;
  openModal("code-delete-modal");
  $("#code-delete-cancel").focus();
}
function deleteCodeProblem() {
  if (!codeDeleteId || !codeProblems.some((item) => item.id === codeDeleteId)) return;
  const id = codeDeleteId, baseline = codeDeleteBaseline;
  return withCodeStorageLock(() => {
    if (codeDeleteId !== id || codeDeleteBaseline !== baseline) return false;
    try {
      const latest = readLatestCodeProblems(), previous = latest.find((item) => item.id === id);
      if (previous && codeProblemSnapshot(previous) !== codeProblemSnapshot(baseline)) {
        codeProblems = latest; renderCodeList(); closeModal("code-delete-modal");
        showToast("题目已在其他标签页修改，删除未执行，请重新确认"); return false;
      }
      const next = latest.filter((item) => item.id !== id); writeCodeProblems(next); codeProblems = next;
      if (codeDraft?.id === id) setCodeDraft(null); else renderCodeList();
      codeEditorPositions.delete(id);
      closeModal("code-delete-modal"); showToast("题目已删除，可在 10 秒内撤销");
      if (previous) offerUndo(() => withCodeStorageLock(() => {
        try {
          const current = readLatestCodeProblems();
          if (current.some(item => item.id === id)) { showToast("题目已存在，未覆盖其他标签页的记录"); return false; }
          const restored = current.slice();
          restored.splice(Math.min(latest.findIndex(item => item.id === id), restored.length), 0, previous);
          writeCodeProblems(restored); codeProblems = restored; renderCodeList();
          showToast("已撤销删除题目"); return true;
        } catch { showToast("撤销失败，请重试或导入备份"); return false; }
      }), "题目已删除");
      return true;
    } catch { showToast("删除失败，题目已保留"); return false; }
  });
}
function openCodeProblemLink(value) {
  const url = codeProblemUrl(value);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}
async function copyCode() {
  const selected = codeEditor?.getSelectedText() ?? null;
  const text = selected ?? codeDraft.code;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const input = document.createElement("textarea");
      input.value = text; input.className = "sr-only"; document.body.appendChild(input); input.select();
      try { if (!document.execCommand("copy")) throw new Error("copy failed"); } finally { input.remove(); codeEditor?.focus(); }
    }
    showToast(selected === null ? "代码已复制" : "选中代码已复制");
  } catch { showToast("复制失败，请选中代码后手动复制"); }
}
function toggleCodeFullscreen(force) {
  if (!codeUiReady) return;
  const panel = $("#code-editor-panel");
  const enabled = force ?? !panel.classList.contains("is-fullscreen");
  panel.classList.toggle("is-fullscreen", enabled);
  document.body.classList.toggle("code-fullscreen", enabled);
  $("#code-fullscreen").setAttribute("aria-pressed", String(enabled));
  $("#code-fullscreen-label").textContent = enabled ? "退出全屏" : "全屏";
  if (enabled) $("#code-details").open = false;
  codeEditor?.refresh();
  if (enabled) codeEditor?.focus();
}
function resetCodeAfterImport() {
  if (codeUiReady) setCodeDraft(null);
  else { clearCodeRecovery(); codeDraft = codeBaseline = null; }
}
function validCodeDraft(draft) {
  return draft && (draft.id === null || typeof draft.id === "string") && typeof draft.title === "string" &&
    typeof draft.code === "string" && isStoredCodeLanguage(draft.language) && typeof draft.url === "string" && typeof draft.tags === "string" &&
    (draft.stdin == null || typeof draft.stdin === "string");
}
function updateCodePythonControls() {
  if (!codeUiReady) return;
  $("#code-python-console").hidden = codeDraft.language !== "python";
  $("#code-python-actions").hidden = codeDraft.language !== "python";
  $("#code-python-console").setAttribute("aria-busy", String(codePythonBusy));
  for (const action of ["run", "compile"]) $("#code-python-" + action).disabled = codePythonBusy || !codeEditor || !window.TrackerPythonRunner;
  $("#code-python-stop").disabled = !codePythonBusy;
  $("#code-python-clear").disabled = codePythonBusy;
}
function appendCodePythonOutput(text) {
  codePythonOutput += text.slice(0, Math.max(0, 65536 - codePythonOutput.length));
  // 合并连续输出，避免 print 循环对页面逐行更新。
  if (!codePythonOutputTimer) codePythonOutputTimer = window.setTimeout(flushCodePythonOutput, 16);
}
function flushCodePythonOutput() {
  window.clearTimeout(codePythonOutputTimer); codePythonOutputTimer = null;
  const output = $("#code-python-output");
  const follow = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
  output.textContent = codePythonOutput;
  if (codePythonErrorStart !== null) {
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of codePythonOutput.slice(codePythonErrorStart).matchAll(/main\.py"?,\s+(line\s+(\d+))/g)) {
      const from = codePythonErrorStart + match.index + match[0].length - match[1].length;
      fragment.append(document.createTextNode(codePythonOutput.slice(offset, from)));
      const button = document.createElement("button");
      button.type = "button"; button.className = "code-error-line"; button.dataset.codeLine = match[2];
      button.textContent = match[1]; button.title = `跳转到代码第 ${match[2]} 行`; button.setAttribute("aria-label", button.title);
      fragment.append(button); offset = from + match[1].length;
    }
    fragment.append(document.createTextNode(codePythonOutput.slice(offset))); output.replaceChildren(fragment);
  }
  if (follow) output.scrollTop = output.scrollHeight;
}
function handleCodePythonEvent(event) {
  const status = $("#code-python-status");
  if (event.type === "output") { appendCodePythonOutput(event.text); return; }
  if (event.type === "state") {
    codePythonBusy = true; status.dataset.state = "busy";
    status.textContent = event.state === "loading" ? "正在加载 Python 环境…" : event.mode === "compile" ? "正在检查语法…" : "正在运行…";
  } else if (event.type === "complete") {
    flushCodePythonOutput();
    codePythonBusy = false; status.dataset.state = event.status;
    if (event.status === "success") {
      status.textContent = event.mode === "compile" ? "编译通过，未执行代码" : `运行完成 · ${event.elapsedMs ?? 0} ms`;
      if (!$("#code-python-output").textContent) $("#code-python-output").textContent = event.mode === "compile" ? "语法检查通过。" : "程序正常结束，没有输出。";
    } else {
      const labels = { stopped: "已停止", timeout: "执行超时，已停止", "output-limit": "输出达到上限，已停止", "load-error": "环境加载失败，可重试" };
      status.textContent = labels[event.status] || (event.mode === "compile" ? "编译未通过" : "运行失败");
      if (event.error && event.status !== "stopped") {
        codePythonErrorStart = codePythonOutput.length;
        appendCodePythonOutput(`${$("#code-python-output").textContent ? "\n" : ""}${event.error}`);
      }
    }
    // 错误和结束状态同时呈现，不等待下一次输出刷新。
    if (event.status !== "success") flushCodePythonOutput();
  }
  updateCodePythonControls();
}
function executeCodePython(mode) {
  if (!codeEditor || codeDraft.language !== "python" || codePythonBusy) return;
  if (!window.TrackerPythonRunner) { showToast("Python 功能未加载，请检查 assets 文件夹后刷新"); return; }
  const code = codeEditor.getValue();
  if (!code.trim()) { showToast("请先输入 Python 代码"); codeEditor.focus(); return; }
  codePythonRunner ||= window.TrackerPythonRunner.create({ onEvent: handleCodePythonEvent });
  resetCodePython();
  codePythonSource = code;
  $("#code-details").open = false;
  $("#code-python-console").open = true;
  return codePythonRunner.execute({ mode, code, stdin: codeDraft.stdin ?? "" });
}
function stopCodePython() { codePythonRunner?.stop(); }
function resetCodePython() {
  stopCodePython();
  window.clearTimeout(codePythonOutputTimer); codePythonOutputTimer = null; codePythonOutput = "";
  codePythonErrorStart = null; codePythonSource = null;
  $("#code-python-output").textContent = "";
  $("#code-python-status").textContent = "就绪";
  $("#code-python-status").dataset.state = "idle";
  updateCodePythonControls();
}
function setupCodePage() {
  if (codeUiReady) { codeEditor?.refresh(); return; }
  codeUiReady = true;
  codeDraft = emptyCodeDraft(); codeBaseline = { ...codeDraft };
  try {
    const last = localStorage.getItem(CODE_LAST_PROBLEM_KEY);
    const selected = last === null ? codeProblems[0] : codeProblems.find((problem) => problem.id === last) || (last ? codeProblems[0] : null);
    if (selected) { codeDraft = stripCodeTimestamps(selected); codeBaseline = { ...codeDraft }; }
  } catch { /* 浏览器无法保存选题偏好时仍可使用空白编辑器。 */ }
  try {
    const ownDraft = sessionStorage.getItem(CODE_DRAFT_KEY);
    const cached = ownDraft ?? localStorage.getItem(CODE_DRAFT_KEY);
    if (cached) {
      const recovery = JSON.parse(cached), draft = recovery.version === 2 ? recovery.draft : recovery;
      if (validCodeDraft(draft)) {
        const existing = codeProblems.find((item) => item.id === draft.id);
        if (recovery.version === 2) {
          if (!validCodeDraft(recovery.baseline) || recovery.baseline.id !== draft.id) throw new Error("临时草稿基准无效");
          codeBaseline = { ...stripCodeTimestamps(recovery.baseline), language: normalizeCodeLanguage(recovery.baseline.language) };
        } else {
          codeBaseline = existing ? stripCodeTimestamps(existing)
            : { ...emptyCodeDraft(), id: draft.id };
        }
        codeDraft = { ...stripCodeTimestamps(draft), language: normalizeCodeLanguage(draft.language) };
        if (isCodeDirty()) { $("#code-workspace").classList.add("mobile-editing"); showToast("已恢复未保存的题目草稿"); }
        if (ownDraft === null) {
          // 旧版共享草稿只在迁移成功后移除，避免已有未保存内容丢失。
          sessionStorage.setItem(CODE_DRAFT_KEY, JSON.stringify({ version: 2, draft: codeDraft, baseline: codeBaseline }));
          localStorage.removeItem(CODE_DRAFT_KEY);
        }
        codeRecoverySaved = isCodeDirty();
      }
    }
  } catch { console.warn("临时题目草稿无法读取。"); }
  if (window.TrackerCodeEditor) {
    codeEditor = window.TrackerCodeEditor.create($("#code-editor"), {
      value: codeDraft.code, language: codeDraft.language,
      onChange(value) { codeDraft.code = value; markCodeChanged(); },
      onCursor(line, column) { $("#code-cursor").textContent = `第 ${line} 行，第 ${column} 列`; },
      onSave: saveCodeProblem
    });
  } else {
    $("#code-editor-error").hidden = false;
    $("#code-save").disabled = true;
    showToast("代码编辑器未加载，请检查项目的 assets 文件夹后刷新");
  }
  for (const field of ["title", "url", "tags"]) $("#code-" + field).addEventListener("input", (event) => {
    codeDraft[field] = event.target.value; $("#code-title").setCustomValidity(""); markCodeChanged();
  });
  $("#code-language").addEventListener("change", (event) => {
    if (!Object.hasOwn(CODE_LANGUAGES, event.target.value)) return;
    codeDraft.language = event.target.value; codeEditor?.setLanguage(codeDraft.language);
    $("#code-language").querySelector("[data-legacy-language]")?.remove();
    resetCodePython();
    markCodeChanged();
  });
  $("#code-stdin").addEventListener("input", (event) => { codeDraft.stdin = event.target.value; markCodeChanged(); });
  $("#code-python-run").addEventListener("click", () => executeCodePython("run"));
  $("#code-python-compile").addEventListener("click", () => executeCodePython("compile"));
  $("#code-python-stop").addEventListener("click", stopCodePython);
  $("#code-python-clear").addEventListener("click", resetCodePython);
  $("#code-python-output").addEventListener("click", (event) => {
    const button = event.target.closest("[data-code-line]");
    if (!button) return;
    if (codeEditor.getValue() !== codePythonSource) { showToast("代码已修改，请重新运行后定位当前错误"); return; }
    codeEditor.goToLine(Number(button.dataset.codeLine));
  });
  for (const [current, other] of [["code-details", "code-python-console"], ["code-python-console", "code-details"]]) {
    $("#" + current + " summary").addEventListener("click", () => {
      if (!$("#" + current).open) $("#" + other).open = false;
    });
    $("#" + current).addEventListener("toggle", () => codeEditor?.refresh());
  }
  $("#code-library-toggle").addEventListener("click", () => {
    const collapsed = $("#code-workspace").classList.toggle("library-collapsed");
    $("#code-library").hidden = collapsed;
    const button = $("#code-library-toggle"), label = collapsed ? "展开题目列表" : "收起题目列表";
    button.setAttribute("aria-expanded", String(!collapsed)); button.setAttribute("aria-label", label); button.title = label;
    codeEditor?.refresh();
  });
  $("#code-search").addEventListener("input", renderCodeList);
  $("#code-add").addEventListener("click", newCodeProblem);
  $("#code-save").addEventListener("click", saveCodeProblem);
  $("#code-open-link").addEventListener("click", () => openCodeProblemLink(codeDraft.url));
  $("#code-copy").addEventListener("click", copyCode);
  $("#code-fullscreen").addEventListener("click", () => toggleCodeFullscreen());
  $("#code-mobile-back").addEventListener("click", () => requestCodeAction(() => { $("#code-workspace").classList.remove("mobile-editing"); }));
  $("#code-problem-list").addEventListener("click", (event) => {
    const target = event.target.closest("[data-code-open], [data-code-link], [data-code-delete]");
    if (!target) return;
    if (target.hasAttribute("data-code-link")) {
      const problem = codeProblems.find((item) => item.id === target.dataset.codeLink);
      if (problem) openCodeProblemLink(problem.url);
    } else if (target.hasAttribute("data-code-delete")) askDeleteCodeProblem(target.dataset.codeDelete);
    else openCodeProblem(target.dataset.codeOpen);
  });
  $("#code-unsaved-save").addEventListener("click", () => resolveCodeAction("save"));
  $("#code-unsaved-discard").addEventListener("click", () => resolveCodeAction("discard"));
  $("#code-delete-confirm").addEventListener("click", deleteCodeProblem);
  $("#code-conflict-copy").addEventListener("click", () => resolveCodeConflict("copy"));
  $("#code-conflict-reload").addEventListener("click", () => resolveCodeConflict("reload"));
  window.addEventListener("storage", (event) => {
    if (event.key !== CODE_STORAGE_KEY && event.key !== null) return;
    if (event.storageArea && event.storageArea !== localStorage) return;
    try {
      const cached = localStorage.getItem(CODE_STORAGE_KEY);
      codeProblems = cached === null ? [] : parseCodeProblems(JSON.parse(cached));
      // null 事件也是一次已知的删除，后续不能回退到旧内存数据。
      codeStorageSnapshot = cached ?? "[]"; renderCodeList();
    } catch { showToast("其他标签页的题目更新无法读取，本页编辑内容已保留"); }
  });
  window.addEventListener("beforeunload", (event) => {
    if (!isCodeDirty()) return;
    persistCodeRecovery(); event.preventDefault(); event.returnValue = "";
  });
  document.addEventListener("keydown", (event) => {
    const modal = $$(".modal-backdrop.active").at(-1);
    const scope = !modal && $("#code-editor-panel").classList.contains("is-fullscreen") ? $("#code-editor-panel") : null;
    if (scope && event.key === "Tab") {
      const controls = $$("button:not(:disabled), input, select, textarea, summary, [tabindex='0'], [contenteditable='true']", scope)
        .filter((item) => item.tabIndex !== -1 && !item.closest("[hidden]") && window.getComputedStyle(item).display !== "none" &&
          (!item.closest("details:not([open])") || item.closest("summary")));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if (event.key === "Escape" && $("#code-editor-panel").classList.contains("is-fullscreen")) {
      if ($("#code-editor").contains(event.target) && codeEditor?.dismissCompletion()) return;
      event.preventDefault(); event.stopPropagation(); toggleCodeFullscreen(false); $("#code-fullscreen").focus();
    }
    if (!modal && activeRoute === "codes" && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault(); event.stopPropagation(); saveCodeProblem();
    }
    if (!modal && activeRoute === "codes" && codeDraft.language === "python" && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault(); event.stopPropagation(); executeCodePython("run");
    }
  }, true);
  rememberCodeProblem();
  renderCodeDraft();
}
