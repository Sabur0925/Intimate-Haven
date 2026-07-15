/* =========================================================================
   INTIMATE HAVEN — Quotation & Invoicing app
   Talks to a Google Apps Script Web App (Sheets-backed) over fetch/JSON.
   ========================================================================= */

const CONFIG = {
  // Paste your deployed Apps Script Web App URL here (ends in /exec)
  API_URL: 'https://script.google.com/macros/s/AKfycby4K6-R-c-6VLi8ndv-gkfJ8lJIApETRjdKyol8odVS8JXh93cbN79LTqRws0JwiL0Y/exec'
};

// NGN/GHS/KES are spelled out ("NGN ", not "₦") on purpose: the PDF export
// rasterizes the page with html2canvas before fonts always finish loading,
// and those glyphs are the ones most likely to come out as a broken box.
// Plain letters always render correctly in every font, on every device.
const CURRENCIES = {
  NGN: { symbol: 'NGN ', label: 'Naira' },
  USD: { symbol: '$', label: 'US Dollar' },
  GBP: { symbol: '£', label: 'Pound' },
  EUR: { symbol: '€', label: 'Euro' },
  GHS: { symbol: 'GHS ', label: 'Cedi' },
  KES: { symbol: 'KES ', label: 'Kenyan Shilling' },
  ZAR: { symbol: 'R', label: 'Rand' }
};

const state = {
  token: localStorage.getItem('ih_token') || null,
  user: JSON.parse(localStorage.getItem('ih_user') || 'null'),
  settings: null,
  clients: [],
  products: [],
  quotes: [],
  invoices: [],
  orders: [],
  view: 'dashboard'
};

/* ---------------------------------------------------------------------- */
/* API helper                                                              */
/* ---------------------------------------------------------------------- */

async function api(action, payload) {
  if (CONFIG.API_URL.indexOf('PASTE_YOUR') === 0) {
    toast('Backend not configured yet — set CONFIG.API_URL in app.js');
    return { ok: false, error: 'Backend URL not configured.' };
  }
  const body = Object.assign({ action, token: state.token }, payload || {});
  try {
    const res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight on Apps Script
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!data.ok && data.error === 'Session expired. Please log in again.') {
      logout(true);
    }
    return data;
  } catch (err) {
    toast('Network error — check your connection.');
    return { ok: false, error: String(err) };
  }
}

/* ---------------------------------------------------------------------- */
/* Boot                                                                    */
/* ---------------------------------------------------------------------- */

window.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  if (state.token && state.user) {
    renderApp();
    loadAllData();
  } else {
    renderLogin();
  }
});

/* ---------------------------------------------------------------------- */
/* Login                                                                   */
/* ---------------------------------------------------------------------- */

function renderLogin() {
  document.getElementById('app').innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <img class="brand-mark" src="icons/logo.png" alt="Intimate Haven" />
        <div class="tagline">elevating comfort, inspiring wellness…</div>
        <form id="loginForm">
          <div class="field">
            <label>Username</label>
            <input type="text" id="loginUser" autocomplete="username" required />
          </div>
          <div class="field">
            <label>Password</label>
            <input type="password" id="loginPass" autocomplete="current-password" required />
          </div>
          <button type="submit" class="btn btn-primary" id="loginBtn">Sign in</button>
          <div class="login-error" id="loginError"></div>
        </form>
        <div class="login-hint">Staff accounts are created by an admin in Settings.</div>
      </div>
    </div>
  `;
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    const btn = document.getElementById('loginBtn');
    const errBox = document.getElementById('loginError');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    const res = await api('login', { username, password });
    btn.disabled = false; btn.innerHTML = 'Sign in';
    if (res.ok) {
      state.token = res.token;
      state.user = res.user;
      localStorage.setItem('ih_token', res.token);
      localStorage.setItem('ih_user', JSON.stringify(res.user));
      renderApp();
      loadAllData();
    } else {
      errBox.textContent = res.error || 'Login failed.';
    }
  });
}

function logout(silent) {
  if (!silent) api('logout', {});
  state.token = null; state.user = null;
  localStorage.removeItem('ih_token'); localStorage.removeItem('ih_user');
  renderLogin();
}

/* ---------------------------------------------------------------------- */
/* App shell                                                               */
/* ---------------------------------------------------------------------- */

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: '◆' },
  { id: 'products', label: 'Products', icon: '❖' },
  { id: 'quotes', label: 'Quotations', icon: '▤' },
  { id: 'orders', label: 'Orders', icon: '⬢' },
  { id: 'invoices', label: 'Invoices', icon: '▥' },
  { id: 'clients', label: 'Clients', icon: '◐' },
  { id: 'reports', label: 'Reports', icon: '▲' },
  { id: 'settings', label: 'Settings', icon: '✦' }
];

function renderApp() {
  document.getElementById('app').innerHTML = `
    <div class="topbar">
      <img class="brand-mark" src="icons/logo.png" alt="" />
      <div class="brand-text">
        <div class="name">Intimate Haven</div>
        <div class="tag">elevating comfort, inspiring wellness…</div>
      </div>
      <div class="spacer"></div>
      <div class="user-chip">
        <span>${escapeHtml(state.user.name)} · ${escapeHtml(state.user.role)}</span>
        <button id="logoutBtn">Sign out</button>
      </div>
    </div>
    <div class="layout">
      <nav class="tabs">
        ${NAV_ITEMS.map(n => `
          <button data-view="${n.id}" class="${state.view === n.id ? 'active' : ''}">${n.icon}&nbsp;&nbsp;${n.label}</button>
        `).join('')}
      </nav>
      <main class="content" id="content"></main>
    </div>
    <nav class="bottom-tabs">
      ${NAV_ITEMS.map(n => `
        <button data-view="${n.id}" class="${state.view === n.id ? 'active' : ''}">
          <span class="ic">${n.icon}</span>${n.label}
        </button>
      `).join('')}
    </nav>
    <div id="toast" class="toast"></div>
    <div id="printArea"></div>
  `;
  document.getElementById('logoutBtn').addEventListener('click', () => logout());
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => { state.view = btn.dataset.view; renderApp(); renderView(); });
  });
  renderView();
}

async function loadAllData() {
  showLoading();
  const [settingsRes, clientsRes, productsRes, quotesRes, invoicesRes, ordersRes] = await Promise.all([
    api('getSettings', {}), api('listClients', {}), api('listProducts', {}), api('listQuotes', {}), api('listInvoices', {}), api('listOrders', {})
  ]);
  if (settingsRes.ok) state.settings = settingsRes.settings;
  if (clientsRes.ok) state.clients = clientsRes.clients;
  if (productsRes.ok) state.products = productsRes.products;
  if (quotesRes.ok) state.quotes = quotesRes.quotes.reverse();
  if (invoicesRes.ok) state.invoices = invoicesRes.invoices.reverse();
  if (ordersRes.ok) state.orders = ordersRes.orders.reverse();
  renderView();
}

function showLoading() {
  const c = document.getElementById('content');
  if (c) c.innerHTML = `<div class="empty-state">Loading your workspace…</div>`;
}

function renderView() {
  const c = document.getElementById('content');
  if (!c) return;
  if (state.view === 'dashboard') return renderDashboard(c);
  if (state.view === 'quotes') return renderQuotesList(c);
  if (state.view === 'invoices') return renderInvoicesList(c);
  if (state.view === 'orders') return renderOrders(c);
  if (state.view === 'clients') return renderClients(c);
  if (state.view === 'products') return renderProducts(c);
  if (state.view === 'reports') return renderReports(c);
  if (state.view === 'settings') return renderSettings(c);
}

/* ---------------------------------------------------------------------- */
/* Dashboard                                                               */
/* ---------------------------------------------------------------------- */

function renderDashboard(c) {
  const outstanding = state.invoices.filter(i => i.status !== 'paid')
    .reduce((sum, i) => sum + (Number(i.total) - Number(i.amountPaid || 0)), 0);
  const paidCount = state.invoices.filter(i => i.status === 'paid').length;
  const draftQuotes = state.quotes.filter(q => q.status === 'draft' || q.status === 'sent').length;

  c.innerHTML = `
    <div class="section-title">Welcome back, ${escapeHtml(state.user.name.split(' ')[0])}</div>
    <div class="section-sub">Here's what's happening across your quotes and invoices.</div>
    <div class="grid-3">
      <div class="card"><div class="muted" style="font-size:12.5px;">Open quotations</div><div class="display" style="font-size:32px;margin-top:6px;">${draftQuotes}</div></div>
      <div class="card"><div class="muted" style="font-size:12.5px;">Invoices paid</div><div class="display" style="font-size:32px;margin-top:6px;">${paidCount}</div></div>
      <div class="card"><div class="muted" style="font-size:12.5px;">Outstanding balance</div><div class="display" style="font-size:32px;margin-top:6px;">${formatMoneyMixed(outstanding)}</div></div>
    </div>
    <div class="card" style="margin-top:16px;">
      <h3>Quick actions</h3>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;">
        <button class="btn btn-primary" id="qaQuote">+ New quotation</button>
        <button class="btn btn-ghost" id="qaInvoice">+ New invoice</button>
        <button class="btn btn-ghost" id="qaClient">+ Add client</button>
        <button class="btn btn-ghost" id="qaProduct">+ Add product</button>
      </div>
    </div>
    <div class="card" style="margin-top:16px;">
      <h3>Recent activity</h3>
      ${renderRecentTable()}
    </div>
  `;
  document.getElementById('qaQuote').addEventListener('click', () => openDocEditor('quote'));
  document.getElementById('qaInvoice').addEventListener('click', () => openDocEditor('invoice'));
  document.getElementById('qaClient').addEventListener('click', () => openClientModal());
  document.getElementById('qaProduct').addEventListener('click', () => openProductModal());
}

function renderRecentTable() {
  const items = [
    ...state.quotes.map(q => ({ ...q, kind: 'Quote' })),
    ...state.invoices.map(i => ({ ...i, kind: 'Invoice' }))
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8);
  if (!items.length) return `<div class="empty-state">Nothing yet — create your first quotation or invoice.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Type</th><th>Number</th><th>Client</th><th>Total</th><th>Status</th></tr></thead><tbody>
    ${items.map(i => `<tr><td>${i.kind}</td><td>${i.number}</td><td>${escapeHtml(i.clientName)}</td><td>${formatMoney(i.total, i.currency)}</td><td><span class="badge badge-${i.status}">${i.status}</span></td></tr>`).join('')}
  </tbody></table></div>`;
}

/* ---------------------------------------------------------------------- */
/* Utilities: money / dates / toast                                       */
/* ---------------------------------------------------------------------- */

function formatMoney(amount, currency) {
  const sym = (CURRENCIES[currency] || {}).symbol || (currency ? currency + ' ' : '');
  return sym + Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatMoneyMixed(amount) {
  return Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return alert(msg);
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------------------------------------------------------------------- */
/* Clients                                                                 */
/* ---------------------------------------------------------------------- */

function renderClients(c) {
  c.innerHTML = `
    <div class="flex-between">
      <div><div class="section-title">Clients</div><div class="section-sub">Everyone you send quotes and invoices to.</div></div>
      <button class="btn btn-primary" id="addClientBtn">+ Add client</button>
    </div>
    <div class="card">
      ${state.clients.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Address</th><th></th></tr></thead><tbody>
        ${state.clients.map(cl => `<tr>
          <td>${escapeHtml(cl.name)}</td><td>${escapeHtml(cl.phone)}</td><td>${escapeHtml(cl.email)}</td><td>${escapeHtml(cl.address)}</td>
          <td class="row-actions">
            <button class="link-btn" data-edit="${cl.id}">Edit</button>
            <button class="link-btn" style="color:var(--danger)" data-del="${cl.id}">Delete</button>
          </td>
        </tr>`).join('')}
      </tbody></table></div>` : `<div class="empty-state">No clients yet. Add your first one to get started.</div>`}
    </div>
  `;
  document.getElementById('addClientBtn').addEventListener('click', () => openClientModal());
  c.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openClientModal(state.clients.find(x => x.id === b.dataset.edit))));
  c.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this client?')) return;
    const res = await api('deleteClient', { id: b.dataset.del });
    if (res.ok) { state.clients = state.clients.filter(x => x.id !== b.dataset.del); renderView(); toast('Client deleted.'); }
    else toast(res.error);
  }));
}

function openClientModal(client) {
  const isEdit = !!client;
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? 'Edit client' : 'Add client'}</h3>
      <div class="field"><label>Full name</label><input type="text" id="cName" value="${escapeHtml(client?.name)}" required /></div>
      <div class="field"><label>Phone</label><input type="tel" id="cPhone" value="${escapeHtml(client?.phone)}" /></div>
      <div class="field"><label>Email</label><input type="email" id="cEmail" value="${escapeHtml(client?.email)}" /></div>
      <div class="field"><label>Address</label><textarea id="cAddress">${escapeHtml(client?.address)}</textarea></div>
      <div class="field"><label>Notes</label><textarea id="cNotes">${escapeHtml(client?.notes)}</textarea></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cCancel">Cancel</button>
        <button class="btn btn-primary" id="cSave">Save</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('#cCancel').addEventListener('click', () => wrap.remove());
  wrap.querySelector('#cSave').addEventListener('click', async () => {
    const payload = {
      id: client?.id,
      name: wrap.querySelector('#cName').value.trim(),
      phone: wrap.querySelector('#cPhone').value.trim(),
      email: wrap.querySelector('#cEmail').value.trim(),
      address: wrap.querySelector('#cAddress').value.trim(),
      notes: wrap.querySelector('#cNotes').value.trim()
    };
    if (!payload.name) return toast('Client name is required.');
    const res = await api(isEdit ? 'updateClient' : 'addClient', { client: payload });
    if (res.ok) {
      if (isEdit) Object.assign(client, payload);
      else state.clients.unshift({ ...payload, id: res.id, createdAt: new Date().toISOString() });
      wrap.remove(); renderView(); toast('Client saved.');
    } else toast(res.error);
  });
}

/* ---------------------------------------------------------------------- */
/* Products (catalog: category + sizes/variants + price, reusable later)  */
/* ---------------------------------------------------------------------- */

function renderProducts(c) {
  const categories = [...new Set(state.products.map(p => p.category || 'Uncategorized'))];
  c.innerHTML = `
    <div class="flex-between">
      <div><div class="section-title">Products</div><div class="section-sub">Save a product once — with its sizes and prices — then pick it straight into any quote or invoice.</div></div>
      <button class="btn btn-primary" id="addProductBtn">+ Add product</button>
    </div>
    ${state.products.length ? categories.map(cat => `
      <div class="card">
        <h3 style="margin-bottom:10px;">${escapeHtml(cat)}</h3>
        <div class="table-wrap"><table><thead><tr><th>Product</th><th>Unit</th><th>Sizes / prices</th><th></th></tr></thead><tbody>
          ${state.products.filter(p => (p.category || 'Uncategorized') === cat).map(p => `<tr>
            <td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.unit)}</td>
            <td>${(p.variants || []).map(v => `${escapeHtml(v.label)}: ${formatMoney(v.price, state.settings?.defaultCurrency)}`).join(' · ')}</td>
            <td class="row-actions">
              <button class="link-btn" data-edit-p="${p.id}">Edit</button>
              <button class="link-btn" style="color:var(--danger)" data-del-p="${p.id}">Delete</button>
            </td>
          </tr>`).join('')}
        </tbody></table></div>
      </div>
    `).join('') : `<div class="card"><div class="empty-state">No products saved yet. Add your first one — e.g. "Bra" with sizes 32B, 34C and their prices.</div></div>`}
  `;
  document.getElementById('addProductBtn').addEventListener('click', () => openProductModal());
  c.querySelectorAll('[data-edit-p]').forEach(b => b.addEventListener('click', () => openProductModal(state.products.find(x => x.id === b.dataset.editP))));
  c.querySelectorAll('[data-del-p]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this product?')) return;
    const res = await api('deleteProduct', { id: b.dataset.delP });
    if (res.ok) { state.products = state.products.filter(x => x.id !== b.dataset.delP); renderView(); toast('Product deleted.'); }
    else toast(res.error);
  }));
}

let productVariantRows = [];

function openProductModal(product) {
  const isEdit = !!product;
  productVariantRows = isEdit && product.variants?.length ? JSON.parse(JSON.stringify(product.variants)) : [{ label: 'Standard', price: 0 }];
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? 'Edit product' : 'Add product'}</h3>
      <div class="field"><label>Product name</label><input type="text" id="pName" value="${escapeHtml(product?.name)}" placeholder="e.g. Lace Bra" /></div>
      <div class="grid-2">
        <div class="field"><label>Category</label><input type="text" id="pCategory" value="${escapeHtml(product?.category)}" placeholder="e.g. Bras, Robes, Wellness kits" list="catList" />
          <datalist id="catList">${[...new Set(state.products.map(p => p.category))].map(cat => `<option value="${escapeHtml(cat)}">`).join('')}</datalist>
        </div>
        <div class="field"><label>Unit (optional)</label><input type="text" id="pUnit" value="${escapeHtml(product?.unit)}" placeholder="e.g. piece, set" /></div>
      </div>
      <label style="margin-top:6px;">Sizes &amp; prices</label>
      <div id="variantRows"></div>
      <button class="btn btn-ghost btn-sm" id="addVariantBtn" type="button">+ Add size</button>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="pCancel">Cancel</button>
        <button class="btn btn-primary" id="pSave">Save</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  function renderVariantRows() {
    const box = wrap.querySelector('#variantRows');
    box.innerHTML = productVariantRows.map((v, i) => `
      <div style="display:flex; gap:8px; margin-bottom:8px;" data-vidx="${i}">
        <input type="text" class="v-label" value="${escapeHtml(v.label)}" placeholder="Size / label (e.g. 34C, One size)" style="flex:2;" />
        <input type="number" class="v-price" value="${v.price}" placeholder="Price" step="0.01" style="flex:1;" />
        <button class="btn btn-ghost btn-sm" data-rm-v="${i}" type="button">✕</button>
      </div>
    `).join('');
    box.querySelectorAll('.v-label').forEach((el, i) => el.addEventListener('input', () => { productVariantRows[i].label = el.value; }));
    box.querySelectorAll('.v-price').forEach((el, i) => el.addEventListener('input', () => { productVariantRows[i].price = Number(el.value || 0); }));
    box.querySelectorAll('[data-rm-v]').forEach(b => b.addEventListener('click', () => {
      productVariantRows.splice(Number(b.dataset.rmV), 1);
      if (!productVariantRows.length) productVariantRows.push({ label: 'Standard', price: 0 });
      renderVariantRows();
    }));
  }
  renderVariantRows();

  wrap.querySelector('#addVariantBtn').addEventListener('click', () => { productVariantRows.push({ label: '', price: 0 }); renderVariantRows(); });
  wrap.querySelector('#pCancel').addEventListener('click', () => wrap.remove());
  wrap.querySelector('#pSave').addEventListener('click', async () => {
    const payload = {
      id: product?.id,
      name: wrap.querySelector('#pName').value.trim(),
      category: wrap.querySelector('#pCategory').value.trim() || 'Uncategorized',
      unit: wrap.querySelector('#pUnit').value.trim(),
      variants: productVariantRows.filter(v => v.label.trim())
    };
    if (!payload.name) return toast('Product name is required.');
    if (!payload.variants.length) return toast('Add at least one size and price.');
    const res = await api(isEdit ? 'updateProduct' : 'addProduct', { product: payload });
    if (res.ok) {
      if (isEdit) Object.assign(product, payload);
      else state.products.unshift({ ...payload, id: res.id, createdAt: new Date().toISOString() });
      wrap.remove(); renderView(); toast('Product saved.');
    } else toast(res.error);
  });
}

/* ---------------------------------------------------------------------- */
/* Quotes list                                                            */
/* ---------------------------------------------------------------------- */

function renderQuotesList(c) {
  c.innerHTML = `
    <div class="flex-between">
      <div><div class="section-title">Quotations</div><div class="section-sub">Draft, send, and track client quotes.</div></div>
      <button class="btn btn-primary" id="newQuoteBtn">+ New quotation</button>
    </div>
    <div class="card">
      ${state.quotes.length ? `<div class="table-wrap"><table><thead><tr><th>Number</th><th>Date</th><th>Client</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>
        ${state.quotes.map(q => `<tr>
          <td>${q.number}</td><td>${formatDate(q.date)}</td><td>${escapeHtml(q.clientName)}</td><td>${formatMoney(q.total, q.currency)}</td>
          <td><span class="badge badge-${q.status}">${q.status}</span></td>
          <td class="row-actions">
            <button class="link-btn" data-pdf="${q.id}">PDF</button>
            <button class="link-btn" data-edit-q="${q.id}">Edit</button>
            ${q.status === 'draft' ? `<button class="link-btn" data-send="${q.id}">Mark sent</button>` : ''}
            ${q.status === 'sent' ? `<button class="link-btn" data-accept="${q.id}">Mark accepted</button><button class="link-btn" style="color:var(--danger)" data-decline="${q.id}">Decline</button>` : ''}
            ${q.status === 'accepted' ? `<button class="link-btn" data-convert="${q.id}">Convert to order</button>` : ''}
            <button class="link-btn" style="color:var(--danger)" data-del-q="${q.id}">Delete</button>
          </td>
        </tr>`).join('')}
      </tbody></table></div>` : `<div class="empty-state">No quotations yet. Create your first one.</div>`}
    </div>
  `;
  document.getElementById('newQuoteBtn').addEventListener('click', () => openDocEditor('quote'));
  c.querySelectorAll('[data-pdf]').forEach(b => b.addEventListener('click', () => exportPdf('quote', state.quotes.find(x => x.id === b.dataset.pdf))));
  c.querySelectorAll('[data-edit-q]').forEach(b => b.addEventListener('click', () => openDocEditor('quote', state.quotes.find(x => x.id === b.dataset.editQ))));
  c.querySelectorAll('[data-send]').forEach(b => b.addEventListener('click', () => setQuoteStatus(b.dataset.send, 'sent')));
  c.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', () => setQuoteStatus(b.dataset.accept, 'accepted')));
  c.querySelectorAll('[data-decline]').forEach(b => b.addEventListener('click', () => setQuoteStatus(b.dataset.decline, 'declined')));
  c.querySelectorAll('[data-convert]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm("Convert this quotation to an order? Use this once the customer has paid or sent a purchase order.")) return;
    const res = await api('convertQuoteToOrder', { id: b.dataset.convert });
    if (res.ok) { toast('Converted to order ' + res.number); await loadAllData(); state.view = 'orders'; renderApp(); }
    else toast(res.error);
  }));
  c.querySelectorAll('[data-del-q]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this quotation? This cannot be undone.')) return;
    const res = await api('deleteQuote', { id: b.dataset.delQ });
    if (res.ok) { state.quotes = state.quotes.filter(x => x.id !== b.dataset.delQ); renderView(); toast('Quotation deleted.'); }
    else toast(res.error);
  }));
}

async function setQuoteStatus(id, status) {
  const res = await api('updateQuoteStatus', { id, status });
  if (res.ok) { const q = state.quotes.find(x => x.id === id); q.status = status; renderView(); toast('Status updated.'); }
  else toast(res.error);
}

/* ---------------------------------------------------------------------- */
/* Invoices list                                                          */
/* ---------------------------------------------------------------------- */

function renderInvoicesList(c) {
  c.innerHTML = `
    <div class="flex-between">
      <div><div class="section-title">Invoices</div><div class="section-sub">Bill clients once their order has been delivered, and track payments.</div></div>
      <button class="btn btn-primary" id="newInvoiceBtn">+ New invoice</button>
    </div>
    <div class="card">
      ${state.invoices.length ? `<div class="table-wrap"><table><thead><tr><th>Number</th><th>Date</th><th>Client</th><th>From order</th><th>Total</th><th>Paid</th><th>Status</th><th></th></tr></thead><tbody>
        ${state.invoices.map(i => `<tr>
          <td>${i.number}</td><td>${formatDate(i.date)}</td><td>${escapeHtml(i.clientName)}</td><td>${escapeHtml(i.orderNumber) || '—'}</td><td>${formatMoney(i.total, i.currency)}</td><td>${formatMoney(i.amountPaid, i.currency)}</td>
          <td><span class="badge badge-${i.status}">${i.status}</span></td>
          <td class="row-actions">
            <button class="link-btn" data-pdf="${i.id}">PDF</button>
            <button class="link-btn" data-edit-i="${i.id}">Edit</button>
            ${i.status !== 'paid' ? `<button class="link-btn" data-pay="${i.id}">Record payment</button>` : ''}
            <button class="link-btn" style="color:var(--danger)" data-del-i="${i.id}">Delete</button>
          </td>
        </tr>`).join('')}
      </tbody></table></div>` : `<div class="empty-state">No invoices yet. Create one directly, or deliver an order to convert it automatically.</div>`}
    </div>
  `;
  document.getElementById('newInvoiceBtn').addEventListener('click', () => openDocEditor('invoice'));
  c.querySelectorAll('[data-pdf]').forEach(b => b.addEventListener('click', () => exportPdf('invoice', state.invoices.find(x => x.id === b.dataset.pdf))));
  c.querySelectorAll('[data-edit-i]').forEach(b => b.addEventListener('click', () => openDocEditor('invoice', state.invoices.find(x => x.id === b.dataset.editI))));
  c.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => openPaymentModal(state.invoices.find(x => x.id === b.dataset.pay))));
  c.querySelectorAll('[data-del-i]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this invoice? This cannot be undone.')) return;
    const res = await api('deleteInvoice', { id: b.dataset.delI });
    if (res.ok) { state.invoices = state.invoices.filter(x => x.id !== b.dataset.delI); renderView(); toast('Invoice deleted.'); }
    else toast(res.error);
  }));
}

function openPaymentModal(inv) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  const balance = Number(inv.total) - Number(inv.amountPaid || 0);
  wrap.innerHTML = `
    <div class="modal">
      <h3>Record payment — ${inv.number}</h3>
      <p class="muted">Balance due: ${formatMoney(balance, inv.currency)}</p>
      <div class="field"><label>Amount received (${inv.currency})</label><input type="number" id="payAmt" step="0.01" value="${balance.toFixed(2)}" /></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="payCancel">Cancel</button>
        <button class="btn btn-primary" id="paySave">Save</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('#payCancel').addEventListener('click', () => wrap.remove());
  wrap.querySelector('#paySave').addEventListener('click', async () => {
    const added = Number(wrap.querySelector('#payAmt').value || 0);
    const newPaid = Number(inv.amountPaid || 0) + added;
    const status = newPaid >= Number(inv.total) ? 'paid' : (newPaid > 0 ? 'partial' : 'unpaid');
    const res = await api('updateInvoiceStatus', { id: inv.id, status, amountPaid: newPaid });
    if (res.ok) { inv.amountPaid = newPaid; inv.status = status; wrap.remove(); renderView(); toast('Payment recorded.'); }
    else toast(res.error);
  });
}

/* ---------------------------------------------------------------------- */
/* Document editor (quote / invoice creation)                             */
/* ---------------------------------------------------------------------- */

let editorRows = [];
let editorClient = { phone: '', email: '', address: '' };
let editingDocId = null;

function openDocEditor(kind, existingDoc) {
  editingDocId = existingDoc ? existingDoc.id : null;
  editorRows = existingDoc && existingDoc.items && existingDoc.items.length
    ? existingDoc.items.map(i => ({ productId: '', desc: i.desc, qty: i.qty, price: i.price }))
    : [{ productId: '', desc: '', qty: 1, price: 0 }];
  editorClient = { phone: existingDoc?.clientPhone || '', email: existingDoc?.clientEmail || '', address: existingDoc?.clientAddress || '' };
  const c = document.getElementById('content');
  const currency = existingDoc?.currency || state.settings?.defaultCurrency || 'NGN';
  const isEdit = !!existingDoc;
  const matchedClient = existingDoc ? state.clients.find(cl => cl.id === existingDoc.clientId) : null;

  c.innerHTML = `
    <div class="flex-between">
      <div><div class="section-title">${isEdit ? 'Edit' : 'New'} ${kind === 'quote' ? 'quotation' : 'invoice'}</div><div class="section-sub">Fill in client and line items, then save.</div></div>
      <button class="btn btn-ghost" id="backBtn">← Back</button>
    </div>
    <div class="card">
      <div class="grid-2">
        <div class="field">
          <label>Client</label>
          <select id="edClient">
            <option value="">— Select existing client —</option>
            ${state.clients.map(cl => `<option value="${cl.id}" ${matchedClient && cl.id === matchedClient.id ? 'selected' : ''}>${escapeHtml(cl.name)}</option>`).join('')}
            <option value="__new__" ${existingDoc && !matchedClient ? 'selected' : ''}>+ New client (type details below)</option>
          </select>
        </div>
        <div class="field">
          <label>Client name (if new)</label>
          <input type="text" id="edClientName" placeholder="Full name" value="${existingDoc && !matchedClient ? escapeHtml(existingDoc.clientName) : ''}" />
        </div>
      </div>
      <div class="grid-3" id="clientContactRow" style="display:${existingDoc ? 'grid' : 'none'};">
        <div class="field"><label>Phone</label><input type="tel" id="edClientPhone" placeholder="Phone number" value="${escapeHtml(editorClient.phone)}" /></div>
        <div class="field"><label>Email</label><input type="email" id="edClientEmail" placeholder="Email address" value="${escapeHtml(editorClient.email)}" /></div>
        <div class="field"><label>Address</label><input type="text" id="edClientAddress" placeholder="Delivery / billing address" value="${escapeHtml(editorClient.address)}" /></div>
      </div>
      <div class="grid-2">
        <div class="field">
          <label>${kind === 'quote' ? 'Quote date' : 'Invoice date'}</label>
          <input type="date" id="edDate" value="${existingDoc ? new Date(existingDoc.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)}" />
        </div>
        <div class="field">
          <label>${kind === 'quote' ? 'Valid until' : 'Due date'}</label>
          <input type="date" id="edDate2" value="${(() => { const d = kind === 'quote' ? existingDoc?.validUntil : existingDoc?.dueDate; return d ? new Date(d).toISOString().slice(0, 10) : ''; })()}" />
        </div>
        <div class="field">
          <label>Currency</label>
          <select id="edCurrency">${Object.keys(CURRENCIES).map(k => `<option value="${k}" ${k === currency ? 'selected' : ''}>${k} — ${CURRENCIES[k].label}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label>Discount (%)</label>
          <input type="number" id="edDiscount" value="${existingDoc?.discountPercent != null ? existingDoc.discountPercent : (existingDoc?.discount && existingDoc?.subtotal ? Math.round((existingDoc.discount / existingDoc.subtotal) * 10000) / 100 : 0)}" step="0.01" min="0" max="100" />
        </div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-bottom:12px;">Line items</h3>
      <div id="itemRows"></div>
      <button class="btn btn-ghost btn-sm" id="addRowBtn">+ Add line item</button>
      <div class="totals-box" id="totalsBox"></div>
      <div class="field" style="margin-top:16px;">
        <label>Notes (optional)</label>
        <textarea id="edNotes" placeholder="Payment terms, delivery notes, etc.">${escapeHtml(existingDoc?.notes)}</textarea>
      </div>
    </div>

    <div style="display:flex; gap:10px; margin-top:16px;">
      <button class="btn btn-primary" id="saveDocBtn">${isEdit ? 'Save changes' : `Save ${kind === 'quote' ? 'quotation' : 'invoice'}`}</button>
      <button class="btn btn-ghost" id="cancelDocBtn">Cancel</button>
    </div>
  `;

  document.getElementById('backBtn').addEventListener('click', () => renderView());
  document.getElementById('cancelDocBtn').addEventListener('click', () => renderView());
  document.getElementById('addRowBtn').addEventListener('click', () => { editorRows.push({ productId: '', desc: '', qty: 1, price: 0 }); renderItemRows(); });

  document.getElementById('edClient').addEventListener('change', (e) => {
    const contactRow = document.getElementById('clientContactRow');
    const nameField = document.getElementById('edClientName');
    if (e.target.value === '__new__') {
      contactRow.style.display = 'grid';
      nameField.style.display = 'block';
      document.getElementById('edClientPhone').value = '';
      document.getElementById('edClientEmail').value = '';
      document.getElementById('edClientAddress').value = '';
    } else if (e.target.value) {
      const cl = state.clients.find(x => x.id === e.target.value);
      contactRow.style.display = 'grid';
      nameField.style.display = 'none';
      document.getElementById('edClientPhone').value = cl?.phone || '';
      document.getElementById('edClientEmail').value = cl?.email || '';
      document.getElementById('edClientAddress').value = cl?.address || '';
    } else {
      contactRow.style.display = 'none';
      nameField.style.display = 'block';
    }
  });
  if (!existingDoc) document.getElementById('edClientName').style.display = 'none';
  document.getElementById('edDiscount').addEventListener('input', renderTotals);
  document.getElementById('edCurrency').addEventListener('change', renderTotals);

  renderItemRows();
  document.getElementById('saveDocBtn').addEventListener('click', () => saveDoc(kind));
}

// Flattens the product catalog into <option> choices, one per size/variant.
function productOptions() {
  const opts = [];
  state.products.forEach(p => {
    (p.variants || []).forEach((v, vi) => {
      opts.push({
        value: `${p.id}::${vi}`,
        label: `${p.name}${v.label && v.label !== 'Standard' ? ' — ' + v.label : ''} (${formatMoney(v.price, state.settings?.defaultCurrency)})`,
        category: p.category || 'Uncategorized',
        desc: `${p.name}${v.label && v.label !== 'Standard' ? ' — ' + v.label : ''}`,
        price: v.price
      });
    });
  });
  return opts;
}

function renderItemRows() {
  const box = document.getElementById('itemRows');
  const opts = productOptions();
  const cats = [...new Set(opts.map(o => o.category))];

  box.innerHTML = editorRows.map((r, idx) => `
    <div class="card" style="padding:14px; margin-bottom:10px; box-shadow:none; border-color:var(--line);" data-idx="${idx}">
      <div class="field" style="margin-bottom:8px;">
        <label>Pick a saved product (optional)</label>
        <select class="row-product">
          <option value="">— Custom item / type below —</option>
          ${cats.map(cat => `<optgroup label="${escapeHtml(cat)}">
            ${opts.filter(o => o.category === cat).map(o => `<option value="${o.value}" ${r.productId === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
          </optgroup>`).join('')}
        </select>
      </div>
      <div class="item-row">
        <div class="field" style="margin:0;"><label>Description</label><input type="text" class="row-desc" value="${escapeHtml(r.desc)}" placeholder="Item or service" /></div>
        <div class="field" style="margin:0;"><label>Qty</label><input type="number" class="row-qty" value="${r.qty}" min="0" step="1" /></div>
        <div class="field" style="margin:0;"><label>Unit price</label><input type="number" class="row-price" value="${r.price}" min="0" step="0.01" /></div>
        <div class="field" style="margin:0;"><label>Line total</label><input type="text" class="row-total" value="${(r.qty * r.price).toFixed(2)}" disabled /></div>
        <button class="btn btn-ghost btn-sm" style="height:38px;" data-remove="${idx}">✕</button>
      </div>
    </div>
  `).join('');

  box.querySelectorAll('.row-product').forEach((el, i) => el.addEventListener('change', () => {
    editorRows[i].productId = el.value;
    if (el.value) {
      const [pid, vi] = el.value.split('::');
      const opt = opts.find(o => o.value === el.value);
      if (opt) { editorRows[i].desc = opt.desc; editorRows[i].price = opt.price; }
    }
    renderItemRows();
  }));
  box.querySelectorAll('.row-desc').forEach((el, i) => el.addEventListener('input', () => { editorRows[i].desc = el.value; }));
  box.querySelectorAll('.row-qty').forEach((el, i) => el.addEventListener('input', () => { editorRows[i].qty = Number(el.value || 0); syncRowTotal(i); renderTotals(); }));
  box.querySelectorAll('.row-price').forEach((el, i) => el.addEventListener('input', () => { editorRows[i].price = Number(el.value || 0); syncRowTotal(i); renderTotals(); }));
  box.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
    editorRows.splice(Number(b.dataset.remove), 1);
    if (!editorRows.length) editorRows.push({ productId: '', desc: '', qty: 1, price: 0 });
    renderItemRows(); renderTotals();
  }));
  renderTotals();
}

function syncRowTotal(i) {
  const box = document.getElementById('itemRows');
  const rowEl = box.querySelector(`[data-idx="${i}"] .row-total`);
  if (rowEl) rowEl.value = (editorRows[i].qty * editorRows[i].price).toFixed(2);
}

function computeTotals() {
  const subtotal = editorRows.reduce((s, r) => s + (Number(r.qty) * Number(r.price)), 0);
  const discountPercent = Number(document.getElementById('edDiscount')?.value || 0);
  const discount = subtotal * (discountPercent / 100);
  const taxRate = Number(state.settings?.taxRate || 0);
  const taxable = Math.max(subtotal - discount, 0);
  const tax = taxable * (taxRate / 100);
  const total = taxable + tax;
  return { subtotal, discountPercent, discount, tax, total, taxRate };
}

function renderTotals() {
  const box = document.getElementById('totalsBox');
  if (!box) return;
  const currency = document.getElementById('edCurrency')?.value || 'NGN';
  const t = computeTotals();
  box.innerHTML = `
    <div class="row"><span>Subtotal</span><span>${formatMoney(t.subtotal, currency)}</span></div>
    <div class="row"><span>Discount (${t.discountPercent}%)</span><span>-${formatMoney(t.discount, currency)}</span></div>
    <div class="row"><span>${state.settings?.taxLabel || 'Tax'} (${t.taxRate}%)</span><span>${formatMoney(t.tax, currency)}</span></div>
    <div class="row total"><span>Total</span><span>${formatMoney(t.total, currency)}</span></div>
  `;
}

async function saveDoc(kind) {
  const clientSel = document.getElementById('edClient').value;
  let clientId = '', clientName = '';
  const clientPhone = document.getElementById('edClientPhone')?.value.trim() || '';
  const clientEmail = document.getElementById('edClientEmail')?.value.trim() || '';
  const clientAddress = document.getElementById('edClientAddress')?.value.trim() || '';

  if (clientSel === '__new__') {
    clientName = document.getElementById('edClientName').value.trim();
    if (!clientName) return toast("Please enter the new client's name.");
    const res = await api('addClient', { client: { name: clientName, phone: clientPhone, email: clientEmail, address: clientAddress } });
    if (res.ok) {
      clientId = res.id;
      state.clients.unshift({ id: res.id, name: clientName, phone: clientPhone, email: clientEmail, address: clientAddress });
    }
  } else if (clientSel) {
    clientId = clientSel;
    clientName = state.clients.find(c => c.id === clientSel)?.name || '';
  } else {
    return toast('Please select or enter a client.');
  }

  const items = editorRows.filter(r => r.desc.trim() || r.qty || r.price).map(r => ({
    desc: r.desc, qty: Number(r.qty), price: Number(r.price), lineTotal: Number(r.qty) * Number(r.price)
  }));
  if (!items.length) return toast('Add at least one line item.');

  const t = computeTotals();
  const currency = document.getElementById('edCurrency').value;
  const date = document.getElementById('edDate').value;
  const date2 = document.getElementById('edDate2').value;
  const notes = document.getElementById('edNotes').value.trim();

  const payload = {
    clientId, clientName, clientPhone, clientEmail, clientAddress, items, currency,
    subtotal: t.subtotal, discountPercent: t.discountPercent, discount: t.discount, tax: t.tax, total: t.total, notes, date
  };
  if (kind === 'quote') payload.validUntil = date2; else payload.dueDate = date2;

  const isEdit = !!editingDocId;
  let res;
  if (isEdit) {
    res = await api(kind === 'quote' ? 'updateQuote' : 'updateInvoice', { id: editingDocId, [kind]: payload });
  } else {
    res = await api(kind === 'quote' ? 'createQuote' : 'createInvoice', { [kind]: payload });
  }
  if (res.ok) {
    toast(isEdit ? `${kind === 'quote' ? 'Quotation' : 'Invoice'} updated.` : `${kind === 'quote' ? 'Quotation' : 'Invoice'} ${res.number} saved.`);
    editingDocId = null;
    await loadAllData();
    state.view = kind === 'quote' ? 'quotes' : 'invoices';
    renderApp();
  } else toast(res.error);
}

/* ---------------------------------------------------------------------- */
/* PDF export                                                             */
/* ---------------------------------------------------------------------- */

async function exportPdf(kind, doc) {
  if (!doc) return;
  const s = state.settings || {};
  const items = doc.items || [];
  const hasPayInfo = s.bankName || s.altPaymentMethod;
  const hasClientContact = doc.clientPhone || doc.clientEmail || doc.clientAddress;

  const html = `
    <div class="doc-sheet" id="pdfSheet">
      <div class="doc-band"></div>
      <div class="doc-head">
        <img src="icons/logo.png" />
        <div class="co">
          <b>${escapeHtml(s.companyName || 'Intimate Haven')}</b>
          ${s.companyAddress ? `<span>${escapeHtml(s.companyAddress)}</span>` : ''}
          <span>${[s.companyPhone, s.companyEmail].filter(Boolean).map(escapeHtml).join('  ·  ')}</span>
        </div>
      </div>
      <div class="doc-title">${kind === 'quote' ? 'Quotation' : 'Invoice'}</div>
      <div class="muted">${doc.number}</div>
      <div class="doc-meta">
        <div class="block">
          <b>Billed to</b>
          ${escapeHtml(doc.clientName)}
          ${hasClientContact ? `<span class="doc-client-contact">
            ${doc.clientPhone ? escapeHtml(doc.clientPhone) : ''}
            ${doc.clientEmail ? (doc.clientPhone ? ' · ' : '') + escapeHtml(doc.clientEmail) : ''}
            ${doc.clientAddress ? `<br/>${escapeHtml(doc.clientAddress)}` : ''}
          </span>` : ''}
        </div>
        <div class="block"><b>Date</b>${formatDate(doc.date)}</div>
        <div class="block"><b>${kind === 'quote' ? 'Valid until' : 'Due date'}</b>${formatDate(kind === 'quote' ? doc.validUntil : doc.dueDate)}</div>
      </div>
      <table>
        <colgroup><col style="width:46%"><col style="width:12%"><col style="width:21%"><col style="width:21%"></colgroup>
        <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead>
        <tbody>
          ${items.map(i => `<tr><td>${escapeHtml(i.desc)}</td><td>${i.qty}</td><td>${formatMoney(i.price, doc.currency)}</td><td>${formatMoney(i.lineTotal, doc.currency)}</td></tr>`).join('')}
        </tbody>
      </table>
      <div class="doc-totals">
        <div class="row"><span>Subtotal</span><span>${formatMoney(doc.subtotal, doc.currency)}</span></div>
        <div class="row"><span>Discount${doc.discountPercent ? ` (${doc.discountPercent}%)` : ''}</span><span>-${formatMoney(doc.discount, doc.currency)}</span></div>
        <div class="row"><span>${s.taxLabel || 'Tax'}</span><span>${formatMoney(doc.tax, doc.currency)}</span></div>
        <div class="row total"><span>Total</span><span>${formatMoney(doc.total, doc.currency)}</span></div>
        ${kind === 'invoice' ? `<div class="row"><span>Amount paid</span><span>${formatMoney(doc.amountPaid, doc.currency)}</span></div>
        <div class="row"><span>Balance due</span><span>${formatMoney(Number(doc.total) - Number(doc.amountPaid || 0), doc.currency)}</span></div>` : ''}
      </div>
      ${doc.notes ? `<div class="doc-notes"><b>Notes:</b> ${escapeHtml(doc.notes)}</div>` : ''}
      ${hasPayInfo ? `
      <div class="doc-pay">
        <b>Payment / account details</b>
        ${s.bankName ? `Bank: ${escapeHtml(s.bankName)}<br/>Account name: ${escapeHtml(s.bankAccountName)}<br/>Account number: ${escapeHtml(s.bankAccountNumber)}<br/>` : ''}
        ${s.altPaymentMethod ? `${escapeHtml(s.altPaymentMethod)}: ${escapeHtml(s.altPaymentDetails)}` : ''}
      </div>` : ''}
      <div class="doc-foot">${escapeHtml(s.invoiceFooterNote || 'Thank you for your patronage.')}</div>
    </div>
  `;
  const printArea = document.getElementById('printArea');
  printArea.innerHTML = html;
  printArea.style.cssText = 'position:fixed; left:-9999px; top:0; display:block;';

  toast('Preparing PDF…');
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise(r => setTimeout(r, 60));

    const el = document.getElementById('pdfSheet');
    // Render the sheet to a single tall image, then slice it across A4 pages.
    // This mirrors the on-screen layout exactly — no column cut-offs, no
    // mid-row page breaks — instead of relying on jsPDF's own (fragile)
    // HTML-to-PDF text flow.
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', windowWidth: 750 });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'pt', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    const imgData = canvas.toDataURL('image/png');
    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(`${doc.number}-${(doc.clientName || 'client').replace(/\s+/g, '_')}.pdf`);
  } catch (err) {
    toast('Could not generate PDF: ' + err);
  } finally {
    printArea.style.cssText = 'display:none;';
  }
}

/* ---------------------------------------------------------------------- */
/* Orders (fulfillment tracking — usually created from a paid invoice)   */
/* ---------------------------------------------------------------------- */

const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'invoiced', 'cancelled'];

function renderOrders(c) {
  c.innerHTML = `
    <div class="flex-between">
      <div><div class="section-title">Orders</div><div class="section-sub">Track fulfillment after a quote is paid for — from packing to delivery.</div></div>
      <button class="btn btn-primary" id="newOrderBtn">+ New order</button>
    </div>
    <div class="card">
      ${state.orders.length ? `<div class="table-wrap"><table><thead><tr><th>Number</th><th>Date</th><th>Client</th><th>From quote</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>
        ${state.orders.map(o => `<tr>
          <td>${o.number}</td><td>${formatDate(o.date)}</td><td>${escapeHtml(o.clientName)}</td><td>${escapeHtml(o.quoteNumber) || '—'}</td><td>${formatMoney(o.total, o.currency)}</td>
          <td>
            <select class="order-status-select" data-order-id="${o.id}" ${o.status === 'invoiced' ? 'disabled' : ''} style="padding:5px 8px; border-radius:6px; border:1px solid var(--line);">
              ${ORDER_STATUSES.filter(s => s !== 'invoiced').map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
              ${o.status === 'invoiced' ? `<option value="invoiced" selected>Invoiced</option>` : ''}
            </select>
          </td>
          <td class="row-actions">
            ${o.status === 'delivered' ? `<button class="link-btn" data-order-to-inv="${o.id}">Convert to invoice</button>` : ''}
            ${o.status === 'invoiced' ? `<span class="muted" style="font-size:12.5px;">→ ${escapeHtml(o.invoiceNumber)}</span>` : ''}
            <button class="link-btn" style="color:var(--danger)" data-del-order="${o.id}">Delete</button>
          </td>
        </tr>`).join('')}
      </tbody></table></div>` : `<div class="empty-state">No orders yet. Convert an accepted quotation once it's paid for, or start one here.</div>`}
    </div>
  `;
  document.getElementById('newOrderBtn').addEventListener('click', () => openOrderModal());
  c.querySelectorAll('.order-status-select').forEach(sel => sel.addEventListener('change', async () => {
    const res = await api('updateOrderStatus', { id: sel.dataset.orderId, status: sel.value });
    if (res.ok) { const o = state.orders.find(x => x.id === sel.dataset.orderId); o.status = sel.value; renderView(); toast('Order status updated.'); }
    else toast(res.error);
  }));
  c.querySelectorAll('[data-order-to-inv]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Convert this order to an invoice? Use this once the items have been delivered.')) return;
    const res = await api('convertOrderToInvoice', { id: b.dataset.orderToInv });
    if (res.ok) { toast('Converted to invoice ' + res.number); await loadAllData(); state.view = 'invoices'; renderApp(); }
    else toast(res.error);
  }));
  c.querySelectorAll('[data-del-order]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this order?')) return;
    const res = await api('deleteOrder', { id: b.dataset.delOrder });
    if (res.ok) { state.orders = state.orders.filter(x => x.id !== b.dataset.delOrder); renderView(); toast('Order deleted.'); }
    else toast(res.error);
  }));
}

let orderModalRows = [];

function openOrderModal() {
  orderModalRows = [{ desc: '', qty: 1, price: 0 }];
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  const availableQuotes = state.quotes.filter(q => q.status === 'accepted');
  wrap.innerHTML = `
    <div class="modal">
      <h3>New order</h3>
      <div class="field">
        <label>Base on an accepted quotation (optional)</label>
        <select id="ordQuote">
          <option value="">— Start blank —</option>
          ${availableQuotes.map(q => `<option value="${q.id}">${q.number} — ${escapeHtml(q.clientName)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Client name</label><input type="text" id="ordClient" /></div>
      <div id="ordItemRows"></div>
      <button class="btn btn-ghost btn-sm" id="ordAddRow" type="button">+ Add item</button>
      <div class="field" style="margin-top:12px;"><label>Notes</label><textarea id="ordNotes"></textarea></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="ordCancel">Cancel</button>
        <button class="btn btn-primary" id="ordSave">Create order</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  let sourceQuote = null;

  function renderOrdRows() {
    const box = wrap.querySelector('#ordItemRows');
    const locked = !!sourceQuote;
    box.innerHTML = orderModalRows.map((r, i) => `
      <div style="display:flex; gap:8px; margin-bottom:8px;">
        <input type="text" class="ord-desc" value="${escapeHtml(r.desc)}" placeholder="Item" style="flex:2;" ${locked ? 'disabled' : ''} />
        <input type="number" class="ord-qty" value="${r.qty}" placeholder="Qty" style="flex:1;" ${locked ? 'disabled' : ''} />
        <input type="number" class="ord-price" value="${r.price}" placeholder="Price" step="0.01" style="flex:1;" ${locked ? 'disabled' : ''} />
        ${locked ? '' : `<button class="btn btn-ghost btn-sm" data-rm-ord="${i}" type="button">✕</button>`}
      </div>
    `).join('');
    if (locked) return;
    box.querySelectorAll('.ord-desc').forEach((el, i) => el.addEventListener('input', () => { orderModalRows[i].desc = el.value; }));
    box.querySelectorAll('.ord-qty').forEach((el, i) => el.addEventListener('input', () => { orderModalRows[i].qty = Number(el.value || 0); }));
    box.querySelectorAll('.ord-price').forEach((el, i) => el.addEventListener('input', () => { orderModalRows[i].price = Number(el.value || 0); }));
    box.querySelectorAll('[data-rm-ord]').forEach(b => b.addEventListener('click', () => {
      orderModalRows.splice(Number(b.dataset.rmOrd), 1);
      if (!orderModalRows.length) orderModalRows.push({ desc: '', qty: 1, price: 0 });
      renderOrdRows();
    }));
  }
  renderOrdRows();
  wrap.querySelector('#ordAddRow').addEventListener('click', () => {
    if (sourceQuote) return;
    orderModalRows.push({ desc: '', qty: 1, price: 0 }); renderOrdRows();
  });

  wrap.querySelector('#ordQuote').addEventListener('change', (e) => {
    sourceQuote = availableQuotes.find(q => q.id === e.target.value) || null;
    const addBtn = wrap.querySelector('#ordAddRow');
    const clientField = wrap.querySelector('#ordClient');
    if (sourceQuote) {
      clientField.value = sourceQuote.clientName;
      clientField.disabled = true;
      addBtn.style.display = 'none';
      orderModalRows = sourceQuote.items.map(i => ({ desc: i.desc, qty: i.qty, price: i.price }));
    } else {
      clientField.disabled = false;
      addBtn.style.display = 'inline-flex';
    }
    renderOrdRows();
  });

  wrap.querySelector('#ordCancel').addEventListener('click', () => wrap.remove());
  wrap.querySelector('#ordSave').addEventListener('click', async () => {
    // If the whole quote was picked unmodified, convert it properly so the
    // quote's own status updates and nothing has to be retyped.
    if (sourceQuote) {
      if (!confirm('Convert quote ' + sourceQuote.number + ' into this order?')) return;
      const res = await api('convertQuoteToOrder', { id: sourceQuote.id });
      if (res.ok) { toast('Order ' + res.number + ' created.'); wrap.remove(); await loadAllData(); state.view = 'orders'; renderApp(); }
      else toast(res.error);
      return;
    }
    const clientName = wrap.querySelector('#ordClient').value.trim();
    if (!clientName) return toast('Please enter a client name.');
    const items = orderModalRows.filter(r => r.desc.trim()).map(r => ({ desc: r.desc, qty: Number(r.qty), price: Number(r.price), lineTotal: Number(r.qty) * Number(r.price) }));
    if (!items.length) return toast('Add at least one item.');
    const total = items.reduce((s, i) => s + i.lineTotal, 0);
    const payload = {
      clientName, items, currency: state.settings?.defaultCurrency || 'NGN', subtotal: total, total,
      notes: wrap.querySelector('#ordNotes').value.trim()
    };
    const res = await api('createOrder', { order: payload });
    if (res.ok) { toast('Order ' + res.number + ' created.'); wrap.remove(); await loadAllData(); }
    else toast(res.error);
  });
}

/* ---------------------------------------------------------------------- */
/* Reports (Sales report)                                                 */
/* ---------------------------------------------------------------------- */

function renderReports(c) {
  c.innerHTML = `
    <div class="section-title">Reports</div>
    <div class="section-sub">Sales performance across your quotes and invoices.</div>
    <div class="card">
      <div class="flex-between">
        <h3>Sales report</h3>
        <div style="display:flex; gap:8px; align-items:end;">
          <div class="field" style="margin:0;"><label>From</label><input type="date" id="repFrom" /></div>
          <div class="field" style="margin:0;"><label>To</label><input type="date" id="repTo" /></div>
          <button class="btn btn-ghost btn-sm" id="repRun">Run</button>
        </div>
      </div>
      <div id="reportBody" style="margin-top:16px;"></div>
    </div>
  `;
  document.getElementById('repRun').addEventListener('click', renderSalesReportBody);
  renderSalesReportBody();
}

function renderSalesReportBody() {
  const from = document.getElementById('repFrom')?.value;
  const to = document.getElementById('repTo')?.value;
  const inRange = (d) => {
    if (!d) return true;
    const t = new Date(d).getTime();
    if (from && t < new Date(from).getTime()) return false;
    if (to && t > new Date(to).getTime() + 86400000) return false;
    return true;
  };

  const invoices = state.invoices.filter(i => inRange(i.date));
  const quotes = state.quotes.filter(q => inRange(q.date));

  const totalInvoiced = invoices.reduce((s, i) => s + Number(i.total), 0);
  const totalCollected = invoices.reduce((s, i) => s + Number(i.amountPaid || 0), 0);
  const totalOutstanding = totalInvoiced - totalCollected;
  const acceptedQuotes = quotes.filter(q => q.status === 'accepted' || q.status === 'converted').length;
  const conversionRate = quotes.length ? Math.round((acceptedQuotes / quotes.length) * 100) : 0;

  const productTotals = {};
  invoices.forEach(inv => (inv.items || []).forEach(i => {
    productTotals[i.desc] = (productTotals[i.desc] || 0) + Number(i.qty);
  }));
  const topProducts = Object.entries(productTotals).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const clientTotals = {};
  invoices.forEach(inv => { clientTotals[inv.clientName] = (clientTotals[inv.clientName] || 0) + Number(inv.total); });
  const topClients = Object.entries(clientTotals).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const body = document.getElementById('reportBody');
  body.innerHTML = `
    <div class="grid-3">
      <div class="card" style="box-shadow:none;"><div class="muted" style="font-size:12.5px;">Total invoiced</div><div class="display" style="font-size:26px;margin-top:6px;">${formatMoneyMixed(totalInvoiced)}</div></div>
      <div class="card" style="box-shadow:none;"><div class="muted" style="font-size:12.5px;">Total collected</div><div class="display" style="font-size:26px;margin-top:6px;">${formatMoneyMixed(totalCollected)}</div></div>
      <div class="card" style="box-shadow:none;"><div class="muted" style="font-size:12.5px;">Outstanding</div><div class="display" style="font-size:26px;margin-top:6px;">${formatMoneyMixed(totalOutstanding)}</div></div>
    </div>
    <div class="grid-2" style="margin-top:16px;">
      <div class="card" style="box-shadow:none;">
        <h3 style="margin-bottom:8px;">Top products sold (by qty)</h3>
        ${topProducts.length ? `<table><tbody>${topProducts.map(([name, qty]) => `<tr><td>${escapeHtml(name)}</td><td style="text-align:right;">${qty}</td></tr>`).join('')}</tbody></table>` : `<p class="muted">No invoice data in this range yet.</p>`}
      </div>
      <div class="card" style="box-shadow:none;">
        <h3 style="margin-bottom:8px;">Top clients (by revenue)</h3>
        ${topClients.length ? `<table><tbody>${topClients.map(([name, total]) => `<tr><td>${escapeHtml(name)}</td><td style="text-align:right;">${formatMoneyMixed(total)}</td></tr>`).join('')}</tbody></table>` : `<p class="muted">No invoice data in this range yet.</p>`}
      </div>
    </div>
    <div class="card" style="box-shadow:none; margin-top:16px;">
      <h3>Quotation conversion</h3>
      <p class="muted" style="margin-top:6px;">${quotes.length} quotation${quotes.length === 1 ? '' : 's'} in range · ${acceptedQuotes} accepted or converted · <b style="color:var(--ink);">${conversionRate}% conversion rate</b></p>
    </div>
  `;
}

/* ---------------------------------------------------------------------- */
/* Settings (company info, payment details, staff)                       */
/* ---------------------------------------------------------------------- */

function renderSettings(c) {
  const s = state.settings || {};
  const isAdmin = state.user.role === 'admin';
  c.innerHTML = `
    <div class="section-title">Settings</div>
    <div class="section-sub">Company details, payment accounts${isAdmin ? ', and staff access' : ''}.</div>

    <div class="card">
      <h3>Company info</h3>
      <div class="grid-2" style="margin-top:12px;">
        <div class="field"><label>Company name</label><input type="text" id="stCompanyName" value="${escapeHtml(s.companyName)}" ${!isAdmin ? 'disabled' : ''}/></div>
        <div class="field"><label>Tagline</label><input type="text" id="stTagline" value="${escapeHtml(s.companyTagline)}" ${!isAdmin ? 'disabled' : ''}/></div>
        <div class="field"><label>Phone</label><input type="text" id="stPhone" value="${escapeHtml(s.companyPhone)}" ${!isAdmin ? 'disabled' : ''}/></div>
        <div class="field"><label>Email</label><input type="text" id="stEmail" value="${escapeHtml(s.companyEmail)}" ${!isAdmin ? 'disabled' : ''}/></div>
        <div class="field" style="grid-column:1/-1;"><label>Address</label><textarea id="stAddress" ${!isAdmin ? 'disabled' : ''}>${escapeHtml(s.companyAddress)}</textarea></div>
        <div class="field"><label>Default currency</label><select id="stCurrency" ${!isAdmin ? 'disabled' : ''}>${Object.keys(CURRENCIES).map(k => `<option value="${k}" ${k === s.defaultCurrency ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
        <div class="field"><label>Tax label</label><input type="text" id="stTaxLabel" value="${escapeHtml(s.taxLabel)}" ${!isAdmin ? 'disabled' : ''}/></div>
        <div class="field"><label>Tax rate (%)</label><input type="number" id="stTaxRate" value="${escapeHtml(s.taxRate)}" ${!isAdmin ? 'disabled' : ''}/></div>
        <div class="field" style="grid-column:1/-1;"><label>Invoice / quote footer note</label><input type="text" id="stFooter" value="${escapeHtml(s.invoiceFooterNote)}" ${!isAdmin ? 'disabled' : ''}/></div>
      </div>
    </div>

    <div class="card">
      <h3>Payment account details</h3>
      <div class="section-sub" style="margin-top:4px;">These appear on every quotation and invoice PDF so clients know where to pay.</div>
      <div class="grid-2">
        <div class="field"><label>Bank name</label><input type="text" id="stBankName" value="${escapeHtml(s.bankName)}" ${!isAdmin ? 'disabled' : ''}/></div>
        <div class="field"><label>Account name</label><input type="text" id="stBankAccName" value="${escapeHtml(s.bankAccountName)}" ${!isAdmin ? 'disabled' : ''}/></div>
        <div class="field"><label>Account number</label><input type="text" id="stBankAccNo" value="${escapeHtml(s.bankAccountNumber)}" ${!isAdmin ? 'disabled' : ''}/></div>
        <div class="field"><label>Alternative payment method (e.g. Opay, PayPal)</label><input type="text" id="stAltMethod" value="${escapeHtml(s.altPaymentMethod)}" ${!isAdmin ? 'disabled' : ''}/></div>
        <div class="field" style="grid-column:1/-1;"><label>Alternative payment details</label><input type="text" id="stAltDetails" value="${escapeHtml(s.altPaymentDetails)}" ${!isAdmin ? 'disabled' : ''}/></div>
      </div>
      ${isAdmin ? `<button class="btn btn-primary" id="saveSettingsBtn">Save settings</button>` : `<p class="muted">Only admins can edit these.</p>`}
    </div>

    ${isAdmin ? renderStaffSection() : ''}
  `;
  if (isAdmin) {
    document.getElementById('saveSettingsBtn').addEventListener('click', saveSettingsForm);
    bindStaffHandlers();
  }
}

function renderStaffSection() {
  return `
    <div class="card">
      <div class="flex-between">
        <h3>Staff access</h3>
        <button class="btn btn-ghost btn-sm" id="addStaffBtn">+ Add staff</button>
      </div>
      <div class="table-wrap" style="margin-top:10px;">
        <table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody id="staffTbody"><tr><td colspan="5" class="muted">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>
  `;
}

async function bindStaffHandlers() {
  document.getElementById('addStaffBtn').addEventListener('click', () => openStaffModal());
  const res = await api('listStaff', {});
  const tbody = document.getElementById('staffTbody');
  if (!res.ok) { tbody.innerHTML = `<tr><td colspan="5">${res.error}</td></tr>`; return; }
  tbody.innerHTML = res.staff.map(s => `
    <tr>
      <td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.username)}</td><td>${escapeHtml(s.role)}</td>
      <td>${s.active ? 'Active' : 'Disabled'}</td>
      <td class="row-actions">
        <button class="link-btn" data-edit-staff="${s.id}">Edit</button>
        <button class="link-btn" style="color:var(--danger)" data-del-staff="${s.id}">Delete</button>
      </td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-edit-staff]').forEach(b => b.addEventListener('click', () => openStaffModal(res.staff.find(x => x.id === b.dataset.editStaff))));
  tbody.querySelectorAll('[data-del-staff]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remove this staff member?')) return;
    const r = await api('deleteStaff', { id: b.dataset.delStaff });
    if (r.ok) { toast('Staff removed.'); bindStaffHandlers(); } else toast(r.error);
  }));
}

function openStaffModal(staffMember) {
  const isEdit = !!staffMember;
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? 'Edit staff member' : 'Add staff member'}</h3>
      <div class="field"><label>Full name</label><input type="text" id="sName" value="${escapeHtml(staffMember?.name)}" /></div>
      <div class="field"><label>Username</label><input type="text" id="sUsername" value="${escapeHtml(staffMember?.username)}" ${isEdit ? 'disabled' : ''} /></div>
      <div class="field"><label>${isEdit ? 'New password (leave blank to keep current)' : 'Password'}</label><input type="password" id="sPassword" /></div>
      <div class="field"><label>Role</label>
        <select id="sRole">
          <option value="staff" ${staffMember?.role === 'staff' ? 'selected' : ''}>Staff</option>
          <option value="admin" ${staffMember?.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </div>
      ${isEdit ? `<div class="field"><label>Status</label><select id="sActive"><option value="true" ${staffMember?.active !== false ? 'selected' : ''}>Active</option><option value="false" ${staffMember?.active === false ? 'selected' : ''}>Disabled</option></select></div>` : ''}
      <div class="modal-actions">
        <button class="btn btn-ghost" id="sCancel">Cancel</button>
        <button class="btn btn-primary" id="sSave">Save</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('#sCancel').addEventListener('click', () => wrap.remove());
  wrap.querySelector('#sSave').addEventListener('click', async () => {
    const payload = {
      id: staffMember?.id,
      name: wrap.querySelector('#sName').value.trim(),
      username: wrap.querySelector('#sUsername').value.trim(),
      password: wrap.querySelector('#sPassword').value,
      role: wrap.querySelector('#sRole').value
    };
    if (isEdit) payload.active = wrap.querySelector('#sActive').value === 'true';
    if (!payload.name || (!isEdit && (!payload.username || !payload.password))) return toast('Please fill all required fields.');
    const res = await api(isEdit ? 'updateStaff' : 'addStaff', { staff: payload });
    if (res.ok) { wrap.remove(); toast('Staff saved.'); bindStaffHandlers(); } else toast(res.error);
  });
}

async function saveSettingsForm() {
  const payload = {
    companyName: v('stCompanyName'), companyTagline: v('stTagline'), companyPhone: v('stPhone'),
    companyEmail: v('stEmail'), companyAddress: v('stAddress'), defaultCurrency: v('stCurrency'),
    taxLabel: v('stTaxLabel'), taxRate: v('stTaxRate'), invoiceFooterNote: v('stFooter'),
    bankName: v('stBankName'), bankAccountName: v('stBankAccName'), bankAccountNumber: v('stBankAccNo'),
    altPaymentMethod: v('stAltMethod'), altPaymentDetails: v('stAltDetails')
  };
  const res = await api('saveSettings', { settings: payload });
  if (res.ok) { state.settings = res.settings; toast('Settings saved.'); }
  else toast(res.error);
  function v(id) { return document.getElementById(id).value; }
}

