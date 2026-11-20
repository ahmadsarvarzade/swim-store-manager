/*
 * Swim Store Manager v10 enhancements
 * - Persian/Arabic digit-safe price inputs and 100,000 toman steppers
 * - Reliable awaited manual cash transaction save
 * - Structured product attributes and optional foreign-currency pricing
 * - NerkhAra free-market rates, cached locally, refreshed at most once/day
 * - Inventory sale valuation
 *
 * Loaded after app.js and firebase-integration.js as a classic script.
 */
(() => {
  'use strict';

  const BRANDS = ['اسپیدو','ارنا','تی وای آر','فینیس','جکد','اسپورتی','۳۶۱','نامشخص'];
  const COLORS = ['آبی','قرمز','مشکی','زرد','سبز روشن','صورتی','سفید','بنفش','سبز تیره','آبی تیره','آبی فیروزه ای','چند رنگ','غیره'];
  const PRODUCT_TYPES = [
    'عینک شنا مسابقه ای','عینک شنا تمرینی','مایو','جمر','کفی','کش مقاومتی',
    'پاراشوت','اسنورکل','فین','تخته','عینک هوشمند','تمپو','کلاه تمرینی',
    'کلاه مسابقه ای','کش لوپ','کش پیلاتس','تیشرت','حوله','دماغ گیر',
    'رو مایویی','درگ','شرت','دمپایی','غیره'
  ];
  const GENDERS = ['مردانه','زنانه','بچه گانه-پسرانه','بچه گانه-دخترانه','یونیسکس'];
  const CURRENCIES = [
    ['USD','دلار آمریکا','usd'],['EUR','یورو','eur'],['GBP','پوند انگلیس','gbp'],
    ['AED','درهم امارات','aed'],['CNY','یوان چین','cny'],['AFN','افغانی','afn'],
    ['AZN','منات آذربایجان','azn'],['TRY','لیر ترکیه','try'],['CAD','دلار کانادا','cad'],
    ['AUD','دلار استرالیا','aud'],['SAR','ریال عربستان','sar'],['QAR','ریال قطر','qar'],
    ['KWD','دینار کویت','kwd'],['JPY','ین ژاپن','jpy'],['CHF','فرانک سوئیس','chf']
  ];
  const API_ID = Object.fromEntries(CURRENCIES.map(([code,,id]) => [code,id]));
  const TICK = 100000;
  const DAY = 24 * 60 * 60 * 1000;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function normalizeDigits(value) {
    return String(value ?? '')
      .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
      .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/[٬،\s]/g, '')
      .replace(/٫/g, '.');
  }

  function parseAmount(value) {
    const normalized = normalizeDigits(value).replace(/,/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function grouped(value) {
    const normalized = normalizeDigits(value);
    if (!normalized || normalized === '.') return normalized;
    const n = Number(normalized);
    if (!Number.isFinite(n)) return normalized;
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(n);
  }

  function currencyLabel(code) {
    return CURRENCIES.find(item => item[0] === code)?.[1] || code || 'ارز';
  }

  function localMultiplier() {
    return typeof currency === 'function' && currency() === 'ریال' ? 10 : 1;
  }

  function fxRate(code) {
    const item = state.settings?.fxRates?.[code];
    return Number(item?.rateToman || 0);
  }

  function fxOptionMarkup(selected) {
    return CURRENCIES.map(([code,label]) =>
      `<option value="${code}" ${selected === code ? 'selected' : ''}>${code} · ${label}</option>`
    ).join('');
  }

  function createSelectFromInput(input, options, emptyLabel = '') {
    if (!input) return null;
    const current = input.value || '';
    const select = document.createElement('select');
    select.name = input.name;
    select.id = input.id;
    select.required = input.required;
    if (emptyLabel) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = emptyLabel;
      select.appendChild(empty);
    }
    const values = [...options];
    if (current && !values.includes(current)) values.push(current);
    values.forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    select.value = current;
    input.replaceWith(select);
    return select;
  }

  function decorateMoneyInput(input, step = TICK) {
    if (!input || input.dataset.ssMoneyReady === '1') return;
    input.dataset.ssMoneyReady = '1';
    const wasFocused = document.activeElement === input;
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.removeAttribute('min');
    input.removeAttribute('max');
    input.removeAttribute('step');
    input.value = normalizeDigits(input.value);

    input.addEventListener('focus', () => {
      input.value = normalizeDigits(input.value);
    });
    input.addEventListener('input', () => {
      const cleaned = normalizeDigits(input.value);
      if (cleaned !== input.value) {
        const start = input.selectionStart;
        input.value = cleaned;
        try { input.setSelectionRange(start, start); } catch (_) {}
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    input.addEventListener('blur', () => {
      if (input.value.trim()) input.value = grouped(input.value);
    });

    const controls = document.createElement('div');
    controls.className = 'ss-money-stepper';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = `−${new Intl.NumberFormat('fa-IR').format(step)}`;
    minus.setAttribute('aria-label', `کاهش ${step}`);
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = `+${new Intl.NumberFormat('fa-IR').format(step)}`;
    plus.setAttribute('aria-label', `افزایش ${step}`);
    const adjust = delta => {
      input.value = grouped(Math.max(0, parseAmount(input.value) + delta));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    minus.addEventListener('click', () => adjust(-step));
    plus.addEventListener('click', () => adjust(step));
    controls.append(minus, plus);
    input.insertAdjacentElement('afterend', controls);
    if (input.value.trim()) input.value = grouped(input.value);
    if (wasFocused) input.focus();
  }

  function decorateMoneyFields(root = document) {
    const selectors = [
      'input[name="amount"]','input[name="cost"]','input[name="price"]',
      'input[name="unitCost"]','input[name="paid"]','input[name="discount"]',
      'input[name="shipping"]','input.line-price'
    ].join(',');
    $$(selectors, root).forEach(input => decorateMoneyInput(input, TICK));
  }

  const style = document.createElement('style');
  style.textContent = `
    .inventory-stats{grid-template-columns:repeat(5,minmax(0,1fr))}
    .ss-money-stepper{display:flex;gap:6px;margin-top:5px}
    .ss-money-stepper button{border:1px solid #dce5ec;background:#f8fafc;color:#40556c;border-radius:7px;padding:5px 9px;font:10px Tahoma,sans-serif;cursor:pointer}
    .ss-money-stepper button:active{background:#eaf6f3}
    .ss-price-panel{grid-column:1/-1;border:1px solid #e0e8ef;background:#f8fbfd;border-radius:10px;padding:12px;display:grid;gap:10px}
    .ss-price-panel .ss-price-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .ss-price-panel label{font-size:10px;color:#607187;font-weight:600}
    .ss-price-panel input,.ss-price-panel select{width:100%;box-sizing:border-box;border:1px solid #dfe7ee;border-radius:8px;padding:9px 10px;font:11px Tahoma,sans-serif;background:#fff;color:#33465a}
    .ss-rate-note{font-size:10px;line-height:1.9;color:#63758a}
    .ss-rate-warning{color:#b34c56}
    .ss-fx-card{margin-top:16px;padding:18px}
    .ss-fx-card h3{margin:0 0 7px;font-size:13px}
    .ss-fx-card p{font-size:10px;line-height:1.9;color:#7b8b9c}
    .ss-fx-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:end}
    .ss-fx-form label{display:block;font-size:10px;color:#63748a;margin-bottom:6px}
    .ss-fx-form input,.ss-fx-form select{width:100%;box-sizing:border-box;border:1px solid #dfe7ee;border-radius:8px;padding:10px 11px;font:11px Tahoma,sans-serif;background:#fff;color:#33465a}
    .ss-login-confirm{display:flex;align-items:flex-start;gap:9px;margin:12px 0 5px;color:#52657b;font:11px/1.9 Tahoma,sans-serif;cursor:pointer}
    .ss-login-confirm input{flex:0 0 auto;width:16px;height:16px;margin:3px 0 0;accent-color:#24b8a5}
    @media(max-width:1100px){.inventory-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.ss-fx-form{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:760px){.inventory-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.ss-price-panel .ss-price-grid,.ss-fx-form{grid-template-columns:1fr}.ss-money-stepper button{min-height:34px;flex:1}}
  `;
  document.head.appendChild(style);

  // Require a deliberate user confirmation even if Safari autofills credentials.
  const loginForm = $('#ssOwnerLogin');
  if (loginForm && !loginForm.querySelector('[name="confirmLogin"]')) {
    loginForm.setAttribute('autocomplete', 'off');
    const submitButton = $('button[type="submit"]', loginForm);
    if (submitButton) {
      const label = document.createElement('label');
      label.className = 'ss-login-confirm';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'confirmLogin';
      checkbox.required = true;
      const text = document.createElement('span');
      text.textContent = 'تأیید می‌کنم که خودم قصد ورود به فروشگاه را روی این دستگاه دارم.';
      label.append(checkbox, text);
      loginForm.insertBefore(label, submitButton);
    }
  }

  // Convert the app's monetary controls after every modal is created.
  if (typeof modal === 'function') {
    const originalModal = modal;
    modal = function (...args) {
      const result = originalModal.apply(this, args);
      decorateMoneyFields($('#modalForm') || document);
      return result;
    };
  }

  // Observe dynamically added order-line price inputs too.
  const modalRoot = $('#modalRoot');
  if (modalRoot && typeof MutationObserver !== 'undefined') {
    const modalObserver = new MutationObserver(() => decorateMoneyFields(modalRoot));
    modalObserver.observe(modalRoot, { childList: true, subtree: true });
  }

  // More reliable manual cash transaction: normalize amount, await IndexedDB commit,
  // then redraw. A failed save leaves the form open and reports the error.
  openCashForm = function openCashFormReliable() {
    const body = `<div class="form-grid">
      <div class="field"><label>نوع تراکنش</label><select name="type"><option value="in">دریافت</option><option value="out">پرداخت</option></select></div>
      <div class="field"><label>مبلغ *</label><input name="amount" type="text" inputmode="decimal" required placeholder="مثلاً 1,500,000"></div>
      <div class="field"><label>شرح تراکنش *</label><input name="description" type="text" required maxlength="120"></div>
      <div class="field"><label>دسته‌بندی</label><input name="category" type="text" value="سایر"></div>
      <div class="field"><label>تاریخ</label><input name="date" type="date" value="${todayISO()}" required></div>
      <div class="field-note full">مبلغ را می‌توانی با اعداد فارسی یا انگلیسی وارد کنی. دریافت به صندوق اضافه و پرداخت از صندوق کم می‌شود.</div>
    </div>`;
    modal('ثبت دستی دریافت / پرداخت', body, 'ثبت تراکنش', async data => {
      const amount = parseAmount(data.get('amount'));
      const description = String(data.get('description') || '').trim();
      const type = data.get('type') === 'out' ? 'out' : 'in';
      const date = String(data.get('date') || todayISO());
      const category = String(data.get('category') || 'سایر').trim() || 'سایر';
      if (!(amount > 0)) throw new Error('مبلغ باید بیشتر از صفر باشد.');
      if (!description) throw new Error('شرح تراکنش الزامی است.');
      const entry = {
        id: uid(), date, type, category, description, amount,
        ref: 'manual', createdAt: new Date().toISOString()
      };
      state.cash.push(entry);
      try {
        await persist();
        updateSidebarMeta();
        render();
        toast('تراکنش مالی با موفقیت ذخیره شد.');
        return true;
      } catch (error) {
        const index = state.cash.findIndex(item => item.id === entry.id);
        if (index >= 0) state.cash.splice(index, 1);
        throw new Error(`ذخیره تراکنش ناموفق بود: ${error?.message || 'خطای پایگاه داده محلی'}`);
      }
    });
  };

  // Store extra product metadata when the original product form commits.
  let pendingProductMeta = null;
  const originalSaveAndRender = saveAndRender;
  saveAndRender = function saveAndRenderWithProductMetadata(message) {
    if (pendingProductMeta && /کالا/.test(String(message || ''))) {
      let target = pendingProductMeta.editingId
        ? state.products.find(item => item.id === pendingProductMeta.editingId)
        : state.products.find(item => !pendingProductMeta.beforeIds.has(item.id));
      if (target) Object.assign(target, pendingProductMeta.fields);
      pendingProductMeta = null;
    }
    return originalSaveAndRender.apply(this, arguments);
  };

  const originalOpenProductForm = openProductForm;
  openProductForm = function openProductFormWithStructuredFields(product = null) {
    originalOpenProductForm(product);
    const form = $('#modalForm');
    const grid = $('.modal-content .form-grid', form || document);
    if (!form || !grid) return;

    const brandSelect = createSelectFromInput($('[name="brand"]', form), BRANDS, 'انتخاب برند');
    const categorySelect = createSelectFromInput($('[name="category"]', form), PRODUCT_TYPES, 'انتخاب نوع محصول');
    const colorSelect = createSelectFromInput($('[name="color"]', form), COLORS, 'انتخاب رنگ');
    if (!product && categorySelect && categorySelect.value === 'تجهیزات شنا') categorySelect.value = 'غیره';
    if (!product && brandSelect && !brandSelect.value) brandSelect.value = 'نامشخص';

    const genderField = document.createElement('div');
    genderField.className = 'field';
    genderField.innerHTML = '<label>جنسیت</label><select name="ssGender"><option value="">انتخاب جنسیت</option></select>';
    const genderSelect = $('[name="ssGender"]', genderField);
    GENDERS.forEach(value => { const option=document.createElement('option'); option.value=value; option.textContent=value; genderSelect.appendChild(option); });
    genderSelect.value = product?.gender || '';
    const sizeInput = $('[name="size"]', form);
    const sizeField = sizeInput?.closest('.field');
    const unitField = $('[name="unit"]', form)?.closest('.field');
    if (genderField && sizeField) grid.insertBefore(genderField, sizeField);
    else if (genderField && unitField) grid.insertBefore(genderField, unitField);

    function updateSizeVisibility() {
      const allowed = ['مایو','جمر'].includes(categorySelect?.value);
      if (sizeField) sizeField.style.display = allowed ? '' : 'none';
      if (!allowed && sizeInput) sizeInput.value = '';
    }
    categorySelect?.addEventListener('change', updateSizeVisibility);
    updateSizeVisibility();

    const costInput = $('[name="cost"]', form);
    const priceInput = $('[name="price"]', form);
    const costField = costInput?.closest('.field');
    const priceField = priceInput?.closest('.field');
    if (!costInput || !priceInput || !costField || !priceField) return;

    const defaultCurrency = product?.priceCurrency || state.settings?.fxCurrency || 'USD';
    const savedRate = fxRate(defaultCurrency);
    const savedMode = product?.priceMode === 'foreign' ? 'foreign' : 'local';
    const initialCostForeign = product?.costForeign ?? (savedMode === 'foreign' && savedRate ? Number(product.cost || 0) / (savedRate * localMultiplier()) : '');
    const initialPriceForeign = product?.priceForeign ?? (savedMode === 'foreign' && savedRate ? Number(product.price || 0) / (savedRate * localMultiplier()) : '');

    const pricePanel = document.createElement('div');
    pricePanel.className = 'ss-price-panel';
    pricePanel.innerHTML = `
      <div class="ss-price-grid">
        <div><label for="ssPriceMode">روش قیمت‌گذاری</label><select id="ssPriceMode" name="ssPriceMode"><option value="local">ورود دستی به تومان</option><option value="foreign">قیمت‌گذاری ارزی و تبدیل به تومان</option></select></div>
        <div id="ssCurrencyWrap"><label for="ssCurrency">ارز قیمت‌گذاری</label><select id="ssCurrency" name="ssCurrency">${fxOptionMarkup(defaultCurrency)}</select></div>
      </div>
      <div class="ss-price-grid" id="ssForeignPrices">
        <div><label for="ssCostForeign">قیمت خرید (ارزی)</label><input id="ssCostForeign" name="ssCostForeign" type="text" inputmode="decimal" placeholder="مثلاً 12.50"></div>
        <div><label for="ssPriceForeign">قیمت فروش (ارزی)</label><input id="ssPriceForeign" name="ssPriceForeign" type="text" inputmode="decimal" placeholder="مثلاً 18.00"></div>
      </div>
      <div class="ss-rate-note" id="ssRatePreview"></div>
    `;
    grid.insertBefore(pricePanel, costField);
    const modeSelect = $('#ssPriceMode', pricePanel);
    const currencySelect = $('#ssCurrency', pricePanel);
    const foreignWrap = $('#ssForeignPrices', pricePanel);
    const currencyWrap = $('#ssCurrencyWrap', pricePanel);
    const foreignCostInput = $('#ssCostForeign', pricePanel);
    const foreignPriceInput = $('#ssPriceForeign', pricePanel);
    modeSelect.value = savedMode;
    foreignCostInput.value = initialCostForeign === '' ? '' : String(initialCostForeign);
    foreignPriceInput.value = initialPriceForeign === '' ? '' : String(initialPriceForeign);
    decorateMoneyInput(foreignCostInput, 1);
    decorateMoneyInput(foreignPriceInput, 1);

    const costLabel = $('label', costField);
    const priceLabel = $('label', priceField);
    function updatePriceMode() {
      const foreign = modeSelect.value === 'foreign';
      foreignWrap.style.display = foreign ? 'grid' : 'none';
      currencyWrap.style.display = foreign ? '' : 'none';
      if (costLabel) costLabel.textContent = foreign ? 'قیمت خرید معادل (تومان)' : 'قیمت خرید واحد (تومان)';
      if (priceLabel) priceLabel.textContent = foreign ? 'قیمت فروش معادل (تومان)' : 'قیمت فروش واحد (تومان)';
      costInput.readOnly = foreign;
      priceInput.readOnly = foreign;
      [costField, priceField].forEach(field => {
        const stepper = $('.ss-money-stepper', field);
        if (stepper) stepper.style.display = foreign ? 'none' : '';
      });
      const code = currencySelect.value;
      const rate = fxRate(code);
      const amountCost = parseAmount(foreignCostInput.value);
      const amountPrice = parseAmount(foreignPriceInput.value);
      if (foreign && rate > 0) {
        costInput.value = String(Math.round(amountCost * rate * localMultiplier()));
        priceInput.value = String(Math.round(amountPrice * rate * localMultiplier()));
      }
      const preview = $('#ssRatePreview', pricePanel);
      if (preview) {
        if (rate > 0) {
          const updated = state.settings?.fxRates?.[code]?.updatedAt;
          const source = state.settings?.fxRates?.[code]?.source || 'دستی';
          preview.innerHTML = `هر ۱ ${code} = ${new Intl.NumberFormat('fa-IR').format(rate)} تومان · منبع: ${source === 'NerkhAra' ? '<a href="https://nerkhara.com" target="_blank" rel="noopener">NerkhAra</a>' : 'دستی'}${updated ? ` · زمان نرخ: ${new Date(updated).toLocaleString('fa-IR')}` : ''}`;
          preview.classList.remove('ss-rate-warning');
        } else {
          preview.textContent = `برای ${code} هنوز نرخ تبدیل ثبت نشده است. ابتدا در «تنظیمات و پشتیبان» نرخ دستی وارد کن یا به‌روزرسانی خودکار را فعال کن.`;
          preview.classList.add('ss-rate-warning');
        }
      }
    }
    modeSelect.addEventListener('change', updatePriceMode);
    currencySelect.addEventListener('change', updatePriceMode);
    currencySelect.addEventListener('change', async () => {
      if (state.settings?.fxUpdateMode === 'auto' && !fxRate(currencySelect.value)) {
        try { await refreshFxRate(currencySelect.value, false); } catch (error) { console.warn(error); }
        updatePriceMode();
      }
    });
    foreignCostInput.addEventListener('input', updatePriceMode);
    foreignPriceInput.addEventListener('input', updatePriceMode);
    updatePriceMode();

    const beforeIds = new Set(state.products.map(item => item.id));
    form.addEventListener('submit', event => {
      const selectedMode = modeSelect.value;
      const code = currencySelect.value;
      const rate = fxRate(code);
      const gender = genderSelect.value;
      if (selectedMode === 'foreign') {
        if (!(rate > 0)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          toast(`نرخ تبدیل ${code} ثبت نشده است؛ ابتدا نرخ را در تنظیمات وارد یا دریافت کن.`, 'error');
          return;
        }
        const costForeign = parseAmount(foreignCostInput.value);
        const priceForeign = parseAmount(foreignPriceInput.value);
        if (costForeign < 0 || priceForeign < 0) {
          event.preventDefault(); event.stopImmediatePropagation();
          toast('قیمت ارزی معتبر نیست.', 'error'); return;
        }
        costInput.value = String(Math.round(costForeign * rate * localMultiplier()));
        priceInput.value = String(Math.round(priceForeign * rate * localMultiplier()));
        pendingProductMeta = {
          editingId: product?.id || null,
          beforeIds,
          fields: {
            gender, priceMode: 'foreign', priceCurrency: code,
            costForeign, priceForeign, fxRateToman: rate,
            fxUpdatedAt: state.settings?.fxRates?.[code]?.updatedAt || null
          }
        };
      } else {
        pendingProductMeta = {
          editingId: product?.id || null,
          beforeIds,
          fields: { gender, priceMode: 'local', priceCurrency: '', costForeign: null, priceForeign: null, fxRateToman: null, fxUpdatedAt: null }
        };
      }
    }, true);
  };

  document.addEventListener('click', event => {
    if (event.target.closest('[data-close-modal]') || event.target.matches('[data-modal-backdrop]')) {
      pendingProductMeta = null;
    }
  }, true);

  // Inventory view: show purchase value and sale value side by side.
  if (typeof productsView === 'function') {
    productsView = function productsViewWithValuation() {
      const filtered = state.products.filter(product =>
        [product.name,product.sku,product.barcode,product.category,product.brand,
          product.model,product.color,product.size,product.supplier,product.location]
          .some(value => String(value || '').toLowerCase().includes(searchTerm.toLowerCase()))
      );
      const purchaseValue = sum(state.products, product => product.stock * product.cost);
      const saleValue = sum(state.products, product => product.stock * product.price);
      const units = sum(state.products, product => product.stock);
      const low = state.products.filter(product => product.stock <= product.minStock).length;
      const rows = filtered.map(product => {
        const image = product.imageData
          ? `<img src="${escapeHTML(product.imageData)}" alt="${escapeHTML(product.name)}" style="width:56px;height:56px;object-fit:contain;border-radius:8px;background:#fff;border:1px solid #e7edf3">`
          : '<div style="width:56px;height:56px;border-radius:8px;background:#f3f6fa;display:grid;place-items:center;color:#9aa6b2;font-size:10px">بدون عکس</div>';
        const foreignCost = product.priceMode === 'foreign' ? `<span class="secondary-cell">${number(product.costForeign)} ${escapeHTML(product.priceCurrency || '')}</span>` : '';
        const foreignPrice = product.priceMode === 'foreign' ? `<span class="secondary-cell">${number(product.priceForeign)} ${escapeHTML(product.priceCurrency || '')}</span>` : '';
        return `<tr><td>${image}</td><td><span class="primary-cell">${escapeHTML(product.name)}</span><span class="secondary-cell">${escapeHTML(product.unit || 'عدد')}</span></td><td>${escapeHTML(product.sku || '—')}<span class="secondary-cell">${escapeHTML(product.barcode || '—')}</span></td><td>${escapeHTML(product.brand || '—')}<span class="secondary-cell">${escapeHTML(product.model || '—')}</span></td><td>${escapeHTML(product.category || 'عمومی')}<span class="secondary-cell">${escapeHTML(product.gender || '')}</span></td><td>${escapeHTML([product.color,product.size].filter(Boolean).join(' / ') || '—')}</td><td>${money(product.cost)}${foreignCost}</td><td>${money(product.price)}${foreignPrice}</td><td class="primary-cell">${number(product.stock)}</td><td>${product.stock===0?'<span class="badge badge-red">ناموجود</span>':product.stock<=product.minStock?'<span class="badge badge-orange">کم‌موجود</span>':'<span class="badge badge-green">موجود</span>'}</td><td><div class="action-cell"><button class="text-action" data-action="stock-product" data-id="${product.id}">موجودی</button><button class="text-action" data-action="edit-product" data-id="${product.id}">ویرایش</button></div></td></tr>`;
      }).join('');
      return `${pageHead('کالاها و انبار','مدیریت مشخصات تخصصی کالا، قیمت‌ها، موجودی و گردش انبار', '<button class="btn btn-primary" data-action="new-product">＋ افزودن کالا</button>')}
        <div class="stats-grid inventory-stats">
          ${statCard('تعداد اقلام',number(state.products.length),'کالاهای تعریف‌شده','▤','icon-blue')}
          ${statCard('تعداد واحد موجود',number(units),'جمع موجودی فیزیکی','◫','icon-teal')}
          ${statCard('ارزش خرید موجودی',money(purchaseValue),'موجودی فعلی × قیمت خرید','◈','icon-orange')}
          ${statCard('ارزش فروش موجودی',money(saleValue),'موجودی فعلی × قیمت فروش','↗','icon-teal')}
          ${statCard('کالاهای کم‌موجود',number(low),'برابر یا کمتر از حد هشدار','⚑','icon-red')}
        </div>
        <div class="table-toolbar"><div class="search-box"><input id="tableSearch" value="${escapeHTML(searchTerm)}" placeholder="جست‌وجوی نام، SKU، بارکد، برند، مدل، رنگ یا سایز..."></div><span class="muted">${number(filtered.length)} کالا</span></div>
        <div class="table-card"><div class="table-wrap">${rows ? `<table><thead><tr><th>تصویر</th><th>نام کالا</th><th>SKU / بارکد</th><th>برند / مدل</th><th>نوع / جنسیت</th><th>رنگ / سایز</th><th>قیمت خرید</th><th>قیمت فروش</th><th>موجودی</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>${rows}</tbody></table>` : emptyState('هنوز کالایی ثبت نشده','برای شروع، کالاهای فروشگاه را با مشخصات، قیمت و موجودی اولیه ثبت کن.')}</div><div class="table-summary"><span>ارزش خرید موجودی: <strong>${money(purchaseValue)}</strong></span><span>ارزش فروش موجودی: <strong>${money(saleValue)}</strong></span></div></div>
        <section class="panel" style="margin-top:16px"><div class="panel-head"><h3>آخرین گردش‌های انبار</h3><span>${number(state.movements.length)} رویداد ثبت‌شده</span></div><div class="table-wrap">${state.movements.length ? `<table><thead><tr><th>تاریخ</th><th>کالا</th><th>نوع گردش</th><th>تعداد</th><th>علت</th></tr></thead><tbody>${[...state.movements].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,12).map(m=>`<tr><td>${shortDate(m.date)}</td><td class="primary-cell">${escapeHTML(m.productName)}</td><td>${m.type==='in'?'<span class="badge badge-green">ورود</span>':'<span class="badge badge-orange">خروج</span>'}</td><td>${number(m.qty)}</td><td>${escapeHTML(m.reason || '—')}</td></tr>`).join('')}</tbody></table>` : emptyState('گردش انباری ثبت نشده','با ورود، خروج یا فروش کالا، تاریخچه در این بخش ثبت می‌شود.')}</div></section>`;
    };
  }

  // Exchange-rate settings card, kept separate from the original settings form.
  if (typeof settingsView === 'function') {
    const originalSettingsView = settingsView;
    settingsView = function settingsViewWithFx() {
      const html = originalSettingsView();
      const code = state.settings?.fxCurrency || 'USD';
      const item = state.settings?.fxRates?.[code] || {};
      const rate = item.rateToman || '';
      const mode = state.settings?.fxUpdateMode || 'manual';
      const stamp = item.updatedAt ? new Date(item.updatedAt).toLocaleString('fa-IR') : 'هنوز نرخ ثبت نشده';
      const card = `<section class="panel settings-card ss-fx-card">
        <h3>نرخ ارز و قیمت‌گذاری محصولات</h3>
        <p>قیمت خرید و فروش هر محصول می‌تواند دستی به تومان یا ارزی ثبت شود. نرخ تبدیل همیشه به‌صورت «تومان برای یک واحد ارز» نگهداری می‌شود.</p>
        <form id="fxSettingsForm" class="ss-fx-form">
          <div><label>ارز پیش‌فرض / نرخ موردنظر</label><select name="fxCurrency">${fxOptionMarkup(code)}</select></div>
          <div><label>نرخ هر واحد ارز به تومان</label><input name="rateToman" type="text" inputmode="decimal" value="${escapeHTML(String(rate))}" placeholder="مثلاً ۲۷۰۰۰۰"></div>
          <div><label>روش به‌روزرسانی</label><select name="fxUpdateMode"><option value="manual" ${mode==='manual'?'selected':''}>دستی</option><option value="auto" ${mode==='auto'?'selected':''}>خودکار هر ۲۴ ساعت</option></select></div>
          <div class="settings-actions" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">ذخیره تنظیمات نرخ</button><button class="btn btn-secondary" type="button" data-ss-refresh-fx>دریافت نرخ فعلی</button></div>
        </form>
        <p id="ssFxStatus">نرخ فعلی: <strong>${rate ? new Intl.NumberFormat('fa-IR').format(rate)+' تومان' : 'ثبت نشده'}</strong> · آخرین به‌روزرسانی: ${stamp}<br>منبع خودکار: <a href="https://nerkhara.com/en/api/" target="_blank" rel="noopener">NerkhAra</a>؛ نرخ بازار آزاد تهران، نه نرخ رسمی بانکی. زمان نرخ کنار اطلاعات محصول نگهداری می‌شود.</p>
        <p>به‌روزرسانی خودکار در اولین بازشدن برنامه پس از گذشت ۲۴ ساعت انجام می‌شود؛ چون اپ روی GitHub Pages اجرا می‌شود، وقتی همه دستگاه‌ها بسته‌اند، امکان اجرای کار پس‌زمینه یا زمان‌بندی سروری مستقل وجود ندارد.</p>
      </section>`;
      const index = html.lastIndexOf('</div>');
      return index >= 0 ? html.slice(0,index) + card + html.slice(index) : html + card;
    };
  }

  async function updateProductsForRate(code, rate) {
    const now = new Date().toISOString();
    let changed = false;
    state.products.forEach(product => {
      if (product.priceMode !== 'foreign' || product.priceCurrency !== code) return;
      const multiplier = localMultiplier();
      product.cost = Math.round(Number(product.costForeign || 0) * rate * multiplier);
      product.price = Math.round(Number(product.priceForeign || 0) * rate * multiplier);
      product.fxRateToman = rate;
      product.fxUpdatedAt = now;
      product.updatedAt = now;
      changed = true;
    });
    return changed;
  }

  async function refreshFxRate(code, showMessage = true) {
    const apiId = API_ID[code];
    if (!apiId) throw new Error(`ارز ${code} در منبع نرخ خودکار پشتیبانی نشده است.`);
    const response = await fetch(`https://nerkhara.com/api/v1/latest/${apiId}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`دریافت نرخ ${code} ناموفق بود (HTTP ${response.status}).`);
    const payload = await response.json();
    const item = payload?.item;
    const rate = Number(item?.price || 0);
    if (!item || item.unit !== 'IRT' || !(rate > 0) || item.stale === true) {
      throw new Error(`نرخ ${code} معتبر یا به‌روز نیست؛ نرخ قبلی حفظ شد.`);
    }
    state.settings = state.settings || {};
    state.settings.fxRates = state.settings.fxRates || {};
    const updatedAt = item.updated_utc || payload.generated_utc || new Date().toISOString();
    state.settings.fxRates[code] = {
      rateToman: rate,
      updatedAt,
      fetchedAt: new Date().toISOString(),
      source: 'NerkhAra',
      sourceUrl: item.page?.fa || 'https://nerkhara.com'
    };
    await updateProductsForRate(code, rate);
    await persist();
    updateSidebarMeta();
    if (typeof render === 'function') render();
    if (showMessage) toast(`نرخ ${code} دریافت شد: ${new Intl.NumberFormat('fa-IR').format(rate)} تومان`);
    return rate;
  }

  async function refreshStaleRates() {
    if (state.settings?.fxUpdateMode !== 'auto' || !navigator.onLine) return;
    const codes = new Set([state.settings.fxCurrency || 'USD']);
    state.products.filter(p => p.priceMode === 'foreign' && p.priceCurrency).forEach(p => codes.add(p.priceCurrency));
    for (const code of codes) {
      if (!API_ID[code]) continue;
      const item = state.settings?.fxRates?.[code];
      const when = item?.fetchedAt || item?.updatedAt;
      const stale = !when || (Date.now() - Date.parse(when) >= DAY);
      if (stale) {
        try { await refreshFxRate(code, false); }
        catch (error) { console.warn('FX refresh skipped:', code, error); }
      }
    }
  }

  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!form || form.id !== 'fxSettingsForm') return;
    event.preventDefault();
    const data = new FormData(form);
    const code = String(data.get('fxCurrency') || 'USD');
    const mode = data.get('fxUpdateMode') === 'auto' ? 'auto' : 'manual';
    const rawRate = parseAmount(data.get('rateToman'));
    state.settings = state.settings || {};
    state.settings.fxCurrency = code;
    state.settings.fxUpdateMode = mode;
    state.settings.fxRates = state.settings.fxRates || {};
    if (mode === 'manual') {
      if (!(rawRate > 0)) { toast('نرخ دستی باید بیشتر از صفر باشد.', 'error'); return; }
      state.settings.fxRates[code] = {
        rateToman: rawRate,
        updatedAt: new Date().toISOString(),
        fetchedAt: new Date().toISOString(),
        source: 'دستی'
      };
      await updateProductsForRate(code, rawRate);
    }
    try {
      await persist();
      updateSidebarMeta();
      render();
      toast('تنظیمات نرخ ارز ذخیره شد.');
      if (mode === 'auto') {
        try { await refreshFxRate(code, true); }
        catch (error) { toast(error.message || 'دریافت نرخ خودکار انجام نشد.', 'error'); }
      }
    } catch (error) {
      toast(`ذخیره نرخ ارز ناموفق بود: ${error?.message || ''}`, 'error');
    }
  }, true);

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-ss-refresh-fx]');
    if (!button) return;
    const form = $('#fxSettingsForm');
    const code = form?.elements?.fxCurrency?.value || state.settings?.fxCurrency || 'USD';
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'در حال دریافت…';
    try {
      await refreshFxRate(code, true);
      if (state.settings) state.settings.fxCurrency = code;
      await persist();
    } catch (error) {
      toast(error.message || 'دریافت نرخ ارز ناموفق بود.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });

  // Check once when the app becomes visible after owner login, then when the
  // app returns to the foreground. It does not run while the site is closed.
  const appShell = $('.app-shell');
  let fxStartupDone = false;
  function startFxCheckWhenVisible() {
    if (fxStartupDone || !appShell || appShell.style.display === 'none') return;
    fxStartupDone = true;
    refreshStaleRates();
  }
  if (typeof MutationObserver !== 'undefined' && appShell) {
    const visibilityObserver = new MutationObserver(startFxCheckWhenVisible);
    visibilityObserver.observe(appShell, { attributes: true, attributeFilter: ['style'] });
  }
  window.addEventListener('focus', refreshStaleRates);
  window.addEventListener('online', refreshStaleRates);
  window.setInterval(refreshStaleRates, 60 * 60 * 1000);
  window.setTimeout(startFxCheckWhenVisible, 2500);

  window.SwimStoreEnhancements = Object.freeze({
    version: 10,
    refreshFxRate,
    parseAmount,
    brands: BRANDS,
    colors: COLORS,
    productTypes: PRODUCT_TYPES,
    genders: GENDERS
  });
})();
