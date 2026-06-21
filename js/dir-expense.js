/* global bootstrap */
(() => {
  'use strict';

  let banks = [];
  let allEntries = [];
  let filteredEntries = [];
  let currentPage = 1;
  const pageSize = 12;

  const TYPES = {
    cash_given: {
      label: 'Cash Given to Owner / Dir Expense',
      short: 'Cash Given',
      badge: 'bg-danger',
      effect: 'debit',
      help: 'Owner/dir expense ne business se cash liya. Balance pending barhega.',
      bankType: 'payment'
    },
    cash_received: {
      label: 'Cash Received Back / Vasooli',
      short: 'Vasooli',
      badge: 'bg-success',
      effect: 'credit',
      help: 'Owner/dir expense ne cash/bank wapis diya. Pending balance kam hoga.',
      bankType: 'credit'
    },
    bank_transfer_to_owner: {
      label: 'Bank Transfer to Owner Account',
      short: 'Transfer To Owner',
      badge: 'bg-warning text-dark',
      effect: 'debit',
      help: 'Company bank se owner/direct expense bank me transfer. Balance pending barhega.',
      bankType: 'transfer'
    },
    bank_transfer_from_owner: {
      label: 'Bank Transfer from Owner Account',
      short: 'Transfer From Owner',
      badge: 'bg-info text-dark',
      effect: 'credit',
      help: 'Owner/direct expense bank se company bank me transfer. Pending balance kam hoga.',
      bankType: 'transfer'
    },
    expense_settled: {
      label: 'Expense Bill Settled',
      short: 'Expense Settled',
      badge: 'bg-primary',
      effect: 'credit',
      help: 'Owner ne jo cash liya tha us ka kharcha/bill adjust hua. Pending kam hoga aur P&L me expense add hoga.',
      bankType: 'expense'
    }
  };

  const sb = () => window.supabaseClient;
  const num = v => {
    const n = parseFloat(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const fmt = n => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const today = () => new Date().toISOString().slice(0, 10);
  const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
  const typeCfg = t => TYPES[t] || TYPES.cash_given;
  const debitOf = r => typeCfg(r.entry_type).effect === 'debit' ? num(r.amount) : 0;
  const creditOf = r => typeCfg(r.entry_type).effect === 'credit' ? num(r.amount) : 0;

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

    await Promise.all([loadBanks(), loadDirEntries()]);
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
      if (type && r.entry_type !== type) return false;
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
      const cfg = typeCfg(r.entry_type);
      const debit = debitOf(r);
      const credit = creditOf(r);
      const bank = banks.find(b => String(b.id) === String(r.bank_id));
      const toBank = banks.find(b => String(b.id) === String(r.to_bank_id));
      const mode = modeText(r, bank, toBank);
      const bal = balMap.get(String(r.id)) || 0;
      return `<tr class="dir-row">
        <td>${formatDate(r.entry_date)}</td>
        <td><span class="badge type-pill ${cfg.badge}">${esc(cfg.short)}</span></td>
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
    const t = r.entry_type;
    if (t === 'bank_transfer_to_owner') return `${esc(bank?.name || 'From Bank')} → ${esc(toBank?.name || 'Owner Bank')}`;
    if (t === 'bank_transfer_from_owner') return `${esc(bank?.name || 'Owner Bank')} → ${esc(toBank?.name || 'To Bank')}`;
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
    const monthRows = allEntries.filter(r => String(r.entry_date || '').slice(0,7) === month);
    const mDebit = monthRows.reduce((s,r) => s + debitOf(r), 0);
    const mCredit = monthRows.reduce((s,r) => s + creditOf(r), 0);
    const mExpense = monthRows.filter(r => r.entry_type === 'expense_settled').reduce((s,r) => s + num(r.amount), 0);

    document.getElementById('stat-balance').textContent = `Rs. ${fmt(Math.abs(balance))}`;
    document.getElementById('stat-balance-note').textContent = balance > 0 ? 'Pending from owner/dir expense' : balance < 0 ? 'Owner advance/credit' : 'Clear';
    document.getElementById('stat-debit').textContent = `Rs. ${fmt(mDebit)}`;
    document.getElementById('stat-credit').textContent = `Rs. ${fmt(mCredit)}`;
    document.getElementById('stat-expense').textContent = `Rs. ${fmt(mExpense)}`;
  }

  function renderBankSummary() {
    const el = document.getElementById('dir-bank-summary');
    if (!banks.length) { el.innerHTML = '<div class="text-center text-muted small py-3">No banks found.</div>'; return; }
    const map = new Map();
    banks.forEach(b => map.set(String(b.id), { bank: b, debit: 0, credit: 0 }));
    allEntries.forEach(r => {
      const debit = debitOf(r), credit = creditOf(r);
      if (r.bank_id && map.has(String(r.bank_id))) {
        if (r.entry_type === 'bank_transfer_from_owner') map.get(String(r.bank_id)).credit += credit;
        else map.get(String(r.bank_id)).debit += debit;
      }
      if (r.to_bank_id && map.has(String(r.to_bank_id))) {
        if (r.entry_type === 'bank_transfer_to_owner') map.get(String(r.to_bank_id)).debit += debit;
        else map.get(String(r.to_bank_id)).credit += credit;
      }
    });
    const rows = [...map.values()].filter(x => x.debit || x.credit).slice(0, 8);
    if (!rows.length) { el.innerHTML = '<div class="text-center text-muted small py-3">No bank movement yet.</div>'; return; }
    el.innerHTML = rows.map(x => `<div class="border-bottom py-2">
      <div class="fw-semibold">${esc(x.bank.name)}</div>
      <div class="small text-muted d-flex justify-content-between"><span>Debit Rs. ${fmt(x.debit)}</span><span>Credit Rs. ${fmt(x.credit)}</span></div>
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
    document.getElementById('dir-type').value = r?.entry_type || 'cash_given';
    document.getElementById('dir-mode').value = r?.payment_mode || 'cash';
    document.getElementById('dir-bank').value = r?.bank_id || '';
    document.getElementById('dir-to-bank').value = r?.to_bank_id || '';
    document.getElementById('dir-amount').value = r?.amount || '';
    document.getElementById('dir-expense-category').value = r?.expense_category || '';
    document.getElementById('dir-reference').value = r?.reference_no || '';
    document.getElementById('dir-note').value = r?.note || '';
    onDirTypeChange();
    dirModal().show();
  };

  window.onDirTypeChange = function () {
    const type = document.getElementById('dir-type').value;
    const mode = document.getElementById('dir-mode').value;
    const isTransfer = type === 'bank_transfer_to_owner' || type === 'bank_transfer_from_owner';
    const isExpense = type === 'expense_settled';
    document.getElementById('dir-type-help').textContent = typeCfg(type).help;
    document.getElementById('dir-mode-wrap').style.display = isTransfer || isExpense ? 'none' : '';
    document.getElementById('dir-bank-wrap').style.display = isTransfer || mode === 'bank' ? '' : 'none';
    document.getElementById('dir-to-bank-wrap').style.display = isTransfer ? '' : 'none';
    document.getElementById('dir-expense-category-wrap').style.display = isExpense ? '' : 'none';
    if (isTransfer) {
      document.getElementById('dir-bank-label').textContent = type === 'bank_transfer_to_owner' ? 'From Bank' : 'From Owner Bank';
      document.getElementById('dir-to-bank-label').textContent = type === 'bank_transfer_to_owner' ? 'To Owner Bank' : 'To Bank';
    } else {
      document.getElementById('dir-bank-label').textContent = 'Bank';
    }
  };

  window.saveDirEntry = async function () {
    const id = document.getElementById('dir-id').value;
    const type = document.getElementById('dir-type').value;
    const amount = num(document.getElementById('dir-amount').value);
    const entryDate = document.getElementById('dir-date').value;
    const isTransfer = type === 'bank_transfer_to_owner' || type === 'bank_transfer_from_owner';
    const isExpense = type === 'expense_settled';
    const mode = isTransfer ? 'bank_transfer' : isExpense ? 'adjustment' : document.getElementById('dir-mode').value;
    const bankId = (isTransfer || mode === 'bank') ? (document.getElementById('dir-bank').value || null) : null;
    const toBankId = isTransfer ? (document.getElementById('dir-to-bank').value || null) : null;
    const expenseCategory = isExpense ? (document.getElementById('dir-expense-category').value.trim() || 'Direct Expense') : '';
    const referenceNo = document.getElementById('dir-reference').value.trim();
    const note = document.getElementById('dir-note').value.trim();

    if (!entryDate) { toast('Date is required.', 'warning'); return; }
    if (!amount || amount <= 0) { toast('Amount must be greater than 0.', 'warning'); return; }
    if ((isTransfer || mode === 'bank') && !bankId) { toast('Please select bank.', 'warning'); return; }
    if (isTransfer && !toBankId) { toast('Please select second bank for transfer.', 'warning'); return; }
    if (isTransfer && String(bankId) === String(toBankId)) { toast('From Bank and To Bank cannot be same.', 'warning'); return; }

    const baseRow = {
      entry_date: entryDate,
      entry_type: type,
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
      // Linked finance rows are regenerated on edit where possible to keep amounts clean.
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
    const type = row.entry_type;
    const cfg = typeCfg(type);
    let cashDepositId = null;
    let transactionId = null;

    if (row.payment_mode === 'bank' || row.payment_mode === 'bank_transfer') {
      const party = type === 'bank_transfer_to_owner' ? 'Dir Expense / Owner Bank' : type === 'bank_transfer_from_owner' ? 'Owner Bank / Dir Expense' : 'Dir Expense Khata';
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

    if (type === 'expense_settled') {
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
    const from = document.getElementById('filter-from').value || 'Start';
    const to = document.getElementById('filter-to').value || 'Today';
    const rows = filteredEntries.map(r => {
      const cfg = typeCfg(r.entry_type);
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
        <tr><th style="border:1px solid #333;padding:6px;text-align:left;">Total Debit/Given</th><th style="border:1px solid #333;padding:6px;text-align:left;">Total Credit/Received</th><th style="border:1px solid #333;padding:6px;text-align:left;">Current Balance</th></tr>
        <tr><td style="border:1px solid #333;padding:6px;">Rs. ${fmt(totalDebit)}</td><td style="border:1px solid #333;padding:6px;">Rs. ${fmt(totalCredit)}</td><td style="border:1px solid #333;padding:6px;">Rs. ${fmt(Math.abs(balance))} ${balance > 0 ? 'Pending' : balance < 0 ? 'Advance' : 'Clear'}</td></tr>
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead><tr style="background:#eef2ff;"><th style="border:1px solid #333;padding:5px;">Date</th><th style="border:1px solid #333;padding:5px;">Type</th><th style="border:1px solid #333;padding:5px;">Mode/Bank</th><th style="border:1px solid #333;padding:5px;">Debit</th><th style="border:1px solid #333;padding:5px;">Credit</th><th style="border:1px solid #333;padding:5px;">Ref</th><th style="border:1px solid #333;padding:5px;">Note</th></tr></thead>
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
