/* Swim Store Manager - manual FX and bulk pricing tools (v11)
 * Loaded after app-enhancements.js. Keeps existing product and sync data models.
 */
(() => {
  'use strict';

  const BRAND_LABELS = {
    'اسپیدو': 'اسپیدو / Speedo',
    'ارنا': 'ارنا / Arena',
    'تی وای آر': 'تی وای آر / TYR',
    'فینیس': 'فینیس / FINIS',
    'جکد': 'جکد / Jacked',
    'اسپورتی': 'اسپورتی / Sporti',
    '۳۶۱': '۳۶۱ / 361°',
    'نامشخص': 'نامشخص / Unknown'
  };

  const COLOR_LABELS = {
    'آبی': 'آبی / Blue',
    'قرمز': 'قرمز / Red',
    'مشکی': 'مشکی / Black',
    'زرد': 'زرد / Yellow',
    'سبز روشن': 'سبز روشن / Light Green',
    'صورتی': 'صورتی / Pink',
    'سفید': 'سفید / White',
    'بنفش': 'بنفش / Purple',
    'سبز تیره': 'سبز تیره / Dark Green',
    'آبی تیره': 'آبی تیره / Navy',
    'آبی فیروزه ای': 'آبی فیروزه‌ای / Turquoise',
    'چند رنگ': 'چند رنگ / Multicolor',
    'غیره': 'غیره / Other'
  };

  const CURRENCIES = [
    ['USD', 'دلار آمریکا / US Dollar'], ['EUR', 'یورو / Euro'],
    ['GBP', 'پوند انگلیس / British Pound'], ['AED', 'درهم امارات / UAE Dirham'],
    ['CNY', 'یوان چین / Chinese Yuan'], ['AFN', 'افغانی / Afghan Afghani'],
    ['AZN', 'منات آذربایجان / Azerbaijani Manat'], ['TRY', 'لیر ترکیه / Turkish Lira'],
    ['CAD', 'دلار کانادا / Canadian Dollar'], ['AUD', 'دلار استرالیا / Australian Dollar'],
    ['SAR', 'ریال عربستان / Saudi Riyal'], ['QAR', 'ریال قطر / Qatari Riyal'],
    ['KWD', 'دینار کویت / Kuwaiti Dinar'], ['JPY', 'ین ژاپن / Japanese Yen'],
    ['CHF', 'فرانک سوئیس / Swiss Franc']
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const normalizeNumericText = value => String(value ?? '')
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/[٬،\s]/g, '');
  const safeNumber = value => {
    const normalized = normalizeNumericText(value).replace(/,/g, '');
    const result = Number(normalized);
    return Number.isFinite(result) ? result : NaN;
  };
  const safePercent = value => {
    const normalized = normalizeNumericText(value).replace(/,/g, '.');
    const result = Number(normalized);
    return Number.isFinite(result) ? result : NaN;
  };
  const formatFa = value => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Number(value) || 0);
  const formatGrouped = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(Number(value) || 0);
  const localMultiplier = () => typeof currency === 'function' && currency() === 'ریال' ? 10 : 1;

  const style = document.createElement('style');
  style.textContent = `
    .ss-dashboard-tools{margin-top:16px;align-items:stretch}
    .ss-tool-panel .panel-body{padding:16px}
    .ss-tool-panel h3{margin:0;font-size:13px}
    .ss-tool-panel .ss-tool-copy{font-size:10px;line-height:2;color:#718096;margin:8px 0 14px}
    .ss-tool-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px;align-items:end}
    .ss-tool-form .field{display:grid;gap:6px;min-width:0}
    .ss-tool-form label{font-size:10px;color:#607187;font-weight:600}
    .ss-tool-form input,.ss-tool-form select{width:100%;min-width:0;box-sizing:border-box;border:1px solid #dfe7ee;border-radius:8px;padding:10px 11px;font:11px Tahoma,sans-serif;background:#fff;color:#33465a}
    .ss-tool-form .full{grid-column:1/-1}
    .ss-tool-form .settings-actions{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}
    .ss-tool-note{font-size:10px;color:#718096;line-height:1.9;margin-top:10px}
    .ss-tool-status{font-size:10px;color:#52657b;line-height:1.9;margin-top:10px}
    @media(max-width:760px){.ss-tool-form{grid-template-columns:1fr}.ss-tool-form .full,.ss-tool-form .settings-actions{grid-column:auto}}
  `;
  document.head.appendChild(style);

  // Automatic provider updates are disabled. All foreign-currency products
  // now use manually maintained rates in state.settings.fxRates.
  let manualModeSavePending = false;
  function ensureManualFxMode() {
    if (typeof state === 'undefined' || !state || !state.settings) return;
    if (state.settings.fxUpdateMode === 'manual') return;
    state.settings.fxUpdateMode = 'manual';
    if (typeof db !== 'undefined' && db && !manualModeSavePending) {
      manualModeSavePending = true;
      Promise.resolve().then(() => persist())
        .catch(error => console.warn('Could not save manual FX mode:', error))
        .finally(() => { manualModeSavePending = false; });
    }
  }

  const originalRender = render;
  render = function renderWithManualFxMode(...args) {
    ensureManualFxMode();
    return originalRender.apply(this, args);
  };

  function bilingualize(select, labels) {
    if (!select) return;
    [...select.options].forEach(option => {
      if (labels[option.value]) option.textContent = labels[option.value];
    });
  }

  function secondColorSelect(product, grid, firstColorSelect) {
    if (!grid || !firstColorSelect || $('[name="color2"]', grid)) return null;
    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.innerHTML = '<label for="ssProductColor2">رنگ دوم / Second color</label><select id="ssProductColor2" name="color2"><option value="">بدون رنگ دوم / None</option></select>';
    const select = $('[name="color2"]', wrap);
    Object.entries(COLOR_LABELS).forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
    const saved = product?.color2 || '';
    if (saved && ![...select.options].some(option => option.value === saved)) {
      const option = document.createElement('option');
      option.value = saved;
      option.textContent = saved;
      select.appendChild(option);
    }
    select.value = saved;
    const firstField = firstColorSelect.closest('.field');
    if (firstField) firstField.insertAdjacentElement('afterend', wrap);
    else grid.appendChild(wrap);
    return select;
  }

  // Add a second color and make the existing brand/color options bilingual.
  let pendingColor2 = null;
  const priorSaveAndRender = saveAndRender;
  saveAndRender = function saveAndRenderWithColor2(message) {
    if (pendingColor2 && /کالا/.test(String(message || ''))) {
      const target = pendingColor2.editingId
        ? state.products.find(item => item.id === pendingColor2.editingId)
        : state.products.find(item => !pendingColor2.beforeIds.has(item.id));
      if (target) target.color2 = pendingColor2.value;
      pendingColor2 = null;
    }
    return priorSaveAndRender.apply(this, arguments);
  };

  const priorOpenProductForm = openProductForm;
  openProductForm = function openProductFormWithSecondColor(product = null) {
    priorOpenProductForm(product);
    const form = $('#modalForm');
    if (!form) return;
    const brandSelect = $('[name="brand"]', form);
    const colorSelect = $('[name="color"]', form);
    const grid = $('.modal-content .form-grid', form);
    bilingualize(brandSelect, BRAND_LABELS);
    bilingualize(colorSelect, COLOR_LABELS);
    const second = secondColorSelect(product, grid, colorSelect);

    // Replace legacy provider-oriented helper text with the new manual dashboard flow.
    const modeSelect = $('#ssPriceMode', form);
    const currencySelect = $('#ssCurrency', form);
    const foreignCostInput = $('#ssCostForeign', form);
    const foreignPriceInput = $('#ssPriceForeign', form);
    const preview = $('#ssRatePreview', form);
    const refreshManualPreview = () => {
      if (!preview || !modeSelect || modeSelect.value !== 'foreign' || !currencySelect) return;
      const code = currencySelect.value;
      const rate = Number(state.settings?.fxRates?.[code]?.rateToman || 0);
      const item = state.settings?.fxRates?.[code] || {};
      if (rate > 0) {
        const stamp = item.updatedAt ? ` · زمان نرخ: ${new Date(item.updatedAt).toLocaleString('fa-IR')}` : '';
        preview.textContent = `هر ۱ ${code} = ${formatFa(rate)} تومان · منبع: دستی${stamp}`;
        preview.classList.remove('ss-rate-warning');
      } else {
        preview.textContent = `برای ${code} هنوز نرخ ثبت نشده است. از بخش «نرخ ارز دستی» در داشبورد نرخ را وارد کن.`;
        preview.classList.add('ss-rate-warning');
      }
    };
    [modeSelect, currencySelect, foreignCostInput, foreignPriceInput].filter(Boolean).forEach(input => {
      input.addEventListener(input === foreignCostInput || input === foreignPriceInput ? 'input' : 'change', refreshManualPreview);
    });
    refreshManualPreview();

    if (!second) return;
    const beforeIds = new Set(state.products.map(item => item.id));
    form.addEventListener('submit', () => {
      pendingColor2 = {
        editingId: product?.id || null,
        beforeIds,
        value: second.value || ''
      };
    }, true);
  };

  document.addEventListener('click', event => {
    if (event.target.closest('[data-close-modal]') || event.target.matches('[data-modal-backdrop]')) {
      pendingColor2 = null;
    }
  }, true);

  // Display both colors in the inventory table without changing its columns.
  const priorProductsView = productsView;
  productsView = function productsViewWithSecondColor() {
    const html = priorProductsView();
    const holder = document.createElement('div');
    holder.innerHTML = html;
    $$('tbody tr', holder).forEach(row => {
      const editButton = $('[data-action="edit-product"]', row);
      const product = editButton
        ? state.products.find(item => String(item.id) === String(editButton.dataset.id))
        : null;
      const colorCell = row.children[5];
      if (product && colorCell) {
        colorCell.textContent = [product.color, product.color2, product.size].filter(Boolean).join(' / ') || '—';
      }
    });
    return holder.innerHTML;
  };

  // Also include the second color in product CSV exports.
  exportProductsCSV = function exportProductsCSVWithSecondColor() {
    const rows = [
      ['نام کالا','SKU','بارکد','دسته‌بندی','برند','مدل','رنگ اول','رنگ دوم','سایز','واحد','قیمت خرید','قیمت فروش','موجودی','حد هشدار','تأمین‌کننده','محل نگهداری','توضیحات'],
      ...state.products.map(p => [p.name,p.sku,p.barcode,p.category,p.brand,p.model,p.color,p.color2,p.size,p.unit,p.cost,p.price,p.stock,p.minStock,p.supplier,p.location,p.notes])
    ];
    const csv = '\uFEFF' + rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    downloadFile(`products-${todayISO()}.csv`, csv, 'text/csv');
    toast('خروجی CSV کالاها با هر دو رنگ آماده شد.');
  };

  function currencyOptions(selected) {
    return CURRENCIES.map(([code, label]) => `<option value="${code}" ${selected === code ? 'selected' : ''}>${code} · ${label}</option>`).join('');
  }

  function rateFor(code) {
    return Number(state.settings?.fxRates?.[code]?.rateToman || 0);
  }

  function dashboardToolsMarkup() {
    const currentCode = state.settings?.fxCurrency || 'USD';
    const rateItem = state.settings?.fxRates?.[currentCode] || {};
    const currentRate = Number(rateItem.rateToman || 0);
    const updated = rateItem.updatedAt
      ? new Date(rateItem.updatedAt).toLocaleString('fa-IR')
      : 'برای این ارز هنوز نرخی ثبت نشده است.';
    const localProducts = state.products.filter(product => product.priceMode !== 'foreign');
    const foreignProducts = state.products.filter(product => product.priceMode === 'foreign');

    return `<div class="dashboard-grid ss-dashboard-tools">
      <section class="panel ss-tool-panel">
        <div class="panel-head"><h3>نرخ ارز دستی / Manual exchange rate</h3><span>به‌روزرسانی مرکزی محصولات ارزی</span></div>
        <div class="panel-body">
          <p class="ss-tool-copy">نرخ هر ارز را به تومان وارد کن. با ذخیره نرخ، قیمت خرید و فروش تمام کالاهایی که با همان ارز ثبت شده‌اند، دوباره محاسبه می‌شود. نرخ‌ها برای هر ارز جداگانه نگهداری می‌شوند و دریافت خودکار از سایت‌ها غیرفعال است.</p>
          <form id="ssDashboardFxForm" class="ss-tool-form">
            <div class="field"><label>ارز موردنظر</label><select name="fxCurrency">${currencyOptions(currentCode)}</select></div>
            <div class="field"><label>نرخ یک واحد ارز به تومان</label><input name="rateToman" type="text" inputmode="decimal" value="${currentRate ? formatGrouped(currentRate) : ''}" placeholder="مثلاً 120,000" required></div>
            <div class="settings-actions"><button class="btn btn-primary" type="submit">ذخیره نرخ و به‌روزرسانی کالاها</button></div>
          </form>
          <div class="ss-tool-status" id="ssDashboardFxStatus">نرخ فعلی: <strong>${currentRate ? `${formatFa(currentRate)} تومان` : 'ثبت نشده'}</strong> · آخرین تغییر: ${updated}</div>
        </div>
      </section>
      <section class="panel ss-tool-panel">
        <div class="panel-head"><h3>تغییر درصدی قیمت کالاهای تومانی</h3><span>افزایش یا کاهش گروهی</span></div>
        <div class="panel-body">
          <p class="ss-tool-copy">درصد قیمت خرید واحد و قیمت فروش واحد را جداگانه وارد کن. عدد مثبت برای افزایش و عدد منفی برای کاهش است. فقط کالاهای تومانی تغییر می‌کنند؛ کالاهای ارزی و سوابق سفارش‌های قبلی دست‌نخورده می‌مانند.</p>
          <form id="ssBulkPriceForm" class="ss-tool-form">
            <div class="field"><label>تغییر قیمت خرید (%)</label><input name="costPercent" type="number" step="0.1" min="-100" value="0" inputmode="decimal"></div>
            <div class="field"><label>تغییر قیمت فروش (%)</label><input name="pricePercent" type="number" step="0.1" min="-100" value="0" inputmode="decimal"></div>
            <div class="settings-actions"><button class="btn btn-primary" type="submit">اعمال روی کالاهای تومانی</button></div>
          </form>
          <div class="ss-tool-status">کالاهای مشمول: <strong>${formatFa(localProducts.length)}</strong> · کالاهای ارزیِ خارج از این تغییر: ${formatFa(foreignProducts.length)}</div>
        </div>
      </section>
    </div>`;
  }

  const priorDashboardView = dashboardView;
  dashboardView = function dashboardViewWithManagementTools() {
    ensureManualFxMode();
    return priorDashboardView() + dashboardToolsMarkup();
  };

  // Remove the old FX card from Settings. The only user-facing FX control is
  // now the manual card on the dashboard; no provider selector remains.
  const priorSettingsView = settingsView;
  settingsView = function settingsViewWithoutProviderControls() {
    let html = priorSettingsView();
    const marker = '<section class="panel settings-card ss-fx-card">';
    const start = html.indexOf(marker);
    if (start >= 0) {
      const close = html.indexOf('</section>', start);
      if (close >= 0) html = html.slice(0, start) + html.slice(close + '</section>'.length);
    }
    return html;
  };

  document.addEventListener('focus', event => {
    if (event.target.matches('#ssDashboardFxForm [name="rateToman"]')) {
      event.target.value = normalizeNumericText(event.target.value).replace(/,/g, '');
    }
  }, true);
  document.addEventListener('blur', event => {
    if (event.target.matches('#ssDashboardFxForm [name="rateToman"]')) {
      const rate = safeNumber(event.target.value);
      if (rate > 0) event.target.value = formatGrouped(rate);
    }
  }, true);

  document.addEventListener('change', event => {
    const form = event.target.closest('#ssDashboardFxForm');
    if (!form || event.target.name !== 'fxCurrency') return;
    const code = event.target.value;
    const currentRate = rateFor(code);
    form.elements.rateToman.value = currentRate ? formatGrouped(currentRate) : '';
    const status = $('#ssDashboardFxStatus');
    const item = state.settings?.fxRates?.[code] || {};
    const stamp = item.updatedAt ? new Date(item.updatedAt).toLocaleString('fa-IR') : 'برای این ارز هنوز نرخی ثبت نشده است.';
    if (status) status.innerHTML = `نرخ فعلی: <strong>${currentRate ? `${formatFa(currentRate)} تومان` : 'ثبت نشده'}</strong> · آخرین تغییر: ${stamp}`;
  });

  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!form || form.id !== 'ssDashboardFxForm') return;
    event.preventDefault();
    const data = new FormData(form);
    const code = String(data.get('fxCurrency') || 'USD');
    const rate = safeNumber(data.get('rateToman'));
    if (!(rate > 0)) {
      toast('نرخ ارز باید عددی بزرگ‌تر از صفر باشد.', 'error');
      return;
    }

    const now = new Date().toISOString();
    const oldSettings = JSON.parse(JSON.stringify(state.settings || {}));
    const affected = state.products.filter(product => product.priceMode === 'foreign' && product.priceCurrency === code);
    const oldProducts = affected.map(product => ({
      product,
      cost: product.cost,
      price: product.price,
      fxRateToman: product.fxRateToman,
      fxUpdatedAt: product.fxUpdatedAt,
      updatedAt: product.updatedAt
    }));

    state.settings = state.settings || {};
    state.settings.fxCurrency = code;
    state.settings.fxUpdateMode = 'manual';
    state.settings.fxRates = state.settings.fxRates || {};
    state.settings.fxRates[code] = { rateToman: rate, updatedAt: now, fetchedAt: now, source: 'دستی' };

    const multiplier = localMultiplier();
    affected.forEach(product => {
      product.cost = Math.round(Number(product.costForeign || 0) * rate * multiplier);
      product.price = Math.round(Number(product.priceForeign || 0) * rate * multiplier);
      product.fxRateToman = rate;
      product.fxUpdatedAt = now;
      product.updatedAt = now;
    });

    const submit = $('button[type="submit"]', form);
    if (submit) { submit.disabled = true; submit.textContent = 'در حال ذخیره…'; }
    try {
      await persist();
      updateSidebarMeta();
      render();
      toast(`نرخ ${code} ذخیره شد؛ قیمت ${formatFa(affected.length)} کالای ارزی به‌روزرسانی شد.`);
    } catch (error) {
      state.settings = oldSettings;
      oldProducts.forEach(old => Object.assign(old.product, {
        cost: old.cost, price: old.price, fxRateToman: old.fxRateToman,
        fxUpdatedAt: old.fxUpdatedAt, updatedAt: old.updatedAt
      }));
      if (submit) { submit.disabled = false; submit.textContent = 'ذخیره نرخ و به‌روزرسانی کالاها'; }
      toast(`ذخیره نرخ ارز ناموفق بود: ${error?.message || 'خطای ذخیره‌سازی'}`, 'error');
    }
  });

  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!form || form.id !== 'ssBulkPriceForm') return;
    event.preventDefault();
    const data = new FormData(form);
    const costPercent = safePercent(data.get('costPercent') || 0);
    const pricePercent = safePercent(data.get('pricePercent') || 0);
    if (!Number.isFinite(costPercent) || !Number.isFinite(pricePercent) || costPercent < -100 || pricePercent < -100) {
      toast('درصدها باید عدد معتبر و حداقل ۱۰۰- باشند.', 'error');
      return;
    }
    if (costPercent === 0 && pricePercent === 0) {
      toast('حداقل یکی از درصدهای خرید یا فروش را تغییر بده.', 'error');
      return;
    }

    const targets = state.products.filter(product => product.priceMode !== 'foreign');
    if (!targets.length) {
      toast('هیچ کالای تومانی برای تغییر قیمت وجود ندارد.', 'error');
      return;
    }
    const signed = value => `${value > 0 ? '+' : ''}${value}%`;
    const message = `این تغییر روی ${formatFa(targets.length)} کالای تومانی اعمال می‌شود.\n\nقیمت خرید: ${signed(costPercent)}\nقیمت فروش: ${signed(pricePercent)}\n\nکالاهای ارزی و سفارش‌های ثبت‌شده قبلی تغییر نمی‌کنند. ادامه می‌دهی؟`;
    if (!confirm(message)) return;

    const snapshots = targets.map(product => ({
      product,
      cost: product.cost,
      price: product.price,
      updatedAt: product.updatedAt
    }));
    const now = new Date().toISOString();
    targets.forEach(product => {
      product.cost = Math.max(0, Math.round((Number(product.cost) || 0) * (1 + costPercent / 100)));
      product.price = Math.max(0, Math.round((Number(product.price) || 0) * (1 + pricePercent / 100)));
      product.updatedAt = now;
    });

    const submit = $('button[type="submit"]', form);
    if (submit) { submit.disabled = true; submit.textContent = 'در حال اعمال تغییرات…'; }
    try {
      await persist();
      updateSidebarMeta();
      render();
      toast(`قیمت خرید و فروش ${formatFa(targets.length)} کالای تومانی به‌روزرسانی شد.`);
    } catch (error) {
      snapshots.forEach(old => Object.assign(old.product, {
        cost: old.cost, price: old.price, updatedAt: old.updatedAt
      }));
      if (submit) { submit.disabled = false; submit.textContent = 'اعمال روی کالاهای تومانی'; }
      toast(`اعمال تغییرات ناموفق بود: ${error?.message || 'خطای ذخیره‌سازی'}`, 'error');
    }
  });

  window.SwimStoreManagementTools = Object.freeze({
    version: 11,
    manualFxOnly: true,
    currencies: CURRENCIES.map(([code]) => code),
    getTomanProductCount: () => state.products.filter(product => product.priceMode !== 'foreign').length,
    getForeignProductCount: () => state.products.filter(product => product.priceMode === 'foreign').length
  });
})();
