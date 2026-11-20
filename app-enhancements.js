/*
 * Swim Store Manager - small application enhancements.
 * Adds a confirmed-login checkbox and inventory valuation at selling price.
 * Does not alter stored records or the Firebase data model.
 */
(() => {
  'use strict';

  const style = document.createElement('style');
  style.textContent = `
    .inventory-stats { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    .ss-login-confirm {
      display:flex; align-items:flex-start; gap:9px; margin:12px 0 5px;
      color:#52657b; font:11px/1.9 Tahoma,sans-serif; cursor:pointer;
    }
    .ss-login-confirm input { flex:0 0 auto; width:16px; height:16px; margin:3px 0 0; accent-color:#24b8a5; }
    @media(max-width:1100px) {
      .inventory-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media(max-width:760px) {
      .inventory-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `;
  document.head.appendChild(style);

  // The authentication gate is created by firebase-integration.js immediately
  // before this script is loaded. Autofill may fill credentials, but this
  // required checkbox and the submit button require an explicit user action.
  const loginForm = document.getElementById('ssOwnerLogin');
  if (loginForm && !loginForm.querySelector('[name="confirmLogin"]')) {
    const submitButton = loginForm.querySelector('button[type="submit"]');
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

  // Override the existing inventory view without changing app.js or its data.
  if (typeof productsView === 'function') {
    productsView = function productsViewWithSaleValuation() {
      const filtered = state.products.filter((product) =>
        [product.name, product.sku, product.barcode, product.category,
          product.brand, product.model, product.color, product.size,
          product.supplier, product.location]
          .some((value) => String(value || '').toLowerCase().includes(searchTerm.toLowerCase()))
      );

      const purchaseValue = sum(state.products,
        (product) => product.stock * product.cost);
      const saleValue = sum(state.products,
        (product) => product.stock * product.price);
      const unitsInStock = sum(state.products, (product) => product.stock);
      const lowStockCount = state.products.filter(
        (product) => product.stock <= product.minStock
      ).length;

      return `${pageHead('کالاها و انبار','مدیریت مشخصات تخصصی کالا، قیمت‌ها، موجودی و گردش انبار', `<button class="btn btn-primary" data-action="new-product">＋ افزودن کالا</button>`)}
        <div class="stats-grid inventory-stats">
          ${statCard('تعداد اقلام', number(state.products.length), 'کالاهای تعریف‌شده', '▤','icon-blue')}
          ${statCard('تعداد واحد موجود', number(unitsInStock), 'جمع موجودی فیزیکی', '◫','icon-teal')}
          ${statCard('ارزش خرید موجودی', money(purchaseValue), 'موجودی فعلی × قیمت خرید', '◈','icon-orange')}
          ${statCard('ارزش فروش موجودی', money(saleValue), 'موجودی فعلی × قیمت فروش', '↗','icon-teal')}
          ${statCard('کالاهای کم‌موجود', number(lowStockCount), 'برابر یا کمتر از حد هشدار', '⚑','icon-red')}
        </div>
        <div class="table-toolbar"><div class="search-box"><input id="tableSearch" value="${escapeHTML(searchTerm)}" placeholder="جست‌وجوی نام، SKU، بارکد، برند، مدل، رنگ یا سایز..."></div><span class="muted">${number(filtered.length)} کالا</span></div>
        <div class="table-card"><div class="table-wrap">${filtered.length ? `<table><thead><tr><th>تصویر</th><th>نام کالا</th><th>SKU / بارکد</th><th>برند / مدل</th><th>دسته‌بندی</th><th>رنگ / سایز</th><th>قیمت خرید</th><th>قیمت فروش</th><th>موجودی</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>${filtered.map((product) => `<tr>
          <td>${product.imageData ? `<img src="${escapeHTML(product.imageData)}" alt="${escapeHTML(product.name)}" style="width:56px;height:56px;object-fit:contain;border-radius:8px;background:#fff;border:1px solid #e7edf3">` : '<div style="width:56px;height:56px;border-radius:8px;background:#f3f6fa;display:grid;place-items:center;color:#9aa6b2;font-size:10px">بدون عکس</div>'}</td>
          <td><span class="primary-cell">${escapeHTML(product.name)}</span><span class="secondary-cell">${escapeHTML(product.unit || 'عدد')}</span></td>
          <td>${escapeHTML(product.sku || '—')}<span class="secondary-cell">${escapeHTML(product.barcode || '—')}</span></td>
          <td>${escapeHTML(product.brand || '—')}<span class="secondary-cell">${escapeHTML(product.model || '—')}</span></td>
          <td>${escapeHTML(product.category || 'عمومی')}</td>
          <td>${escapeHTML([product.color,product.size].filter(Boolean).join(' / ') || '—')}</td>
          <td>${money(product.cost)}</td><td>${money(product.price)}</td>
          <td class="primary-cell">${number(product.stock)}</td>
          <td>${product.stock === 0 ? '<span class="badge badge-red">ناموجود</span>' : product.stock <= product.minStock ? '<span class="badge badge-orange">کم‌موجود</span>' : '<span class="badge badge-green">موجود</span>'}</td>
          <td><div class="action-cell"><button class="text-action" data-action="stock-product" data-id="${product.id}">موجودی</button><button class="text-action" data-action="edit-product" data-id="${product.id}">ویرایش</button></div></td>
        </tr>`).join('')}</tbody></table>` : emptyState('هنوز کالایی ثبت نشده','برای شروع، کالاهای فروشگاه را با مشخصات، قیمت و موجودی اولیه اضافه کن.')}</div>
        <div class="table-summary"><span>ارزش خرید موجودی: <strong>${money(purchaseValue)}</strong></span><span>ارزش فروش موجودی: <strong>${money(saleValue)}</strong></span></div></div>
        <section class="panel" style="margin-top:16px"><div class="panel-head"><h3>آخرین گردش‌های انبار</h3><span>${number(state.movements.length)} رویداد ثبت‌شده</span></div><div class="table-wrap">${state.movements.length ? `<table><thead><tr><th>تاریخ</th><th>کالا</th><th>نوع گردش</th><th>تعداد</th><th>علت</th></tr></thead><tbody>${[...state.movements].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,12).map((movement) => `<tr><td>${shortDate(movement.date)}</td><td class="primary-cell">${escapeHTML(movement.productName)}</td><td>${movement.type === 'in' ? '<span class="badge badge-green">ورود</span>' : '<span class="badge badge-orange">خروج</span>'}</td><td>${number(movement.qty)}</td><td>${escapeHTML(movement.reason || '—')}</td></tr>`).join('')}</tbody></table>` : emptyState('گردش انباری ثبت نشده','با ورود، خروج یا فروش کالا، تاریخچه در این بخش ثبت می‌شود.')}</div></section>`;
    };
  }
})();
