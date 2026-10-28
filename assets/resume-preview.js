(() => {
  if (window.parent === window) return;
  const page = document.querySelector(".a4-page");
  if (!page) return;
  let previousHeight = 0;
  function reportHeight() {
    const height = Math.ceil(page.getBoundingClientRect().height);
    if (!height || height === previousHeight) return;
    previousHeight = height;
    window.parent.postMessage({ type: "resume-preview-size", url: window.location.href, height }, "*");
  }
  if (window.ResizeObserver) new ResizeObserver(reportHeight).observe(page);
  window.addEventListener("load", reportHeight);
  document.fonts?.ready.then(reportHeight);
  reportHeight();
})();
