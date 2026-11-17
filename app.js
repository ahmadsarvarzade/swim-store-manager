'use strict';

const DB_NAME = 'swim-store-manager-db';
const DB_VERSION = 1;
const STORE_NAME = 'app-data';
const STATE_KEY = 'main';

const defaultState = () => ({
  schemaVersion: 1,
  settings: { storeName: 'مدیریت فروشگاه', phone: '', currency: 'تومان', lowStockDefault: 3 },
  products: [], customers: [], purchases: [], orders: [], expenses: [], movements: [], cash: []
});

let db;
let state = defaultState();
let activeView = 'dashboard';
let searchTerm = '';
let orderLineSequence = 0;

const viewTitles = {
  dashboard: 'داشبورد', products: 'کالاها و انبار', purchases: 'خرید و تأمین کالا',
  orders: 'سفارش‌ها و فروش', customers: 'مشتریان', expenses: 'هزینه‌ها',
  ledger: 'صندوق و گردش مالی', reports: 'گزارش‌ها', settings: 'تنظیمات و پشتیبان'
};

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readSavedState() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(STATE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function persist() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(state, STATE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('ذخیره‌سازی انجام نشد'));
  });
}

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const toNumber = (value) => Number(String(value ?? '').replace(/[٬،,\s]/g, '')) || 0;
const sum = (items, getter) => items.reduce((total, item) => total + getter(item), 0);
const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const currency = () => state.settings.currency || 'تومان';
const money = (value) => `${new Intl.NumberFormat('fa-IR').format(Math.round(Number(value) || 0))} ${currency()}`;
const number = (value) => new Intl.NumberFormat('fa-IR').format(Number(value) || 0);
const shortDate = (date) => date ? new Intl.DateTimeFormat('fa-IR', {year:'numeric', month:'short', day:'numeric'}).format(new Date(`${date}T12:00:00`)) : '—';
const productById = (id) => state.products.find((product) => product.id === id);
const customerById = (id) => state.customers.find((customer) => customer.id === id);
const isCancelled = (order) => order.status === 'cancelled';

function toast(message, kind = 'success') {
  const root = $('#toastRoot');
  const item = document.createElement('div');
  item.className = `toast ${kind}`;
  item.textContent = message;
  root.appendChild(item);
  setTimeout(() => item.remove(), 3200);
}

function saveAndRender(message) {
  persist().then(() => {
    updateSidebarMeta();
    render();
    if (message) toast(message);
  }).catch((error) => {
    console.error(error);
    toast('ذخیره‌سازی انجام نشد؛ فضای ذخیره‌سازی مرورگر را بررسی کن.', 'error');
  });
}

function updateSidebarMeta() {
  $('#brandName').textContent = state.settings.storeName || 'مدیریت فروشگاه';
  const lowStock = state.products.filter((product) => product.stock <= product.minStock).length;
  $('#lowStockCount').textContent = number(lowStock);
  $('#todayLabel').textContent = new Intl.DateTimeFormat('fa-IR', {weekday:'long', year:'numeric', month:'long', day:'numeric'}).format(new Date());
}

function changeView(view) {
  activeView = viewTitles[view] ? view : 'dashboard';
  searchTerm = '';
  $$('.nav-item[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === activeView));
  $('#pageTitle').textContent = viewTitles[activeView];
  $('#sidebar').classList.remove('open');
  render();
}

function pageHead(title, subtitle, actions = '') {
  return `<div class="page-head"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="actions">${actions}</div></div>`;
}

function statCard(label, value, note, icon, color) {
  return `<div class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon ${color}">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></div>`;
}

function emptyState(title, description) {
  return `<div class="empty-state"><div class="empty-icon">＋</div><strong>${title}</strong>${description}</div>`;
}

function statusBadge(status) {
  const map = {
    registered:['ثبت‌شده','badge-blue'], processing:['در حال آماده‌سازی','badge-orange'], shipped:['ارسال‌شده','badge-blue'], delivered:['تحویل‌شده','badge-green'], cancelled:['لغوشده','badge-red'],
    paid:['تسویه‌شده','badge-green'], partial:['پرداخت ناقص','badge-orange'], unpaid:['پرداخت‌نشده','badge-red']
  };
  const [label, className] = map[status] || [status || '—','badge-gray'];
  return `<span class="badge ${className}">${label}</span>`;
}

function cashBalance() { return sum(state.cash, (entry) => entry.type === 'in' ? entry.amount : -entry.amount); }
function soldTotal() { return sum(state.orders.filter((order) => !isCancelled(order)), (order) => order.total); }
function receivedTotal() { return sum(state.cash.filter((entry) => entry.type === 'in'), (entry) => entry.amount); }
function paidOutTotal() { return sum(state.cash.filter((entry) => entry.type === 'out'), (entry) => entry.amount); }
function receivables() { return sum(state.orders.filter((order) => !isCancelled(order)), (order) => Math.max(0, order.total - order.paid)); }
function payables() { return sum(state.purchases, (purchase) => Math.max(0, purchase.total - purchase.paid)); }
function grossProfit() {
  return sum(state.orders.filter((order) => !isCancelled(order)), (order) => order.total - sum(order.items, (item) => item.cost * item.qty));
}

function dashboardView() {
  const low = state.products.filter((product) => product.stock <= product.minStock);
  const monthPrefix = todayISO().slice(0, 7);
  const monthOrders = state.orders.filter((order) => !isCancelled(order) && order.date.startsWith(monthPrefix));
  const monthCash = state.cash.filter((entry) => entry.date.startsWith(monthPrefix));
  const monthSales = sum(monthOrders, (order) => order.total);
  const latest = [...state.cash].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,5);
  const recentOrders = [...state.orders].filter((order) => !isCancelled(order)).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,5);
  const chart = buildMonthChart();
  return `${pageHead('نمای کلی فروشگاه','خلاصه عملکرد، وضعیت موجودی و گردش مالی', `<button class="btn btn-secondary" data-action="open-backup">⇩ پشتیبان</button><button class="btn btn-primary" data-action="new-order">＋ ثبت سفارش</button>`)}
    <div class="stats-grid">
      ${statCard('فروش این ماه', money(monthSales), `${number(monthOrders.length)} سفارش ثبت‌شده`, '↗', 'icon-teal')}
      ${statCard('موجودی کالا', number(state.products.length) + ' قلم', `${number(sum(state.products, p => p.stock))} واحد موجود در انبار`, '▤', 'icon-blue')}
      ${statCard('مانده صندوق', money(cashBalance()), `دریافتی ${money(receivedTotal())}`, '◈', 'icon-orange')}
      ${statCard('مطالبات از مشتریان', money(receivables()), `${number(low.length)} کالا در آستانه اتمام`, '◷', 'icon-red')}
    </div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-head"><h3>روند گردش نقدی</h3><span>۶ ماه اخیر</span></div><div class="panel-body"><div class="chart-wrap"><div class="chart-grid"><i></i><i></i><i></i><i></i></div><div class="chart-bars">${chart.map((month) => `<div class="chart-col"><div class="bar-pair"><i class="bar" style="height:${month.inPct}%" title="ورودی ${money(month.in)}"></i><i class="bar expense" style="height:${month.outPct}%" title="خروجی ${money(month.out)}"></i></div><small>${month.label}</small></div>`).join('')}</div></div><div class="legend"><span><i style="background:#53cbb9"></i>ورودی</span><span><i style="background:#b9c8dc"></i>خروجی</span></div></div></section>
      <section class="panel"><div class="panel-head"><h3>آخرین گردش‌ها</h3><button class="text-action" data-view="ledger">مشاهده همه</button></div><div class="panel-body">${latest.length ? `<div class="activity-list">${latest.map((entry) => `<div class="activity-item"><div class="activity-dot">${entry.type === 'in' ? '↙' : '↗'}</div><div><strong>${escapeHTML(entry.description)}</strong><small>${shortDate(entry.date)} · ${escapeHTML(entry.category)}</small></div><span class="activity-amount ${entry.type === 'in' ? 'text-green' : 'text-red'}">${entry.type === 'in' ? '+' : '−'}${money(entry.amount)}</span></div>`).join('')}</div>` : emptyState('هنوز گردش مالی ثبت نشده','با ثبت فروش یا هزینه، فعالیت‌ها در این بخش نمایش داده می‌شوند.')}</div></section>
    </div>
    <div class="lower-grid">
      <section class="panel"><div class="panel-head"><h3>سفارش‌های اخیر</h3><button class="text-action" data-view="orders">همه سفارش‌ها</button></div><div class="table-wrap">${recentOrders.length ? `<table><thead><tr><th>شماره</th><th>مشتری</th><th>مبلغ</th><th>وضعیت</th></tr></thead><tbody>${recentOrders.map((order) => `<tr><td class="primary-cell">${escapeHTML(order.number)}</td><td>${escapeHTML(order.customerName || 'مشتری حضوری')}</td><td>${money(order.total)}</td><td>${statusBadge(order.status)}</td></tr>`).join('')}</tbody></table>` : emptyState('سفارشی وجود ندارد','اولین سفارش فروشگاه را ثبت کن.')}</div></section>
      <section class="panel"><div class="panel-head"><h3>هشدار موجودی</h3><span>${number(low.length)} کالا</span></div><div class="table-wrap">${low.length ? `<table><thead><tr><th>کالا</th><th>موجودی</th><th>حد هشدار</th><th>وضعیت</th></tr></thead><tbody>${low.slice(0,5).map((product) => `<tr><td class="primary-cell">${escapeHTML(product.name)}</td><td>${number(product.stock)}</td><td>${number(product.minStock)}</td><td><span class="badge ${product.stock === 0 ? 'badge-red' : 'badge-orange'}">${product.stock === 0 ? 'ناموجود' : 'رو به اتمام'}</span></td></tr>`).join('')}</tbody></table>` : emptyState('موجودی مناسب است','در حال حاضر کالایی زیر حد هشدار نیست.')}</div></section>
    </div>`;
}

function buildMonthChart() {
  const list = [];
  for (let offset = 5; offset >= 0; offset--) {
    const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - offset);
    const prefix = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
    const entries = state.cash.filter((entry) => entry.date.startsWith(prefix));
    list.push({ label: new Intl.DateTimeFormat('fa-IR',{month:'short'}).format(date), in: sum(entries.filter(e=>e.type==='in'),e=>e.amount), out: sum(entries.filter(e=>e.type==='out'),e=>e.amount) });
  }
  const max = Math.max(1, ...list.flatMap((item) => [item.in,item.out]));
  return list.map((item) => ({...item, inPct: item.in ? Math.max(4, item.in/max*100) : 2, outPct: item.out ? Math.max(4, item.out/max*100) : 2}));
}

function productsView() {
  const filtered = state.products.filter((product) => [product.name, product.sku, product.barcode, product.category, product.brand, product.model, product.color, product.size, product.supplier, product.location].some(value => String(value || '').toLowerCase().includes(searchTerm.toLowerCase())));
  const value = sum(state.products, (product) => product.stock * product.cost);
  return `${pageHead('کالاها و انبار','مدیریت مشخصات تخصصی کالا، قیمت‌ها، موجودی و گردش انبار', `<button class="btn btn-primary" data-action="new-product">＋ افزودن کالا</button>`)}
    <div class="stats-grid">${statCard('تعداد اقلام', number(state.products.length), 'کالاهای تعریف‌شده', '▤','icon-blue')}${statCard('تعداد واحد موجود', number(sum(state.products,p=>p.stock)), 'جمع موجودی فیزیکی', '◫','icon-teal')}${statCard('ارزش خرید موجودی', money(value), 'بر اساس قیمت خرید ثبت‌شده', '◈','icon-orange')}${statCard('کالاهای کم‌موجود', number(state.products.filter(p=>p.stock<=p.minStock).length), 'برابر یا کمتر از حد هشدار', '⚑','icon-red')}</div>
    <div class="table-toolbar"><div class="search-box"><input id="tableSearch" value="${escapeHTML(searchTerm)}" placeholder="جست‌وجوی نام، SKU، بارکد، برند، مدل، رنگ یا سایز..."></div><span class="muted">${number(filtered.length)} کالا</span></div>
    <div class="table-card"><div class="table-wrap">${filtered.length ? `<table><thead><tr><th>تصویر</th><th>نام کالا</th><th>SKU / بارکد</th><th>برند / مدل</th><th>دسته‌بندی</th><th>رنگ / سایز</th><th>قیمت خرید</th><th>قیمت فروش</th><th>موجودی</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>${filtered.map((product) => `<tr> <td>${product.imageData   ? `<img src="${escapeHTML(product.imageData)}" alt="${escapeHTML(product.name)}" style="width:56px;height:56px;object-fit:contain;border-radius:8px;background:#fff;border:1px solid #e7edf3">`   : '<div style="width:56px;height:56px;border-radius:8px;background:#f3f6fa;display:grid;place-items:center;color:#9aa6b2;font-size:10px">بدون عکس</div>'} </td><td><span class="primary-cell">${escapeHTML(product.name)}</span><span class="secondary-cell">${escapeHTML(product.unit || 'عدد')}</span></td><td>${escapeHTML(product.sku || '—')}<span class="secondary-cell">${escapeHTML(product.barcode || '—')}</span></td><td>${escapeHTML(product.brand || '—')}<span class="secondary-cell">${escapeHTML(product.model || '—')}</span></td><td>${escapeHTML(product.category || 'عمومی')}</td><td>${escapeHTML([product.color,product.size].filter(Boolean).join(' / ') || '—')}</td><td>${money(product.cost)}</td><td>${money(product.price)}</td><td class="primary-cell">${number(product.stock)}</td><td>${product.stock === 0 ? '<span class="badge badge-red">ناموجود</span>' : product.stock <= product.minStock ? '<span class="badge badge-orange">کم‌موجود</span>' : '<span class="badge badge-green">موجود</span>'}</td><td><div class="action-cell"><button class="text-action" data-action="stock-product" data-id="${product.id}">موجودی</button><button class="text-action" data-action="edit-product" data-id="${product.id}">ویرایش</button></div></td></tr>`).join('')}</tbody></table>` : emptyState('هنوز کالایی ثبت نشده','برای شروع، کالاهای فروشگاه را با مشخصات، قیمت و موجودی اولیه اضافه کن.')}</div><div class="table-summary"><span>ارزش موجودی بر مبنای قیمت خرید</span><strong>${money(value)}</strong></div></div>
    <section class="panel" style="margin-top:16px"><div class="panel-head"><h3>آخرین گردش‌های انبار</h3><span>${number(state.movements.length)} رویداد ثبت‌شده</span></div><div class="table-wrap">${state.movements.length?`<table><thead><tr><th>تاریخ</th><th>کالا</th><th>نوع گردش</th><th>تعداد</th><th>علت</th></tr></thead><tbody>${[...state.movements].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,12).map(m=>`<tr><td>${shortDate(m.date)}</td><td class="primary-cell">${escapeHTML(m.productName)}</td><td>${m.type==='in'?'<span class="badge badge-green">ورود</span>':'<span class="badge badge-orange">خروج</span>'}</td><td>${number(m.qty)}</td><td>${escapeHTML(m.reason||'—')}</td></tr>`).join('')}</tbody></table>`:emptyState('گردش انباری ثبت نشده','با ورود، خروج یا فروش کالا، تاریخچه در این بخش ثبت می‌شود.')}</div></section>`;
}

function purchasesView() {
  const filtered = [...state.purchases].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).filter((purchase) => `${purchase.number} ${purchase.supplier}`.toLowerCase().includes(searchTerm.toLowerCase()));
  const total = sum(state.purchases,p=>p.total), paid = sum(state.purchases,p=>p.paid);
  return `${pageHead('خرید و تأمین کالا','ثبت خرید از تأمین‌کننده، افزایش موجودی و کنترل بدهی‌ها', `<button class="btn btn-primary" data-action="new-purchase" ${state.products.length ? '' : 'disabled'}>＋ ثبت خرید جدید</button>`)}
    <div class="stats-grid">${statCard('جمع خریدها',money(total),'ارزش کل فاکتورهای خرید','↙','icon-blue')}${statCard('پرداخت‌شده',money(paid),'مبالغ پرداختی به تأمین‌کنندگان','✓','icon-teal')}${statCard('بدهی به تأمین‌کننده',money(Math.max(0,total-paid)),'مانده پرداخت‌نشده خریدها','◷','icon-red')}${statCard('تعداد فاکتور خرید',number(state.purchases.length),'ثبت‌های خرید کالا','▧','icon-orange')}</div>
    <div class="table-toolbar"><div class="search-box"><input id="tableSearch" value="${escapeHTML(searchTerm)}" placeholder="جست‌وجوی شماره فاکتور یا تأمین‌کننده..."></div><span class="muted">${number(filtered.length)} فاکتور</span></div>
    <div class="table-card"><div class="table-wrap">${filtered.length ? `<table><thead><tr><th>شماره فاکتور</th><th>تأمین‌کننده</th><th>تاریخ</th><th>تعداد واحد</th><th>مبلغ کل</th><th>پرداخت‌شده</th><th>مانده</th><th>عملیات</th></tr></thead><tbody>${filtered.map((p)=>`<tr><td class="primary-cell">${escapeHTML(p.number)}</td><td>${escapeHTML(p.supplier)}</td><td>${shortDate(p.date)}</td><td>${number(p.qty)}</td><td>${money(p.total)}</td><td class="amount-positive">${money(p.paid)}</td><td class="${p.total-p.paid>0?'amount-negative':''}">${money(p.total-p.paid)}</td><td>${p.total>p.paid?`<button class="text-action" data-action="pay-purchase" data-id="${p.id}">ثبت پرداخت</button>`:'<span class="badge badge-green">تسویه</span>'}</td></tr>`).join('')}</tbody></table>` : emptyState('خریدی ثبت نشده','با ثبت خرید، موجودی کالا افزایش پیدا می‌کند و مبلغ پرداختی در صندوق ثبت می‌شود.')}</div></div>`;
}

function ordersView() {
  const filtered = [...state.orders].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).filter((order) => `${order.number} ${order.customerName} ${order.status}`.toLowerCase().includes(searchTerm.toLowerCase()));
  const active = state.orders.filter(o=>!isCancelled(o));
  return `${pageHead('سفارش‌ها و فروش','ثبت سفارش، کسر خودکار موجودی، دریافت وجه و پیگیری ارسال', `<button class="btn btn-primary" data-action="new-order" ${state.products.length ? '' : 'disabled'}>＋ ثبت سفارش</button>`)}
    <div class="stats-grid">${statCard('فروش ثبت‌شده',money(sum(active,o=>o.total)),'بدون سفارش‌های لغوشده','↗','icon-teal')}${statCard('دریافتی از فروش',money(sum(active,o=>o.paid)),'پرداخت‌های ثبت‌شده','✓','icon-blue')}${statCard('مانده دریافتنی',money(receivables()),'مطالبات سفارش‌ها','◷','icon-orange')}${statCard('تعداد سفارش‌ها',number(active.length),'سفارش فعال و تکمیل‌شده','▣','icon-red')}</div>
    <div class="table-toolbar"><div class="search-box"><input id="tableSearch" value="${escapeHTML(searchTerm)}" placeholder="جست‌وجوی شماره سفارش یا نام مشتری..."></div><span class="muted">${number(filtered.length)} سفارش</span></div>
    <div class="table-card"><div class="table-wrap">${filtered.length ? `<table><thead><tr><th>شماره سفارش</th><th>مشتری</th><th>تاریخ</th><th>اقلام</th><th>مبلغ کل</th><th>پرداختی</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>${filtered.map((order)=>`<tr><td class="primary-cell">${escapeHTML(order.number)}</td><td>${escapeHTML(order.customerName || 'مشتری حضوری')}</td><td>${shortDate(order.date)}</td><td>${number(sum(order.items,i=>i.qty))} واحد</td><td>${money(order.total)}</td><td>${money(order.paid)}</td><td>${statusBadge(isCancelled(order)?'cancelled':(order.paid>=order.total?'paid':order.paid>0?'partial':'unpaid'))}<div style="margin-top:4px">${statusBadge(order.status)}</div></td><td><div class="action-cell"><button class="text-action" data-action="view-order" data-id="${order.id}">جزئیات</button>${!isCancelled(order)?`<button class="text-action danger" data-action="cancel-order" data-id="${order.id}">لغو</button>`:''}</div></td></tr>`).join('')}</tbody></table>` : emptyState('سفارشی ثبت نشده','سفارش جدید را ثبت کن؛ موجودی کالا و دفتر مالی به‌صورت خودکار به‌روزرسانی می‌شوند.')}</div></div>`;
}

function customersView() {
  const filtered = state.customers.filter((customer)=>`${customer.name} ${customer.phone} ${customer.address}`.toLowerCase().includes(searchTerm.toLowerCase()));
  return `${pageHead('مشتریان','اطلاعات تماس و سابقه خرید مشتریان فروشگاه', `<button class="btn btn-primary" data-action="new-customer">＋ افزودن مشتری</button>`)}
    <div class="stats-grid">${statCard('تعداد مشتریان',number(state.customers.length),'مشتریان ثبت‌شده','♙','icon-blue')}${statCard('مشتریان دارای سفارش',number(new Set(state.orders.filter(o=>!isCancelled(o)&&o.customerId).map(o=>o.customerId)).size),'حداقل یک خرید ثبت‌شده','✓','icon-teal')}${statCard('مطالبات فروش',money(receivables()),'مانده سفارش‌های تسویه‌نشده','◷','icon-orange')}${statCard('میانگین مبلغ سفارش',money(state.orders.filter(o=>!isCancelled(o)).length ? soldTotal()/state.orders.filter(o=>!isCancelled(o)).length : 0),'بر اساس سفارش‌های فعال','◈','icon-red')}</div>
    <div class="table-toolbar"><div class="search-box"><input id="tableSearch" value="${escapeHTML(searchTerm)}" placeholder="جست‌وجوی نام، تلفن یا نشانی..."></div><span class="muted">${number(filtered.length)} مشتری</span></div>
    <div class="table-card"><div class="table-wrap">${filtered.length ? `<table><thead><tr><th>نام مشتری</th><th>شماره تماس</th><th>تعداد سفارش</th><th>مجموع خرید</th><th>مانده حساب</th><th>نشانی</th><th>عملیات</th></tr></thead><tbody>${filtered.map((customer)=>{const orders=state.orders.filter(o=>o.customerId===customer.id&&!isCancelled(o));return `<tr><td class="primary-cell">${escapeHTML(customer.name)}</td><td>${escapeHTML(customer.phone||'—')}</td><td>${number(orders.length)}</td><td>${money(sum(orders,o=>o.total))}</td><td>${money(sum(orders,o=>Math.max(0,o.total-o.paid)))}</td><td>${escapeHTML(customer.address||'—')}</td><td><button class="text-action" data-action="edit-customer" data-id="${customer.id}">ویرایش</button></td></tr>`}).join('')}</tbody></table>` : emptyState('مشتری ثبت نشده','مشتریان را اضافه کن تا سفارش‌ها و مانده‌حساب آن‌ها قابل پیگیری باشد.')}</div></div>`;
}

function expensesView() {
  const filtered=[...state.expenses].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).filter((expense)=>`${expense.title} ${expense.category}`.toLowerCase().includes(searchTerm.toLowerCase()));
  const month=todayISO().slice(0,7), monthExpenses=state.expenses.filter(e=>e.date.startsWith(month));
  return `${pageHead('هزینه‌ها','ثبت مخارج جاری و مشاهده سوابق پرداختی فروشگاه', `<button class="btn btn-primary" data-action="new-expense">＋ ثبت هزینه</button>`)}
    <div class="stats-grid">${statCard('جمع هزینه‌ها',money(sum(state.expenses,e=>e.amount)),'تمام هزینه‌های ثبت‌شده','↗','icon-red')}${statCard('هزینه این ماه',money(sum(monthExpenses,e=>e.amount)),'از ابتدای ماه جاری','◷','icon-orange')}${statCard('تعداد ثبت‌ها',number(state.expenses.length),'فاکتور و پرداخت هزینه','▧','icon-blue')}${statCard('خروجی صندوق',money(paidOutTotal()),'شامل خرید و هزینه‌ها','◈','icon-teal')}</div>
    <div class="table-toolbar"><div class="search-box"><input id="tableSearch" value="${escapeHTML(searchTerm)}" placeholder="جست‌وجوی شرح یا دسته هزینه..."></div><span class="muted">${number(filtered.length)} ثبت</span></div>
    <div class="table-card"><div class="table-wrap">${filtered.length?`<table><thead><tr><th>شرح هزینه</th><th>دسته‌بندی</th><th>تاریخ</th><th>مبلغ</th><th>یادداشت</th></tr></thead><tbody>${filtered.map(e=>`<tr><td class="primary-cell">${escapeHTML(e.title)}</td><td>${escapeHTML(e.category)}</td><td>${shortDate(e.date)}</td><td class="amount-negative">${money(e.amount)}</td><td>${escapeHTML(e.notes||'—')}</td></tr>`).join('')}</tbody></table>`:emptyState('هزینه‌ای ثبت نشده','هزینه‌هایی مانند بسته‌بندی، ارسال، تبلیغات و اجاره را ثبت کن.')}</div></div>`;
}

function ledgerView() {
  const filtered=[...state.cash].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).filter(entry=>`${entry.description} ${entry.category} ${entry.type}`.toLowerCase().includes(searchTerm.toLowerCase()));
  let balance=cashBalance();
  return `${pageHead('صندوق و گردش مالی','دفتر ثبت دریافت‌ها و پرداخت‌ها؛ فروش و خرید به‌صورت خودکار در این بخش ثبت می‌شوند', `<button class="btn btn-secondary" data-action="print">چاپ گزارش</button><button class="btn btn-primary" data-action="new-cash">＋ ثبت دریافت / پرداخت</button>`)}
    <div class="stats-grid">${statCard('موجودی صندوق',money(cashBalance()),'ورودی منهای خروجی','◈','icon-teal')}${statCard('مجموع دریافتی',money(receivedTotal()),'تمام دریافت‌های ثبت‌شده','↙','icon-blue')}${statCard('مجموع پرداختی',money(paidOutTotal()),'تمام خروجی‌های ثبت‌شده','↗','icon-red')}${statCard('مطالبات مشتریان',money(receivables()),'مانده سفارش‌ها','◷','icon-orange')}</div>
    <div class="table-toolbar"><div class="search-box"><input id="tableSearch" value="${escapeHTML(searchTerm)}" placeholder="جست‌وجوی شرح یا نوع گردش..."></div><span class="muted">${number(filtered.length)} تراکنش</span></div>
    <div class="table-card"><div class="table-wrap">${filtered.length?`<table><thead><tr><th>تاریخ</th><th>شرح تراکنش</th><th>دسته‌بندی</th><th>نوع</th><th>مبلغ</th><th>مانده کل صندوق</th></tr></thead><tbody>${filtered.map(entry=>`<tr><td>${shortDate(entry.date)}</td><td class="primary-cell">${escapeHTML(entry.description)}</td><td>${escapeHTML(entry.category)}</td><td>${entry.type==='in'?'<span class="badge badge-green">دریافت</span>':'<span class="badge badge-red">پرداخت</span>'}</td><td class="${entry.type==='in'?'amount-positive':'amount-negative'}">${entry.type==='in'?'+':'−'}${money(entry.amount)}</td><td>${money(balanceAfter(entry.id))}</td></tr>`).join('')}</tbody></table>`:emptyState('گردش مالی وجود ندارد','با ثبت سفارش، خرید، هزینه یا تراکنش دستی، دفتر مالی شکل می‌گیرد.')}</div><div class="table-summary"><span>مانده نهایی صندوق</span><strong>${money(balance)}</strong></div></div>`;
}

function balanceAfter(entryId) {
  const sorted=[...state.cash].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)); let balance=0;
  for(const entry of sorted){balance += entry.type==='in'?entry.amount:-entry.amount; if(entry.id===entryId) return balance;}
  return 0;
}

function reportsView() {
  const active=state.orders.filter(o=>!isCancelled(o));
  const costs=sum(active,o=>sum(o.items,i=>i.cost*i.qty));
  const sales=sum(active,o=>o.total);
  const gross=sales-costs;
  const expenses=sum(state.expenses,e=>e.amount);
  const purchased=sum(state.purchases,p=>p.total);
  const categoryTotals={}; state.expenses.forEach(e=>categoryTotals[e.category]=(categoryTotals[e.category]||0)+e.amount);
  const max=Math.max(1,...Object.values(categoryTotals));
  return `${pageHead('گزارش‌ها و تحلیل','خلاصه فروش، بهای تمام‌شده، هزینه‌ها و وضعیت تعهدات', `<button class="btn btn-secondary" data-action="export-csv">خروجی CSV کالاها</button><button class="btn btn-primary" data-action="print">چاپ گزارش</button>`)}
    <div class="report-cards"><div class="report-card"><small>فروش خالص ثبت‌شده</small><strong>${money(sales)}</strong><span>سفارش‌های لغوشده حذف شده‌اند</span></div><div class="report-card"><small>بهای تمام‌شده کالای فروخته‌شده</small><strong>${money(costs)}</strong><span>بر اساس قیمت خرید هنگام فروش</span></div><div class="report-card"><small>سود ناخالص کالا</small><strong class="${gross>=0?'amount-positive':'amount-negative'}">${money(gross)}</strong><span>پیش از کسر هزینه‌های جاری</span></div><div class="report-card"><small>هزینه‌های جاری ثبت‌شده</small><strong>${money(expenses)}</strong><span>بدون احتساب پرداخت خرید کالا</span></div><div class="report-card"><small>ارزش فاکتورهای خرید</small><strong>${money(purchased)}</strong><span>مجموع خریدهای ثبت‌شده</span></div><div class="report-card"><small>سود پس از هزینه‌های جاری</small><strong class="${gross-expenses>=0?'amount-positive':'amount-negative'}">${money(gross-expenses)}</strong><span>برآورد بر مبنای اطلاعات واردشده</span></div></div>
    <div class="dashboard-grid"><section class="panel"><div class="panel-head"><h3>ترکیب هزینه‌ها</h3><span>بر اساس دسته‌بندی</span></div><div class="panel-body">${Object.keys(categoryTotals).length?`<div class="breakdown">${Object.entries(categoryTotals).sort((a,b)=>b[1]-a[1]).map(([category,amount])=>`<div class="breakdown-row"><span>${escapeHTML(category)}</span><div class="progress-track"><i style="width:${amount/max*100}%"></i></div><strong>${money(amount)}</strong></div>`).join('')}</div>`:emptyState('داده‌ای برای تحلیل نیست','پس از ثبت هزینه، نمودار دسته‌بندی نمایش داده می‌شود.')}</div></section>
    <section class="panel"><div class="panel-head"><h3>وضعیت تعهدات</h3><span>مانده پرداختنی / دریافتنی</span></div><div class="panel-body"><div class="activity-list"><div class="activity-item"><div class="activity-dot">↙</div><div><strong>مطالبات از مشتریان</strong><small>مانده پرداخت‌نشده سفارش‌ها</small></div><span class="activity-amount text-red">${money(receivables())}</span></div><div class="activity-item"><div class="activity-dot">↗</div><div><strong>بدهی به تأمین‌کنندگان</strong><small>مانده پرداخت‌نشده خریدها</small></div><span class="activity-amount text-red">${money(payables())}</span></div><div class="activity-item"><div class="activity-dot">◈</div><div><strong>مانده صندوق</strong><small>بر اساس تراکنش‌های ثبت‌شده</small></div><span class="activity-amount text-green">${money(cashBalance())}</span></div></div><div class="notice" style="margin:18px 0 0">این گزارش مدیریتی است و جایگزین دفاتر قانونی، اظهارنامه مالیاتی یا نرم‌افزار حسابداری تأییدشده نیست. صحت نتایج به کامل و دقیق بودن اطلاعات ثبت‌شده بستگی دارد.</div></div></section></div>`;
}

function settingsView() {
  return `${pageHead('تنظیمات و پشتیبان','اطلاعات فروشگاه، واحد پول و مدیریت نسخه‌های پشتیبان', '')}
    <div class="notice">اطلاعات اصلی در پایگاه داده محلی مرورگر (IndexedDB) ذخیره می‌شود. پاک‌کردن داده‌های سایت یا مرورگر ممکن است اطلاعات را حذف کند؛ به‌صورت منظم فایل پشتیبان بگیر و آن را در محل امن دیگری نگه دار.</div>
    <div class="settings-grid"><section class="panel settings-card"><h3>مشخصات فروشگاه</h3><p>نام و اطلاعاتی که در سربرگ برنامه نمایش داده می‌شود.</p><form id="settingsForm"><div class="form-grid"><div class="field full"><label>نام فروشگاه</label><input name="storeName" required maxlength="60" value="${escapeHTML(state.settings.storeName)}"></div><div class="field"><label>شماره تماس</label><input name="phone" value="${escapeHTML(state.settings.phone||'')}" placeholder="اختیاری"></div><div class="field"><label>واحد پول</label><select name="currency"><option ${currency()==='تومان'?'selected':''}>تومان</option><option ${currency()==='ریال'?'selected':''}>ریال</option><option ${currency()==='AZN'?'selected':''}>AZN</option><option ${currency()==='USD'?'selected':''}>USD</option></select></div><div class="field"><label>حد هشدار پیش‌فرض موجودی</label><input name="lowStockDefault" type="number" min="0" step="1" value="${Number(state.settings.lowStockDefault)||0}"></div></div><div class="settings-actions" style="margin-top:15px"><button class="btn btn-primary" type="submit">ذخیره تنظیمات</button></div></form></section>
    <section class="panel settings-card"><h3>پشتیبان‌گیری و بازیابی</h3><p>نسخهٔ کامل اطلاعات کالاها، سفارش‌ها، مشتریان و تراکنش‌ها را ذخیره یا بازیابی کن.</p><div class="settings-actions"><button class="btn btn-primary" data-action="export-backup">⇩ دریافت پشتیبان JSON</button><button class="btn btn-secondary" data-action="import-backup">⇧ بازیابی پشتیبان</button></div><p style="margin-top:16px">پشتیبان JSON شامل همه اطلاعات ثبت‌شده در برنامه است. فایل را با دیگران به اشتراک نگذار؛ اطلاعات مشتریان و حساب‌ها در آن قرار دارد.</p><div class="settings-actions"><button class="btn btn-secondary" data-action="export-csv">خروجی فهرست کالاها (CSV)</button><button class="btn btn-secondary" data-action="print">چاپ صفحه</button></div></section>
    <section class="panel settings-card"><h3>وضعیت داده‌ها</h3><p>آمار فعلی پایگاه داده محلی این دستگاه.</p><div class="activity-list"><div class="activity-item"><div><strong>کالاها</strong></div><span class="activity-amount">${number(state.products.length)} مورد</span></div><div class="activity-item"><div><strong>سفارش‌ها</strong></div><span class="activity-amount">${number(state.orders.length)} مورد</span></div><div class="activity-item"><div><strong>مشتریان</strong></div><span class="activity-amount">${number(state.customers.length)} مورد</span></div><div class="activity-item"><div><strong>تراکنش‌های مالی</strong></div><span class="activity-amount">${number(state.cash.length)} مورد</span></div></div></section>
    <section class="panel settings-card"><h3>نکات استفاده</h3><p>این نسخه برای مدیریت یک فروشگاه و استفاده محلی روی یک مرورگر طراحی شده است.</p><ul style="margin:0;padding-right:18px;color:#78899c;font-size:10px;line-height:2.2"><li>همگام‌سازی خودکار بین دستگاه‌ها وجود ندارد.</li><li>برای نصب روی iPhone و Mac باید برنامه روی یک نشانی HTTPS میزبانی شود.</li><li>از ورود هم‌زمان چند کاربر یا چند دستگاه به یک پایگاه داده مشترک پشتیبانی نمی‌شود.</li><li>قبل از استفادهٔ تجاری، ثبت‌ها و گزارش‌ها را با چند سناریوی واقعی آزمایش کن.</li></ul></section></div>`;
}

function render() {
  const views = { dashboard: dashboardView, products: productsView, purchases: purchasesView, orders: ordersView, customers: customersView, expenses: expensesView, ledger: ledgerView, reports: reportsView, settings: settingsView };
  $('#content').innerHTML = views[activeView]();
}

function modal(title, body, submitLabel, onSubmit, options = {}) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-backdrop" data-modal-backdrop><section class="modal ${options.wide?'wide':''}" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}"><div class="modal-head"><h3>${escapeHTML(title)}</h3><button class="modal-close" type="button" data-close-modal aria-label="بستن">×</button></div><form id="modalForm"><div class="modal-content">${body}</div><div class="modal-footer"><button class="btn btn-secondary" type="button" data-close-modal>انصراف</button><button class="btn btn-primary" type="submit">${escapeHTML(submitLabel)}</button></div></form></section></div>`;
  const form = $('#modalForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('button[type="submit"]', form); button.disabled = true;
    try { const success = await onSubmit(new FormData(form), form); if (success !== false) closeModal(); }
    catch(error) { console.error(error); toast(error.message || 'ثبت اطلاعات ناموفق بود.', 'error'); button.disabled = false; }
  });
  $('.modal-backdrop', root).addEventListener('click', (event) => { if(event.target.dataset.modalBackdrop !== undefined) closeModal(); });
  $$('[data-close-modal]', root).forEach(button => button.addEventListener('click', closeModal));
  const first = $('input:not([type="hidden"]),select,textarea', form); if(first) first.focus();
}

function closeModal() { $('#modalRoot').innerHTML = ''; }
function field(label, name, value = '', type = 'text', extra = '') { return `<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${escapeHTML(value)}" ${extra}></div>`; }


function openProductForm(product = null) {
  const editing = Boolean(product);
  const p = product || {
    name:'', sku:'', barcode:'', category:'تجهیزات شنا',
    brand:'', model:'', color:'', size:'', unit:'عدد',
    cost:0, price:0, stock:0,
    minStock:state.settings.lowStockDefault,
    supplier:'', location:'', notes:'', imageData:''
  };

  let previewObjectUrl = null;

  const body = `<div class="form-grid">
    <div class="field full">
      <label>تصویر محصول</label>
      <input id="productImageInput" name="image" type="file" accept="image/*">
      <div style="margin-top:10px;display:flex;align-items:center;gap:12px">
        <img id="productImagePreview"
          src="${escapeHTML(p.imageData || '')}"
          alt="تصویر محصول"
          style="width:100px;height:100px;object-fit:contain;border:1px solid #e7edf3;border-radius:10px;background:#fff;${p.imageData ? '' : 'display:none'}">
        <span id="productImageEmpty" class="field-note" style="${p.imageData ? 'display:none' : ''}">هنوز تصویری انتخاب نشده است.</span>
      </div>
      ${p.imageData ? '<label style="margin-top:10px"><input type="checkbox" name="removeImage" value="yes"> حذف تصویر فعلی</label>' : ''}
      <span class="field-note">تصویر از گالری انتخاب و برای کاهش حجم فشرده می‌شود.</span>
    </div>

    ${field('نام کالا *','name',p.name,'text','required maxlength="100"')}
    ${field('کد کالا / SKU','sku',p.sku || '')}
    ${field('بارکد','barcode',p.barcode || '')}
    ${field('دسته‌بندی','category',p.category || 'تجهیزات شنا')}
    ${field('برند','brand',p.brand || '')}
    ${field('مدل','model',p.model || '')}
    ${field('رنگ','color',p.color || '')}
    ${field('سایز','size',p.size || '')}
    ${field('واحد شمارش','unit',p.unit || 'عدد')}
    ${field('قیمت خرید واحد','cost',p.cost,'number','min="0" step="1" required')}
    ${field('قیمت فروش واحد','price',p.price,'number','min="0" step="1" required')}
    ${field('موجودی فعلی','stock',p.stock,'number',`min="0" step="1" ${editing?'disabled':''} required`)}
    ${field('حد هشدار موجودی','minStock',p.minStock,'number','min="0" step="1" required')}
    ${field('تأمین‌کننده پیش‌فرض','supplier',p.supplier || '')}
    ${field('محل نگهداری','location',p.location || '')}
    <div class="field full">
      <label>توضیحات</label>
      <textarea name="notes" placeholder="توضیحات اختیاری">${escapeHTML(p.notes||'')}</textarea>
    </div>
  </div>
  ${editing?'<div class="field-note" style="margin-top:10px">برای تغییر تعداد موجودی از گزینهٔ «موجودی» در فهرست کالاها استفاده کن.</div>':''}`;

  modal(editing?'ویرایش کالا':'افزودن کالای جدید',body,
    editing?'ذخیره تغییرات':'افزودن کالا',
    async(data)=>{

      const name = data.get('name').trim();
      if(!name) throw new Error('نام کالا الزامی است.');

      const sku = data.get('sku').trim();
      const barcode = data.get('barcode').trim();

      if(sku && state.products.some(item =>
        String(item.sku||'').toLowerCase()===sku.toLowerCase() && item.id!==p.id
      )) throw new Error('این کد کالا قبلاً استفاده شده است.');

      if(barcode && state.products.some(item =>
        String(item.barcode||'').toLowerCase()===barcode.toLowerCase() && item.id!==p.id
      )) throw new Error('این بارکد قبلاً برای کالای دیگری ثبت شده است.');

      let imageData = p.imageData || '';
      const imageFile = data.get('image');

      if(imageFile && imageFile.size > 0) {
        if(!imageFile.type.startsWith('image/')) {
          throw new Error('فایل انتخاب‌شده تصویر معتبر نیست.');
        }

        if(imageFile.size > 8 * 1024 * 1024) {
          throw new Error('حجم عکس باید کمتر از ۸ مگابایت باشد.');
        }

        const source = await new Promise((resolve,reject)=>{
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('خواندن عکس ناموفق بود.'));
          reader.readAsDataURL(imageFile);
        });

        const image = await new Promise((resolve,reject)=>{
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('بازکردن تصویر ممکن نشد. لطفاً عکس JPG یا PNG انتخاب کن.'));
          img.src = source;
        });

        const maxSide = 720;
        const scale = Math.min(1,maxSide/Math.max(image.width,image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1,Math.round(image.width*scale));
        canvas.height = Math.max(1,Math.round(image.height*scale));

        const context = canvas.getContext('2d');
        if(!context) throw new Error('پردازش تصویر در مرورگر ممکن نیست.');

        context.fillStyle = '#ffffff';
        context.fillRect(0,0,canvas.width,canvas.height);
        context.drawImage(image,0,0,canvas.width,canvas.height);

        const compressed = await new Promise(resolve=>{
          canvas.toBlob(resolve,'image/jpeg',0.72);
        });

        if(!compressed) throw new Error('فشرده‌سازی تصویر ناموفق بود.');

        imageData = await new Promise((resolve,reject)=>{
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('ذخیره تصویر ناموفق بود.'));
          reader.readAsDataURL(compressed);
        });
      }

      if(data.get('removeImage') === 'yes') imageData = '';

      const payload = {
        name, sku, barcode,
        category:data.get('category').trim(),
        brand:data.get('brand').trim(),
        model:data.get('model').trim(),
        color:data.get('color').trim(),
        size:data.get('size').trim(),
        unit:data.get('unit').trim() || 'عدد',
        cost:toNumber(data.get('cost')),
        price:toNumber(data.get('price')),
        minStock:toNumber(data.get('minStock')),
        supplier:data.get('supplier').trim(),
        location:data.get('location').trim(),
        notes:data.get('notes').trim(),
        imageData
      };

      if(editing) {
        Object.assign(p,payload,{updatedAt:new Date().toISOString()});
      } else {
        const created = {
          id:uid(),
          ...payload,
          stock:toNumber(data.get('stock')),
          createdAt:new Date().toISOString()
        };

        state.products.push(created);

        if(created.stock>0) {
          state.movements.push({
            id:uid(),date:todayISO(),
            productId:created.id,
            productName:created.name,
            type:'in',qty:created.stock,
            reason:'موجودی اولیه'
          });
        }
      }

      saveAndRender(
        editing?'اطلاعات کالا به‌روزرسانی شد.':'کالا با موفقیت اضافه شد.'
      );
    }
  );

  const imageInput = $('#productImageInput');
  imageInput.addEventListener('change',()=>{
    const file = imageInput.files?.[0];
    if(!file) return;

    if(previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(file);

    $('#productImagePreview').src = previewObjectUrl;
    $('#productImagePreview').style.display = 'block';
    $('#productImageEmpty').style.display = 'none';

    const removeOption = $('[name="removeImage"]');
    if(removeOption) removeOption.checked = false;
  });
}


function openStockForm(product) {
  const body=`<div class="notice">موجودی این کالا در حال حاضر <strong>${number(product.stock)} ${escapeHTML(product.unit||'عدد')}</strong> است. برای حفظ سابقه، هر تغییر تعداد در گردش انبار ثبت می‌شود.</div><div class="form-grid"><div class="field"><label>نوع عملیات</label><select name="type"><option value="in">ورود کالا</option><option value="out">خروج کالا</option><option value="adjust">تنظیم موجودی نهایی</option></select></div>${field('تعداد / موجودی نهایی','qty','1','number','min="0" step="1" required')}<div class="field full"><label>علت تغییر</label><input name="reason" required placeholder="مثلاً شمارش دوره‌ای، کالای معیوب، اصلاح موجودی"></div></div>`;
  modal(`تغییر موجودی · ${product.name}`,body,'ثبت تغییر',async(data)=>{
    const type=data.get('type'), qty=toNumber(data.get('qty')); if(qty<0) throw new Error('تعداد نمی‌تواند منفی باشد.');
    let delta=type==='in'?qty:type==='out'?-qty:qty-product.stock;
    if(product.stock+delta<0) throw new Error('موجودی کافی نیست.');
    product.stock+=delta;
    state.movements.push({id:uid(),date:todayISO(),productId:product.id,productName:product.name,type:delta>=0?'in':'out',qty:Math.abs(delta),reason:data.get('reason').trim()||'اصلاح دستی'});
    saveAndRender('موجودی کالا ثبت و به‌روزرسانی شد.');
  });
}

function openCustomerForm(customer=null) {
  const editing=Boolean(customer), c=customer||{name:'',phone:'',address:'',notes:''};
  const body=`<div class="form-grid">${field('نام و نام خانوادگی *','name',c.name,'text','required maxlength="100"')}${field('شماره تماس','phone',c.phone,'tel','maxlength="30"')}<div class="field full"><label>نشانی</label><textarea name="address">${escapeHTML(c.address||'')}</textarea></div><div class="field full"><label>یادداشت</label><textarea name="notes">${escapeHTML(c.notes||'')}</textarea></div></div>`;
  modal(editing?'ویرایش مشتری':'افزودن مشتری',body,'ذخیره',async(data)=>{const payload={name:data.get('name').trim(),phone:data.get('phone').trim(),address:data.get('address').trim(),notes:data.get('notes').trim()};if(!payload.name)throw new Error('نام مشتری الزامی است.');if(editing){Object.assign(customer,payload);state.orders.filter(o=>o.customerId===customer.id).forEach(o=>o.customerName=customer.name);}else state.customers.push({id:uid(),...payload,createdAt:new Date().toISOString()});saveAndRender('اطلاعات مشتری ذخیره شد.');});
}

function openPurchaseForm() {
  const productOptions=state.products.map(p=>`<option value="${p.id}">${escapeHTML(p.name)} · موجودی ${number(p.stock)}</option>`).join('');
  const body=`<div class="form-grid">${field('نام تأمین‌کننده *','supplier','','text','required')}${field('تاریخ خرید','date',todayISO(),'date','required')}<div class="field"><label>کالا *</label><select name="productId" required>${productOptions}</select></div>${field('تعداد خرید','qty','1','number','min="1" step="1" required')}${field('قیمت خرید هر واحد','unitCost','0','number','min="0" step="1" required')}${field('مبلغ پرداخت‌شده','paid','0','number','min="0" step="1" required')}<div class="field full"><label>یادداشت</label><textarea name="notes"></textarea></div></div><div class="field-note" style="margin-top:10px">با ثبت خرید، موجودی کالا افزایش می‌یابد و فقط مبلغ پرداخت‌شده از صندوق کسر می‌شود. مانده خرید به‌عنوان بدهی تأمین‌کننده محاسبه خواهد شد.</div>`;
  modal('ثبت خرید و ورود کالا',body,'ثبت خرید',async(data)=>{
    const product=productById(data.get('productId')); if(!product) throw new Error('کالا انتخاب نشده است.');
    const qty=toNumber(data.get('qty')), unitCost=toNumber(data.get('unitCost')), paid=toNumber(data.get('paid')), total=qty*unitCost;
    if(qty<=0)throw new Error('تعداد خرید باید بیشتر از صفر باشد.');if(paid>total)throw new Error('مبلغ پرداختی نمی‌تواند از مبلغ فاکتور بیشتر باشد.');
    const purchase={id:uid(),number:`PUR-${String(state.purchases.length+1).padStart(5,'0')}`,supplier:data.get('supplier').trim(),date:data.get('date'),productId:product.id,productName:product.name,qty,unitCost,total,paid,notes:data.get('notes').trim(),createdAt:new Date().toISOString()};
    const oldStock=product.stock; product.stock+=qty; product.cost=oldStock>0?Math.round((oldStock*product.cost+qty*unitCost)/(oldStock+qty)):unitCost;
    state.purchases.push(purchase);state.movements.push({id:uid(),date:purchase.date,productId:product.id,productName:product.name,type:'in',qty,reason:`خرید ${purchase.number}`});
    if(paid>0)state.cash.push({id:uid(),date:purchase.date,type:'out',category:'پرداخت خرید',description:`پرداخت خرید ${purchase.number} · ${purchase.supplier}`,amount:paid,ref:purchase.id,createdAt:new Date().toISOString()});
    saveAndRender('خرید ثبت شد و موجودی انبار افزایش یافت.');
  });
}

function openPurchasePaymentForm(purchase) {
  const remain=Math.max(0,purchase.total-purchase.paid);if(!remain)return toast('این فاکتور تسویه شده است.','error');
  const body=`<div class="notice">مانده فاکتور ${escapeHTML(purchase.number)} · ${escapeHTML(purchase.supplier)}: <strong>${money(remain)}</strong></div><div class="form-grid">${field('مبلغ پرداختی','amount',remain,'number',`min="1" max="${remain}" step="1" required`)}${field('تاریخ پرداخت','date',todayISO(),'date','required')}</div>`;
  modal('ثبت پرداخت تأمین‌کننده',body,'ثبت پرداخت',async(data)=>{const amount=toNumber(data.get('amount'));if(amount<=0||amount>remain)throw new Error('مبلغ واردشده معتبر نیست یا از مانده فاکتور بیشتر است.');purchase.paid+=amount;state.cash.push({id:uid(),date:data.get('date'),type:'out',category:'پرداخت خرید',description:`پرداخت تکمیلی ${purchase.number} · ${purchase.supplier}`,amount,ref:purchase.id,createdAt:new Date().toISOString()});saveAndRender('پرداخت تأمین‌کننده ثبت شد.');});
}

function addOrderLine(container, selectedId='', qty='1') {
  const row=document.createElement('div');row.className='order-item-row';row.innerHTML=`<div class="field"><label>کالا</label><select class="line-product" required><option value="">انتخاب کالا</option>${state.products.map(p=>`<option value="${p.id}" ${p.id===selectedId?'selected':''}>${escapeHTML(p.name)} · موجودی ${number(p.stock)}</option>`).join('')}</select></div><div class="field"><label>تعداد</label><input class="line-qty" type="number" min="1" step="1" value="${qty}" required></div><div class="field"><label>قیمت واحد</label><input class="line-price" type="number" min="0" step="1" value="${selectedId?productById(selectedId)?.price||0:0}" required></div><button class="remove-line" type="button" title="حذف قلم">×</button>`;
  container.appendChild(row);
  $('.line-product',row).addEventListener('change',()=>{const product=productById($('.line-product',row).value);$('.line-price',row).value=product?product.price:0;updateOrderPreview();});
  $('.line-qty',row).addEventListener('input',updateOrderPreview);$('.line-price',row).addEventListener('input',updateOrderPreview);
  $('.remove-line',row).addEventListener('click',()=>{row.remove();updateOrderPreview();});
  updateOrderPreview();
}

function updateOrderPreview() {
  const rows=$$('.order-item-row',$('#modalForm'));
  const subtotal=rows.reduce((total,row)=>total+toNumber($('.line-qty',row).value)*toNumber($('.line-price',row).value),0);
  const discount=toNumber($('[name="discount"]')?.value), shipping=toNumber($('[name="shipping"]')?.value);
  const total=Math.max(0,subtotal-discount+shipping);
  const preview=$('#orderPreview'); if(preview) preview.innerHTML=`<span>جمع سفارش</span><strong>${money(total)}</strong>`;
  const paid=$('[name="paid"]'); if(paid){paid.max=total;$('#paidHint').textContent=`حداکثر مبلغ قابل ثبت: ${money(total)}`;}
}

function openOrderForm() {
  if(!state.products.length) return toast('ابتدا حداقل یک کالا تعریف کن.','error');
  const customerOptions=state.customers.map(c=>`<option value="${c.id}">${escapeHTML(c.name)} ${c.phone?`· ${escapeHTML(c.phone)}`:''}</option>`).join('');
  const body=`<div class="form-grid"><div class="field"><label>مشتری</label><select name="customerId"><option value="">مشتری حضوری / ثبت‌نشده</option>${customerOptions}</select></div>${field('تاریخ سفارش','date',todayISO(),'date','required')}<div class="field full"><label>اقلام سفارش</label><div class="line-items" id="orderLines"></div><button type="button" class="btn btn-secondary btn-small" id="addOrderLine" style="margin-top:8px;align-self:flex-start">＋ افزودن قلم کالا</button></div>${field('تخفیف','discount','0','number','min="0" step="1"')}${field('هزینه ارسال','shipping','0','number','min="0" step="1"')}${field('مبلغ دریافت‌شده','paid','0','number','min="0" step="1" required')}<div class="field"><label>وضعیت سفارش</label><select name="status"><option value="registered">ثبت‌شده</option><option value="processing">در حال آماده‌سازی</option><option value="shipped">ارسال‌شده</option><option value="delivered">تحویل‌شده</option></select></div><div class="field full"><label>یادداشت سفارش</label><textarea name="notes" placeholder="کد رهگیری، توضیح ارسال و ..."></textarea></div></div><div class="order-total-strip" id="orderPreview"><span>جمع سفارش</span><strong>۰</strong></div><div class="field-note" id="paidHint" style="margin-top:7px">موجودی کالا پس از ثبت سفارش کسر می‌شود.</div>`;
  modal('ثبت سفارش جدید',body,'ثبت سفارش',async(data)=>{
    const rows=$$('.order-item-row',$('#modalForm'));if(!rows.length)throw new Error('حداقل یک قلم کالا اضافه کن.');
    const items=rows.map(row=>{const product=productById($('.line-product',row).value);const qty=toNumber($('.line-qty',row).value),price=toNumber($('.line-price',row).value);if(!product||qty<=0)throw new Error('اطلاعات قلم سفارش کامل نیست.');return {productId:product.id,name:product.name,qty,price,cost:product.cost};});
    const qtyByProduct=new Map();items.forEach(item=>qtyByProduct.set(item.productId,(qtyByProduct.get(item.productId)||0)+item.qty));
    for(const [productId,qty] of qtyByProduct){const product=productById(productId);if(product.stock<qty)throw new Error(`موجودی «${product.name}» کافی نیست؛ موجودی فعلی ${number(product.stock)} و تعداد درخواستی ${number(qty)} است.`);}
    const subtotal=sum(items,i=>i.qty*i.price),discount=toNumber(data.get('discount')),shipping=toNumber(data.get('shipping')),total=Math.max(0,subtotal-discount+shipping),paid=toNumber(data.get('paid'));
    if(discount>subtotal)throw new Error('تخفیف نباید از جمع کالاها بیشتر باشد.');if(paid>total)throw new Error('مبلغ دریافتی نمی‌تواند از مبلغ سفارش بیشتر باشد.');
    const customer=customerById(data.get('customerId'));
    const order={id:uid(),number:`SO-${String(state.orders.length+1).padStart(5,'0')}`,customerId:customer?.id||'',customerName:customer?.name||'مشتری حضوری',date:data.get('date'),items,subtotal,discount,shipping,total,paid,status:data.get('status'),notes:data.get('notes').trim(),createdAt:new Date().toISOString()};
    items.forEach(item=>{const product=productById(item.productId);product.stock-=item.qty;state.movements.push({id:uid(),date:order.date,productId:product.id,productName:product.name,type:'out',qty:item.qty,reason:`فروش ${order.number}`});});
    state.orders.push(order);
    if(paid>0)state.cash.push({id:uid(),date:order.date,type:'in',category:'دریافت فروش',description:`دریافت سفارش ${order.number} · ${order.customerName}`,amount:paid,ref:order.id,createdAt:new Date().toISOString()});
    saveAndRender('سفارش ثبت شد؛ موجودی و دفتر مالی به‌روزرسانی شدند.');
  },{wide:true});
  const container=$('#orderLines');addOrderLine(container);
  $('#addOrderLine').addEventListener('click',()=>addOrderLine(container));
  ['discount','shipping','paid'].forEach(name=>$(`[name="${name}"]`).addEventListener('input',updateOrderPreview));
}

 function printInvoice(order) {   const customer = customerById(order.customerId);   const rows = order.items.map((item,index)=>`     <tr>       <td>${index+1}</td>       <td>${escapeHTML(item.name)}</td>       <td>${number(item.qty)}</td>       <td>${money(item.price)}</td>       <td>${money(item.qty*item.price)}</td>     </tr>   `).join('');    const subtotal = order.subtotal ?? sum(order.items,i=>i.qty*i.price);   const discount = order.discount || 0;   const shipping = order.shipping || 0;   const total = order.total || 0;   const paid = order.paid || 0;   const remaining = Math.max(0,total-paid);    const printable = `   <style>     @page { size:A4; margin:14mm; }     .invoice {max-width:850px;margin:auto;color:#17283d;font-family:Tahoma,Arial,sans-serif}     .invoice-head {display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #168f83;padding-bottom:18px}     .invoice h1 {font-size:24px;margin:0 0 8px}     .invoice h2 {font-size:17px;margin:0 0 8px}     .invoice p {font-size:12px;line-height:2;margin:4px 0}     .invoice .muted {color:#718096}     .invoice .info {display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:22px 0}     .invoice .box {border:1px solid #dfe7ee;border-radius:8px;padding:13px}     .invoice table {width:100%;border-collapse:collapse;margin:20px 0}     .invoice th {background:#edf5f4;color:#263d4c}     .invoice th,.invoice td {border:1px solid #dfe7ee;padding:11px 8px;text-align:right;font-size:11px}     .invoice .totals {width:340px;max-width:100%;margin-right:auto}     .invoice .totals div {display:flex;justify-content:space-between;padding:7px;border-bottom:1px solid #e7edf3;font-size:12px}     .invoice .grand {font-weight:bold;font-size:15px;background:#edf8f5}     .invoice .footer {display:flex;justify-content:space-between;margin-top:55px}     .invoice .sign {width:42%;border-top:1px solid #aeb9c5;text-align:center;padding-top:10px;font-size:11px}     .invoice .cancelled {color:#bd3f4d;font-weight:bold;border:2px solid #bd3f4d;padding:8px}     @media print {body{padding:0!important}.invoice{width:100%}}   </style>    <section class="invoice">     <div class="invoice-head">       <div>         <h1>${escapeHTML(state.settings.storeName || 'فروشگاه تجهیزات شنا')}</h1>         <p>تلفن: ${escapeHTML(state.settings.phone || '—')}</p>       </div>       <div style="text-align:left">         <h2>فاکتور فروش</h2>         <p>شماره: ${escapeHTML(order.number)}</p>         <p>تاریخ: ${shortDate(order.date)}</p>         ${isCancelled(order)?'<p class="cancelled">این سفارش لغو شده است</p>':''}       </div>     </div>      <div class="info">       <div class="box">         <strong>مشخصات فروشنده</strong>         <p>${escapeHTML(state.settings.storeName || 'فروشگاه')}</p>         <p>تلفن: ${escapeHTML(state.settings.phone || '—')}</p>       </div>       <div class="box">         <strong>مشخصات خریدار</strong>         <p>نام: ${escapeHTML(order.customerName || 'مشتری حضوری')}</p>         <p>تلفن: ${escapeHTML(customer?.phone || '—')}</p>         <p>نشانی: ${escapeHTML(customer?.address || '—')}</p>       </div>     </div>      <table>       <thead>         <tr>           <th>ردیف</th><th>شرح کالا</th><th>تعداد</th>           <th>قیمت واحد</th><th>مبلغ کل</th>         </tr>       </thead>       <tbody>${rows}</tbody>     </table>      <div class="totals">       <div><span>جمع کالاها</span><strong>${money(subtotal)}</strong></div>       <div><span>تخفیف</span><strong>${money(discount)}</strong></div>       <div><span>هزینه ارسال</span><strong>${money(shipping)}</strong></div>       <div class="grand"><span>مبلغ نهایی</span><strong>${money(total)}</strong></div>       <div><span>مبلغ پرداخت‌شده</span><strong>${money(paid)}</strong></div>       <div><span>مانده حساب</span><strong>${money(remaining)}</strong></div>     </div>      ${order.notes?`<p style="margin-top:20px">توضیحات: ${escapeHTML(order.notes)}</p>`:''}      <div class="footer">       <div class="sign">امضای خریدار</div>       <div class="sign">مهر و امضای فروشنده</div>     </div>   </section>`;    printHtml(printable); }  function viewOrder(order) {
  const rows=order.items.map(item=>`<tr><td class="primary-cell">${escapeHTML(item.name)}</td><td>${number(item.qty)}</td><td>${money(item.price)}</td><td>${money(item.qty*item.price)}</td></tr>`).join('');
  const payments=state.cash.filter(entry=>entry.ref===order.id&&entry.type==='in');
  const body=`<div class="activity-list" style="margin-bottom:16px"><div class="activity-item"><div><strong>${escapeHTML(order.number)}</strong><small>${shortDate(order.date)} · ${escapeHTML(order.customerName)}</small></div><span class="activity-amount">${statusBadge(order.status)}</span></div></div><div class="table-wrap"><table><thead><tr><th>کالا</th><th>تعداد</th><th>قیمت واحد</th><th>جمع</th></tr></thead><tbody>${rows}</tbody></table></div><div class="activity-list" style="margin-top:16px"><div class="activity-item"><div><strong>جمع کالاها</strong></div><span class="activity-amount">${money(order.subtotal)}</span></div><div class="activity-item"><div><strong>تخفیف و ارسال</strong></div><span class="activity-amount">−${money(order.discount)} / +${money(order.shipping)}</span></div><div class="activity-item"><div><strong>مبلغ نهایی</strong></div><span class="activity-amount">${money(order.total)}</span></div><div class="activity-item"><div><strong>پرداختی / مانده</strong></div><span class="activity-amount">${money(order.paid)} / ${money(order.total-order.paid)}</span></div></div>${order.notes?`<p class="field-note">یادداشت: ${escapeHTML(order.notes)}</p>`:''}${!isCancelled(order)?`<div class="form-grid" style="margin-top:15px"><div class="field"><label>به‌روزرسانی وضعیت سفارش</label><select id="orderStatusSelect"><option value="registered" ${order.status==='registered'?'selected':''}>ثبت‌شده</option><option value="processing" ${order.status==='processing'?'selected':''}>در حال آماده‌سازی</option><option value="shipped" ${order.status==='shipped'?'selected':''}>ارسال‌شده</option><option value="delivered" ${order.status==='delivered'?'selected':''}>تحویل‌شده</option></select></div><div class="field" style="justify-content:end"><button class="btn btn-secondary" type="button" data-update-order-status="${order.id}">ذخیره وضعیت</button></div></div>`:''}<div class="settings-actions" style="margin-top:15px"><button class="btn btn-secondary" type="button" data-print-order="${order.id}">چاپ فاکتور</button>${!isCancelled(order)?`<button class="btn btn-secondary" type="button" data-add-payment="${order.id}">＋ ثبت دریافت تکمیلی</button>`:''}</div>`;
  modal(`جزئیات سفارش ${order.number}`,body,'بستن',async()=>true,{wide:true});
  const form=$('#modalForm');$('button[type="submit"]',form).textContent='بستن';
  $('[data-print-order]',form).addEventListener('click',()=>printInvoice(order));('click',()=>{const printable=`<h2>فاکتور ${escapeHTML(order.number)}</h2><p>${escapeHTML(order.customerName)} | ${shortDate(order.date)}</p><table border="1" cellpadding="8" cellspacing="0"><tr><th>کالا</th><th>تعداد</th><th>قیمت</th><th>جمع</th></tr>${rows}</table><h3>مبلغ نهایی: ${money(order.total)}</h3>`;printHtml(printable);});
  $('[data-add-payment]',form)?.addEventListener('click',()=>{closeModal();openPaymentForm(order);});
  $('[data-update-order-status]',form)?.addEventListener('click',()=>{order.status=$('#orderStatusSelect').value;order.updatedAt=new Date().toISOString();persist().then(()=>{closeModal();updateSidebarMeta();render();toast('وضعیت سفارش به‌روزرسانی شد.');}).catch(()=>toast('ذخیره وضعیت ناموفق بود.','error'));});
}

function openPaymentForm(order) {
  const remain=Math.max(0,order.total-order.paid);if(!remain)return toast('این سفارش تسویه شده است.','error');
  const body=`<div class="notice">مانده سفارش ${escapeHTML(order.number)}: <strong>${money(remain)}</strong></div><div class="form-grid">${field('مبلغ دریافتی','amount',remain,'number',`min="1" max="${remain}" step="1" required`)}${field('تاریخ دریافت','date',todayISO(),'date','required')}</div>`;
  modal('ثبت دریافت تکمیلی',body,'ثبت دریافت',async(data)=>{const amount=toNumber(data.get('amount'));if(amount<=0||amount>remain)throw new Error('مبلغ واردشده بیشتر از مانده سفارش است یا معتبر نیست.');order.paid+=amount;state.cash.push({id:uid(),date:data.get('date'),type:'in',category:'دریافت فروش',description:`دریافت تکمیلی ${order.number}`,amount,ref:order.id,createdAt:new Date().toISOString()});saveAndRender('دریافت وجه ثبت شد.');});
}

function cancelOrder(order) {
  if(!confirm(`سفارش ${order.number} لغو شود؟ موجودی کالا به انبار برمی‌گردد و مبلغ دریافتی به‌عنوان بازپرداخت از صندوق ثبت می‌شود.`))return;
  order.items.forEach(item=>{const product=productById(item.productId);if(product){product.stock+=item.qty;state.movements.push({id:uid(),date:todayISO(),productId:product.id,productName:product.name,type:'in',qty:item.qty,reason:`برگشت از سفارش لغوشده ${order.number}`});}});
  if(order.paid>0)state.cash.push({id:uid(),date:todayISO(),type:'out',category:'بازپرداخت فروش',description:`بازپرداخت سفارش لغوشده ${order.number}`,amount:order.paid,ref:`refund-${order.id}`,createdAt:new Date().toISOString()});
  order.status='cancelled';order.cancelledAt=new Date().toISOString();saveAndRender('سفارش لغو شد، موجودی برگشت خورد و بازپرداخت در صندوق ثبت شد.');
}

function openExpenseForm() {
  const categories=['بسته‌بندی','ارسال و پست','تبلیغات','اجاره و قبوض','حقوق و دستمزد','کارمزد درگاه','تجهیزات و ملزومات','سایر'];
  const body=`<div class="form-grid">${field('شرح هزینه *','title','','text','required maxlength="100"')}<div class="field"><label>دسته‌بندی</label><select name="category">${categories.map(c=>`<option>${c}</option>`).join('')}</select></div>${field('مبلغ *','amount','','number','min="1" step="1" required')}${field('تاریخ پرداخت','date',todayISO(),'date','required')}<div class="field full"><label>یادداشت</label><textarea name="notes"></textarea></div></div>`;
  modal('ثبت هزینه جدید',body,'ثبت هزینه',async(data)=>{const amount=toNumber(data.get('amount'));if(amount<=0)throw new Error('مبلغ باید بیشتر از صفر باشد.');const expense={id:uid(),title:data.get('title').trim(),category:data.get('category'),amount,date:data.get('date'),notes:data.get('notes').trim(),createdAt:new Date().toISOString()};state.expenses.push(expense);state.cash.push({id:uid(),date:expense.date,type:'out',category:expense.category,description:expense.title,amount,ref:expense.id,createdAt:new Date().toISOString()});saveAndRender('هزینه ثبت و از صندوق کسر شد.');});
}

function openCashForm() {
  const body=`<div class="form-grid"><div class="field"><label>نوع تراکنش</label><select name="type"><option value="in">دریافت</option><option value="out">پرداخت</option></select></div>${field('مبلغ *','amount','','number','min="1" step="1" required')}${field('شرح تراکنش *','description','','text','required')}${field('دسته‌بندی','category','سایر')}${field('تاریخ','date',todayISO(),'date','required')}<div class="field-note full">برای فروش، خرید و هزینه‌ها از فرم مخصوص همان بخش استفاده کن تا گزارش‌ها و سوابق به شکل دقیق‌تری ثبت شوند.</div></div>`;
  modal('ثبت دستی دریافت / پرداخت',body,'ثبت تراکنش',async(data)=>{const amount=toNumber(data.get('amount'));if(amount<=0)throw new Error('مبلغ باید بیشتر از صفر باشد.');state.cash.push({id:uid(),date:data.get('date'),type:data.get('type'),category:data.get('category').trim()||'سایر',description:data.get('description').trim(),amount,ref:'manual',createdAt:new Date().toISOString()});saveAndRender('تراکنش مالی ثبت شد.');});
}

function exportBackup() {
  const payload={app:'swim-store-manager',version:1,exportedAt:new Date().toISOString(),state};
  downloadFile(`store-backup-${todayISO()}.json`,JSON.stringify(payload,null,2),'application/json');toast('نسخه پشتیبان آماده شد.');
}
function downloadFile(filename, content, mime) {
  const blob=new Blob([content],{type:`${mime};charset=utf-8`});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function exportProductsCSV() {
  const rows=[['نام کالا','SKU','بارکد','دسته‌بندی','برند','مدل','رنگ','سایز','واحد','قیمت خرید','قیمت فروش','موجودی','حد هشدار','تأمین‌کننده','محل نگهداری','توضیحات'],...state.products.map(p=>[p.name,p.sku,p.barcode,p.category,p.brand,p.model,p.color,p.size,p.unit,p.cost,p.price,p.stock,p.minStock,p.supplier,p.location,p.notes])];
  const csv='\uFEFF'+rows.map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');downloadFile(`products-${todayISO()}.csv`,csv,'text/csv');toast('خروجی کامل CSV کالاها آماده شد.');
}

function importBackup(file) {
  if (!file) return;

  if (file.size > 50 * 1024 * 1024) {
    toast('حجم فایل پشتیبان نباید بیشتر از ۵۰ مگابایت باشد.', 'error');
    return;
  }

  const reader = new FileReader();

  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);

      if (
        parsed.app && parsed.app !== 'swim-store-manager'
      ) {
        throw new Error('این فایل متعلق به اپ مدیریت فروشگاه شنا نیست.');
      }

      const imported = parsed.state || parsed;
      const keys = [
        'products',
        'orders',
        'customers',
        'purchases',
        'expenses',
        'movements',
        'cash'
      ];

      if (
        !imported ||
        !imported.settings ||
        typeof imported.settings !== 'object' ||
        keys.some(key => !Array.isArray(imported[key]))
      ) {
        throw new Error('ساختار فایل پشتیبان معتبر نیست.');
      }

      const summary = keys.map(
        key => `${key}: ${imported[key].length}`
      ).join('\n');

      const choice = prompt(
        'فایل پشتیبان معتبر است.\n\n' +
        'تعداد اطلاعات داخل فایل:\n' + summary +
        '\n\nروش بازیابی را انتخاب کن:\n' +
        '1 = ادغام با اطلاعات فعلی (پیشنهادی)\n' +
        '2 = جایگزینی کامل اطلاعات فعلی\n' +
        'لغو = انصراف'
      );

      if (choice !== '1' && choice !== '2') return;

      if (
        choice === '2' &&
        !confirm(
          'هشدار: تمام اطلاعات فعلی با اطلاعات بک‌آپ جایگزین می‌شوند. ادامه می‌دهی؟'
        )
      ) return;

      const safetyBackup = {
        app: 'swim-store-manager',
        version: 1,
        exportedAt: new Date().toISOString(),
        state: state
      };

      const blob = new Blob(
        [JSON.stringify(safetyBackup, null, 2)],
        { type: 'application/json;charset=utf-8' }
      );

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'swim-store-before-restore.json';
      link.click();
      URL.revokeObjectURL(url);

      if (choice === '2') {
        state = {
          ...defaultState(),
          ...imported,
          settings: {
            ...defaultState().settings,
            ...imported.settings
          }
        };
      } else {
        const merged = { ...state };

        keys.forEach(key => {
          const current = Array.isArray(state[key]) ? state[key] : [];
          const incoming = imported[key];
          const result = [...current];
          const ids = new Set(
            current.filter(item => item.id != null).map(item => item.id)
          );

          incoming.forEach(item => {
            if (item.id == null || !ids.has(item.id)) {
              result.push(item);
              if (item.id != null) ids.add(item.id);
            } else if (key === 'products') {
              const index = result.findIndex(
                existing => existing.id === item.id
              );

              const product = result[index];
              [
                'barcode',
                'brand',
                'model',
                'color',
                'size',
                'supplier',
                'location',
                'imageData'
              ].forEach(field => {
                if (!product[field] && item[field]) {
                  product[field] = item[field];
                }
              });
            }
          });

          merged[key] = result;
        });

        state = merged;
      }

      await persist();
      updateSidebarMeta();
      render();

      toast(
        choice === '1'
          ? 'اطلاعات بک‌آپ با موفقیت ادغام شد.'
          : 'اطلاعات بک‌آپ بازیابی شد.'
      );

    } catch (error) {
      toast(error.message || 'خواندن فایل ناموفق بود.', 'error');
    }
  };

  reader.readAsText(file, 'UTF-8');
}

function printHtml(content) {
  const win=window.open('','_blank');if(!win){toast('اجازه بازشدن پنجره چاپ را به مرورگر بده.','error');return;}win.document.write(`<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>چاپ</title><body style="font-family:Tahoma,sans-serif;padding:24px;color:#15243a">${content}<script>window.onload=()=>window.print()<\/script></body></html>`);win.document.close();
}

function bindGlobalEvents() {
  document.addEventListener('click',(event)=>{
    const nav=event.target.closest('[data-view]');if(nav){changeView(nav.dataset.view);return;}
    const button=event.target.closest('[data-action]');if(!button)return;
    const action=button.dataset.action,id=button.dataset.id;
    if(action==='new-product')openProductForm();
    if(action==='edit-product')openProductForm(productById(id));
    if(action==='stock-product')openStockForm(productById(id));
    if(action==='new-purchase')openPurchaseForm();
    if(action==='pay-purchase')openPurchasePaymentForm(state.purchases.find(p=>p.id===id));
    if(action==='new-order')openOrderForm();
    if(action==='view-order')viewOrder(state.orders.find(o=>o.id===id));
    if(action==='cancel-order')cancelOrder(state.orders.find(o=>o.id===id));
    if(action==='new-customer')openCustomerForm();
    if(action==='edit-customer')openCustomerForm(customerById(id));
    if(action==='new-expense')openExpenseForm();
    if(action==='new-cash')openCashForm();
    if(action==='open-backup')changeView('settings');
    if(action==='export-backup')exportBackup();
    if(action==='import-backup')$('#importFile').click();
    if(action==='export-csv')exportProductsCSV();
    if(action==='print')window.print();
  });
  document.addEventListener('input',(event)=>{if(event.target.id==='tableSearch'){searchTerm=event.target.value;const cursor=event.target.selectionStart;render();const replacement=$('#tableSearch');replacement.focus();replacement.setSelectionRange(cursor,cursor);}});
  $('#quickBackup').addEventListener('click',exportBackup);
  $('#mobileMenu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
  $('#importFile').addEventListener('change',(event)=>{const file=event.target.files?.[0];if(file)importBackup(file);event.target.value='';});
  $('#content').addEventListener('submit',(event)=>{if(event.target.id!=='settingsForm')return;event.preventDefault();const data=new FormData(event.target);state.settings={...state.settings,storeName:data.get('storeName').trim(),phone:data.get('phone').trim(),currency:data.get('currency'),lowStockDefault:toNumber(data.get('lowStockDefault'))};saveAndRender('تنظیمات ذخیره شد.');});
  document.addEventListener('keydown',(event)=>{if(event.key==='Escape')closeModal();});
}

async function init() {
  try {
    if(!('indexedDB' in window)) throw new Error('مرورگر از ذخیره‌سازی محلی پشتیبانی نمی‌کند.');
    db=await openDatabase();
    if(navigator.storage?.persist) { try { await navigator.storage.persist(); } catch (_) {} }
    const saved=await readSavedState();if(saved)state={...defaultState(),...saved,settings:{...defaultState().settings,...saved.settings}};
    else await persist();
    bindGlobalEvents();updateSidebarMeta();render();
  } catch(error) {
    console.error(error);
    $('#content').innerHTML=`<div class="panel" style="padding:30px"><h2>ذخیره‌سازی در دسترس نیست</h2><p>برای استفاده از برنامه، آن را از طریق یک نشانی محلی یا HTTPS باز کن. بازکردن مستقیم فایل ممکن است دسترسی به پایگاه داده را محدود کند.</p><p>${escapeHTML(error.message||'خطای ناشناخته')}</p></div>`;
  }
}

init();
