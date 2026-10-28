/* Move existing controls, never clone records, forms or backup actions. */
(() => {
  let mounted = false;
  function mount({ switchRoute, openModal, closeModal }) {
    if (mounted) return;
    mounted = true;
    const $ = selector => document.querySelector(selector);
    const media = window.matchMedia("(max-width: 760px)");
    const more = $("#mobile-more-modal"), filters = $("#mobile-filter-modal");
    const moves = [
      [$(".sidebar-actions"), $("#mobile-backup-tools")],
      [$("#applications .filter-left"), $("#mobile-filter-options")],
      [$("label.mobile-sort"), $("#mobile-sort-options")],
      [$("#export-btn"), $("#mobile-csv-exports")],
      [$("#export-company-btn"), $("#mobile-csv-exports")],
      [$(".sidebar-actions a"), $(".mobile-tool-links")]
    ].map(([node, target]) => {
      const home = document.createComment("mobile-control-home"); node.before(home);
      return { node, target, home };
    });

    function sync() {
      const route = $(".view.active")?.id || "overview";
      const moreOpen = more.classList.contains("active");
      document.querySelectorAll("[data-mobile-route]").forEach(button => {
        const selected = button.dataset.mobileRoute === route && !moreOpen;
        button.classList.toggle("active", selected);
        if (selected) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
      });
      $("#mobile-more-open").classList.toggle("active", moreOpen || ["resumes", "codes"].includes(route));
      $("#mobile-more-open").setAttribute("aria-expanded", String(moreOpen));
      const status = $("#backup-state").textContent;
      $("#mobile-backup-label").textContent = /已.*写入|已保存内容/.test(status) ? "已备份" : /尚未导出/.test(status) ? "待备份" : "备份";
      $("#mobile-backup-dot").classList.toggle("is-dirty", $("#backup-status").classList.contains("is-dirty"));
      const activeFilter = $(".filter-chip.active")?.dataset.filter || "全部";
      document.querySelectorAll("[data-mobile-filter]").forEach(button => {
        const selected = button.dataset.mobileFilter === activeFilter;
        button.classList.toggle("active", selected); button.setAttribute("aria-pressed", String(selected));
      });
      $("#mobile-filter-open").classList.toggle("active", !["全部", "已约", "有面试", "已拿Offer"].includes(activeFilter));
      $("#mobile-filter-open").setAttribute("aria-label", `筛选与排序，当前：${activeFilter}`);
    }

    function resizeViewport() {
      if (!media.matches) {
        document.documentElement.style.removeProperty("--mobile-vh");
        document.documentElement.style.removeProperty("--mobile-vtop");
        return;
      }
      const viewport = window.visualViewport;
      document.documentElement.style.setProperty("--mobile-vh", `${viewport?.height || window.innerHeight}px`);
      document.documentElement.style.setProperty("--mobile-vtop", `${viewport?.offsetTop || 0}px`);
    }

    function layout() {
      moves.forEach(({ node, target, home }) => media.matches ? target.append(node) : home.after(node));
      if (!media.matches) {
        if (more.classList.contains("active")) closeModal(more.id, true);
        if (filters.classList.contains("active")) closeModal(filters.id, true);
      }
      resizeViewport(); sync();
      window.dispatchEvent(new Event("resize"));
    }

    $("#mobile-more-open").addEventListener("click", () => more.classList.contains("active") ? closeModal(more.id) : openModal(more.id));
    $("#mobile-more-top").addEventListener("click", () => openModal(more.id));
    $("#mobile-filter-open").addEventListener("click", () => openModal(filters.id));
    document.querySelectorAll("[data-mobile-route]").forEach(button => button.addEventListener("click", () => {
      if (more.classList.contains("active")) closeModal(more.id);
      switchRoute(button.dataset.mobileRoute);
    }));
    document.querySelectorAll("[data-mobile-filter]").forEach(button => button.addEventListener("click", () => {
      const value = button.dataset.mobileFilter;
      if (value === "有面试") {
        const custom = $("#overview-filter-chip"); custom.hidden = false; custom.dataset.filter = value; custom.textContent = "有面试安排";
      }
      document.querySelector(`.filter-chip[data-filter="${value}"]`)?.click();
    }));
    const observer = new MutationObserver(sync);
    observer.observe($(".sidebar .nav"), { subtree: true, attributes: true, attributeFilter: ["class"] });
    observer.observe($(".filter-left"), { subtree: true, attributes: true, attributeFilter: ["class"] });
    observer.observe($("#backup-status"), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    observer.observe(more, { attributes: true, attributeFilter: ["class"] });
    media.addEventListener("change", layout);
    window.visualViewport?.addEventListener("resize", resizeViewport);
    window.visualViewport?.addEventListener("scroll", resizeViewport);
    window.addEventListener("resize", resizeViewport);
    layout();
  }
  window.TrackerMobile = { mount };
})();
