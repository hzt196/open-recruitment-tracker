/* Pixel2Motion: preserve the original SVG geometry; animate named parts only. */
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const DURATION = 2200;
  const EASE = "cubic-bezier(.4, 0, .2, 1)";
  const REST = { transform: "none", opacity: 1 };
  const shapes = {
    brand: `<g data-part="latch"><path d="M12 12h.01"/></g><g data-part="handle"><path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></g><g data-part="flap"><path d="M22 13a18.15 18.15 0 0 1-20 0"/></g><g data-part="body"><rect width="20" height="14" x="2" y="6" rx="2"/></g>`,
    overview: `<g data-part="tile-a"><rect width="7" height="9" x="3" y="3" rx="1"/></g><g data-part="tile-b"><rect width="7" height="5" x="14" y="3" rx="1"/></g><g data-part="tile-c"><rect width="7" height="9" x="14" y="12" rx="1"/></g><g data-part="tile-d"><rect width="7" height="5" x="3" y="16" rx="1"/></g>`,
    calendar: `<g data-part="ring-left"><path d="M8 2v3"/></g><g data-part="ring-right"><path d="M16 2v3"/></g><g data-part="frame"><rect x="3" y="3" width="18" height="18" rx="2"/></g><g data-part="divider"><path d="M3 9h18"/></g>${[[8,13],[12,13],[16,13],[8,17],[12,17],[16,17]].map(([x,y], i) => `<g data-part="day-${i + 1}"><path d="M${x} ${y}h.01"/></g>`).join("")}`,
    applications: `<g data-part="paper" opacity="0"><path d="M8 9V5h8v4M10 7h4"/></g><g data-part="rim"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/></g><g data-part="tray"><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></g>`,
    offerbiu: `<g data-part="handle-frame"><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></g><g data-part="case"><rect width="20" height="14" x="2" y="6" rx="2"/></g>`,
    resumes: `<g data-part="page"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/></g><g data-part="fold"><path d="M14 2v5a1 1 0 0 0 1 1h5"/></g><g data-part="line-1"><path d="M10 9H8"/></g><g data-part="line-2"><path d="M16 13H8"/></g><g data-part="line-3"><path d="M16 17H8"/></g>`,
    codes: `<g data-part="bracket-right"><path d="m18 16 4-4-4-4"/></g><g data-part="bracket-left"><path d="m6 8-4 4 4 4"/></g><g data-part="slash"><path d="m14.5 4-5 16"/></g>`
  };
  const kinds = Object.keys(shapes);
  const controllers = new Set();
  const installed = new WeakMap();
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let serial = 0;

  function createSvg(kind, prefix = `p2m-${++serial}`) {
    if (!shapes[kind]) return null;
    const svg = document.createElementNS(NS, "svg");
    Object.entries({ viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false", class: "p2m-icon" }).forEach(([key, value]) => svg.setAttribute(key, value));
    svg.innerHTML = shapes[kind];
    svg.querySelectorAll("[data-part]").forEach(part => { part.id = `${prefix}-${part.dataset.part}`; });
    return svg;
  }

  // All offsets use one shared clock; each accent has a different active window.
  function beat(peak, at = .35) {
    return [
      { ...REST, offset: 0 }, { ...REST, offset: Math.max(0, at - .16) },
      { ...REST, ...peak, offset: at }, { ...REST, offset: at + .22 },
      { ...REST, offset: 1 }
    ];
  }

  function choreography(kind) {
    const lift = { part: "host", frames: beat({ transform: "translateY(-2px) scale(1.02)" }, .37) };
    const sheen = { part: "sheen", frames: [
      { transform: "translateX(-110%)", opacity: 0, offset: 0 },
      { transform: "translateX(-110%)", opacity: 0, offset: .2 },
      { transform: "translateX(0)", opacity: .6, offset: .46 },
      { transform: "translateX(110%)", opacity: 0, offset: .72 },
      { transform: "translateX(-110%)", opacity: 0, offset: 1 }
    ] };
    const move = (part, transform, at) => ({ part, frames: beat({ transform }, at) });
    const glow = (part, at) => ({ part, frames: beat({ opacity: .35, transform: "translateY(-.3px)" }, at) });
    const motions = {
      brand: [move("handle", "translateY(-1.2px)", .27), move("body", "translateY(-.45px)", .37), move("flap", "translateY(-.65px)", .34), glow("latch", .42)],
      overview: ["a", "b", "c", "d"].map((part, i) => move(`tile-${part}`, "translateY(-1px)", .22 + i * .09)),
      calendar: [move("ring-left", "translateY(-.65px)", .23), move("ring-right", "translateY(-.65px)", .29), ...Array.from({ length: 6 }, (_, i) => glow(`day-${i + 1}`, .3 + i * .055))],
      applications: [move("tray", "translateY(.45px)", .45), move("rim", "translateY(.6px)", .4), { part: "paper", frames: [
        { transform: "translateY(-2px)", opacity: 0, offset: 0 },
        { transform: "translateY(-2px)", opacity: 0, offset: .14 },
        { transform: "translateY(-.5px)", opacity: .9, offset: .29 },
        { transform: "translateY(3px)", opacity: .9, offset: .45 },
        { transform: "translateY(4px)", opacity: 0, offset: .56 },
        { transform: "none", opacity: 0, offset: 1 }
      ] }],
      offerbiu: [move("handle-frame", "translateY(-.6px)", .28), move("case", "translateY(.4px) scaleY(.97)", .4)],
      resumes: [move("fold", "translateY(-.4px)", .24), ...[1, 2, 3].map((line, i) => glow(`line-${line}`, .32 + i * .1))],
      codes: [move("bracket-left", "translateX(-.75px)", .3), move("bracket-right", "translateX(.75px)", .34), move("slash", "rotate(5deg)", .44)]
    };
    return [lift, ...motions[kind], sheen];
  }

  function attach(host, kind) {
    if (installed.has(host)) return installed.get(host);
    const svg = createSvg(kind);
    if (!svg) return null;
    host.replaceChildren(svg);
    const sheen = document.createElement("span");
    sheen.className = "p2m-sheen"; sheen.dataset.part = "sheen";
    sheen.setAttribute("aria-hidden", "true");
    host.append(sheen);
    host.classList.add("p2m-host"); host.dataset.motionKind = kind;
    const actors = new Map([["host", host], ...[...host.querySelectorAll("[data-part]")].map(el => [el.dataset.part, el])]);
    const plans = choreography(kind).map(plan => ({ ...plan, el: actors.get(plan.part) }));
    let loops = [], returns = [], hovering = false, focusing = false, rate = 1, tapTimer;
    const rest = el => ({ transform: "none", opacity: el.dataset.part === "paper" || el.dataset.part === "sheen" ? 0 : 1 });
    const cancel = () => { window.clearTimeout(tapTimer); [...loops, ...returns].forEach(animation => animation.cancel()); loops = []; returns = []; };

    function start() {
      if (loops.length || reduced?.matches || !host.animate) return;
      const carry = returns.length ? plans.map(({ el }) => ({ transform: getComputedStyle(el).transform, opacity: getComputedStyle(el).opacity })) : null;
      cancel();
      plans.forEach(({ el, frames }, i) => {
        const animation = el.animate(frames.map(frame => ({ ...frame, easing: EASE })), { duration: DURATION, delay: carry ? 120 : 0, iterations: Infinity, fill: "both" });
        animation.playbackRate = rate; loops.push(animation);
        if (carry) {
          const bridge = el.animate([carry[i], frames[0]], { duration: 120, easing: EASE, fill: "both" });
          returns.push(bridge); bridge.onfinish = () => bridge.cancel();
        }
      });
      host.dataset.motionActive = "true";
    }

    function stop(immediate = false) {
      if (!loops.length && !returns.length) return;
      const current = plans.map(({ el }) => ({ transform: getComputedStyle(el).transform, opacity: getComputedStyle(el).opacity }));
      cancel(); delete host.dataset.motionActive;
      if (immediate || reduced?.matches) return;
      plans.forEach(({ el }, i) => {
        const animation = el.animate([current[i], rest(el)], { duration: 220, easing: EASE, fill: "both" });
        returns.push(animation);
        animation.onfinish = () => { animation.cancel(); returns = returns.filter(item => item !== animation); };
      });
    }

    const controller = {
      host, kind, start, stop,
      reset() { hovering = focusing = false; stop(true); },
      seek(time) { stop(true); start(); loops.forEach(animation => { animation.pause(); animation.currentTime = time; }); },
      setRate(value) { rate = value; loops.forEach(animation => animation.updatePlaybackRate(value)); }
    };
    host.addEventListener("pointerenter", event => { if (event.pointerType === "touch") return; hovering = true; start(); });
    host.addEventListener("pointerleave", event => { if (event.pointerType === "touch") return; hovering = false; if (!focusing) stop(); });
    host.addEventListener("pointerup", event => {
      if (event.pointerType !== "touch") return;
      hovering = focusing = false; stop(true); start();
      if (loops.length) tapTimer = window.setTimeout(() => stop(), DURATION);
    });
    host.addEventListener("focusin", () => { focusing = host.matches(":focus-visible"); if (focusing) start(); });
    host.addEventListener("focusout", () => { focusing = false; if (!hovering) stop(); });
    controllers.add(controller); installed.set(host, controller);
    return controller;
  }

  function enhance() {
    document.querySelectorAll(".brand-icon, .page-heading-icon").forEach(host => {
      if (installed.has(host)) return;
      const kind = host.classList.contains("brand-icon") ? "brand" : host.closest(".view")?.id;
      if (shapes[kind]) attach(host, kind);
    });
  }

  const resetAll = () => controllers.forEach(controller => controller.reset());
  reduced?.addEventListener?.("change", () => { if (reduced.matches) resetAll(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) resetAll(); });
  window.addEventListener("blur", resetAll);
  // Observe only page visibility classes; navigation text and highlight are untouched.
  if (window.MutationObserver) {
    const observer = new MutationObserver(() => controllers.forEach(controller => {
      const view = controller.host.closest(".view");
      if (view && !view.classList.contains("active")) controller.reset();
    }));
    document.querySelectorAll(".view").forEach(view => observer.observe(view, { attributes: true, attributeFilter: ["class"] }));
  }
  window.TrackerIconMotion = { enhance, attach, createSvg, kinds, duration: DURATION };
})();
