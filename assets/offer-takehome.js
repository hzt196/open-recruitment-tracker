(() => {
  const INSURANCE = [
    ["pensionRate", "养老保险"], ["medicalRate", "医疗保险"],
    ["unemploymentRate", "失业保险"], ["injuryRate", "工伤保险"], ["maternityRate", "生育保险"]
  ];
  const KEYS = ["socialBase", ...INSURANCE.map(([key]) => key), "housingBase", "housingRate", "specialDeduction"];
  const SOURCE = "https://fgk.chinatax.gov.cn/zcfgk/c100012/c5194838/content.html";
  // 居民个人工资薪金预扣率表一；普通工资按全年 12 个月模拟。
  const BRACKETS = [[36000, .03, 0], [144000, .1, 2520], [300000, .2, 16920],
    [420000, .25, 31920], [660000, .3, 52920], [960000, .35, 85920], [Infinity, .45, 181920]];
  const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
  const number = value => value === null || value === undefined || String(value).trim() === "" || typeof value === "boolean"
    ? null : Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const money = value => value === null ? "—" : `¥ ${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  const rate = value => number(value) !== null && number(value) <= 100 ? number(value) : null;
  const id = key => `offer-payroll-${key}`;

  function annualTax(taxable) {
    const [, taxRate, deduction] = BRACKETS.find(([limit]) => taxable <= limit);
    return round(Math.max(0, taxable * taxRate - deduction));
  }

  function calculate(record) {
    const params = record.salaryDeductions || {};
    const socialBase = number(params.socialBase), housingBase = number(params.housingBase);
    const items = INSURANCE.map(([key, label]) => {
      const percentage = rate(params[key]);
      return { key, label, rate: percentage, amount: socialBase === null || percentage === null ? null : round(socialBase * percentage / 100) };
    });
    const housingRate = rate(params.housingRate);
    const housing = housingBase === null || housingRate === null ? null : round(housingBase * housingRate / 100);
    const social = items.some(item => item.amount === null) ? null : round(items.reduce((sum, item) => sum + item.amount, 0));
    const contribution = social === null || housing === null ? null : round(social + housing);
    const salary = number(record.monthlySalary);
    const special = params.specialDeduction == null || String(params.specialDeduction).trim() === "" ? 0 : number(params.specialDeduction);
    const result = { items, socialBase, housingBase, housingRate, social, housing, contribution, salary, special, ready: false, message: "填写月薪、缴费基数和各项个人比例后计算" };
    if (salary === null || contribution === null || special === null) return result;
    if (contribution > salary) return { ...result, message: "个人缴费合计超过税前月薪，请核对基数与比例" };
    const taxable = round(Math.max(0, (salary - contribution - special - 5000) * 12));
    const tax = annualTax(taxable);
    return { ...result, ready: true, annualTax: tax, monthlyTax: round(tax / 12), net: round(salary - contribution - tax / 12) };
  }

  function summary(result) {
    return `<div class="payroll-summary">
      <div class="payroll-totals">${[["个人社保 / 月", result.social], ["个人公积金 / 月", result.housing], ["个人缴纳合计 / 月", result.contribution]].map(([label, value]) => `<div><span>${label}</span><strong>${money(value)}</strong></div>`).join("")}</div>
      <div class="payroll-net"><div><span>全年平均每月到手</span><strong>${result.ready ? money(result.net) : "待填写"}</strong></div><p>${result.ready ? `月均个税约 ${money(result.monthlyTax)}<br>不含奖金、签字费、股票及其他补贴` : result.message}</p></div>
    </div>`;
  }

  function detail(record) {
    const result = calculate(record);
    const ratio = value => value === null ? "—" : `${value}%`;
    return `<section class="payroll-detail" aria-label="五险一金与到手估算">
      <div class="payroll-heading"><h3><i data-lucide="shield-check" size="16" aria-hidden="true"></i>五险一金与到手估算</h3><button type="button" class="ghost-button" data-payroll-edit>编辑缴费参数</button></div>
      ${summary(result)}
      <p class="payroll-note">中国大陆居民个人 · 全年 12 个月固定月薪估算，实际每月扣税可能不同。</p>
      <details class="payroll-breakdown"><summary>个人缴费明细</summary>
        <p class="payroll-note">社保基数 ${money(result.socialBase)} / 月 · 公积金基数 ${money(result.housingBase)} / 月</p>
        <table><thead><tr><th>缴费项目</th><th>个人比例</th><th>个人月缴</th></tr></thead><tbody>
          ${result.items.concat([{ label: "住房公积金", rate: result.housingRate, amount: result.housing }]).map(item => `<tr><td>${item.label}</td><td>${ratio(item.rate)}</td><td>${money(item.amount)}</td></tr>`).join("")}
        </tbody></table>
        <p class="payroll-note">专项附加扣除 ${money(result.special)} / 月，用于减少计税收入，不是额外扣款。工伤、生育默认 0%，可在编辑时修改。</p>
        <p class="payroll-note">按所填个人缴费均符合税前扣除规定估算，未校验当地缴费基数上下限；不适用于非居民、入职首年或年内换工作等情形。<a href="${SOURCE}" target="_blank" rel="noopener noreferrer">计算依据 ↗</a></p>
      </details>
    </section>`;
  }

  function field(key, label, unit, extra = "") {
    return `<label class="form-field"><span>${label}</span><span class="payroll-input"><input type="number" id="${id(key)}" name="payroll-${key}" data-payroll-key="${key}" min="0" ${unit === "%" ? 'max="100"' : ''} step="any" placeholder="${unit === "%" ? '请输入比例' : '请输入金额'}" ${extra}><span aria-hidden="true">${unit}</span></span></label>`;
  }

  function read(form) {
    const params = Object.fromEntries(KEYS.map(key => [key, form.querySelector(`#${id(key)}`).value.trim()]));
    const custom = KEYS.filter(key => !["injuryRate", "maternityRate"].includes(key)).some(key => params[key] !== "")
      || ["injuryRate", "maternityRate"].some(key => params[key] !== "" && params[key] !== "0");
    return custom ? params : null;
  }

  function update(form) {
    const params = Object.fromEntries(KEYS.map(key => [key, form.querySelector(`#${id(key)}`).value]));
    const result = calculate({ monthlySalary: form.querySelector("#offer-field-monthly").value, salaryDeductions: params });
    form.querySelector("#offer-payroll-preview").innerHTML = summary(result);
    result.items.forEach(item => { form.querySelector(`[data-payroll-amount="${item.key}"]`).textContent = `个人月缴：${money(item.amount)}`; });
  }

  function mount(form) {
    const root = form.querySelector("#offer-payroll-editor");
    if (root.dataset.mounted) return;
    root.dataset.mounted = "true";
    root.innerHTML = `<div class="form-section-title payroll-heading"><span>五险一金与到手估算</span><span class="payroll-mode">按个人比例填写</span></div>
      <p class="payroll-note">可选填写；只计个人承担部分，不计公司缴费。基数与比例填齐后显示到手估算。</p>
      ${field("socialBase", "社保缴费基数 / 月", "元")}
      <div class="payroll-insurance-grid">${INSURANCE.map(([key, label]) => `<div class="payroll-insurance-card">${field(key, label, "%")}${["injuryRate", "maternityRate"].includes(key) ? '<small>默认 0%，可修改</small>' : ''}<small data-payroll-amount="${key}">个人月缴：—</small></div>`).join("")}</div>
      <div class="payroll-housing-heading"><span>个人公积金</span><button type="button" class="ghost-button" data-payroll-copy>同社保基数</button></div>
      <div class="form-grid">${field("housingBase", "公积金缴费基数 / 月", "元")}${field("housingRate", "个人公积金比例", "%")}</div>
      ${field("specialDeduction", "专项附加扣除 / 月（选填）", "元", 'aria-describedby="payroll-special-help"')}
      <p id="payroll-special-help" class="payroll-note">如租房等符合规定的扣除合计；用于减少计税收入，并非额外扣款，留空按 0 计算。</p>
      <div id="offer-payroll-preview" role="status" aria-live="polite" aria-atomic="true"></div>
      <p class="payroll-note">按全年 12 个月固定普通月薪估算，不含奖金等收入；预览随输入更新，点击“保存 Offer”后生效。</p>`;
    form.addEventListener("input", event => {
      if (!event.target.matches("[data-payroll-key], #offer-field-monthly")) return;
      event.target.setCustomValidity(""); update(form);
    });
    root.querySelector("[data-payroll-copy]").addEventListener("click", () => {
      const input = form.querySelector(`#${id("housingBase")}`);
      input.value = form.querySelector(`#${id("socialBase")}`).value;
      input.dispatchEvent(new Event("input", { bubbles: true })); input.focus();
    });
  }

  function fill(form, record) {
    mount(form);
    const params = record.salaryDeductions || {};
    KEYS.forEach(key => {
      const input = form.querySelector(`#${id(key)}`);
      input.value = Object.hasOwn(params, key) ? params[key] ?? "" : ["injuryRate", "maternityRate"].includes(key) ? "0" : "";
      input.setCustomValidity("");
    });
    update(form);
  }

  function validate(form) {
    const inputs = [...form.querySelectorAll("[data-payroll-key]")];
    let valid = true;
    inputs.forEach(input => {
      input.setCustomValidity("");
      if (input.validity.badInput || (input.value !== "" && (number(input.value) === null || (input.max && Number(input.value) > Number(input.max))))) {
        input.setCustomValidity(input.max ? "请输入 0 到 100 之间的个人缴费比例" : "请输入不小于 0 的有限金额"); valid = false;
      }
    });
    if (!valid) form.reportValidity();
    return valid;
  }

  window.OfferTakeHome = { calculate, annualTax, detail, fill, read, validate };
})();
