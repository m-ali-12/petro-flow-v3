// =============================================
// FILE: js/employee-salary.js
// Employee Salary Management
// 3-option salary flow: regular salary + advanced salary + repay advanced salary + A4 print
// =============================================
(function () {
  'use strict';

  const PAGE_SIZE = 20;
  let employees = [];
  let banks = [];
  let salaryPayments = [];
  let currentPage = 1;

  const sb = () => window.supabaseClient;
  const fmt = n => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = v => {
    const n = parseFloat(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const today = () => new Date().toISOString().slice(0, 10);
  const currentMonth = () => new Date().toISOString().slice(0, 7);

  window.addEventListener('DOMContentLoaded', () => waitReady(init));

  function waitReady(cb, n = 0) {
    if (window.supabaseClient && window.PETRO_SESSION_READY) return setTimeout(cb, 400);
    if (n > 80) return;
    setTimeout(() => waitReady(cb, n + 1), 100);
  }

  async function init() {
    if (!window.hasPermission('canManageBanks')) {
      document.querySelector('.container-fluid')?.insertAdjacentHTML('afterbegin',
        `<div class="alert alert-danger"><i class="bi bi-lock me-2"></i>You do not have permission to access Employee Salary.</div>`);
      return;
    }

    document.getElementById('filter-month').value = currentMonth();
    await Promise.all([loadEmployees(), loadBanks()]);
    await loadSalaryPayments();
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

  async function safeInsertTransaction(payload) {
    let row = { ...payload };
    const removable = ['cash_deposit_id','salary_payment_id','reference_no','payment_mode','entry_method','employee_id','salary_month','bank_id','to_bank_id','category','customer_category','linked_table','linked_id','payment_month','notes','charges'];
    for (let i = 0; i < 14; i++) {
      const { error } = await sb().from('transactions').insert([row]);
      if (!error) return true;
      const col = missingColumn(error.message || error.details || '');
      if (col && Object.prototype.hasOwnProperty.call(row, col)) { delete row[col]; continue; }
      const rm = removable.find(k => Object.prototype.hasOwnProperty.call(row, k));
      if (rm && /schema cache|column/i.test(error.message || error.details || '')) { delete row[rm]; continue; }
      console.warn('Salary transaction insert skipped:', error.message);
      return false;
    }
    return false;
  }

  async function safeInsertCashDeposit(payload) {
    let row = { ...payload };
    const removable = ['transaction_type','to_bank_id','party_name','employee_id','salary_payment_id','salary_month','reference','note','updated_at'];
    for (let i = 0; i < 12; i++) {
      const { data, error } = await sb().from('cash_deposits').insert([row]).select('id').single();
      if (!error) return data?.id || null;
      const col = missingColumn(error.message || error.details || '');
      if (col && Object.prototype.hasOwnProperty.call(row, col)) { delete row[col]; continue; }
      const rm = removable.find(k => Object.prototype.hasOwnProperty.call(row, k));
      if (rm && /schema cache|column/i.test(error.message || error.details || '')) { delete row[rm]; continue; }
      console.warn('Salary bank/cash finance entry skipped:', error.message);
      return null;
    }
    return null;
  }

  function salaryTypeLabel(type) {
    const map = {
      salary_pay: 'Salary (Regular Monthly)',
      advance: 'Advanced Salary (Credit)',
      advance_return: 'Repay Advanced Salary (Vasooli)',
      credit: 'Legacy Hidden Entry',
      debit: 'Legacy Hidden Entry'
    };
    return map[type || 'salary_pay'] || type || 'Salary (Regular Monthly)';
  }

  function salaryTypeBadge(type) {
    const t = type || 'salary_pay';
    const cls = t === 'advance' ? 'bg-warning text-dark' : t === 'advance_return' ? 'bg-info text-dark' : t === 'credit' || t === 'debit' ? 'bg-secondary' : 'bg-primary';
    return `<span class="badge ${cls}">${salaryTypeLabel(t)}</span>`;
  }

  function employeeDelta(type, amount) {
    const amt = num(amount);
    const t = String(type || 'salary_pay').toLowerCase();
    // Regular monthly salary is a business expense only; it does not create/clear employee advance balance.
    if (t === 'advance_return') return amt;
    if (t === 'advance') return -amt;
    return 0;
  }

  function txTypeFor(type) {
    const t = String(type || '').toLowerCase();
    if (t === 'advance') return 'EmployeeAdvance';
    if (t === 'advance_return') return 'EmployeeAdvanceReturn';
    return 'SalaryPay';
  }

  async function adjustEmployee(employeeId, delta) {
    if (!employeeId || !delta) return true;
    if (window.PetroLedger?.adjustEmployeeBalance) return await window.PetroLedger.adjustEmployeeBalance(employeeId, delta);
    const { data, error } = await sb().from('employees').select('balance').eq('id', employeeId).maybeSingle();
    if (error) { console.warn('Employee balance fetch failed:', error.message); return false; }
    const next = num(data?.balance) + num(delta);
    const { error: upErr } = await sb().from('employees').update({ balance: next, updated_at: new Date().toISOString() }).eq('id', employeeId);
    if (upErr) { console.warn('Employee balance update failed:', upErr.message); return false; }
    return true;
  }

  async function reverseSalaryImpact(oldRow) {
    if (!oldRow) return;
    const t = oldRow.payment_type || (oldRow.is_advance ? 'advance' : 'salary_pay');
    await adjustEmployee(oldRow.employee_id, -employeeDelta(t, oldRow.amount));
  }

  async function applySalaryImpact(row) {
    if (!row) return;
    const t = row.payment_type || 'salary_pay';
    await adjustEmployee(row.employee_id, employeeDelta(t, row.amount));
  }

  let _employeeModal, _salaryModal;
  function employeeModal() { return _employeeModal || (_employeeModal = new bootstrap.Modal(document.getElementById('employeeModal'))); }
  function salaryModal() { return _salaryModal || (_salaryModal = new bootstrap.Modal(document.getElementById('salaryModal'))); }

  // ── Employees ────────────────────────────────────────────────
  async function loadEmployees() {
    const { data, error } = await sb().from('employees').select('*').order('name');
    if (error) { toast('Error loading employees: ' + error.message + ' | Please run employee salary DB SQL first.', 'danger'); return; }
    employees = data || [];
    renderEmployees();
    populateEmployeeDropdowns();
    updateStats();
  }

  function renderEmployees() {
    const el = document.getElementById('employees-list');
    const active = employees.filter(e => (e.status || 'active') === 'active');
    if (!employees.length) {
      el.innerHTML = '<div class="text-center py-3 text-muted small">No employees added yet.<br>Click "Add" to start.</div>';
      document.getElementById('stat-employees').textContent = '0';
      return;
    }
    el.innerHTML = employees.map(e => {
      const bal = num(e.balance);
      return `
      <div class="employee-row d-flex align-items-start justify-content-between py-2 border-bottom">
        <div>
          <div class="fw-semibold">${esc(e.name)}</div>
          <div class="small text-muted">${esc(e.role || '—')} ${e.phone ? ' • ' + esc(e.phone) : ''}</div>
          <div class="small"><span class="text-success fw-semibold">Rs. ${fmt(e.salary)}</span> / month
            <span class="badge bg-${(e.status || 'active') === 'active' ? 'success' : 'secondary'} ms-1">${esc(e.status || 'active')}</span>
          </div>
          <div class="small ${bal < 0 ? 'text-danger' : 'text-primary'} fw-semibold">
            Advance Balance: ${bal < 0 ? 'Rs. ' + fmt(Math.abs(bal)) : 'Clear'}
          </div>
        </div>
        <div class="text-nowrap">
          <button class="btn btn-link btn-sm p-0 me-2 text-primary" onclick="openEmployeeModal('${e.id}')"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-link btn-sm p-0 me-2 text-success" onclick="openSalaryModal('${e.id}')"><i class="bi bi-cash-coin"></i></button>
          <button class="btn btn-link btn-sm p-0 text-danger" onclick="deleteEmployee('${e.id}')"><i class="bi bi-trash"></i></button>
        </div>
      </div>`;
    }).join('');
    document.getElementById('stat-employees').textContent = active.length;
  }

  function populateEmployeeDropdowns() {
    ['salary-employee', 'filter-employee'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const val = sel.value;
      sel.innerHTML = id === 'filter-employee'
        ? '<option value="">All Employees</option>'
        : '<option value="">— Select Employee —</option>';
      employees.filter(e => (e.status || 'active') === 'active' || id === 'filter-employee').forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = e.name;
        sel.appendChild(opt);
      });
      if (val) sel.value = val;
    });
  }

  window.openEmployeeModal = function (id) {
    document.getElementById('emp-id').value = id || '';
    document.getElementById('modal-employee-title').textContent = id ? 'Edit Employee' : 'Add Employee';
    if (id) {
      const e = employees.find(x => String(x.id) === String(id));
      if (e) {
        document.getElementById('emp-name').value = e.name || '';
        document.getElementById('emp-role').value = e.role || '';
        document.getElementById('emp-phone').value = e.phone || '';
        document.getElementById('emp-salary').value = e.salary || '';
        document.getElementById('emp-status').value = e.status || 'active';
      }
    } else {
      ['emp-name','emp-role','emp-phone','emp-salary'].forEach(x => document.getElementById(x).value = '');
      document.getElementById('emp-status').value = 'active';
    }
    employeeModal().show();
  };

  window.saveEmployee = async function () {
    const id = document.getElementById('emp-id').value;
    const row = {
      name: document.getElementById('emp-name').value.trim(),
      role: document.getElementById('emp-role').value.trim() || null,
      phone: document.getElementById('emp-phone').value.trim() || null,
      salary: num(document.getElementById('emp-salary').value),
      status: document.getElementById('emp-status').value || 'active',
      created_by: window.currentUser?.id || null,
      updated_at: new Date().toISOString()
    };

    if (!row.name) { toast('Employee name is required.', 'warning'); return; }
    if (row.salary < 0) { toast('Salary cannot be negative.', 'warning'); return; }

    const removable = ['created_by','updated_at'];
    let res;
    if (id) res = await safeUpdate('employees', row, id, removable);
    else { row.created_at = new Date().toISOString(); res = await safeInsert('employees', row, ['created_by','created_at','updated_at']); }
    if (res.error) { toast('Error saving employee: ' + res.error.message, 'danger'); return; }
    employeeModal().hide();
    toast('✅ Employee saved!', 'success');
    await loadEmployees();
  };

  window.deleteEmployee = async function (id) {
    const { data: usedRows } = await sb().from('employee_salary_payments').select('id').eq('employee_id', id).limit(1);
    if (usedRows && usedRows.length) { toast('Cannot delete — salary/advance entries exist for this employee.', 'danger'); return; }
    if (!confirm('Delete this employee?')) return;
    const { error } = await sb().from('employees').delete().eq('id', id);
    if (error) { toast('Error: ' + error.message, 'danger'); return; }
    toast('Employee deleted.', 'warning');
    await loadEmployees();
  };

  // ── Banks ────────────────────────────────────────────────────
  async function loadBanks() {
    const { data, error } = await sb().from('banks').select('*').order('name');
    if (error) { console.warn('Banks load error:', error.message); return; }
    banks = data || [];
    populateBankDropdowns();
  }

  function populateBankDropdowns() {
    ['salary-bank', 'filter-bank'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const val = sel.value;
      sel.innerHTML = id === 'filter-bank'
        ? '<option value="">All Payment Modes</option><option value="cash">Cash</option>'
        : '<option value="">Cash</option>';
      banks.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.name;
        sel.appendChild(opt);
      });
      if (val) sel.value = val;
    });
  }

  // ── Monthly calculations ─────────────────────────────────────
  function activeSalaryRows(rows) {
    return (rows || []).filter(r => (r.entry_status || 'active') !== 'void' && ['salary_pay','advance','advance_return'].includes(r.payment_type || 'salary_pay'));
  }

  function calcMonthSummary(rows, emp) {
    const cleanRows = activeSalaryRows(rows);
    const base = num(emp?.salary);
    const salaryPaid = cleanRows.filter(r => (r.payment_type || 'salary_pay') === 'salary_pay').reduce((s, r) => s + num(r.amount), 0);
    const advanceGiven = cleanRows.filter(r => (r.payment_type || '') === 'advance').reduce((s, r) => s + num(r.amount), 0);
    const advanceReturn = cleanRows.filter(r => (r.payment_type || '') === 'advance_return').reduce((s, r) => s + num(r.amount), 0);
    const remainingSalary = Math.max(0, base - salaryPaid);
    const netAdvance = Math.max(0, advanceGiven - advanceReturn);
    return { base, salaryPaid, advanceGiven, advanceReturn, remainingSalary, netAdvance };
  }

  async function getMonthEntries(employeeId, month, excludeId = '') {
    if (!employeeId || !month) return [];
    let q = sb().from('employee_salary_payments').select('*').eq('employee_id', employeeId).eq('salary_month', month);
    const { data, error } = await q;
    if (error) { console.warn('Month entry check failed:', error.message); return []; }
    return activeSalaryRows(data || []).filter(r => !excludeId || String(r.id) !== String(excludeId));
  }

  // Old auto-split/monthly payable functions removed.
  // New flow uses only explicit 3 options: salary_pay, advance, advance_return.

  // ── Salary Payments ──────────────────────────────────────────
  window.loadSalaryPayments = async function () {
    const month = document.getElementById('filter-month').value;
    const employeeId = document.getElementById('filter-employee').value;
    const bankId = document.getElementById('filter-bank').value;

    let query = sb().from('employee_salary_payments').select('*').order('payment_date', { ascending: false });
    if (month) query = query.eq('salary_month', month);
    if (employeeId) query = query.eq('employee_id', employeeId);

    const { data, error } = await query;
    if (error) { toast('Error loading salary payments: ' + error.message + ' | Please run employee salary DB SQL first.', 'danger'); return; }

    salaryPayments = activeSalaryRows(data || []).filter(p => {
      if (!bankId) return true;
      if (bankId === 'cash') return !p.bank_id;
      return String(p.bank_id || '') === String(bankId);
    });
    currentPage = 1;
    renderSalaryPayments();
    updateStats();
    renderMonthlySummary();
  };

  function renderMonthlySummary() {
    const el = document.getElementById('salary-month-summary');
    if (!el) return;
    const month = document.getElementById('filter-month')?.value || currentMonth();
    const employeeId = document.getElementById('filter-employee')?.value || '';
    const list = employeeId ? employees.filter(e => String(e.id) === String(employeeId)) : employees.filter(e => (e.status || 'active') === 'active');
    const rows = salaryPayments;
    const base = list.reduce((s, e) => s + num(e.salary), 0);
    const salaryPaid = rows.filter(r => (r.payment_type || 'salary_pay') === 'salary_pay').reduce((s, r) => s + num(r.amount), 0);
    const advanceGiven = rows.filter(r => (r.payment_type || '') === 'advance').reduce((s, r) => s + num(r.amount), 0);
    const advanceReturn = rows.filter(r => (r.payment_type || '') === 'advance_return').reduce((s, r) => s + num(r.amount), 0);
    const advanceBalance = list.reduce((s, e) => s + Math.max(0, -num(e.balance)), 0);
    const remaining = Math.max(0, base - salaryPaid);
    el.innerHTML = `
      <div class="row g-2 align-items-center">
        <div class="col-md-2"><b>Month:</b> ${esc(month || 'All')}</div>
        <div class="col-md-2 text-primary"><b>Base:</b> Rs. ${fmt(base)}</div>
        <div class="col-md-2 text-success"><b>Salary Paid:</b> Rs. ${fmt(salaryPaid)}</div>
        <div class="col-md-2 text-warning"><b>Advance:</b> Rs. ${fmt(advanceGiven)}</div>
        <div class="col-md-2 text-info"><b>Vasooli:</b> Rs. ${fmt(advanceReturn)}</div>
        <div class="col-md-2 text-danger"><b>Adv. Balance:</b> Rs. ${fmt(advanceBalance)}</div>
        ${remaining > 0 ? `<div class="col-12 text-muted">Remaining salary payable for selected month: Rs. ${fmt(remaining)}</div>` : ''}
      </div>`;
  }

  function renderSalaryPayments() {
    const tbody = document.getElementById('salary-tbody');
    if (!salaryPayments.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-center py-5 text-muted"><i class="bi bi-inbox fs-2 d-block mb-2"></i>No salary/advance entries found.</td></tr>`;
      document.getElementById('salary-pagination-info').textContent = 'Showing 0 records';
      document.getElementById('salary-pagination-btns').innerHTML = '';
      return;
    }

    const start = (currentPage - 1) * PAGE_SIZE;
    const slice = salaryPayments.slice(start, start + PAGE_SIZE);
    const total = salaryPayments.length;
    const pages = Math.ceil(total / PAGE_SIZE);

    tbody.innerHTML = slice.map(p => {
      const emp = employees.find(e => String(e.id) === String(p.employee_id));
      const bank = banks.find(b => String(b.id) === String(p.bank_id));
      const type = p.payment_type || (p.is_advance ? 'advance' : 'salary_pay');
      const sign = type === 'advance_return' ? '+ ' : (type === 'salary_pay' || type === 'advance' ? '- ' : '');
      const cls = type === 'advance_return' ? 'text-success' : (type === 'advance' ? 'text-warning' : 'text-danger');
      const status = type === 'salary_pay' ? 'Regular monthly salary paid' : type === 'advance' ? `Advanced salary for ${esc(p.advance_month || p.salary_month || '—')}` : type === 'advance_return' ? 'Advance salary vasooli / recovered' : 'Legacy entry hidden from new flow';
      return `<tr class="salary-row">
        <td class="fw-semibold">${fmtDate(p.payment_date)}</td>
        <td><span class="badge bg-light text-dark border">${esc(p.salary_month || '—')}</span></td>
        <td>${esc(emp?.name || p.employee_name || 'Unknown')}</td>
        <td>${salaryTypeBadge(type)}</td>
        <td class="${cls} fw-bold">${sign}Rs. ${fmt(p.amount)}</td>
        <td class="small text-muted">${bank ? esc(bank.name) : 'Cash'}</td>
        <td class="small text-muted">${esc(p.reference || '—')}</td>
        <td class="small text-muted">${esc(p.note || '—')}</td>
        <td class="small text-muted">${status}</td>
        <td class="text-nowrap">
          <button class="btn btn-link btn-sm p-0 me-2 text-primary" onclick="openEditSalary('${p.id}')"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-link btn-sm p-0 text-danger" onclick="deleteSalaryPayment('${p.id}')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
    }).join('');

    document.getElementById('salary-pagination-info').textContent = `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total} records`;
    renderPagination(pages);
  }

  function renderPagination(pages) {
    const el = document.getElementById('salary-pagination-btns');
    if (pages <= 1) { el.innerHTML = ''; return; }
    let html = '<nav><ul class="pagination pagination-sm mb-0">';
    html += `<li class="page-item ${currentPage === 1 ? 'disabled' : ''}"><a class="page-link" href="#" onclick="goSalaryPage(${currentPage - 1});return false">‹</a></li>`;
    for (let i = 1; i <= pages; i++) html += `<li class="page-item ${i === currentPage ? 'active' : ''}"><a class="page-link" href="#" onclick="goSalaryPage(${i});return false">${i}</a></li>`;
    html += `<li class="page-item ${currentPage === pages ? 'disabled' : ''}"><a class="page-link" href="#" onclick="goSalaryPage(${currentPage + 1});return false">›</a></li>`;
    html += '</ul></nav>';
    el.innerHTML = html;
  }

  window.goSalaryPage = function (p) { currentPage = p; renderSalaryPayments(); };

  window.openSalaryModal = function (employeeId) {
    document.getElementById('salary-id').value = '';
    document.getElementById('salary-type').value = 'salary_pay';
    document.getElementById('salary-employee').value = employeeId || '';
    document.getElementById('salary-month').value = currentMonth();
    document.getElementById('salary-date').value = today();
    document.getElementById('salary-amount').value = '';
    document.getElementById('salary-bank').value = '';
    document.getElementById('salary-ref').value = '';
    document.getElementById('salary-note').value = '';
    document.getElementById('modal-salary-title').textContent = 'Pay Salary';
    fillEmployeeSalary();
    updateSalaryTypeUI();
    salaryModal().show();
  };

  window.updateSalaryTypeUI = function () {
    const type = document.getElementById('salary-type')?.value || 'salary_pay';
    const bank = document.getElementById('salary-bank');
    const title = document.getElementById('modal-salary-title');
    if (title) title.textContent = salaryTypeLabel(type);
    if (bank) bank.disabled = false;
    if (!document.getElementById('salary-id')?.value && type === 'salary_pay') fillEmployeeSalary();
    if (!document.getElementById('salary-id')?.value && type === 'advance') document.getElementById('salary-amount').value = '';
    if (!document.getElementById('salary-id')?.value && type === 'advance_return') document.getElementById('salary-amount').value = '';
    previewSalarySplit();
  };

  window.fillEmployeeSalary = async function () {
    const empId = document.getElementById('salary-employee').value;
    const emp = employees.find(e => String(e.id) === String(empId));
    if (emp && !document.getElementById('salary-id').value) {
      document.getElementById('salary-amount').value = emp.salary || '';
    }
    previewSalarySplit();
  };

  window.previewSalarySplit = async function () {
    const box = document.getElementById('salary-split-preview');
    if (!box) return;
    const type = document.getElementById('salary-type')?.value || 'salary_pay';
    const employeeId = document.getElementById('salary-employee')?.value || '';
    const month = document.getElementById('salary-month')?.value || '';
    const amount = num(document.getElementById('salary-amount')?.value);
    const id = document.getElementById('salary-id')?.value || '';
    const emp = employees.find(e => String(e.id) === String(employeeId));
    box.innerHTML = '';
    if (!emp || !month) return;
    const rows = await getMonthEntries(employeeId, month, id);
    const s = calcMonthSummary(rows, emp);
    const outstanding = Math.max(0, -num(emp.balance));

    if (type === 'salary_pay') {
      const remainingAfter = Math.max(0, s.remainingSalary - amount);
      if (amount > s.remainingSalary + 0.009) {
        box.innerHTML = `<span class="text-danger fw-semibold">Monthly salary Rs. ${fmt(s.base)} hai. Is month salary already Rs. ${fmt(s.salaryPaid)} paid hai. Remaining salary Rs. ${fmt(s.remainingSalary)} hai. Extra amount Advanced Salary option se save karein.</span>`;
      } else {
        box.innerHTML = `<span class="text-muted">Regular salary for ${esc(month)}. Already paid Rs. ${fmt(s.salaryPaid)}, remaining after this entry Rs. ${fmt(remainingAfter)}.</span>`;
      }
    } else if (type === 'advance') {
      box.innerHTML = `<span class="text-warning fw-semibold">Advanced salary ${esc(month)} ke against record hogi aur employee ka advance balance increase hoga.</span>`;
    } else if (type === 'advance_return') {
      box.innerHTML = outstanding > 0
        ? `<span class="text-info fw-semibold">Current advance balance: Rs. ${fmt(outstanding)}. Vasooli save hone ke baad advance balance kam/clear ho jayega.</span>`
        : `<span class="text-success fw-semibold">Is employee ka current advance balance zero hai.</span>`;
    }
  };

  window.openEditSalary = function (id) {
    const p = salaryPayments.find(x => String(x.id) === String(id));
    if (!p) return;
    document.getElementById('salary-id').value = p.id;
    document.getElementById('salary-type').value = p.payment_type || (p.is_advance ? 'advance' : 'salary_pay');
    document.getElementById('salary-employee').value = p.employee_id || '';
    document.getElementById('salary-month').value = p.salary_month || currentMonth();
    document.getElementById('salary-date').value = p.payment_date || today();
    document.getElementById('salary-amount').value = p.amount || '';
    document.getElementById('salary-bank').value = p.bank_id || '';
    document.getElementById('salary-ref').value = p.reference || '';
    document.getElementById('salary-note').value = p.note || '';
    document.getElementById('modal-salary-title').textContent = 'Edit ' + salaryTypeLabel(document.getElementById('salary-type').value);
    updateSalaryTypeUI();
    salaryModal().show();
  };

  async function cleanupRelated(id) {
    try { await sb().from('cash_deposits').delete().eq('salary_payment_id', id); } catch (e) { console.warn('Related bank/cash salary entry cleanup skipped:', e.message); }
    try { await sb().from('transactions').delete().eq('salary_payment_id', id); } catch (e) { console.warn('Related salary transaction cleanup skipped:', e.message); }
  }

  function buildSalaryRow({ type, employeeId, emp, month, date, amount, bankId, ref, note, groupId }) {
    return {
      employee_id: employeeId,
      employee_name: emp?.name || null,
      salary_month: month,
      advance_month: type === 'advance' ? month : null,
      payment_date: date,
      payment_type: type,
      is_advance: type === 'advance',
      balance_effect: employeeDelta(type, amount),
      amount: num(amount),
      bank_id: bankId || null,
      payment_mode: bankId ? 'Bank' : 'Cash',
      reference: ref || null,
      note: note || null,
      auto_split_group: groupId || null,
      entry_status: 'active',
      created_by: window.currentUser?.id || null,
      updated_at: new Date().toISOString()
    };
  }

  async function createFinanceForPayment(saved, bank, ref, note) {
    if (!saved || saved.payment_type === 'credit') return;
    const type = saved.payment_type || 'salary_pay';
    const amount = num(saved.amount);
    let cashDepositId = null;

    if (saved.bank_id) {
      const financeType = type === 'advance_return' ? 'credit' : (type === 'salary_pay' ? 'salary_pay' : 'payment');
      cashDepositId = await safeInsertCashDeposit({
        deposit_date: saved.payment_date,
        transaction_type: financeType,
        bank_id: saved.bank_id,
        amount,
        deposited_by: saved.employee_name || null,
        party_name: saved.employee_name || null,
        employee_id: saved.employee_id,
        salary_payment_id: saved.id,
        salary_month: saved.salary_month,
        reference: ref || null,
        note: `${salaryTypeLabel(type)}${note ? ' | ' + note : ''}`,
        created_by: window.currentUser?.id || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    await safeInsertTransaction({
      transaction_type: txTypeFor(type),
      amount,
      charges: amount,
      cash_deposit_id: cashDepositId,
      salary_payment_id: saved.id,
      employee_id: saved.employee_id,
      salary_month: saved.salary_month,
      reference_no: ref || null,
      payment_mode: saved.bank_id ? (bank?.name || 'Bank') : 'Cash',
      entry_method: 'employee_salary',
      description: `${salaryTypeLabel(type)} for ${saved.employee_name || 'Employee'} (${saved.salary_month})${saved.bank_id ? ' via ' + (bank?.name || 'Bank') : ' in Cash'}${note ? ' | ' + note : ''}`,
      notes: note || null,
      created_at: new Date((saved.payment_date || today()) + 'T12:00:00').toISOString()
    });
  }

  async function saveSinglePayment(row, id = '') {
    const removable = ['advance_month','auto_split_group','entry_status','created_by','updated_at','created_at'];
    let res;
    if (id) res = await safeUpdate('employee_salary_payments', row, id, removable);
    else { row.created_at = new Date().toISOString(); res = await safeInsert('employee_salary_payments', row, removable); }
    return res;
  }

  window.saveSalaryPayment = async function () {
    const id = document.getElementById('salary-id').value;
    const type = document.getElementById('salary-type').value || 'salary_pay';
    const employeeId = document.getElementById('salary-employee').value;
    const month = document.getElementById('salary-month').value;
    const date = document.getElementById('salary-date').value;
    const amount = num(document.getElementById('salary-amount').value);
    const bankId = document.getElementById('salary-bank').value;
    const ref = document.getElementById('salary-ref').value.trim();
    const note = document.getElementById('salary-note').value.trim();
    const emp = employees.find(e => String(e.id) === String(employeeId));
    const bank = banks.find(b => String(b.id) === String(bankId));

    if (!employeeId) { toast('Please select employee.', 'warning'); return; }
    if (!month) { toast('Salary/advance month is required.', 'warning'); return; }
    if (!date) { toast('Payment date is required.', 'warning'); return; }
    if (!amount || amount <= 0) { toast('Amount must be greater than 0.', 'warning'); return; }
    if (!['salary_pay','advance','advance_return'].includes(type)) { toast('Only 3 entry types allowed: Salary, Advanced Salary, Repay Advanced Salary.', 'warning'); return; }

    let oldRow = null;
    if (id) {
      const oldRes = await sb().from('employee_salary_payments').select('*').eq('id', id).maybeSingle();
      oldRow = oldRes.data || null;
      await reverseSalaryImpact(oldRow);
      await cleanupRelated(id);
    }

    const rowsForMonth = await getMonthEntries(employeeId, month, id);
    const summary = calcMonthSummary(rowsForMonth, emp);

    if (type === 'salary_pay' && amount > summary.remainingSalary + 0.009) {
      if (oldRow) await applySalaryImpact(oldRow);
      toast(`Regular salary remaining Rs. ${fmt(summary.remainingSalary)} hai. Extra amount Advanced Salary option me save karein.`, 'warning');
      return;
    }

    if (type === 'advance_return') {
      const outstanding = Math.max(0, -num(emp?.balance));
      if (outstanding <= 0) {
        if (oldRow) await applySalaryImpact(oldRow);
        toast('Is employee ka advance balance already clear hai. Vasooli save nahi ho sakti.', 'warning');
        return;
      }
      if (amount > outstanding + 0.009) {
        if (oldRow) await applySalaryImpact(oldRow);
        toast(`Advance balance Rs. ${fmt(outstanding)} hai. Vasooli amount is se zyada nahi ho sakti.`, 'warning');
        return;
      }
    }

    const row = buildSalaryRow({ type, employeeId, emp, month, date, amount, bankId, ref, note, groupId: null });
    const res = await saveSinglePayment(row, id);
    if (res.error) {
      if (oldRow) await applySalaryImpact(oldRow);
      toast('Error saving employee salary entry: ' + res.error.message, 'danger');
      return;
    }

    const saved = res.data || { ...row, id };
    await applySalaryImpact(saved);
    await createFinanceForPayment(saved, bank, ref, saved.note || note);

    salaryModal().hide();
    if (type === 'salary_pay') toast('✅ Regular monthly salary saved!', 'success');
    else if (type === 'advance') toast('✅ Advanced salary saved and employee advance balance updated!', 'success');
    else toast('✅ Advance salary vasooli saved and balance updated!', 'success');
    await loadEmployees();
    await loadSalaryPayments();
  };

  window.deleteSalaryPayment = async function (id) {
    if (!confirm('Delete this employee salary/account entry? Employee balance and related finance entries will be reversed.')) return;
    const oldRes = await sb().from('employee_salary_payments').select('*').eq('id', id).maybeSingle();
    const oldRow = oldRes.data || null;
    await cleanupRelated(id);
    const { error } = await sb().from('employee_salary_payments').delete().eq('id', id);
    if (error) { toast('Error: ' + error.message, 'danger'); return; }
    await reverseSalaryImpact(oldRow);
    toast('Employee salary/account entry deleted and balance reversed.', 'warning');
    await loadEmployees();
    await loadSalaryPayments();
  };

  window.resetSalaryFilters = function () {
    document.getElementById('filter-month').value = currentMonth();
    document.getElementById('filter-employee').value = '';
    document.getElementById('filter-bank').value = '';
    loadSalaryPayments();
  };

  function updateStats() {
    const month = document.getElementById('filter-month')?.value || currentMonth();
    const visibleRows = salaryPayments.filter(p => !month || p.salary_month === month);
    const salaryPaid = visibleRows.filter(p => (p.payment_type || 'salary_pay') === 'salary_pay').reduce((s, p) => s + num(p.amount), 0);
    const advancePaid = visibleRows.filter(p => (p.payment_type || '') === 'advance').reduce((s, p) => s + num(p.amount), 0);
    const baseTotal = employees.filter(e => (e.status || 'active') === 'active').reduce((s, e) => s + num(e.salary), 0);

    document.getElementById('stat-employees').textContent = employees.filter(e => (e.status || 'active') === 'active').length;
    document.getElementById('stat-paid').textContent = 'Rs. ' + fmt(salaryPaid);
    document.getElementById('stat-advance').textContent = 'Rs. ' + fmt(advancePaid);
    document.getElementById('stat-base').textContent = 'Rs. ' + fmt(baseTotal);
  }

  window.printSalaryReport = function () {
    const month = document.getElementById('filter-month')?.value || currentMonth();
    const empId = document.getElementById('filter-employee')?.value || '';
    const empName = empId ? (employees.find(e => String(e.id) === String(empId))?.name || 'Employee') : 'All Employees';
    const baseTotal = (empId ? employees.filter(e => String(e.id) === String(empId)) : employees.filter(e => (e.status || 'active') === 'active')).reduce((s, e) => s + num(e.salary), 0);
    const salaryPaid = salaryPayments.filter(p => (p.payment_type || 'salary_pay') === 'salary_pay').reduce((s, p) => s + num(p.amount), 0);
    const advanceGiven = salaryPayments.filter(p => (p.payment_type || '') === 'advance').reduce((s, p) => s + num(p.amount), 0);
    const advanceReturn = salaryPayments.filter(p => (p.payment_type || '') === 'advance_return').reduce((s, p) => s + num(p.amount), 0);
    const rows = salaryPayments.map(p => {
      const emp = employees.find(e => String(e.id) === String(p.employee_id));
      const bank = banks.find(b => String(b.id) === String(p.bank_id));
      const type = p.payment_type || (p.is_advance ? 'advance' : 'salary_pay');
      return `<tr><td>${fmtDate(p.payment_date)}</td><td>${esc(p.salary_month || '')}</td><td>${esc(emp?.name || p.employee_name || '')}</td><td>${esc(salaryTypeLabel(type))}</td><td style="text-align:right">${fmt(p.amount)}</td><td>${bank ? esc(bank.name) : 'Cash'}</td><td>${esc(p.reference || '')}</td><td>${esc(p.note || '')}</td></tr>`;
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:#777;padding:20px">No records</td></tr>';

    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) { toast('Popup blocked. Please allow popups for print.', 'warning'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Employee Salary Report</title>
      <style>
        @page{size:A4;margin:12mm} body{font-family:Arial,sans-serif;color:#111;font-size:12px} h2{margin:0 0 4px} .muted{color:#666}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.box{border:1px solid #ddd;border-radius:6px;padding:8px}.box b{display:block;margin-bottom:4px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ddd;padding:6px;vertical-align:top} th{background:#f2f4f8}.right{text-align:right}.footer{margin-top:18px;display:flex;justify-content:space-between}.sign{border-top:1px solid #333;width:160px;text-align:center;padding-top:5px;margin-top:35px}@media print{button{display:none}}
      </style></head><body>
      <button onclick="window.print()" style="float:right;padding:8px 14px;margin-bottom:10px">Print A4</button>
      <h2>PetroFlow - Employee Salary Report</h2>
      <div class="muted">Month: ${esc(month || 'All')} | Employee: ${esc(empName)} | Printed: ${new Date().toLocaleString('en-PK')}</div>
      <div class="summary"><div class="box"><b>Monthly Salary Base</b>Rs. ${fmt(baseTotal)}</div><div class="box"><b>Salary Paid</b>Rs. ${fmt(salaryPaid)}</div><div class="box"><b>Advance Given</b>Rs. ${fmt(advanceGiven)}</div><div class="box"><b>Advance Repaid / Vasooli</b>Rs. ${fmt(advanceReturn)}</div></div>
      <table><thead><tr><th>Date</th><th>Month</th><th>Employee</th><th>Type</th><th>Amount</th><th>Mode/Bank</th><th>Reference</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="footer"><div class="sign">Prepared By</div><div class="sign">Checked By</div><div class="sign">Approved By</div></div>
      <script>setTimeout(()=>window.print(),400)<\/script></body></html>`);
    w.document.close();
  };

  function fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d + 'T00:00:00').toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' }); }
    catch { return d; }
  }

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function toast(msg, type = 'success') {
    const t = document.getElementById('liveToast');
    const m = document.getElementById('toast-message');
    if (!t || !m) { alert(msg); return; }
    m.textContent = msg;
    t.className = `toast bg-${type === 'danger' ? 'danger' : type === 'warning' ? 'warning' : type === 'info' ? 'info' : 'success'} text-white`;
    new bootstrap.Toast(t, { delay: 4500 }).show();
  }

  console.log('✅ employee-salary.js loaded with 3-option salary flow + A4 print');
})();
