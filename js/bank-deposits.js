// =============================================
// FILE: js/bank-deposits.js
// Bank Finance Management
// Deposit, credit, transfer, payment, salary pay, expense
// =============================================
(function () {
  'use strict';

  const PAGE_SIZE = 20;
  let allDeposits  = [];
  let allBanks     = [];
  let currentPage  = 1;

  const TX_TYPES = {
    deposit:    { label: 'Deposit',    badge: 'success', icon: 'bi-arrow-down-circle', flow: 'in' },
    credit:     { label: 'Credit',     badge: 'primary', icon: 'bi-plus-circle',       flow: 'in' },
    transfer:   { label: 'Transfer',   badge: 'info',    icon: 'bi-arrow-left-right',  flow: 'transfer' },
    payment:    { label: 'Payment',    badge: 'warning', icon: 'bi-credit-card',       flow: 'out' },
    salary_pay: { label: 'Salary Pay', badge: 'secondary', icon: 'bi-person-check',    flow: 'out' },
    expense:    { label: 'Expense',    badge: 'danger',  icon: 'bi-wallet2',           flow: 'out' }
  };

  const TRANSACTION_MAP = {
    deposit: 'BankDeposit',
    credit: 'BankCredit',
    transfer: 'BankTransfer',
    payment: 'BankPayment',
    salary_pay: 'SalaryPay',
    expense: 'Expense'
  };

  const sb = () => window.supabaseClient;
  const fmt = n => Number(n||0).toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2});
  const today = () => new Date().toISOString().slice(0,10);

  function typeOf(d){ return (d.transaction_type || 'deposit').toLowerCase(); }
  function typeCfg(t){ return TX_TYPES[t] || TX_TYPES.deposit; }
  function isInflow(t){ return typeCfg(t).flow === 'in'; }
  function isOutflow(t){ return typeCfg(t).flow === 'out'; }

  async function getOwnerCustomerId() {
    try {
      const { data } = await sb().from('customers').select('id').eq('category','Owner').maybeSingle();
      if (data?.id) return data.id;
      const { data: created, error } = await sb().from('customers')
        .insert([{ sr_no: 0, name: 'Owner / Cash', category: 'Owner', balance: 0 }])
        .select('id').single();
      if (error) throw error;
      return created?.id || null;
    } catch (e) {
      console.warn('Owner account not available for bank finance transaction:', e.message);
      return null;
    }
  }

  function missingColumn(message){
    const m = String(message || '').match(/'([^']+)' column|column ['"]?([a-zA-Z0-9_]+)['"]?/i);
    return m ? (m[1] || m[2]) : null;
  }

  async function safeInsertBankFinanceTransaction(payload) {
    let row = { ...payload };
    const removable = ['cash_deposit_id','reference_no','payment_mode','balance_before','balance_after','entry_method','category','salary_month','employee_id','bank_id','to_bank_id'];
    for (let i=0; i<12; i++) {
      const { error } = await sb().from('transactions').insert([row]);
      if (!error) return true;
      const col = missingColumn(error.message || error.details || '');
      if (col && Object.prototype.hasOwnProperty.call(row, col)) { delete row[col]; continue; }
      const rm = removable.find(k => Object.prototype.hasOwnProperty.call(row,k));
      if (rm && /schema cache|column/i.test(error.message || error.details || '')) { delete row[rm]; continue; }
      console.warn('Bank finance transaction insert skipped:', error.message);
      return false;
    }
    return false;
  }

  let _depositModal, _bankModal;
  function depositModal() { return _depositModal || (_depositModal = new bootstrap.Modal(document.getElementById('depositModal'))); }
  function bankModal()    { return _bankModal    || (_bankModal    = new bootstrap.Modal(document.getElementById('bankModal'))); }

  window.addEventListener('DOMContentLoaded', () => waitReady(init));

  function waitReady(cb, n=0) {
    if (window.supabaseClient && window.PETRO_SESSION_READY) return setTimeout(cb, 400);
    if (n>80) return;
    setTimeout(() => waitReady(cb, n+1), 100);
  }

  async function init() {
    if (!window.hasPermission('canManageBanks')) {
      document.querySelector('.container-fluid')?.insertAdjacentHTML('afterbegin',
        `<div class="alert alert-danger"><i class="bi bi-lock me-2"></i>You do not have permission to access Bank Finance.</div>`);
      return;
    }

    const now = new Date();
    const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    document.getElementById('filter-from').value = firstOfMonth;
    document.getElementById('filter-to').value   = today();

    await Promise.all([loadBanks(), loadDeposits()]);
    loadSummary();
  }

  // ── BANKS ─────────────────────────────────────────────────────
  async function loadBanks() {
    const { data, error } = await sb().from('banks').select('*').order('name');
    if (error) { console.error('Banks load error:', error.message); return; }
    allBanks = data || [];
    renderBanksList();
    populateBankDropdowns();
    document.getElementById('stat-banks').textContent = allBanks.length;
  }

  function renderBanksList() {
    const el = document.getElementById('banks-list');
    if (!allBanks.length) {
      el.innerHTML = '<div class="text-center py-3 text-muted small">No banks added yet.<br>Click "Add Bank" to start.</div>';
      return;
    }
    el.innerHTML = allBanks.map(b => `
      <div class="d-flex align-items-center justify-content-between py-2 border-bottom">
        <div>
          <span class="badge bg-${b.color||'primary'} me-2">${esc(b.name)}</span>
          ${b.account_number ? `<span class="text-muted small">${esc(b.account_number)}</span>` : ''}
        </div>
        <div>
          <button class="btn btn-link btn-sm p-0 me-2 text-primary" onclick="openBankModal('${b.id}')">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-link btn-sm p-0 text-danger" onclick="deleteBank('${b.id}')">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </div>`).join('');
  }

  function populateBankDropdowns() {
    ['dep-bank','dep-to-bank','filter-bank'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const val = sel.value;
      sel.innerHTML = id === 'filter-bank'
        ? '<option value="">All Banks</option>'
        : '<option value="">— Select Bank —</option>';
      allBanks.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.name;
        sel.appendChild(opt);
      });
      if (val) sel.value = val;
    });
  }

  window.openBankModal = function (bankId) {
    document.getElementById('bank-edit-id').value = bankId || '';
    document.getElementById('modal-bank-title').textContent = bankId ? 'Edit Bank' : 'Add Bank';
    if (bankId) {
      const b = allBanks.find(x => x.id == bankId);
      if (b) {
        document.getElementById('bank-name').value    = b.name || '';
        document.getElementById('bank-account').value = b.account_number || '';
        document.getElementById('bank-branch').value  = b.branch || '';
        document.getElementById('bank-color').value   = b.color || 'primary';
      }
    } else {
      document.getElementById('bank-name').value    = '';
      document.getElementById('bank-account').value = '';
      document.getElementById('bank-branch').value  = '';
      document.getElementById('bank-color').value   = 'primary';
    }
    bankModal().show();
  };

  window.saveBank = async function () {
    const id      = document.getElementById('bank-edit-id').value;
    const name    = document.getElementById('bank-name').value.trim();
    const account = document.getElementById('bank-account').value.trim();
    const branch  = document.getElementById('bank-branch').value.trim();
    const color   = document.getElementById('bank-color').value;
    if (!name) { toast('Bank name is required.', 'warning'); return; }

    const row = { name, account_number: account, branch, color };
    let error;
    if (id) {
      ({ error } = await sb().from('banks').update(row).eq('id', id));
    } else {
      ({ error } = await sb().from('banks').insert({ ...row, created_at: new Date().toISOString() }));
    }
    if (error) { toast('Error saving bank: ' + error.message, 'danger'); return; }
    bankModal().hide();
    toast('✅ Bank saved!', 'success');
    await loadBanks();
    await loadDeposits();
  };

  window.deleteBank = async function (bankId) {
    const used = allDeposits.some(d => d.bank_id == bankId || d.to_bank_id == bankId);
    if (used) { toast('Cannot delete — finance entries exist for this bank. Remove them first.', 'danger'); return; }
    if (!confirm('Delete this bank?')) return;
    const { error } = await sb().from('banks').delete().eq('id', bankId);
    if (error) { toast('Error: ' + error.message, 'danger'); return; }
    toast('Bank deleted.', 'warning');
    await loadBanks();
  };

  // ── FINANCE ENTRIES ───────────────────────────────────────────
  window.loadDeposits = async function () {
    const from = document.getElementById('filter-from').value;
    const to   = document.getElementById('filter-to').value;
    const bank = document.getElementById('filter-bank').value;
    const type = document.getElementById('filter-type')?.value || '';

    let query = sb().from('cash_deposits').select('*').order('deposit_date', { ascending: false });
    if (from) query = query.gte('deposit_date', from);
    if (to)   query = query.lte('deposit_date', to);

    const { data, error } = await query;
    if (error) { toast('Error loading finance entries: ' + error.message, 'danger'); return; }

    allDeposits = (data || []).filter(d => {
      const t = typeOf(d);
      if (type && t !== type) return false;
      if (bank && String(d.bank_id) !== String(bank) && String(d.to_bank_id || '') !== String(bank)) return false;
      return true;
    });

    currentPage = 1;
    renderDeposits();
    loadSummary();
  };

  function renderDeposits() {
    const tbody = document.getElementById('deposits-tbody');
    if (!allDeposits.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-5 text-muted">
        <i class="bi bi-inbox fs-2 d-block mb-2"></i>No finance entries found for this period.</td></tr>`;
      document.getElementById('pagination-info').textContent = 'Showing 0 records';
      document.getElementById('pagination-btns').innerHTML  = '';
      return;
    }

    const start  = (currentPage - 1) * PAGE_SIZE;
    const slice  = allDeposits.slice(start, start + PAGE_SIZE);
    const total  = allDeposits.length;
    const pages  = Math.ceil(total / PAGE_SIZE);

    tbody.innerHTML = slice.map(d => {
      const bank  = allBanks.find(b => b.id == d.bank_id);
      const toBank= allBanks.find(b => b.id == d.to_bank_id);
      const bName = bank ? bank.name : (d.bank_name || 'Unknown');
      const bColor= bank ? (bank.color || 'primary') : 'secondary';
      const tbName= toBank ? toBank.name : '—';
      const t     = typeOf(d);
      const cfg   = typeCfg(t);
      const amountClass = isOutflow(t) ? 'text-danger' : (t === 'transfer' ? 'text-info' : 'text-success');
      const amountSign  = isOutflow(t) ? '-' : (t === 'transfer' ? '↔ ' : '+');
      return `<tr class="deposit-row">
        <td class="fw-semibold">${fmtDate(d.deposit_date)}</td>
        <td><span class="badge bg-${cfg.badge}"><i class="bi ${cfg.icon} me-1"></i>${cfg.label}</span></td>
        <td><span class="badge bg-${bColor} badge-bank">${esc(bName)}</span></td>
        <td class="small text-muted">${esc(tbName)}</td>
        <td class="${amountClass} fw-bold">${amountSign} Rs. ${fmt(d.amount)}</td>
        <td class="small text-muted">${esc(d.party_name || d.deposited_by || '—')}</td>
        <td class="small text-muted">${esc(d.reference||'—')}</td>
        <td class="small text-muted">${esc(d.note||'—')}</td>
        <td>
          <button class="btn btn-link btn-sm p-0 me-2 text-primary" onclick="openEditDeposit(${d.id})">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-link btn-sm p-0 text-danger" onclick="deleteDeposit(${d.id})">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>`;
    }).join('');

    document.getElementById('pagination-info').textContent =
      `Showing ${start+1}–${Math.min(start+PAGE_SIZE, total)} of ${total} records`;
    renderPagination(pages);
  }

  function renderPagination(pages) {
    const el = document.getElementById('pagination-btns');
    if (pages <= 1) { el.innerHTML = ''; return; }
    let html = '<nav><ul class="pagination pagination-sm mb-0">';
    html += `<li class="page-item ${currentPage===1?'disabled':''}">
      <a class="page-link" href="#" onclick="goPage(${currentPage-1});return false">‹</a></li>`;
    for (let i=1; i<=pages; i++) {
      html += `<li class="page-item ${i===currentPage?'active':''}">
        <a class="page-link" href="#" onclick="goPage(${i});return false">${i}</a></li>`;
    }
    html += `<li class="page-item ${currentPage===pages?'disabled':''}">
      <a class="page-link" href="#" onclick="goPage(${currentPage+1});return false">›</a></li>`;
    html += '</ul></nav>';
    el.innerHTML = html;
  }

  window.goPage = function(p) { currentPage = p; renderDeposits(); };

  // ── Summary ───────────────────────────────────────────────────
  function loadSummary() {
    const now     = new Date();
    const todayStr= today();
    const y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,'0');
    const monthStart = `${y}-${m}-01`;

    const todayIn = allDeposits
      .filter(d => d.deposit_date === todayStr && (isInflow(typeOf(d)) || typeOf(d) === 'transfer'))
      .reduce((s, d) => s + Number(d.amount||0), 0);

    const monthIn = allDeposits
      .filter(d => d.deposit_date >= monthStart && (isInflow(typeOf(d)) || typeOf(d) === 'transfer'))
      .reduce((s, d) => s + Number(d.amount||0), 0);

    const monthOut = allDeposits
      .filter(d => d.deposit_date >= monthStart && (isOutflow(typeOf(d)) || typeOf(d) === 'transfer'))
      .reduce((s, d) => s + Number(d.amount||0), 0);

    document.getElementById('stat-today').textContent  = 'Rs. ' + fmt(todayIn);
    document.getElementById('stat-month').textContent  = 'Rs. ' + fmt(monthIn);
    const outEl = document.getElementById('stat-out') || document.getElementById('stat-count');
    if (outEl) outEl.textContent = 'Rs. ' + fmt(monthOut);

    const bankTotals = {};
    allBanks.forEach(b => bankTotals[b.id] = { in: 0, out: 0 });
    allDeposits.forEach(d => {
      const t = typeOf(d);
      const amount = Number(d.amount || 0);
      if (t === 'transfer') {
        if (d.bank_id) bankTotals[d.bank_id] = bankTotals[d.bank_id] || { in: 0, out: 0 };
        if (d.to_bank_id) bankTotals[d.to_bank_id] = bankTotals[d.to_bank_id] || { in: 0, out: 0 };
        if (d.bank_id) bankTotals[d.bank_id].out += amount;
        if (d.to_bank_id) bankTotals[d.to_bank_id].in += amount;
      } else if (isOutflow(t)) {
        const k = d.bank_id || 'unknown';
        bankTotals[k] = bankTotals[k] || { in: 0, out: 0 };
        bankTotals[k].out += amount;
      } else {
        const k = d.bank_id || 'unknown';
        bankTotals[k] = bankTotals[k] || { in: 0, out: 0 };
        bankTotals[k].in += amount;
      }
    });

    const summEl = document.getElementById('bank-summary-list');
    const entries = Object.entries(bankTotals)
      .filter(([,v]) => v.in || v.out)
      .sort((a,b) => (b[1].in-b[1].out) - (a[1].in-a[1].out));
    if (!entries.length) {
      summEl.innerHTML = '<div class="text-center text-muted py-2 small">No data</div>';
      return;
    }
    const grandIn = entries.reduce((s,[,v])=>s+v.in,0);
    const grandOut= entries.reduce((s,[,v])=>s+v.out,0);
    const largest = Math.max(1, ...entries.map(([,v]) => Math.abs(v.in - v.out)));
    summEl.innerHTML = entries.map(([bankId, totals]) => {
      const bank  = allBanks.find(b => b.id == bankId);
      const bName = bank ? bank.name : 'Unknown';
      const bColor= bank ? (bank.color||'primary') : 'secondary';
      const net   = totals.in - totals.out;
      const pct   = Math.round(Math.abs(net)/largest*100);
      return `<div class="mb-3">
        <div class="d-flex justify-content-between mb-1">
          <span class="badge bg-${bColor} badge-bank">${esc(bName)}</span>
          <strong class="small ${net < 0 ? 'text-danger' : 'text-success'}">Net Rs. ${fmt(net)}</strong>
        </div>
        <div class="d-flex justify-content-between small text-muted mb-1">
          <span>In: Rs. ${fmt(totals.in)}</span><span>Out: Rs. ${fmt(totals.out)}</span>
        </div>
        <div class="progress" style="height:6px">
          <div class="progress-bar bg-${bColor}" style="width:${pct}%"></div>
        </div>
      </div>`;
    }).join('') + `<div class="border-top pt-2">
      <div class="d-flex justify-content-between"><strong class="small">Grand In</strong><strong class="small text-success">Rs. ${fmt(grandIn)}</strong></div>
      <div class="d-flex justify-content-between"><strong class="small">Grand Out</strong><strong class="small text-danger">Rs. ${fmt(grandOut)}</strong></div>
      <div class="d-flex justify-content-between"><strong class="small">Net</strong><strong class="small ${grandIn-grandOut < 0 ? 'text-danger' : 'text-success'}">Rs. ${fmt(grandIn-grandOut)}</strong></div>
    </div>`;
  }

  // ── Add / Edit finance entry ─────────────────────────────────
  window.onFinanceTypeChange = function () {
    const t = document.getElementById('dep-type')?.value || 'deposit';
    const toWrap = document.getElementById('dep-to-bank-wrap');
    const bankLabel = document.getElementById('dep-bank-label');
    const byLabel = document.getElementById('dep-by-label');
    const title = document.getElementById('modal-deposit-title');
    const btn = document.querySelector('#depositModal .btn-primary');

    if (toWrap) toWrap.style.display = t === 'transfer' ? '' : 'none';
    if (bankLabel) bankLabel.innerHTML = t === 'transfer' ? 'Transfer From Bank <span class="text-danger">*</span>' : 'Bank <span class="text-danger">*</span>';
    if (byLabel) byLabel.textContent = t === 'salary_pay' ? 'Employee Name / Detail' : (t === 'expense' ? 'Expense Category / Paid To' : 'Party / By');
    if (title) title.textContent = document.getElementById('dep-id')?.value ? `Edit ${typeCfg(t).label}` : `New ${typeCfg(t).label}`;
    if (btn) btn.innerHTML = `<i class="bi bi-save me-1"></i>Save ${typeCfg(t).label}`;
  };

  window.openAddDepositModal = function () {
    document.getElementById('dep-id').value     = '';
    document.getElementById('dep-date').value   = today();
    document.getElementById('dep-type').value   = 'deposit';
    document.getElementById('dep-bank').value   = '';
    document.getElementById('dep-to-bank').value= '';
    document.getElementById('dep-amount').value = '';
    document.getElementById('dep-by').value     = window.currentUserProfile?.full_name || '';
    document.getElementById('dep-ref').value    = '';
    document.getElementById('dep-note').value   = '';
    document.getElementById('modal-deposit-title').textContent = 'New Deposit';
    window.onFinanceTypeChange();
    depositModal().show();
  };

  window.openEditDeposit = function (id) {
    const d = allDeposits.find(x => x.id === id);
    if (!d) return;
    const t = typeOf(d);
    document.getElementById('dep-id').value     = d.id;
    document.getElementById('dep-date').value   = d.deposit_date || '';
    document.getElementById('dep-type').value   = t;
    document.getElementById('dep-bank').value   = d.bank_id || '';
    document.getElementById('dep-to-bank').value= d.to_bank_id || '';
    document.getElementById('dep-amount').value = d.amount || '';
    document.getElementById('dep-by').value     = d.party_name || d.deposited_by || '';
    document.getElementById('dep-ref').value    = d.reference || '';
    document.getElementById('dep-note').value   = d.note || '';
    document.getElementById('modal-deposit-title').textContent = `Edit ${typeCfg(t).label}`;
    window.onFinanceTypeChange();
    depositModal().show();
  };

  window.saveDeposit = async function () {
    const id     = document.getElementById('dep-id').value;
    const date   = document.getElementById('dep-date').value;
    const type   = document.getElementById('dep-type').value || 'deposit';
    const bankId = document.getElementById('dep-bank').value;
    const toBank = document.getElementById('dep-to-bank').value;
    const amount = parseFloat(document.getElementById('dep-amount').value);
    const by     = document.getElementById('dep-by').value.trim();
    const ref    = document.getElementById('dep-ref').value.trim();
    const note   = document.getElementById('dep-note').value.trim();

    if (!date)                 { toast('Date is required.', 'warning'); return; }
    if (!type)                 { toast('Please select transaction type.', 'warning'); return; }
    if (!bankId)               { toast('Please select a bank.', 'warning'); return; }
    if (type === 'transfer' && !toBank) { toast('Please select transfer to bank.', 'warning'); return; }
    if (type === 'transfer' && String(bankId) === String(toBank)) { toast('From bank and to bank cannot be same.', 'warning'); return; }
    if (!amount || amount <= 0) { toast('Amount must be greater than 0.', 'warning'); return; }

    const row = {
      deposit_date: date,
      transaction_type: type,
      bank_id:      bankId,
      to_bank_id:   type === 'transfer' ? toBank : null,
      amount:       amount,
      deposited_by: by || null,
      party_name:   by || null,
      category:     type === 'expense' ? (by || null) : null,
      reference:    ref || null,
      note:         note || null,
      created_by:   window.currentUser?.id || null,
      updated_at:   new Date().toISOString()
    };

    let error, savedDeposit = null;
    if (id) {
      ({ error } = await sb().from('cash_deposits').update(row).eq('id', id));
      savedDeposit = { ...row, id };
    } else {
      row.created_at = new Date().toISOString();
      const res = await sb().from('cash_deposits').insert(row).select().single();
      error = res.error;
      savedDeposit = res.data;
    }
    if (error) { toast('Error saving entry: ' + error.message + ' | Please run PETROFLOW_FINANCE_SALARY_DB_CHANGES.sql first.', 'danger'); return; }

    if (!id && savedDeposit) {
      const bank = allBanks.find(b => String(b.id) === String(bankId));
      const dest = allBanks.find(b => String(b.id) === String(toBank));
      const ownerId = await getOwnerCustomerId();
      const label = typeCfg(type).label;
      const desc = type === 'transfer'
        ? `Bank Transfer from ${bank?.name || 'Bank'} to ${dest?.name || 'Bank'}${ref ? ' | Ref: '+ref : ''}${note ? ' | '+note : ''}`
        : `${label} - ${bank?.name || 'Bank'}${by ? ' | '+by : ''}${ref ? ' | Ref: '+ref : ''}${note ? ' | '+note : ''}`;

      await safeInsertBankFinanceTransaction({
        customer_id: ownerId,
        transaction_type: TRANSACTION_MAP[type] || label,
        amount: amount,
        charges: amount,
        cash_deposit_id: savedDeposit.id,
        reference_no: ref || null,
        payment_mode: type === 'transfer' ? `${bank?.name || 'Bank'} → ${dest?.name || 'Bank'}` : (bank?.name || 'Bank'),
        entry_method: 'bank_finance',
        category: row.category,
        description: desc,
        created_at: new Date(date + 'T12:00:00').toISOString()
      });
    }

    depositModal().hide();
    toast('✅ Entry saved!', 'success');
    await loadDeposits();
  };

  window.deleteDeposit = async function (id) {
    if (!confirm('Delete this finance entry?')) return;
    const { error } = await sb().from('cash_deposits').delete().eq('id', id);
    if (error) { toast('Error: ' + error.message, 'danger'); return; }
    toast('Entry deleted.', 'warning');
    await loadDeposits();
  };

  window.resetFilters = function () {
    const now = new Date();
    const first = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    document.getElementById('filter-from').value = first;
    document.getElementById('filter-to').value   = today();
    document.getElementById('filter-bank').value = '';
    const typeEl = document.getElementById('filter-type');
    if (typeEl) typeEl.value = '';
    loadDeposits();
  };

  function fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d+'T00:00:00').toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric',weekday:'short'}); }
    catch { return d; }
  }
  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function toast(msg, type='success') {
    const t = document.getElementById('liveToast');
    const m = document.getElementById('toast-message');
    if (!t||!m) return;
    m.textContent = msg;
    t.className = `toast bg-${type==='danger'?'danger':type==='warning'?'warning':'success'} text-white`;
    new bootstrap.Toast(t,{delay:4500}).show();
  }

  console.log('✅ bank-deposits.js loaded');
})();
