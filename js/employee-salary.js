// =============================================
// FILE: js/employee-salary.js
// Employee Salary Management
// Add employees and pay monthly salaries
// =============================================
(function () {
  'use strict';

  const PAGE_SIZE = 20;
  let employees = [];
  let banks = [];
  let salaryPayments = [];
  let currentPage = 1;

  const sb = () => window.supabaseClient;
  const fmt = n => Number(n||0).toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2});
  const today = () => new Date().toISOString().slice(0,10);
  const currentMonth = () => new Date().toISOString().slice(0,7);

  window.addEventListener('DOMContentLoaded', () => waitReady(init));

  function waitReady(cb, n=0) {
    if (window.supabaseClient && window.PETRO_SESSION_READY) return setTimeout(cb, 400);
    if (n>80) return;
    setTimeout(() => waitReady(cb, n+1), 100);
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
      console.warn('Owner account not available for salary transaction:', e.message);
      return null;
    }
  }

  function missingColumn(message){
    const m = String(message || '').match(/'([^']+)' column|column ['"]?([a-zA-Z0-9_]+)['"]?/i);
    return m ? (m[1] || m[2]) : null;
  }

  async function safeInsertTransaction(payload) {
    let row = { ...payload };
    const removable = ['cash_deposit_id','salary_payment_id','reference_no','payment_mode','entry_method','employee_id','salary_month','bank_id'];
    for (let i=0; i<10; i++) {
      const { error } = await sb().from('transactions').insert([row]);
      if (!error) return true;
      const col = missingColumn(error.message || error.details || '');
      if (col && Object.prototype.hasOwnProperty.call(row, col)) { delete row[col]; continue; }
      const rm = removable.find(k => Object.prototype.hasOwnProperty.call(row,k));
      if (rm && /schema cache|column/i.test(error.message || error.details || '')) { delete row[rm]; continue; }
      console.warn('Salary transaction insert skipped:', error.message);
      return false;
    }
    return false;
  }

  let _employeeModal, _salaryModal;
  function employeeModal(){ return _employeeModal || (_employeeModal = new bootstrap.Modal(document.getElementById('employeeModal'))); }
  function salaryModal(){ return _salaryModal || (_salaryModal = new bootstrap.Modal(document.getElementById('salaryModal'))); }

  // ── Employees ────────────────────────────────────────────────
  async function loadEmployees() {
    const { data, error } = await sb().from('employees').select('*').order('name');
    if (error) { toast('Error loading employees: ' + error.message + ' | Please run PETROFLOW_FINANCE_SALARY_DB_CHANGES.sql first.', 'danger'); return; }
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
      return;
    }
    el.innerHTML = employees.map(e => `
      <div class="employee-row d-flex align-items-start justify-content-between py-2 border-bottom">
        <div>
          <div class="fw-semibold">${esc(e.name)}</div>
          <div class="small text-muted">${esc(e.role || '—')} ${e.phone ? ' • '+esc(e.phone) : ''}</div>
          <div class="small"><span class="text-success fw-semibold">Rs. ${fmt(e.salary)}</span> / month
            <span class="badge bg-${(e.status||'active') === 'active' ? 'success' : 'secondary'} ms-1">${esc(e.status||'active')}</span>
          </div>
        </div>
        <div class="text-nowrap">
          <button class="btn btn-link btn-sm p-0 me-2 text-primary" onclick="openEmployeeModal('${e.id}')"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-link btn-sm p-0 me-2 text-success" onclick="openSalaryModal('${e.id}')"><i class="bi bi-cash-coin"></i></button>
          <button class="btn btn-link btn-sm p-0 text-danger" onclick="deleteEmployee('${e.id}')"><i class="bi bi-trash"></i></button>
        </div>
      </div>`).join('');
    document.getElementById('stat-employees').textContent = active.length;
  }

  function populateEmployeeDropdowns() {
    ['salary-employee','filter-employee'].forEach(id => {
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
      document.getElementById('emp-name').value = '';
      document.getElementById('emp-role').value = '';
      document.getElementById('emp-phone').value = '';
      document.getElementById('emp-salary').value = '';
      document.getElementById('emp-status').value = 'active';
    }
    employeeModal().show();
  };

  window.saveEmployee = async function () {
    const id = document.getElementById('emp-id').value;
    const name = document.getElementById('emp-name').value.trim();
    const role = document.getElementById('emp-role').value.trim();
    const phone = document.getElementById('emp-phone').value.trim();
    const salary = parseFloat(document.getElementById('emp-salary').value || '0');
    const status = document.getElementById('emp-status').value || 'active';

    if (!name) { toast('Employee name is required.', 'warning'); return; }
    if (salary < 0) { toast('Salary cannot be negative.', 'warning'); return; }

    const row = {
      name,
      role: role || null,
      phone: phone || null,
      salary,
      status,
      created_by: window.currentUser?.id || null,
      updated_at: new Date().toISOString()
    };

    let error;
    if (id) {
      ({ error } = await sb().from('employees').update(row).eq('id', id));
    } else {
      row.created_at = new Date().toISOString();
      ({ error } = await sb().from('employees').insert(row));
    }
    if (error) { toast('Error saving employee: ' + error.message, 'danger'); return; }
    employeeModal().hide();
    toast('✅ Employee saved!', 'success');
    await loadEmployees();
  };

  window.deleteEmployee = async function (id) {
    const used = salaryPayments.some(p => String(p.employee_id) === String(id));
    if (used) { toast('Cannot delete — salary payments exist for this employee.', 'danger'); return; }
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
    ['salary-bank','filter-bank'].forEach(id => {
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

  // ── Salary Payments ──────────────────────────────────────────
  window.loadSalaryPayments = async function () {
    const month = document.getElementById('filter-month').value;
    const employeeId = document.getElementById('filter-employee').value;
    const bankId = document.getElementById('filter-bank').value;

    let query = sb().from('employee_salary_payments').select('*').order('payment_date', { ascending: false });
    if (month) query = query.eq('salary_month', month);
    if (employeeId) query = query.eq('employee_id', employeeId);

    const { data, error } = await query;
    if (error) { toast('Error loading salary payments: ' + error.message + ' | Please run PETROFLOW_FINANCE_SALARY_DB_CHANGES.sql first.', 'danger'); return; }

    salaryPayments = (data || []).filter(p => {
      if (!bankId) return true;
      if (bankId === 'cash') return !p.bank_id;
      return String(p.bank_id || '') === String(bankId);
    });
    currentPage = 1;
    renderSalaryPayments();
    updateStats();
  };

  function renderSalaryPayments() {
    const tbody = document.getElementById('salary-tbody');
    if (!salaryPayments.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-5 text-muted"><i class="bi bi-inbox fs-2 d-block mb-2"></i>No salary payments found.</td></tr>`;
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
      return `<tr class="salary-row">
        <td class="fw-semibold">${fmtDate(p.payment_date)}</td>
        <td><span class="badge bg-light text-dark border">${esc(p.salary_month || '—')}</span></td>
        <td>${esc(emp?.name || p.employee_name || 'Unknown')}</td>
        <td class="text-danger fw-bold">- Rs. ${fmt(p.amount)}</td>
        <td class="small text-muted">${bank ? esc(bank.name) : 'Cash'}</td>
        <td class="small text-muted">${esc(p.reference || '—')}</td>
        <td class="small text-muted">${esc(p.note || '—')}</td>
        <td>
          <button class="btn btn-link btn-sm p-0 me-2 text-primary" onclick="openEditSalary('${p.id}')"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-link btn-sm p-0 text-danger" onclick="deleteSalaryPayment('${p.id}')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
    }).join('');

    document.getElementById('salary-pagination-info').textContent = `Showing ${start+1}–${Math.min(start+PAGE_SIZE, total)} of ${total} records`;
    renderPagination(pages);
  }

  function renderPagination(pages) {
    const el = document.getElementById('salary-pagination-btns');
    if (pages <= 1) { el.innerHTML = ''; return; }
    let html = '<nav><ul class="pagination pagination-sm mb-0">';
    html += `<li class="page-item ${currentPage===1?'disabled':''}"><a class="page-link" href="#" onclick="goSalaryPage(${currentPage-1});return false">‹</a></li>`;
    for (let i=1; i<=pages; i++) {
      html += `<li class="page-item ${i===currentPage?'active':''}"><a class="page-link" href="#" onclick="goSalaryPage(${i});return false">${i}</a></li>`;
    }
    html += `<li class="page-item ${currentPage===pages?'disabled':''}"><a class="page-link" href="#" onclick="goSalaryPage(${currentPage+1});return false">›</a></li>`;
    html += '</ul></nav>';
    el.innerHTML = html;
  }

  window.goSalaryPage = function(p){ currentPage = p; renderSalaryPayments(); };

  window.openSalaryModal = function (employeeId) {
    document.getElementById('salary-id').value = '';
    document.getElementById('salary-employee').value = employeeId || '';
    document.getElementById('salary-month').value = currentMonth();
    document.getElementById('salary-date').value = today();
    document.getElementById('salary-amount').value = '';
    document.getElementById('salary-bank').value = '';
    document.getElementById('salary-ref').value = '';
    document.getElementById('salary-note').value = '';
    document.getElementById('modal-salary-title').textContent = 'Pay Salary';
    fillEmployeeSalary();
    salaryModal().show();
  };

  window.fillEmployeeSalary = function () {
    const empId = document.getElementById('salary-employee').value;
    const emp = employees.find(e => String(e.id) === String(empId));
    if (emp && !document.getElementById('salary-id').value) {
      document.getElementById('salary-amount').value = emp.salary || '';
    }
  };

  window.openEditSalary = function (id) {
    const p = salaryPayments.find(x => String(x.id) === String(id));
    if (!p) return;
    document.getElementById('salary-id').value = p.id;
    document.getElementById('salary-employee').value = p.employee_id || '';
    document.getElementById('salary-month').value = p.salary_month || currentMonth();
    document.getElementById('salary-date').value = p.payment_date || today();
    document.getElementById('salary-amount').value = p.amount || '';
    document.getElementById('salary-bank').value = p.bank_id || '';
    document.getElementById('salary-ref').value = p.reference || '';
    document.getElementById('salary-note').value = p.note || '';
    document.getElementById('modal-salary-title').textContent = 'Edit Salary Payment';
    salaryModal().show();
  };

  window.saveSalaryPayment = async function () {
    const id = document.getElementById('salary-id').value;
    const employeeId = document.getElementById('salary-employee').value;
    const month = document.getElementById('salary-month').value;
    const date = document.getElementById('salary-date').value;
    const amount = parseFloat(document.getElementById('salary-amount').value || '0');
    const bankId = document.getElementById('salary-bank').value;
    const ref = document.getElementById('salary-ref').value.trim();
    const note = document.getElementById('salary-note').value.trim();
    const emp = employees.find(e => String(e.id) === String(employeeId));
    const bank = banks.find(b => String(b.id) === String(bankId));

    if (!employeeId) { toast('Please select employee.', 'warning'); return; }
    if (!month) { toast('Salary month is required.', 'warning'); return; }
    if (!date) { toast('Payment date is required.', 'warning'); return; }
    if (!amount || amount <= 0) { toast('Amount must be greater than 0.', 'warning'); return; }

    const row = {
      employee_id: employeeId,
      employee_name: emp?.name || null,
      salary_month: month,
      payment_date: date,
      amount,
      bank_id: bankId || null,
      payment_mode: bankId ? 'Bank' : 'Cash',
      reference: ref || null,
      note: note || null,
      created_by: window.currentUser?.id || null,
      updated_at: new Date().toISOString()
    };

    let error, saved = null;
    if (id) {
      ({ error } = await sb().from('employee_salary_payments').update(row).eq('id', id));
      saved = { ...row, id };
    } else {
      row.created_at = new Date().toISOString();
      const res = await sb().from('employee_salary_payments').insert(row).select().single();
      error = res.error;
      saved = res.data;
    }
    if (error) { toast('Error saving salary payment: ' + error.message, 'danger'); return; }

    if (!id && saved) {
      let cashDepositId = null;
      if (bankId) {
        const depRow = {
          deposit_date: date,
          transaction_type: 'salary_pay',
          bank_id: bankId,
          amount,
          deposited_by: emp?.name || null,
          party_name: emp?.name || null,
          employee_id: employeeId,
          salary_payment_id: saved.id,
          salary_month: month,
          reference: ref || null,
          note: note || null,
          created_by: window.currentUser?.id || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        const depRes = await sb().from('cash_deposits').insert(depRow).select('id').single();
        if (!depRes.error) cashDepositId = depRes.data?.id || null;
        else console.warn('Salary bank finance entry skipped:', depRes.error.message);
      }

      const ownerId = await getOwnerCustomerId();
      await safeInsertTransaction({
        customer_id: ownerId,
        transaction_type: 'SalaryPay',
        amount,
        charges: amount,
        cash_deposit_id: cashDepositId,
        salary_payment_id: saved.id,
        employee_id: employeeId,
        salary_month: month,
        reference_no: ref || null,
        payment_mode: bankId ? (bank?.name || 'Bank') : 'Cash',
        entry_method: 'employee_salary',
        description: `Salary paid to ${emp?.name || 'Employee'} for ${month}${bankId ? ' via '+(bank?.name || 'Bank') : ' in Cash'}${note ? ' | '+note : ''}`,
        created_at: new Date(date + 'T12:00:00').toISOString()
      });
    }

    salaryModal().hide();
    toast('✅ Salary payment saved!', 'success');
    await loadSalaryPayments();
  };

  window.deleteSalaryPayment = async function (id) {
    if (!confirm('Delete this salary payment?')) return;
    try { await sb().from('cash_deposits').delete().eq('salary_payment_id', id); } catch(e) { console.warn('Related bank salary entry delete skipped:', e.message); }
    try { await sb().from('transactions').delete().eq('salary_payment_id', id); } catch(e) { console.warn('Related salary transaction delete skipped:', e.message); }
    const { error } = await sb().from('employee_salary_payments').delete().eq('id', id);
    if (error) { toast('Error: ' + error.message, 'danger'); return; }
    toast('Salary payment deleted.', 'warning');
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
    const paidRows = salaryPayments.filter(p => p.salary_month === month);
    const paidTotal = paidRows.reduce((s,p) => s + Number(p.amount || 0), 0);
    const baseTotal = employees
      .filter(e => (e.status || 'active') === 'active')
      .reduce((s,e) => s + Number(e.salary || 0), 0);

    document.getElementById('stat-employees').textContent = employees.filter(e => (e.status || 'active') === 'active').length;
    document.getElementById('stat-paid').textContent = 'Rs. ' + fmt(paidTotal);
    document.getElementById('stat-payment-count').textContent = paidRows.length;
    document.getElementById('stat-base').textContent = 'Rs. ' + fmt(baseTotal);
  }

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

  console.log('✅ employee-salary.js loaded');
})();
