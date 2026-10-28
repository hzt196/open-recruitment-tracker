(() => {
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  function create({ root, getOffers, getStatus, money, hasValue, number, yearTotal, hasSalary, multiplier, deadline,
    openModal, closeModal, onDetail, onEdit, refreshIcons }) {
    const content = root.querySelector("[data-compare-content]");
    const footer = root.querySelector("[data-compare-footer]");
    let selected = [];
    let choosing = true;
    let offset = 0;
    let capacity = window.innerWidth < 1100 ? 2 : 3;
    let signature = "";
    const active = () => root.classList.contains("active");
    const offers = () => getOffers();
    const savedMoney = value => hasValue(value) ? money(number(value)) : '<span class="compare-missing">未填写</span>';
    const text = value => String(value ?? "").trim() ? escape(value) : '<span class="compare-missing">未填写</span>';
    const amount = (record, key, months) => hasValue(record[key])
      ? `${savedMoney(record[key])}${hasValue(record[months]) ? `<small>${money(number(record[key]))} × ${number(record[months])} 月 · 合计 ${money(number(record[key]) * multiplier(record[months]))}</small>` : ''}`
      : '<span class="compare-missing">未填写</span>';

    function syncSelection() {
      const count = root.querySelector("[data-compare-count]");
      if (count) count.textContent = `已选 ${selected.length} / 3`;
      root.querySelectorAll("[data-compare-choice]").forEach(input => {
        input.checked = selected.includes(input.value);
        input.disabled = selected.length === 3 && !input.checked;
      });
      const start = root.querySelector('[data-compare-action="start"]');
      if (start) start.disabled = selected.length < 2;
    }

    function chooseHTML(items) {
      return `<div class="compare-selection-heading"><div><h3>选择要对比的 Offer</h3><p>选择 2～3 个；不受 Offerbiu 当前筛选影响。</p></div><span data-compare-count class="tiny-badge"></span></div>
        <div class="compare-selection">${items.length ? items.map(record => `<label class="compare-choice"><input type="checkbox" value="${escape(record.id)}" data-compare-choice><span><strong>${text(record.company)}</strong><span>${text(record.role)}</span><small>${text(record.city)} · ${escape(getStatus(record))}</small></span></label>`).join("") : '<div class="empty-state">暂无可对比的 Offer，将岗位阶段设置为“已拿Offer”后再来选择。</div>'}</div>`;
    }

    function contributionDetails(record) {
      const result = window.OfferTakeHome?.calculate(record);
      if (!result) return '<span class="compare-missing">未填写</span>';
      const value = amount => amount === null ? "未填写" : money(amount);
      const ratio = rate => rate === null ? "未填写" : `${rate}%`;
      return `<details class="compare-disclosure"><summary>展开明细</summary><div>
        <p>社保基数 ${value(result.socialBase)} / 月<br>公积金基数 ${value(result.housingBase)} / 月</p>
        ${result.items.concat([{ label: "住房公积金", rate: result.housingRate, amount: result.housing }]).map(item => `<p><strong>${item.label}</strong><br>${ratio(item.rate)} · ${value(item.amount)} / 月</p>`).join("")}
        <p>专项附加扣除 ${value(result.special)} / 月</p>
      </div></details>`;
    }

    function tableHTML(items) {
      const visible = items.slice(offset, offset + capacity);
      const row = (label, cell, className = "") => `<tr class="${className}"><th scope="row">${label}</th>${visible.map(record => `<td>${cell(record)}</td>`).join("")}</tr>`;
      const netResult = record => window.OfferTakeHome?.calculate(record);
      const monthly = (record, key) => {
        const value = netResult(record)?.[key];
        return value == null ? '<span class="compare-missing">未填写</span>' : money(value);
      };
      return `<div class="compare-context"><span data-compare-count class="tiny-badge"></span><span>未填写不按 0 计算；年总包按已填写薪资项目合计。</span></div>

        <table class="offer-compare-table"><caption class="sr-only">Offer 薪资、五险一金、到手金额与日期对比</caption><thead><tr><th scope="col">对比项目</th>${visible.map(record => `<th scope="col"><strong class="compare-company">${text(record.company)}</strong><span class="compare-role">${text(record.role)}</span><span class="compare-status">${escape(getStatus(record))}</span><div class="compare-company-actions"><button type="button" data-compare-action="detail" data-compare-id="${escape(record.id)}">查看详情 ↗</button><button type="button" data-compare-action="remove" data-compare-id="${escape(record.id)}">移出</button></div></th>`).join("")}</tr></thead><tbody>
        ${row("城市", record => text(record.city))}
        ${row("税前月薪", record => savedMoney(record.monthlySalary))}
        ${row("薪资月数", record => hasValue(record.salaryMonths) ? `${number(record.salaryMonths)} 薪` : '<span class="compare-missing">未填写</span>')}
        ${row("预计税前年总包", record => hasSalary(record) ? `<strong>${money(yearTotal(record))}</strong>` : '<span class="compare-missing">未填写</span>', "compare-emphasis")}
        ${row("年终奖", record => amount(record, "yearEndBonus", "yearEndBonusMonths"))}
        ${row("签字费", record => savedMoney(record.signingBonus))}
        ${row("股票 / RSU", record => savedMoney(record.stock))}
        ${row("其他补贴", record => amount(record, "otherSubsidy", "otherSubsidyMonths"))}
        <tr class="compare-section"><th colspan="${visible.length + 1}">个人五险一金与到手估算</th></tr>
        ${row("个人社保 / 月", record => monthly(record, "social"))}
        ${row("个人公积金 / 月", record => monthly(record, "housing"))}
        ${row("平均每月到手", record => {
          const result = netResult(record);
          return `${result?.ready ? `<strong>${money(result.net)}</strong><small>月均个税约 ${money(result.monthlyTax)}</small>` : '<span class="compare-missing">待完善参数</span>'}<button type="button" class="compare-text-button" data-compare-action="edit" data-compare-id="${escape(record.id)}">${result?.ready ? '编辑缴费参数' : '填写缴费参数'}</button>`;
        }, "compare-emphasis compare-net")}
        <tr><td class="compare-scope" colspan="${visible.length + 1}">到手估算仅含全年 12 个月固定普通月薪，不含奖金、签字费、股票及其他补贴；与税前年总包分别比较。</td></tr>
        ${row("缴费比例与基数", contributionDetails)}
        ${row("截止日期", record => {
          const info = deadline(record.deadline);
          const badge = info.state === "urgent" && getStatus(record) === "待决定"
            ? `<span class="compare-deadline">${info.days === 0 ? '今天截止' : `剩 ${info.days} 天`}</span>`
            : info.state === "passed" ? '<small>已截止</small>' : '';
          return `${text(record.deadline)}${badge}`;
        })}
        ${row("预计入职日期", record => text(record.expectedJoinDate))}
        ${row("备注", record => String(record.notes ?? "").trim() ? `<details class="compare-disclosure"><summary>展开查看</summary><div class="compare-notes">${escape(record.notes)}</div></details>` : '<span class="compare-missing">未填写</span>')}
        </tbody></table>`;
    }

    function render() {
      const all = offers();
      signature = JSON.stringify(all);
      selected = selected.filter(id => all.some(record => record.id === id));
      if (selected.length < 2) choosing = true;
      const items = selected.map(id => all.find(record => record.id === id));
      offset = Math.max(0, Math.min(offset, items.length - capacity));
      content.innerHTML = choosing ? chooseHTML(all) : tableHTML(items);
      const paging = !choosing && items.length > capacity;
      footer.innerHTML = `${paging ? `<nav class="compare-pages" aria-label="切换对比组"><span>每次两家：第 ${offset + 1}～${Math.min(offset + capacity, items.length)} 家 / 共 ${items.length} 家</span><button type="button" class="ghost-button" data-compare-action="previous" ${offset === 0 ? 'disabled' : ''}>上一组</button><button type="button" class="ghost-button" data-compare-action="next" ${offset + capacity >= items.length ? 'disabled' : ''}>下一组</button></nav>` : `<span>${choosing ? '只比较已保存信息，不自动打分或排名。' : '查看详情或编辑参数后，关闭即可回到对比。'}</span>`}<div><button type="button" class="ghost-button" data-close="offer-compare-modal" data-compare-action="close">返回 Offerbiu</button>${choosing ? '<button type="button" class="primary-button" data-compare-action="start">开始对比</button>' : '<button type="button" class="primary-button" data-compare-action="choose">调整对比</button>'}</div>`;
      syncSelection(); refreshIcons();
    }

    root.addEventListener("change", event => {
      if (!event.target.matches("[data-compare-choice]")) return;
      const input = event.target;
      if (input.checked && selected.length < 3 && !selected.includes(input.value)) selected.push(input.value);
      else if (!input.checked) selected = selected.filter(id => id !== input.value);
      syncSelection();
    });
    root.addEventListener("click", event => {
      const button = event.target.closest("[data-compare-action]");
      if (!button || button.disabled) return;
      const action = button.dataset.compareAction, id = button.dataset.compareId;
      if (action === "close") { closeModal(root.id); return; }
      if (action === "detail") { onDetail(id); return; }
      if (action === "edit") { onEdit(id); return; }
      if (action === "start") { if (selected.length < 2) return; choosing = false; offset = 0; }
      if (action === "choose") choosing = true;
      if (action === "remove") selected = selected.filter(value => value !== id);
      if (action === "previous") offset--;
      if (action === "next") offset++;
      render();
      content.querySelector(choosing ? "input:not(:disabled)" : "button:not(:disabled)")?.focus({ preventScroll: true });
    });
    window.addEventListener("resize", () => {
      const next = window.innerWidth < 1100 ? 2 : 3;
      if (next === capacity) return;
      capacity = next; offset = 0;
      if (active()) render();
    });
    return {
      open() { render(); openModal(root.id); },
      refresh() { if (active() && signature !== JSON.stringify(offers())) render(); }
    };
  }
  window.OfferComparison = { create };
})();
