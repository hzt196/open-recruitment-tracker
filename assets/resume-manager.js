(() => {
  const root = document.getElementById("resumes");
  if (!root) return;
  const tabs = Array.from(root.querySelectorAll("[role='tab']"));
  const tablist = root.querySelector("[role='tablist']");
  const panel = root.querySelector("#resume-preview");
  const frame = root.querySelector("#resume-frame");
  const paper = root.querySelector("#resume-paper");
  const status = root.querySelector("#resume-preview-status");
  const locationToggle = root.querySelector("#resume-location-toggle");
  const fileLocation = root.querySelector("#resume-file-location");
  const paperWidth = 810; // A4 width (794px) plus room for a native scrollbar.
  const paperHeight = 1123;
  let activeTab = tabs.find(tab => tab.getAttribute("aria-selected") === "true") || tabs[0];
  let loaded = false;
  let documentHeight = paperHeight;

  function fitPreview() {
    tablist.setAttribute("aria-orientation", window.matchMedia?.("(max-width: 760px)").matches ? "horizontal" : "vertical");
    const width = paper.clientWidth;
    if (!width) return;
    const scale = Math.min(1, width / paperWidth);
    frame.style.transform = `scale(${scale})`;
    paper.style.height = `${documentHeight * scale}px`;
  }

  function setDocumentHeight(height) {
    if (!Number.isFinite(height) || height <= 0 || height > 30000) return;
    documentHeight = Math.max(paperHeight, Math.ceil(height) + 1);
    frame.style.height = `${documentHeight}px`;
    fitPreview();
  }

  // The embedded file can report its own height even when file:// denies DOM access.
  window.addEventListener("message", event => {
    if (!loaded || event.source !== frame.contentWindow || event.data?.type !== "resume-preview-size") return;
    if (event.data.url !== frame.src) return;
    setDocumentHeight(event.data.height);
  });

  function selectResume(tab) {
    if (!tabs.includes(tab)) return;
    activeTab = tab;
    tabs.forEach(item => {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    panel.setAttribute("aria-labelledby", tab.id);
    root.querySelector("#resume-preview-title").textContent = tab.dataset.resumeTitle;
    root.querySelector("#resume-preview-language").textContent = tab.dataset.resumeLanguage;
    root.querySelector("#resume-file-path").textContent = tab.dataset.resumePath;
    root.querySelector("#resume-open").setAttribute("href", tab.dataset.resumePath);
    frame.title = `${tab.dataset.resumeTitle}预览`;
    if (frame.getAttribute("src") !== tab.dataset.resumePath) {
      documentHeight = paperHeight;
      frame.style.height = `${paperHeight}px`;
      status.textContent = `正在加载${tab.dataset.resumeTitle}…`;
      status.hidden = false;
      panel.setAttribute("aria-busy", "true");
      frame.setAttribute("src", tab.dataset.resumePath);
    }
    fitPreview();
  }

  tabs.forEach(tab => {
    tab.addEventListener("click", () => selectResume(tab));
    tab.addEventListener("keydown", event => {
      if (event.altKey || event.ctrlKey || event.metaKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
        : (index + (event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length;
      selectResume(tabs[next]);
      tabs[next].focus();
    });
  });
  locationToggle.addEventListener("click", () => {
    fileLocation.hidden = !fileLocation.hidden;
    locationToggle.setAttribute("aria-expanded", String(!fileLocation.hidden));
  });
  frame.addEventListener("load", () => {
    if (!frame.hasAttribute("src")) return;
    // Prefer the paper's height; the document viewport grows with the iframe.
    try {
      const doc = frame.contentDocument;
      const page = doc?.querySelector?.(".a4-page");
      const contentHeight = page ? page.getBoundingClientRect().height
        : Math.max(doc?.documentElement.scrollHeight || 0, doc?.body?.scrollHeight || 0);
      setDocumentHeight(contentHeight);
    } catch { /* Keep the height received from the embedded document. */ }
    status.hidden = true;
    status.textContent = "";
    panel.setAttribute("aria-busy", "false");
    fitPreview();
  });
  frame.addEventListener("error", () => {
    status.textContent = "简历预览无法加载，请检查“文件位置”，或点击“打开简历”。";
    status.hidden = false;
    panel.setAttribute("aria-busy", "false");
  });
  if (window.ResizeObserver) new ResizeObserver(fitPreview).observe(paper);
  window.addEventListener("resize", fitPreview);
  window.ResumeWorkbench = {
    activate() {
      if (!loaded) { loaded = true; selectResume(activeTab); }
      else fitPreview();
    }
  };
})();
