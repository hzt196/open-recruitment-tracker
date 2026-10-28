(() => {
  const nav = document.querySelector(".nav");
  const highlight = nav?.querySelector(".nav-highlight");
  if (!highlight) return;
  const buttons = Array.from(nav.querySelectorAll(".nav-button[data-route]"));
  const update = () => {
    const active = buttons.find(button => button.classList.contains("active"));
    if (!active) return;
    const { offsetWidth: width, offsetHeight: height, offsetLeft: left, offsetTop: top } = active;
    highlight.style.width = `${width}px`;
    highlight.style.height = `${height}px`;
    highlight.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    for (const button of buttons) {
      if (button === active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    nav.classList.add("highlight-ready");
  };
  // 跟随实际页面状态；未保存提示阻止切页时，背景仍停在当前页面。
  const changes = new MutationObserver(update);
  buttons.forEach(button => changes.observe(button, { attributes: true, attributeFilter: ["class"] }));
  if (window.ResizeObserver) {
    const sizes = new ResizeObserver(update);
    sizes.observe(nav);
    buttons.forEach(button => sizes.observe(button));
  }
  window.addEventListener("resize", update);
  update();
})();
