/* global bootstrap */
(() => {
  'use strict';

  let banks = [];
  let allEntries = [];
  let filteredEntries = [];
  let currentPage = 1;
  const pageSize = 12;

  // UI types are clearer for business use. DB still stores old safe values
  // cash_given/cash_received so no new DB constraint is required.
  const TYPES = {
    credit_given: {
      label: 'Credit / Cash Given to Owner',
      short: 'Credit Given',
      badge: 'bg-danger',
      effect: 'debit',
      help: 'Owner/dir expense ne business se cash ya bank se paisay liye. Pending balance barhega.',
      bankType: 'payment',
      dbType: 'cash_given',
      systemCategory: 'Credit / Cash Given'
    },
    vasooli_received: {
      label: 'Vasooli / Cash Received Back',
      short: 'Vasooli',
      badge: 'bg-success',
      effect: 'credit',
      help: 'Owner/dir expense ne paisay wapis diye. Pending kam hoga; extra amount owner advance/credit ban jaye gi.',
      bankType: 'credit',
      dbType: 'cash_received',
      systemCategory: 'Vasooli / Payment Received'
    },
    advance_received: {
      label: 'Owner Advance Received',
      short: 'Advance Received',
      badge: 'bg-secondary',
      effect: 'credit',
      help: 'Owner ne extra advance diya. Ye profit nahi, owner ka advance/credit hai. Baad me owner wapis le sakta hai.',
      bankType: 'credit',
      dbType: 'cash_received',
      systemCategory: 'Owner Advance Received'
    },
    advance_return: {
      label: 'Return Owner Advance',
      short: 'Advance Return',
      badge: 'bg-dark',
      effect: 'debit',
      help: 'Owner ne pehle jo advance diya tha, ab us me se cash/bank wapis le raha hai. Sirf advance balance tak allow hai.',
      bankType: 'payment',
      dbType: 'cash_given',
      systemCategory: 'Owner Advance Return'
    },
    bank_transfer_to_owner: {
      label: 'Bank Transfer to Owner Account',
      short: 'Bank → Owner',
      badge: 'bg-warning text-dark',
      effect: 'debit',
      help: 'Business bank se owner/direct expense bank account me transfer. Pending balance barhega.',
      bankType: 'transfer',
      dbType: 'bank_transfer_to_owner',
      systemCategory: 'Bank Transfer to Owner'
    },
    bank_transfer_from_owner: {
      label: 'Bank Transfer from Owner Account',
      short: 'Owner → Bank',
      badge: 'bg-info text-dark',
      effect: 'credit',
      help: 'Owner/direct expense bank se business bank me transfer. Pending kam hoga; extra advance ban sakta hai.',
      bankType: 'transfer',
      dbType: 'bank_transfer_from_owner',
      systemCategory: 'Bank Transfer from Owner'
    },
    expense_settled: {
      label: 'Expense Bill Settled',
      short: 'Expense Settled',
      badge: 'bg-primary',
      effect: 'credit',
      help: 'Owner ne jo cash liya tha us ka bill/expense adjust hua. Pending kam hoga aur Profit & Loss me expense add hoga.',
      bankType: 'expense',
      dbType: 'expense_settled',
      systemCategory: 'Direct Expense'
    }
  };

  const ADVANCE_RECEIVED_CAT = 'Owner Advance Received';
  const ADVANCE_RETURN_CAT = 'Owner Advance Return';

  const sb = () => window.supabaseClient;
  const num = v => {
    const n = parseFloat(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const fmt = n => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const today = () => new Date().toISOString().slice(0, 10);
  const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));

  function uiTypeOf(rowOrType) {
    if (typeof rowOrType === 'string') return TYPES[rowOrType] ? rowOrType : 'credit_given';
    const r = rowOrType || {};
    const cat = String(r.expense_category || '').trim();
    if (r.entry_type === 'cash_given' && cat === ADVANCE_RETURN_CAT) return 'advance_return';
    if (r.entry_type === 'cash_received' && cat === ADVANCE_RECEIVED_CAT) return 'advance_received';
    if (r.entry_type === 'cash_given') return 'credit_given';
    if (r.entry_type === 'cash_received') return 'vasooli_received';
    if (TYPES[r.entry_type]) return r.entry_type;
    return 'credit_given';
  }
  const typeCfg = x => TYPES[uiTypeOf(x)] || TYPES.credit_given;
  const debitOf = r => typeCfg(r).effect === 'debit' ? num(r.amount) : 0;
  const creditOf = r => typeCfg(r).effect === 'credit' ? num(r.amount) : 0;
  const dbTypeFor = ui => (TYPES[ui] || TYPES.credit_given).dbType;

  window.addEventListener('DOMContentLoaded', () => waitReady(init));

  function waitReady(cb, n = 0) {
    if (window.supabaseClient && window.PETRO_SESSION_READY) return setTimeout(cb, 350);
    if (n > 80) return;
    setTimeout(() => waitReady(cb, n + 1), 100);
  }

  async function init() {
    if (!window.hasPermission('canManageBanks')) {
      document.querySelector('.container-fluid')?.insertAdjacentHTML('afterbegin',
        `<div class="alert alert-danger"><i class="bi bi-lock me-2"></i>You do not have permission to access Dir Expense Khata.</div>`);
      return;
    }

    const now = new Date();
    document.getElementById('filter-from').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    document.getElementById('filter-to').value = today();

    await loadBanks();
    await loadDirEntries();
  }

  function missingColumn(message) {
    const m = String(message || '').match(/'([^']+)' column|column ['"]?([a-zA-Z0-9_]+)['"]?/i);
    return m ? (m[1] || m[2]) : null;
  }

  async function safeInsert(table, payload, removable = []) {
    let row = { ...payload };
    for (let i = 0; i < 14; i++) {
      const { data, error } = await sb().from(table).insert([row]).select().single();
      if (!error) return { data, error: null };
      const col = missingColumn(error.message || error.details || '');
      if (col && Object.prototype.hasOwnProperty.call(row, col)) { delete row[col]; continue; }
      const rm = removable.find(k => Object.prototype.hasOwnProperty.call(row, k));
      if (rm && /schema cache|column/i.test(error.message || error.details || '')) { delete row[rm]; continue; }
      return { data: null, error };
    }
    return { data: null, error: { message: `Could not insert ${table}` } };
  }

  async function safeUpdate(table, payload, id, removable = []) {
    let row = { ...payload };
    for (let i = 0; i < 14; i++) {
      const { data, error } = await sb().from(table).update(row).eq('id', id).select().single();
      if (!error) return { data, error: null };
      const col = missingColumn(error.message || error.details || '');
      if (col && Object.prototype.hasOwnProperty.call(row, col)) { delete row[col]; continue; }
      const rm = removable.find(k => Object.prototype.hasOwnProperty.call(row, k));
      if (rm && /schema cache|column/i.test(error.message || error.details || '')) { delete row[rm]; continue; }
      return { data: null, error };
    }
    return { data: null, error: { message: `Could not update ${table}` } };
  }

  async function safeInsertCashDeposit(payload) {
    let row = { ...payload };
    const removable = ['transaction_type','to_bank_id','party_name','direct_expense_id','salary_payment_id','salary_month','employee_id','updated_at'];
    for (let i = 0; i < 12; i++) {
      const { data, error } = await sb().from('cash_deposits').insert([row]).select('id').single();
      if (!error) return data?.id || null;
      const col = missingColumn(error.message || error.details || '');
      if (col && Object.prototype.hasOwnProperty.call(row, col)) { delete row[col]; continue; }
      const rm = removable.find(k => Object.prototype.hasOwnProperty.call(row, k));
      if (rm && /schema cache|column/i.test(error.message || error.details || '')) { delete row[rm]; continue; }
      console.warn('Dir expense bank finance entry skipped:', error.message);
      return null;
    }
    return null;
  }

  async function safeInsertExpenseTransaction(payload) {
    let row = { ...payload };
    const removable = ['direct_expense_id','cash_deposit_id','reference_no','payment_mode','bank_id','to_bank_id','entry_method','category','linked_table','linked_id','notes'];
    for (let i = 0; i < 12; i++) {
      const { data, error } = await sb().from('transactions').insert([row]).select('id').single();
      if (!error) return data?.id || null;
      const col = missingColumn(error.message || error.details || '');
      if (col && Object.prototype.hasOwnProperty.call(row, col)) { delete row[col]; continue; }
      const rm = removable.find(k => Object.prototype.hasOwnProperty.call(row, k));
      if (rm && /schema cache|column/i.test(error.message || error.details || '')) { delete row[rm]; continue; }
      console.warn('Dir expense P&L transaction insert skipped:', error.message);
      return null;
    }
    return null;
  }

  async function loadBanks() {
    const { data, error } = await sb().from('banks').select('*').order('name');
    if (error) { toast('Error loading banks: ' + error.message, 'danger'); return; }
    banks = data || [];
    populateBankDropdowns();
  }

  function populateBankDropdowns() {
    ['filter-bank','dir-bank','dir-to-bank'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const current = sel.value;
      sel.innerHTML = id === 'filter-bank' ? '<option value="">All Banks</option>' : '<option value="">— Select Bank —</option>';
      banks.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.name;
        sel.appendChild(opt);
      });
      if (current) sel.value = current;
    });
  }

  window.loadDirEntries = async function () {
    const { data, error } = await sb().from('direct_expense_entries').select('*').order('entry_date', { ascending: false }).order('id', { ascending: false });
    if (error) {
      document.getElementById('dir-tbody').innerHTML = `<tr><td colspan="9" class="text-center py-5 text-danger">Error loading Dir Expense Khata: ${esc(error.message)}<br><small>Please run the Dir Expense SQL first.</small></td></tr>`;
      toast('Error loading Dir Expense Khata: ' + error.message, 'danger');
      return;
    }

    allEntries = data || [];
    const from = document.getElementById('filter-from').value;
    const to = document.getElementById('filter-to').value;
    const type = document.getElementById('filter-type').value;
    const bank = document.getElementById('filter-bank').value;

    filteredEntries = allEntries.filter(r => {
      if (from && r.entry_date < from) return false;
      if (to && r.entry_date > to) return false;
      if (type && uiTypeOf(r) !== type) return false;
      if (bank && String(r.bank_id || '') !== String(bank) && String(r.to_bank_id || '') !== String(bank)) return false;
      return true;
    });
    currentPage = 1;
    renderEntries();
    updateStats();
    renderBankSummary();
  };

  function balanceMap() {
    let bal = 0;
    const map = new Map();
    [...allEntries].sort((a,b) => String(a.entry_date).localeCompare(String(b.entry_date)) || Number(a.id)-Number(b.id)).forEach(r => {
      bal += debitOf(r) - creditOf(r);
      map.set(String(r.id), bal);
    });
    return map;
  }

  function currentBalance(excludeId = '') {
    return allEntries
      .filter(r => !excludeId || String(r.id) !== String(excludeId))
      .reduce((s,r) => s + debitOf(r) - creditOf(r), 0);
  }

  function renderEntries() {
    const tbody = document.getElementById('dir-tbody');
    if (!filteredEntries.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-5 text-muted"><i class="bi bi-inbox fs-2 d-block mb-2"></i>No direct expense entries found.</td></tr>`;
      document.getElementById('dir-pagination-info').textContent = 'Showing 0 records';
      document.getElementById('dir-pagination-btns').innerHTML = '';
      return;
    }

    const balMap = balanceMap();
    const start = (currentPage - 1) * pageSize;
    const rows = filteredEntries.slice(start, start + pageSize);
    tbody.innerHTML = rows.map(r => {
      const cfg = typeCfg(r);
      const debit = debitOf(r);
      const credit = creditOf(r);
      const bank = banks.find(b => String(b.id) === String(r.bank_id));
      const toBank = banks.find(b => String(b.id) === String(r.to_bank_id));
      const mode = modeText(r, bank, toBank);
      const bal = balMap.get(String(r.id)) || 0;
      const category = r.expense_category && !['Credit / Cash Given','Vasooli / Payment Received',ADVANCE_RECEIVED_CAT,ADVANCE_RETURN_CAT,'Bank Transfer to Owner','Bank Transfer from Owner'].includes(r.expense_category)
        ? `<div class="small text-muted">${esc(r.expense_category)}</div>` : '';
      return `<tr class="dir-row">
        <td>${formatDate(r.entry_date)}</td>
        <td><span class="badge type-pill ${cfg.badge}">${esc(cfg.short)}</span>${category}</td>
        <td class="small">${mode}</td>
        <td class="text-end text-danger fw-semibold">${debit ? 'Rs. ' + fmt(debit) : '—'}</td>
        <td class="text-end text-success fw-semibold">${credit ? 'Rs. ' + fmt(credit) : '—'}</td>
        <td class="text-end ${bal > 0 ? 'balance-positive' : bal < 0 ? 'balance-negative' : 'text-muted'}">Rs. ${fmt(Math.abs(bal))}${bal < 0 ? ' Adv' : bal > 0 ? ' Pend' : ''}</td>
        <td>${r.reference_no ? esc(r.reference_no) : '—'}</td>
        <td class="small text-muted">${r.note ? esc(r.note) : '—'}</td>
        <td class="text-end">
          <button class="btn btn-link btn-sm p-0 me-2 text-primary" onclick="openDirExpenseModal('${r.id}')"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-link btn-sm p-0 text-danger" onclick="deleteDirEntry('${r.id}')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
    }).join('');

    const total = filteredEntries.length;
    document.getElementById('dir-pagination-info').textContent = `Showing ${start + 1}-${Math.min(start + pageSize, total)} of ${total} records`;
    renderPagination(total);
  }

  function renderPagination(total) {
    const pages = Math.ceil(total / pageSize);
    const el = document.getElementById('dir-pagination-btns');
    if (pages <= 1) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <button class="btn btn-sm btn-outline-secondary me-1" ${currentPage<=1?'disabled':''} onclick="changeDirPage(${currentPage-1})">Prev</button>
      <span class="small text-muted mx-1">${currentPage}/${pages}</span>
      <button class="btn btn-sm btn-outline-secondary ms-1" ${currentPage>=pages?'disabled':''} onclick="changeDirPage(${currentPage+1})">Next</button>`;
  }

  window.changeDirPage = function (page) {
    currentPage = page;
    renderEntries();
  };

  function modeText(r, bank, toBank) {
    const ui = uiTypeOf(r);
    if (ui === 'bank_transfer_to_owner') return `${esc(bank?.name || 'Business Bank')} → ${esc(toBank?.name || 'Owner Bank')}`;
    if (ui === 'bank_transfer_from_owner') return `${esc(bank?.name || 'Owner Bank')} → ${esc(toBank?.name || 'Business Bank')}`;
    if (r.payment_mode === 'bank') return esc(bank?.name || 'Bank');
    if (r.payment_mode === 'adjustment') return 'Expense Adjustment';
    return 'Cash';
  }

  function updateStats() {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const totalDebit = allEntries.reduce((s,r) => s + debitOf(r), 0);
    const totalCredit = allEntries.reduce((s,r) => s + creditOf(r), 0);
    const balance = totalDebit - totalCredit;
    const pending = Math.max(balance, 0);
    const advance = Math.max(-balance, 0);
    const monthRows = allEntries.filter(r => String(r.entry_date || '').slice(0,7) === month);
    const mCredit = monthRows.reduce((s,r) => s + creditOf(r), 0);
    const mExpense = monthRows.filter(r => uiTypeOf(r) === 'expense_settled').reduce((s,r) => s + num(r.amount), 0);

    document.getElementById('stat-balance').textContent = `Rs. ${fmt(pending)}`;
    document.getElementById('stat-balance-note').textContent = pending > 0 ? 'Owner/Dir Expense se lena' : 'No pending balance';
    document.getElementById('stat-debit').textContent = `Rs. ${fmt(advance)}`;
    document.getElementById('stat-credit').textContent = `Rs. ${fmt(mCredit)}`;
    document.getElementById('stat-expense').textContent = `Rs. ${fmt(mExpense)}`;
  }

  function renderBankSummary() {
    const el = document.getElementById('dir-bank-summary');
    if (!banks.length) { el.innerHTML = '<div class="text-center text-muted small py-3">No banks found.</div>'; return; }
    const map = new Map();
    banks.forEach(b => map.set(String(b.id), { bank: b, out: 0, in: 0 }));
    allEntries.forEach(r => {
      const ui = uiTypeOf(r), amount = num(r.amount);
      if (r.payment_mode === 'bank' && r.bank_id && map.has(String(r.bank_id))) {
        if (typeCfg(r).effect === 'debit') map.get(String(r.bank_id)).out += amount;
        else map.get(String(r.bank_id)).in += amount;
      }
      if (ui === 'bank_transfer_to_owner') {
        if (r.bank_id && map.has(String(r.bank_id))) map.get(String(r.bank_id)).out += amount;
        if (r.to_bank_id && map.has(String(r.to_bank_id))) map.get(String(r.to_bank_id)).in += amount;
      }
      if (ui === 'bank_transfer_from_owner') {
        if (r.bank_id && map.has(String(r.bank_id))) map.get(String(r.bank_id)).out += amount;
        if (r.to_bank_id && map.has(String(r.to_bank_id))) map.get(String(r.to_bank_id)).in += amount;
      }
    });
    const rows = [...map.values()].filter(x => x.out || x.in).slice(0, 8);
    if (!rows.length) { el.innerHTML = '<div class="text-center text-muted small py-3">No bank movement yet.</div>'; return; }
    el.innerHTML = rows.map(x => `<div class="border-bottom py-2">
      <div class="fw-semibold">${esc(x.bank.name)}</div>
      <div class="small text-muted d-flex justify-content-between"><span>Out Rs. ${fmt(x.out)}</span><span>In Rs. ${fmt(x.in)}</span></div>
    </div>`).join('');
  }

  window.resetDirFilters = function () {
    const now = new Date();
    document.getElementById('filter-from').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    document.getElementById('filter-to').value = today();
    document.getElementById('filter-type').value = '';
    document.getElementById('filter-bank').value = '';
    loadDirEntries();
  };

  let _modal;
  function dirModal() { return _modal || (_modal = new bootstrap.Modal(document.getElementById('dirExpenseModal'))); }

  window.openDirExpenseModal = function (id) {
    document.getElementById('dir-id').value = id || '';
    document.getElementById('modal-dir-title').textContent = id ? 'Edit Dir Expense Entry' : 'New Dir Expense Entry';
    const r = id ? allEntries.find(x => String(x.id) === String(id)) : null;
    document.getElementById('dir-date').value = r?.entry_date || today();
    document.getElementById('dir-type').value = r ? uiTypeOf(r) : 'credit_given';
    document.getElementById('dir-mode').value = r?.payment_mode && ['cash','bank'].includes(r.payment_mode) ? r.payment_mode : 'cash';
    document.getElementById('dir-bank').value = r?.bank_id || '';
    document.getElementById('dir-to-bank').value = r?.to_bank_id || '';
    document.getElementById('dir-amount').value = r?.amount || '';
    const ui = r ? uiTypeOf(r) : 'credit_given';
    document.getElementById('dir-expense-category').value = ui === 'expense_settled' ? (r?.expense_category || '') : '';
    document.getElementById('dir-reference').value = r?.reference_no || '';
    document.getElementById('dir-note').value = r?.note || '';
    onDirTypeChange();
    dirModal().show();
  };

  window.onDirTypeChange = function () {
    const ui = document.getElementById('dir-type').value;
    const mode = document.getElementById('dir-mode').value;
    const isTransfer = ui === 'bank_transfer_to_owner' || ui === 'bank_transfer_from_owner';
    const isExpense = ui === 'expense_settled';
    document.getElementById('dir-type-help').textContent = typeCfg(ui).help;
    document.getElementById('dir-mode-wrap').style.display = isTransfer || isExpense ? 'none' : '';
    document.getElementById('dir-bank-wrap').style.display = isTransfer || mode === 'bank' ? '' : 'none';
    document.getElementById('dir-to-bank-wrap').style.display = isTransfer ? '' : 'none';
    document.getElementById('dir-expense-category-wrap').style.display = isExpense ? '' : 'none';
    if (isTransfer) {
      document.getElementById('dir-bank-label').textContent = ui === 'bank_transfer_to_owner' ? 'From Business Bank' : 'From Owner Bank Account';
      document.getElementById('dir-to-bank-label').textContent = ui === 'bank_transfer_to_owner' ? 'To Owner Bank Account' : 'To Business Bank';
    } else if (mode === 'bank') {
      if (ui === 'credit_given' || ui === 'advance_return') document.getElementById('dir-bank-label').textContent = 'Paid From Bank';
      else document.getElementById('dir-bank-label').textContent = 'Received In Bank';
    } else {
      document.getElementById('dir-bank-label').textContent = 'Bank';
    }
  };

  window.saveDirEntry = async function () {
    const id = document.getElementById('dir-id').value;
    const ui = document.getElementById('dir-type').value;
    const cfg = typeCfg(ui);
    const amount = num(document.getElementById('dir-amount').value);
    const entryDate = document.getElementById('dir-date').value;
    const isTransfer = ui === 'bank_transfer_to_owner' || ui === 'bank_transfer_from_owner';
    const isExpense = ui === 'expense_settled';
    const mode = isTransfer ? 'bank_transfer' : isExpense ? 'adjustment' : document.getElementById('dir-mode').value;
    const bankId = (isTransfer || mode === 'bank') ? (document.getElementById('dir-bank').value || null) : null;
    const toBankId = isTransfer ? (document.getElementById('dir-to-bank').value || null) : null;
    const referenceNo = document.getElementById('dir-reference').value.trim();
    const note = document.getElementById('dir-note').value.trim();
    const expenseCategory = isExpense
      ? (document.getElementById('dir-expense-category').value.trim() || 'Direct Expense')
      : cfg.systemCategory;

    if (!entryDate) { toast('Date is required.', 'warning'); return; }
    if (!amount || amount <= 0) { toast('Amount must be greater than 0.', 'warning'); return; }
    if ((isTransfer || mode === 'bank') && !bankId) { toast('Please select bank.', 'warning'); return; }
    if (isTransfer && !toBankId) { toast('Please select second bank for transfer.', 'warning'); return; }
    if (isTransfer && String(bankId) === String(toBankId)) { toast('From Bank and To Bank cannot be same.', 'warning'); return; }

    const balBefore = currentBalance(id);
    const pending = Math.max(balBefore, 0);
    const advance = Math.max(-balBefore, 0);
    if (ui === 'advance_return') {
      if (advance <= 0) { toast('Owner advance balance available nahi hai. Agar owner new cash le raha hai to Credit / Cash Given option use karo.', 'warning'); return; }
      if (amount > advance + 0.01) { toast(`Advance return Rs. ${fmt(advance)} se zyada nahi ho sakta. Extra amount ke liye Credit / Cash Given option use karo.`, 'warning'); return; }
    }
    if (ui === 'expense_settled') {
      if (pending <= 0) { toast('Pending balance nahi hai. Direct expense ke liye Transactions Expense page use karo.', 'warning'); return; }
      if (amount > pending + 0.01) { toast(`Expense settlement pending balance Rs. ${fmt(pending)} se zyada nahi ho sakti.`, 'warning'); return; }
    }
    if ((ui === 'vasooli_received' || ui === 'bank_transfer_from_owner') && amount > pending + 0.01 && pending > 0) {
      const extra = amount - pending;
      if (!confirm(`Vasooli pending se Rs. ${fmt(extra)} zyada hai. Extra amount owner advance/credit ban jaye ga. Continue?`)) return;
    }
    if (ui === 'advance_received' && pending > 0) {
      if (!confirm(`Abhi pending Rs. ${fmt(pending)} hai. Owner advance entry balance ko pehle pending se adjust karegi, extra advance banega. Continue?`)) return;
    }

    const baseRow = {
      entry_date: entryDate,
      entry_type: dbTypeFor(ui),
      amount,
      payment_mode: mode,
      bank_id: bankId,
      to_bank_id: toBankId,
      expense_category: expenseCategory,
      reference_no: referenceNo,
      note,
      created_by: window.currentUser?.id || null,
      company_id: window.currentUserProfile?.company_id || null,
      updated_at: new Date().toISOString()
    };
    const removable = ['bank_id','to_bank_id','expense_category','reference_no','created_by','company_id','cash_deposit_id','transaction_id','updated_at'];

    if (id) {
      const old = allEntries.find(x => String(x.id) === String(id));
      await cleanupLinkedRows(old);
      const { data, error } = await safeUpdate('direct_expense_entries', { ...baseRow, cash_deposit_id: null, transaction_id: null }, id, removable);
      if (error) { toast('Error saving entry: ' + error.message, 'danger'); return; }
      await createLinkedRows(data || { ...baseRow, id });
      toast('✅ Dir expense entry updated.', 'success');
    } else {
      const { data, error } = await safeInsert('direct_expense_entries', { ...baseRow, created_at: new Date().toISOString() }, removable);
      if (error) { toast('Error saving entry: ' + error.message, 'danger'); return; }
      await createLinkedRows(data);
      toast('✅ Dir expense entry saved.', 'success');
    }

    dirModal().hide();
    await loadDirEntries();
  };

  async function createLinkedRows(row) {
    if (!row?.id) return;
    const cfg = typeCfg(row);
    const ui = uiTypeOf(row);
    let cashDepositId = null;
    let transactionId = null;

    if (row.payment_mode === 'bank' || row.payment_mode === 'bank_transfer') {
      const party = ui === 'bank_transfer_to_owner' ? 'Dir Expense / Owner Bank' : ui === 'bank_transfer_from_owner' ? 'Owner Bank / Dir Expense' : cfg.label;
      cashDepositId = await safeInsertCashDeposit({
        deposit_date: row.entry_date,
        bank_id: row.bank_id,
        to_bank_id: row.to_bank_id,
        amount: row.amount,
        transaction_type: cfg.bankType,
        deposited_by: party,
        party_name: party,
        reference: row.reference_no || null,
        note: row.note || cfg.label,
        direct_expense_id: row.id,
        created_by: window.currentUser?.id || null,
        company_id: window.currentUserProfile?.company_id || null,
        created_at: new Date().toISOString()
      });
    }

    if (ui === 'expense_settled') {
      transactionId = await safeInsertExpenseTransaction({
        transaction_type: 'Expense',
        amount: row.amount,
        charges: row.amount,
        description: `${row.expense_category || 'Direct Expense'} - Dir Expense Khata${row.note ? ' - ' + row.note : ''}`,
        expense_type: row.expense_category || 'Direct Expense',
        expense_account: 'Dir Expense Khata',
        payment_method: 'Dir Expense Adjustment',
        payment_mode: 'Dir Expense Adjustment',
        reference_no: row.reference_no || null,
        direct_expense_id: row.id,
        notes: row.note || null,
        created_at: new Date(row.entry_date + 'T12:00:00').toISOString(),
        user_id: window.currentUser?.id || null,
        company_id: window.currentUserProfile?.company_id || null
      });
    }

    const patch = {};
    if (cashDepositId) patch.cash_deposit_id = cashDepositId;
    if (transactionId) patch.transaction_id = transactionId;
    if (Object.keys(patch).length) await safeUpdate('direct_expense_entries', patch, row.id, ['cash_deposit_id','transaction_id']);
  }

  async function cleanupLinkedRows(row) {
    if (!row) return;
    try {
      if (row.cash_deposit_id) await sb().from('cash_deposits').delete().eq('id', row.cash_deposit_id);
      if (row.transaction_id) await sb().from('transactions').delete().eq('id', row.transaction_id);
    } catch (e) {
      console.warn('Linked row cleanup skipped:', e.message);
    }
  }

  window.deleteDirEntry = async function (id) {
    const row = allEntries.find(x => String(x.id) === String(id));
    if (!row) return;
    if (!confirm('Delete this Dir Expense entry? Linked bank/P&L entry will also be removed where possible.')) return;
    await cleanupLinkedRows(row);
    const { error } = await sb().from('direct_expense_entries').delete().eq('id', id);
    if (error) { toast('Error deleting entry: ' + error.message, 'danger'); return; }
    toast('Entry deleted.', 'warning');
    await loadDirEntries();
  };

  window.printDirExpenseReport = function () {
    const totalDebit = filteredEntries.reduce((s,r) => s + debitOf(r), 0);
    const totalCredit = filteredEntries.reduce((s,r) => s + creditOf(r), 0);
    const balance = allEntries.reduce((s,r) => s + debitOf(r) - creditOf(r), 0);
    const pending = Math.max(balance, 0);
    const advance = Math.max(-balance, 0);
    const from = document.getElementById('filter-from').value || 'Start';
    const to = document.getElementById('filter-to').value || 'Today';
    const rows = filteredEntries.map(r => {
      const cfg = typeCfg(r);
      const bank = banks.find(b => String(b.id) === String(r.bank_id));
      const toBank = banks.find(b => String(b.id) === String(r.to_bank_id));
      return `<tr>
        <td>${formatDate(r.entry_date)}</td>
        <td>${esc(cfg.label)}</td>
        <td>${modeText(r, bank, toBank)}</td>
        <td style="text-align:right">${debitOf(r) ? fmt(debitOf(r)) : '-'}</td>
        <td style="text-align:right">${creditOf(r) ? fmt(creditOf(r)) : '-'}</td>
        <td>${esc(r.reference_no || '')}</td>
        <td>${esc(r.note || '')}</td>
      </tr>`;
    }).join('');
    const html = `<div style="font-family:Arial,sans-serif;padding:10px;">
      <h2 style="margin:0 0 4px;">Khalid & Sons Petroleum</h2>
      <h3 style="margin:0 0 12px;">Dir Expense Khata Report</h3>
      <div style="font-size:12px;margin-bottom:10px;">Period: ${esc(from)} to ${esc(to)} | Printed: ${new Date().toLocaleString('en-PK')}</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:12px;">
        <tr><th style="border:1px solid #333;padding:6px;text-align:left;">Total Debit/Given</th><th style="border:1px solid #333;padding:6px;text-align:left;">Total Credit/Vasooli</th><th style="border:1px solid #333;padding:6px;text-align:left;">Pending</th><th style="border:1px solid #333;padding:6px;text-align:left;">Owner Advance</th></tr>
        <tr><td style="border:1px solid #333;padding:6px;">Rs. ${fmt(totalDebit)}</td><td style="border:1px solid #333;padding:6px;">Rs. ${fmt(totalCredit)}</td><td style="border:1px solid #333;padding:6px;">Rs. ${fmt(pending)}</td><td style="border:1px solid #333;padding:6px;">Rs. ${fmt(advance)}</td></tr>
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead><tr style="background:#eef2ff;"><th style="border:1px solid #333;padding:5px;">Date</th><th style="border:1px solid #333;padding:5px;">Type</th><th style="border:1px solid #333;padding:5px;">Mode/Bank</th><th style="border:1px solid #333;padding:5px;">Debit/Given</th><th style="border:1px solid #333;padding:5px;">Credit/Vasooli</th><th style="border:1px solid #333;padding:5px;">Ref</th><th style="border:1px solid #333;padding:5px;">Note</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="border:1px solid #333;padding:8px;text-align:center;">No records</td></tr>'}</tbody>
      </table>
    </div>`;
    const area = document.getElementById('print-area');
    area.classList.remove('d-none');
    area.innerHTML = html;
    window.print();
    setTimeout(() => area.classList.add('d-none'), 500);
  };

  function formatDate(d) {
    if (!d) return '—';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' });
  }

  function toast(msg, type = 'success') {
    const title = document.getElementById('toast-title');
    const body = document.getElementById('toast-message');
    const toastEl = document.getElementById('liveToast');
    if (!toastEl || !window.bootstrap) { console.log(msg); return; }
    title.textContent = type === 'danger' ? 'Error' : type === 'warning' ? 'Notice' : 'Success';
    body.textContent = msg;
    toastEl.className = `toast border-${type}`;
    new bootstrap.Toast(toastEl).show();
  }
})();
