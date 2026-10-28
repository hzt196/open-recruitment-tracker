(() => {
  const TYPES = [
    ["all", "全部"], ["apply", "投递"], ["exam", "笔试"],
    ["interview", "面试"], ["offer", "Offer"], ["deadline", "截止"], ["join", "入职"]
  ];
  const FIELDS = [
    ["applyTime", "apply", "投递"],
    ["writtenTime", "exam", "笔试"], ["interview1", "interview", "一面"],
    ["interview2", "interview", "二面"], ["interview3", "interview", "三面"],
    ["offerDate", "offer", "收到 Offer"], ["deadline", "deadline", "Offer 截止"],
    ["expectedJoinDate", "join", "预计入职"]
  ];
  const WEEK = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const pad = value => String(value).padStart(2, "0");
  const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const icon = name => `<i data-lucide="${name}" size="18" aria-hidden="true"></i>`;

  function create({ root, getRecords, parseDate, getStage, getOfferStatus, onOpenRecord, onOpenOffer, refreshIcons, onStateChange = () => {}, now = () => new Date() }) {
    const content = root.querySelector("[data-calendar-content]");
    let selected = dateKey(now());
    let month = selected.slice(0, 7);
    let filter = "all";
    let events = [];
    let pickerYear = null;

    function closeMonthPicker(restoreFocus = false) {
      content.querySelector(".cal-month-popover")?.remove();
      content.querySelector("[data-cal-month]")?.setAttribute("aria-expanded", "false");
      pickerYear = null;
      if (restoreFocus) content.querySelector("[data-cal-month]")?.focus({ preventScroll: true });
    }

    function renderMonthPicker() {
      const wrapper = content.querySelector(".cal-month-picker");
      wrapper.querySelector(".cal-month-popover")?.remove();
      wrapper.querySelector("[data-cal-month]").setAttribute("aria-expanded", "true");
      const current = now();
      wrapper.insertAdjacentHTML("beforeend", `<div id="cal-month-popover" class="cal-month-popover" role="dialog" aria-label="选择年月">
        <div class="cal-year-nav">
          <button type="button" data-cal-year="-1" aria-label="上一年" ${pickerYear === 1000 ? 'disabled' : ''}>${icon("chevron-left")}</button>
          <strong aria-live="polite">${pickerYear} 年</strong>
          <button type="button" data-cal-year="1" aria-label="下一年" ${pickerYear === 9999 ? 'disabled' : ''}>${icon("chevron-right")}</button>
        </div>
        <div class="cal-month-grid" role="group" aria-label="月份，方向键切换">
          ${Array.from({ length: 12 }, (_, index) => {
            const value = `${pickerYear}-${pad(index + 1)}`;
            const isCurrent = pickerYear === current.getFullYear() && index === current.getMonth();
            return `<button type="button" data-cal-pick="${value}" aria-label="${pickerYear}年${index + 1}月" aria-pressed="${value === month}" ${isCurrent ? 'aria-current="date"' : ''} tabindex="${index === Number(month.slice(-2)) - 1 ? 0 : -1}">${index + 1} 月${isCurrent ? '<span class="cal-current-dot" aria-hidden="true"></span>' : ''}</button>`;
          }).join("")}
        </div>
        <div class="cal-month-footer"><span>选择月份即可切换</span><button type="button" data-cal-this-month>回到本月</button></div>
      </div>`);
      refreshIcons();
    }

    function chooseMonth(value) {
      const last = new Date(Number(value.slice(0, 4)), Number(value.slice(-2)), 0).getDate();
      selectDay(`${value}-${pad(Math.min(Number(selected.slice(-2)), last))}`);
      content.querySelector("[data-cal-month]").focus({ preventScroll: true });
    }

    function collectEvents() {
      return getRecords().flatMap(record => FIELDS.flatMap(([field, type, label]) => {
        const date = parseDate(record[field]);
        if (!date || !Number.isFinite(date.getTime())) return [];
        const hasTime = /\d{1,2}:\d{2}/.test(String(record[field]));
        return [{ record, field, type, label, date, day: dateKey(date), hasTime }];
      }));
    }

    function selectDay(day) {
      selected = day;
      month = day.slice(0, 7);
      render();
      onStateChange();
    }

    function moveMonth(delta) {
      const date = parseDate(`${month}-01`);
      date.setMonth(date.getMonth() + delta);
      const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      date.setDate(Math.min(Number(selected.slice(-2)), last));
      selectDay(dateKey(date));
    }

    function deadlineText(event) {
      const status = getOfferStatus(event.record);
      if (status === "已接受" || status === "已拒绝") return { text: status, urgent: false };
      const today = dateKey(now());
      if (event.day < today) return { text: "已过期", urgent: false };
      if (event.day === today) return { text: "今天截止", urgent: true };
      // 用日历日差计算，避免夏令时或当前时刻带来一天偏差。
      const dayNumber = day => {
        const [year, m, d] = day.split("-").map(Number);
        return Date.UTC(year, m - 1, d);
      };
      const days = Math.round((dayNumber(event.day) - dayNumber(today)) / 86400000);
      return { text: `剩余 ${days} 天`, urgent: days <= 3 };
    }

    function render() {
      closeMonthPicker();
      const focus = document.activeElement;
      const focusDay = content.contains(focus) ? focus.dataset.calDay : null;
      events = collectEvents().filter(event => filter === "all" || event.type === filter);
      const monthly = events.filter(event => event.day.slice(0, 7) === month);
      const grouped = new Map();
      events.forEach(event => {
        if (!grouped.has(event.day)) grouped.set(event.day, []);
        grouped.get(event.day).push(event);
      });
      const start = parseDate(`${month}-01`);
      const firstDayOffset = (start.getDay() + 6) % 7;
      const monthDays = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
      const cellCount = Math.ceil((firstDayOffset + monthDays) / 7) * 7;
      const today = dateKey(now());
      const cells = Array.from({ length: cellCount }, (_, index) => {
        const date = new Date(start);
        date.setDate(index - firstDayOffset + 1);
        const day = dateKey(date);
        const items = grouped.get(day) || [];
        const counts = TYPES.slice(1).map(([type, label]) => ({ type, label, count: items.filter(event => event.type === type).length })).filter(item => item.count);
        const summary = counts.map(item => `${item.label} ${item.count}`).join("，");
        const visible = counts.slice(0, 3);
        return `<button type="button" class="cal-day${day.slice(0, 7) !== month ? " cal-outside" : ""}${day === today ? " cal-today" : ""}"
          data-cal-day="${day}" aria-pressed="${day === selected}" ${day === today ? 'aria-current="date"' : ""}
          tabindex="${day === selected ? 0 : -1}" aria-label="${day}${day === today ? ' 今天' : ''}，${items.length ? `${items.length} 项，${summary}` : '无事项'}">
          <span class="cal-day-top"><span>${date.getDate()}${day === today ? '<small>今天</small>' : ''}</span>${items.length ? `<span class="cal-count">${items.length}</span>` : ''}</span>
          <span class="cal-day-tags">${visible.map(item => `<span class="cal-tag cal-${item.type}" title="${item.label} ${item.count}">${({ apply: "投", exam: "笔", interview: "面", deadline: "截", offer: "✅" })[item.type] || item.label}${item.count}</span>`).join("")}${counts.length > 3 ? `<span class="cal-more">另 ${counts.length - 3} 类</span>` : ''}</span>
        </button>`;
      }).join("");
      const daily = events.filter(event => event.day === selected).sort((a, b) => Number(a.hasTime) - Number(b.hasTime) || a.date - b.date);
      const selectedDate = parseDate(selected);
      const renderEvent = event => {
        const index = events.indexOf(event);
        const deadline = event.type === "deadline" ? deadlineText(event) : null;
        const stage = getStage(event.record);
        const historical = ["已拒绝", "主动放弃"].includes(stage) && !["offer", "deadline"].includes(event.type);
        const isOffer = ["offer", "deadline", "join"].includes(event.type) && getStage(event.record) === "已拿Offer";
        return `<article class="cal-event${event.hasTime ? ' cal-event-timed' : ' cal-event-compact'}${deadline?.urgent ? ' cal-urgent' : ''}">
          ${event.hasTime ? `<time class="cal-event-time cal-clock">${pad(event.date.getHours())}:${pad(event.date.getMinutes())}</time>` : ''}
          <div class="cal-event-content"><div class="cal-event-meta"><span class="cal-tag cal-${event.type}">${event.label}</span>${event.hasTime ? '' : `<span class="cal-event-time">${deadline ? deadline.text : '仅日期'}</span>`}</div>
          <h3>${escape(event.record.company || "未填写公司")}</h3>
          <p>${escape(event.record.role || "未填写岗位")}</p>
          ${historical ? `<p class="cal-history">历史安排 · 当前${escape(stage)}</p>` : ''}
          <button type="button" class="cal-open" data-cal-event="${index}" data-cal-offer="${isOffer}">查看${isOffer ? ' Offer' : '岗位'} ${icon("arrow-up-right")}</button></div>
        </article>`;
      };
      const allDay = daily.filter(event => !event.hasTime), timed = daily.filter(event => event.hasTime);
      const cards = `${allDay.length ? `<section class="cal-day-section"><h3 class="cal-section-title">仅日期事项 <span>${allDay.length}</span></h3><div class="cal-all-day-list" tabindex="0" role="region" aria-label="仅日期事项，可上下滚动">${allDay.map(renderEvent).join("")}</div></section>` : ''}
        ${timed.length ? `<section class="cal-day-section"><h3 class="cal-section-title">具体时刻 <span>${timed.length}</span></h3><div class="cal-timed-list">${timed.map(renderEvent).join("")}</div></section>` : ''}`;
      content.innerHTML = `
        <div class="cal-stats">
          ${[["本月事项", monthly.length, "clipboard-list"], ["有安排日期", new Set(monthly.map(event => event.day)).size, "calendar-days"], ["Offer 截止", monthly.filter(event => event.type === "deadline").length, "flag"]].map(([label, count, name]) => `<article class="cal-stat"><span class="cal-stat-icon">${icon(name)}</span><div><span>${label}</span><strong>${count}</strong></div></article>`).join("")}
        </div>
        <div class="cal-toolbar">
          <div class="cal-filters" role="group" aria-label="事件类型">${TYPES.map(([type, label]) => `<button type="button" data-cal-filter="${type}" aria-pressed="${filter === type}">${label}</button>`).join("")}</div>
          <div class="cal-month-nav">
            <button type="button" data-cal-move="-1" aria-label="上个月">${icon("chevron-left")}</button>
            <div class="cal-month-picker"><button type="button" data-cal-month aria-label="选择年月，当前 ${start.getFullYear()}年${start.getMonth() + 1}月" aria-haspopup="dialog" aria-controls="cal-month-popover" aria-expanded="false">${start.getFullYear()} 年 ${start.getMonth() + 1} 月 ${icon("calendar-days")}</button></div>
            <button type="button" data-cal-move="1" aria-label="下个月">${icon("chevron-right")}</button>
            <button type="button" data-cal-today>今天</button>
          </div>
        </div>
        <div class="cal-layout">
          <section class="cal-month-panel" aria-label="${start.getFullYear()}年${start.getMonth() + 1}月台历">
            <div class="cal-week" aria-hidden="true">${WEEK.map(day => `<span>${day}</span>`).join("")}</div>
            <div class="cal-days" role="group" aria-label="选择日期，方向键切换日期">${cells}</div>
            <div class="cal-footer"><div class="cal-legend">${TYPES.slice(1).map(([type, label]) => `<span><i class="cal-dot cal-${type}" aria-hidden="true"></i>${label}</span>`).join("")}</div><p>与“我的投递”、Offerbiu 同步 · 统计随筛选更新</p></div>
          </section>
          <aside class="cal-agenda" aria-label="当日事项">
            <h2>${selectedDate.getMonth() + 1} 月 ${selectedDate.getDate()} 日 <span>${WEEK[(selectedDate.getDay() + 6) % 7]}</span></h2>
            <p class="cal-agenda-count" role="status" aria-live="polite">共 ${daily.length} 项${selected === today ? ' · 今天' : ''}</p>
            <div class="cal-event-list" tabindex="0" role="region" aria-label="当日事项列表，可上下滚动">${daily.length ? cards : `<div class="cal-empty">${icon("calendar-check")}<p>这一天暂无${filter === "all" ? '事项' : TYPES.find(([type]) => type === filter)[1] + '事项'}</p><span>选择其他日期，或切换事件类型</span></div>`}</div>
            <p class="cal-note">${icon("info")}仅日期的事项不代表 00:00。</p>
          </aside>
        </div>`;
      if (focusDay) content.querySelector(`[data-cal-day="${selected}"]`)?.focus({ preventScroll: true });
      refreshIcons();
    }

    root.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button || !content.contains(button)) return;
      if (button.hasAttribute("data-cal-month")) {
        if (pickerYear !== null) closeMonthPicker(true);
        else {
          pickerYear = Number(month.slice(0, 4));
          renderMonthPicker();
          content.querySelector(`[data-cal-pick="${month}"]`).focus({ preventScroll: true });
        }
      } else if (button.dataset.calYear) {
        pickerYear += Number(button.dataset.calYear);
        renderMonthPicker();
        content.querySelector(`[data-cal-year="${button.dataset.calYear}"]`).focus({ preventScroll: true });
      } else if (button.dataset.calPick) chooseMonth(button.dataset.calPick);
      else if (button.hasAttribute("data-cal-this-month")) {
        chooseMonth(dateKey(now()).slice(0, 7));
      } else if (button.dataset.calDay) selectDay(button.dataset.calDay);
      else if (button.dataset.calFilter) {
        filter = button.dataset.calFilter;
        render();
        onStateChange();
        content.querySelector(`[data-cal-filter="${filter}"]`).focus({ preventScroll: true });
      } else if (button.dataset.calMove) {
        moveMonth(Number(button.dataset.calMove));
        content.querySelector(`[data-cal-move="${button.dataset.calMove}"]`).focus({ preventScroll: true });
      } else if (button.hasAttribute("data-cal-today")) {
        selectDay(dateKey(now()));
        content.querySelector("[data-cal-today]").focus({ preventScroll: true });
      } else if (button.dataset.calEvent !== undefined) {
        const item = events[Number(button.dataset.calEvent)];
        if (item) (button.dataset.calOffer === "true" ? onOpenOffer : onOpenRecord)(item.record.id);
      }
    });
    document.addEventListener("pointerdown", event => {
      if (pickerYear !== null && !content.querySelector(".cal-month-picker").contains(event.target)) closeMonthPicker();
    });
    document.addEventListener("keydown", event => {
      if (pickerYear !== null && event.key === "Escape") {
        event.preventDefault();
        closeMonthPicker(true);
      }
    });
    root.addEventListener("focusout", event => {
      if (pickerYear !== null && event.relatedTarget && !content.querySelector(".cal-month-picker").contains(event.relatedTarget)) closeMonthPicker();
    });
    root.addEventListener("keydown", event => {
      if (event.target.matches("[data-cal-pick]")) {
        const months = [...content.querySelectorAll("[data-cal-pick]")];
        const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 }[event.key];
        if (delta !== undefined || ["Home", "End"].includes(event.key)) {
          event.preventDefault();
          const index = event.key === "Home" ? 0 : event.key === "End" ? 11 : (months.indexOf(event.target) + delta + 12) % 12;
          months.forEach((button, i) => button.tabIndex = i === index ? 0 : -1);
          months[index].focus({ preventScroll: true });
        }
        return;
      }
      if (!event.target.matches("[data-cal-day]")) return;
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
      if (delta !== undefined) {
        event.preventDefault();
        const date = parseDate(event.target.dataset.calDay);
        date.setDate(date.getDate() + delta);
        selectDay(dateKey(date));
      } else if (["PageUp", "PageDown"].includes(event.key)) {
        event.preventDefault();
        moveMonth(event.key === "PageUp" ? -1 : 1);
      }
    });
    return { render, getState: () => ({ selected, month, filter }), setState(state) {
      if (!state || !/^\d{4}-\d{2}-\d{2}$/.test(state.selected) || !parseDate(state.selected)) return;
      selected = state.selected; month = selected.slice(0, 7);
      filter = TYPES.some(([value]) => value === state.filter) ? state.filter : "all";
      render();
    } };
  }

  window.TrackerCalendar = { create };
})();
