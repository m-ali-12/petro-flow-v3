// =============================================
// FILE: js/employee-salary.js
// Employee Salary Management
// Uses the same customer list that loads on Customers page
// Supports normal salary + advance salary payments
// =============================================
(function () {
  'use strict';

  const PAGE_SIZE = 20;
  let employees = []; // customer-backed people + standalone employees
  let banks = [];
  let salaryPayments = [];
  let currentPage = 1;

  const sb = () => window.supabaseClient;
  const fmt = n => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const today = () => new Date().toISOString().slice(0, 10);
  const currentMonth = () => new Date().toISOString().slice(0, 7);

  window.addEventListener('DOMContentLoaded', () => waitReady(init));

  function waitReady(cb, n = 0) {
    if (window.supabaseClient && window.PETRO_SESSION_READY) return setTimeout(cb, 400);
    if (n > 80) return;
    setTimeout(() => waitReady(cb, n + 1), 100);
  }

  async function init() {
    if (typeof window.hasPermission === 'function' && !window.hasPermission('canManageBanks')) {
      document.querySelector('.container-fluid')?.insertAdjacentHTML('afterbegin',
        `<div class="alert alert-danger"><i class="bi bi-lock me-2"></i>You do not have permission to access Employee Salary.</div>`);
      return;
    }

    const monthEl = document.getElementById('filter-month');
    if (monthEl) monthEl.value = currentMonth();
    await Promise.all([loadEmployees(), loadBanks()]);
    await loadSalaryPayments();
  }

  function missingColumn(message) {
    const m = String(message || '').match(/'([^']+)' column|column ['"]?([a-zA-Z0-9_]+)['"]?/i);
    return m ? (m[1] || m[2]) : null;
  }

  async function safeInsert(table, payload, selectCols = null) {
    let row = { ...payload };
    const removable = Object.keys(row).filter(k => !['name', 'amount', 'payment_date', 'salary_month'].includes(k));
    for (let i = 0; i < 14; i++) {
      let query = sb().from(table).insert([row]);
      if (selectCols) query = query.select(selectCols).single();
      const res = await query;
      if (!res.error) return res;
      const msg = res.error.message || res.error.details || '';
      const col = missingColumn(msg);
      if (col && Object.prototype.hasOwnProperty.call(row, col)) { delete row[col]; continue; }
      const rm = removable.find(k => Object.prototype.hasOwnProperty.call(row, k));
      if (rm && /schema cache|column|could not find|does not exist/i.test(msg)) { delete row[rm]; continue; }
      return res;
    }
    return { error: { message: `Could not insert into ${table}.` } };
  }

  async function safeUpdate(table, payload, column, value) {
    let row = { ...payload };
    const removable = Object.keys(row).filter(k => !['name', 'amount', 'payment_date', 'salary_month'].includes(k));
    for (let i = 0; i < 14; i++) {
      const res = await sb().from(table).update(row).eq(column, value);
      if (!res.error) return res;
      const msg = res.error.message || res.error.details || '';
      const col = missingColumn(msg);
      if (col && Object.prototype.hasOwnProperty.call(row, col)) { delete row[col]; continue; }
      const rm = removable.find(k => Object.prototype.hasOwnProperty.call(row, k));
      if (rm && /schema cache|column|could not find|does not exist/i.test(msg)) { delete row[rm]; continue; }
      return res;
    }
    return { error: { message: `Could not update ${table}.` } };
  }

  async function safeInsertTransaction(payload) {
    const res = await safeInsert('transactions', payload);
    if (!res.error) return true;
    console.warn('Salary transaction insert skipped:', res.error.message);
    return false;
  }

  async function getOwnerCustomerId() {
    try {
      const { data } = await sb().from('customers').select('id').eq('category', 'Owner').maybeSingle();
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

  let _employeeModal, _salaryModal;
  function employeeModal() { return _employeeModal || (_employeeModal = new bootstrap.Modal(document.getElementById('employeeModal'))); }
  function salaryModal() { return _salaryModal || (_salaryModal = new bootstrap.Modal(document.getElementById('salaryModal'))); }

  // ── Customer-backed employee list ─────────────────────────────
  async function loadEmployees() {
    let customers = [];
    let employeeRows = [];

    try {
      const { data, error } = await sb().from('customers').select('*').order('sr_no');
      if (error) throw error;
      customers = data || [];
    } catch (e) {
      console.warn('Customer list load error:', e.message);
      toast('Customer list load nahi hui: ' + e.message, 'danger');
    }

    try {
      const { data, error } = await sb().from('employees').select('*').order('name');
      if (!error) employeeRows = data || [];
      else console.warn('Standalone employees load skipped:', error.message);
    } catch (e) {
      console.warn('Standalone employees table not available:', e.message);
    }

    const byCustomerId = new Map();
    const byNamePhone = new Map();
    employeeRows.forEach(e => {
      if (e.customer_id) byCustomerId.set(String(e.customer_id), e);
      byNamePhone.set(`${norm(e.name)}|${norm(e.phone)}`, e);
      if (!e.phone) byNamePhone.set(`${norm(e.name)}|`, e);
    });

    const usedEmployeeIds = new Set();
    const peopleFromCustomers = customers.map(c => {
      const matched = byCustomerId.get(String(c.id)) || byNamePhone.get(`${norm(c.name)}|${norm(c.phone)}`) || byNamePhone.get(`${norm(c.name)}|`);
      if (matched?.id) usedEmployeeIds.add(String(matched.id));
      return {
        key: `customer:${c.id}`,
        id: `customer:${c.id}`,
        source: 'customer',
        customer_id: c.id,
        employee_id: matched?.id || null,
        sr_no: c.sr_no,
        name: c.name || 'Unnamed',
        phone: c.phone || '',
        role: c.employee_role || matched?.role || c.category || 'Customer',
        category: c.category || '',
        salary: Number(c.employee_salary ?? matched?.salary ?? 0),
        status: c.employee_status || matched?.status || 'active',
        balance: Number(c.balance || 0)
      };
    });

    const standaloneEmployees = employeeRows
      .filter(e => !usedEmployeeIds.has(String(e.id)) && !e.customer_id)
      .map(e => ({
        key: `employee:${e.id}`,
        id: `employee:${e.id}`,
        source: 'employee',
        customer_id: null,
        employee_id: e.id,
        sr_no: null,
        name: e.name || 'Unnamed',
        phone: e.phone || '',
        role: e.role || 'Employee',
        category: 'Employee',
        salary: Number(e.salary || 0),
        status: e.status || 'active',
        balance: 0
      }));

    employees = [...peopleFromCustomers, ...standaloneEmployees];
    renderEmployees();
    populateEmployeeDropdowns();
    updateStats();
  }

  function renderEmployees() {
    const el = document.getElementById('employees-list');
    if (!el) return;
    const active = employees.filter(e => (e.status || 'active') === 'active');
    if (!employees.length) {
      el.innerHTML = '<div class="text-center py-3 text-muted small">No customer / employee record found.<br>Customer page wali list yahan load hogi.</div>';
      return;
    }

    el.innerHTML = employees.map(e => {
      const bal = Number(e.balance || 0);
      const balHtml = e.source === 'customer'
        ? `<div class="small ${bal > 0 ? 'text-danger' : bal < 0 ? 'text-success' : 'text-muted'}">${bal > 0 ? 'Udhaar: Rs. ' + fmt(bal) : bal < 0 ? 'Advance: Rs. ' + fmt(Math.abs(bal)) : 'Balance: Rs. 0.00'}</div>`
        : '';
      const sourceBadge = e.source === 'customer'
        ? `<span class="badge bg-light text-dark border ms-1">Customer List</span>`
        : `<span class="badge bg-info ms-1">Employee</span>`;
      const editBtns = e.source === 'employee'
        ? `<button class="btn btn-link btn-sm p-0 me-2 text-primary" onclick="openEmployeeModal('${e.key}')"><i class="bi bi-pencil"></i></button>
           <button class="btn btn-link btn-sm p-0 text-danger" onclick="deleteEmployee('${e.key}')"><i class="bi bi-trash"></i></button>`
        : '';
      return `
        <div class="employee-row d-flex align-items-start justify-content-between py-2 border-bottom">
          <div>
            <div class="fw-semibold">${e.sr_no ? '#' + esc(e.sr_no) + ' - ' : ''}${esc(e.name)}</div>
            <div class="small text-muted">${esc(e.role || '—')} ${e.phone ? ' • ' + esc(e.phone) : ''}${sourceBadge}</div>
            <div class="small"><span class="text-success fw-semibold">Rs. ${fmt(e.salary)}</span> / month
              <span class="badge bg-${(e.status || 'active') === 'active' ? 'success' : 'secondary'} ms-1">${esc(e.status || 'active')}</span>
            </div>
            ${balHtml}
          </div>
          <div class="text-nowrap">
            <button class="btn btn-link btn-sm p-0 me-2 text-success" onclick="openSalaryModal('${e.key}')"><i class="bi bi-cash-coin"></i></button>
            ${editBtns}
          </div>
        </div>`;
    }).join('');
    const stat = document.getElementById('stat-employees');
    if (stat) stat.textContent = active.length;
  }

  function populateEmployeeDropdowns() {
    ['salary-employee', 'filter-employee'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const val = sel.value;
      sel.innerHTML = id === 'filter-employee'
        ? '<option value="">All Customer / Employee List</option>'
        : '<option value="">— Select Customer / Employee —</option>';
      employees.filter(e => (e.status || 'active') === 'active' || id === 'filter-employee').forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.key;
        opt.textContent = `${e.sr_no ? '#' + e.sr_no + ' - ' : ''}${e.name}${e.source === 'customer' ? ' (Customer)' : ''}`;
        sel.appendChild(opt);
      });
      if (val && [...sel.options].some(o => o.value === val)) sel.value = val;
    });
  }

  function findPerson(key) {
    if (!key) return null;
    return employees.find(e => String(e.key) === String(key) || String(e.id) === String(key) || String(e.employee_id) === String(key));
  }

  function findPersonForPayment(p) {
    return employees.find(e =>
      (p.customer_id && e.customer_id && String(e.customer_id) === String(p.customer_id)) ||
      (p.employee_id && e.employee_id && String(e.employee_id) === String(p.employee_id)) ||
      (p.employee_name && norm(e.name) === norm(p.employee_name))
    );
  }

  function paymentMatchesPerson(p, person) {
    if (!person) return true;
    if (person.customer_id && p.customer_id && String(person.customer_id) === String(p.customer_id)) return true;
    if (person.employee_id && p.employee_id && String(person.employee_id) === String(p.employee_id)) return true;
    return p.employee_name && norm(p.employee_name) === norm(person.name);
  }

  async function ensureEmployeeRecord(person) {
    if (!person) return null;
    if (person.employee_id) return person.employee_id;

    try {
      if (person.customer_id) {
        const byCustomer = await sb().from('employees').select('*').eq('customer_id', person.customer_id).limit(1);
        if (!byCustomer.error && byCustomer.data?.[0]?.id) {
          person.employee_id = byCustomer.data[0].id;
          return person.employee_id;
        }
      }
    } catch (e) { console.warn('Employee lookup by customer skipped:', e.message); }

    try {
      const byName = await sb().from('employees').select('*').eq('name', person.name).limit(1);
      if (!byName.error && byName.data?.[0]?.id) {
        person.employee_id = byName.data[0].id;
        return person.employee_id;
      }
    } catch (e) { console.warn('Employee lookup by name skipped:', e.message); }

    const row = {
      name: person.name,
      role: person.role || null,
      phone: person.phone || null,
      salary: Number(person.salary || 0),
      status: 'active',
      customer_id: person.customer_id || null,
      created_by: window.currentUser?.id || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const res = await safeInsert('employees', row, 'id');
    if (res.error) {
      console.warn('Auto employee link create failed:', res.error.message);
      return null;
    }
    person.employee_id = res.data?.id || null;
    return person.employee_id;
  }

  // Standalone employee modal remains for extra employees not present in customer list.
  window.openEmployeeModal = function (key) {
    const person = findPerson(key);
    if (person && person.source === 'customer') {
      toast('Customer list record ko Customers page se edit karein. Yahan salary / advance pay kar sakte hain.', 'warning');
      return;
    }
    document.getElementById('emp-id').value = person?.employee_id || '';
    document.getElementById('modal-employee-title').textContent = person ? 'Edit Employee' : 'Add Employee';
    document.getElementById('emp-name').value = person?.name || '';
    document.getElementById('emp-role').value = person?.role || '';
    document.getElementById('emp-phone').value = person?.phone || '';
    document.getElementById('emp-salary').value = person?.salary || '';
    document.getElementById('emp-status').value = person?.status || 'active';
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

    let res;
    if (id) res = await safeUpdate('employees', row, 'id', id);
    else {
      row.created_at = new Date().toISOString();
      res = await safeInsert('employees', row);
    }
    if (res.error) { toast('Error saving employee: ' + res.error.message, 'danger'); return; }
    employeeModal().hide();
    toast('✅ Employee saved!', 'success');
    await loadEmployees();
  };

  window.deleteEmployee = async function (key) {
    const person = findPerson(key);
    if (!person || person.source === 'customer') {
      toast('Customer list record salary page se delete nahi ho sakta.', 'warning');
      return;
    }
    const used = salaryPayments.some(p => String(p.employee_id) === String(person.employee_id));
    if (used) { toast('Cannot delete — salary payments exist for this employee.', 'danger'); return; }
    if (!confirm('Delete this employee?')) return;
    const { error } = await sb().from('employees').delete().eq('id', person.employee_id);
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

  // ── Salary Payments ──────────────────────────────────────────
  window.loadSalaryPayments = async function () {
    const month = document.getElementById('filter-month')?.value;
    const personKey = document.getElementById('filter-employee')?.value;
    const bankId = document.getElementById('filter-bank')?.value;
    const selectedPerson = findPerson(personKey);

    let query = sb().from('employee_salary_payments').select('*').order('payment_date', { ascending: false });
    if (month) query = query.eq('salary_month', month);

    const { data, error } = await query;
    if (error) { toast('Error loading salary payments: ' + error.message + ' | Please run PETROFLOW_FINANCE_SALARY_DB_CHANGES.sql first.', 'danger'); return; }

    salaryPayments = (data || []).filter(p => {
      if (selectedPerson && !paymentMatchesPerson(p, selectedPerson)) return false;
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
    if (!tbody) return;
    if (!salaryPayments.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-5 text-muted"><i class="bi bi-inbox fs-2 d-block mb-2"></i>No salary payments found.</td></tr>`;
      document.getElementById('salary-pagination-info').textContent = 'Showing 0 records';
      document.getElementById('salary-pagination-btns').innerHTML = '';
      return;
    }

    const start = (currentPage - 1) * PAGE_SIZE;
    const slice = salaryPayments.slice(start, start + PAGE_SIZE);
    const total = salaryPayments.length;
    const pages = Math.ceil(total / PAGE_SIZE);

    tbody.innerHTML = slice.map(p => {
      const person = findPersonForPayment(p);
      const bank = banks.find(b => String(b.id) === String(p.bank_id));
      const salaryType = (p.salary_type || 'salary').toLowerCase();
      const isAdvance = salaryType === 'advance' || salaryType === 'advance_salary';
      return `<tr class="salary-row">
        <td class="fw-semibold">${fmtDate(p.payment_date)}</td>
        <td><span class="badge bg-light text-dark border">${esc(p.salary_month || '—')}</span></td>
        <td><span class="badge ${isAdvance ? 'bg-warning text-dark' : 'bg-primary'}">${isAdvance ? 'Advance Salary' : 'Salary Pay'}</span></td>
        <td>${esc(person?.name || p.employee_name || 'Unknown')}</td>
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

    document.getElementById('salary-pagination-info').textContent = `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total} records`;
    renderPagination(pages);
  }

  function renderPagination(pages) {
    const el = document.getElementById('salary-pagination-btns');
    if (!el) return;
    if (pages <= 1) { el.innerHTML = ''; return; }
    let html = '<nav><ul class="pagination pagination-sm mb-0">';
    html += `<li class="page-item ${currentPage === 1 ? 'disabled' : ''}"><a class="page-link" href="#" onclick="goSalaryPage(${currentPage - 1});return false">‹</a></li>`;
    for (let i = 1; i <= pages; i++) {
      html += `<li class="page-item ${i === currentPage ? 'active' : ''}"><a class="page-link" href="#" onclick="goSalaryPage(${i});return false">${i}</a></li>`;
    }
    html += `<li class="page-item ${currentPage === pages ? 'disabled' : ''}"><a class="page-link" href="#" onclick="goSalaryPage(${currentPage + 1});return false">›</a></li>`;
    html += '</ul></nav>';
    el.innerHTML = html;
  }

  window.goSalaryPage = function (p) { currentPage = p; renderSalaryPayments(); };

  window.openSalaryModal = function (personKey) {
    document.getElementById('salary-id').value = '';
    document.getElementById('salary-employee').value = personKey || '';
    document.getElementById('salary-type').value = 'salary';
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
    const personKey = document.getElementById('salary-employee').value;
    const salaryType = document.getElementById('salary-type')?.value || 'salary';
    const person = findPerson(personKey);
    if (!document.getElementById('salary-id').value) {
      document.getElementById('salary-amount').value = (person && salaryType === 'salary') ? (person.salary || '') : '';
    }
  };

  window.openEditSalary = function (id) {
    const p = salaryPayments.find(x => String(x.id) === String(id));
    if (!p) return;
    const person = findPersonForPayment(p);
    document.getElementById('salary-id').value = p.id;
    document.getElementById('salary-employee').value = person?.key || '';
    document.getElementById('salary-type').value = p.salary_type || 'salary';
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
    const personKey = document.getElementById('salary-employee').value;
    const salaryType = document.getElementById('salary-type')?.value || 'salary';
    const month = document.getElementById('salary-month').value;
    const date = document.getElementById('salary-date').value;
    const amount = parseFloat(document.getElementById('salary-amount').value || '0');
    const bankId = document.getElementById('salary-bank').value;
    const ref = document.getElementById('salary-ref').value.trim();
    const note = document.getElementById('salary-note').value.trim();
    const person = findPerson(personKey);
    const bank = banks.find(b => String(b.id) === String(bankId));

    if (!person) { toast('Please select customer / employee.', 'warning'); return; }
    if (!month) { toast('Salary month is required.', 'warning'); return; }
    if (!date) { toast('Payment date is required.', 'warning'); return; }
    if (!amount || amount <= 0) { toast('Amount must be greater than 0.', 'warning'); return; }

    const employeeRecordId = await ensureEmployeeRecord(person);
    if (!employeeRecordId) {
      toast('Employee link create nahi hua. Please DB SQL file run karein, phir try karein.', 'danger');
      return;
    }

    const typeLabel = salaryType === 'advance' ? 'Advance Salary' : 'Salary Pay';
    const fullNote = note || (salaryType === 'advance' ? 'Advance salary paid' : null);
    const row = {
      employee_id: employeeRecordId,
      customer_id: person.customer_id || null,
      employee_name: person.name || null,
      salary_type: salaryType,
      salary_month: month,
      payment_date: date,
      amount,
      bank_id: bankId || null,
      payment_mode: bankId ? 'Bank' : 'Cash',
      reference: ref || null,
      note: fullNote,
      created_by: window.currentUser?.id || null,
      updated_at: new Date().toISOString()
    };

    let res, saved = null;
    if (id) {
      res = await safeUpdate('employee_salary_payments', row, 'id', id);
      saved = { ...row, id };
    } else {
      row.created_at = new Date().toISOString();
      res = await safeInsert('employee_salary_payments', row, '*');
      saved = res.data;
    }
    if (res.error) { toast('Error saving salary payment: ' + res.error.message, 'danger'); return; }

    if (!id && saved) {
      let cashDepositId = null;
      if (bankId) {
        const depRow = {
          deposit_date: date,
          transaction_type: 'salary_pay',
          bank_id: bankId,
          amount,
          deposited_by: person.name || null,
          party_name: person.name || null,
          category: typeLabel,
          employee_id: employeeRecordId,
          customer_id: person.customer_id || null,
          salary_payment_id: saved.id,
          salary_month: month,
          salary_type: salaryType,
          reference: ref || null,
          note: fullNote,
          created_by: window.currentUser?.id || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        const depRes = await safeInsert('cash_deposits', depRow, 'id');
        if (!depRes.error) cashDepositId = depRes.data?.id || null;
        else console.warn('Salary bank finance entry skipped:', depRes.error.message);
      }

      const ownerId = await getOwnerCustomerId();
      await safeInsertTransaction({
        customer_id: person.customer_id || ownerId,
        transaction_type: salaryType === 'advance' ? 'AdvanceSalary' : 'SalaryPay',
        amount,
        charges: amount,
        cash_deposit_id: cashDepositId,
        salary_payment_id: saved.id,
        employee_id: employeeRecordId,
        employee_customer_id: person.customer_id || null,
        salary_month: month,
        salary_type: salaryType,
        bank_id: bankId || null,
        reference_no: ref || null,
        payment_mode: bankId ? (bank?.name || 'Bank') : 'Cash',
        entry_method: 'employee_salary',
        description: `${typeLabel} paid to ${person.name || 'Employee'} for ${month}${bankId ? ' via ' + (bank?.name || 'Bank') : ' in Cash'}${fullNote ? ' | ' + fullNote : ''}`,
        created_at: new Date(date + 'T12:00:00').toISOString()
      });
    }

    salaryModal().hide();
    toast(`✅ ${typeLabel} saved!`, 'success');
    await Promise.all([loadEmployees(), loadSalaryPayments()]);
  };

  window.deleteSalaryPayment = async function (id) {
    if (!confirm('Delete this salary payment?')) return;
    try { await sb().from('cash_deposits').delete().eq('salary_payment_id', id); } catch (e) { console.warn('Related bank salary entry delete skipped:', e.message); }
    try { await sb().from('transactions').delete().eq('salary_payment_id', id); } catch (e) { console.warn('Related salary transaction delete skipped:', e.message); }
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
    const monthRows = salaryPayments.filter(p => p.salary_month === month);
    const paidTotal = monthRows.reduce((s, p) => s + Number(p.amount || 0), 0);
    const advanceTotal = monthRows
      .filter(p => (p.salary_type || 'salary').toLowerCase() === 'advance')
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const baseTotal = employees
      .filter(e => (e.status || 'active') === 'active')
      .reduce((s, e) => s + Number(e.salary || 0), 0);

    setText('stat-employees', employees.filter(e => (e.status || 'active') === 'active').length);
    setText('stat-paid', 'Rs. ' + fmt(paidTotal));
    setText('stat-payment-count', monthRows.length);
    setText('stat-advance', 'Rs. ' + fmt(advanceTotal));
    setText('stat-base', 'Rs. ' + fmt(baseTotal));
  }

  function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
  function fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d + 'T00:00:00').toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' }); }
    catch { return d; }
  }
  function norm(s) { return String(s || '').trim().toLowerCase(); }
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function toast(msg, type = 'success') {
    const t = document.getElementById('liveToast');
    const m = document.getElementById('toast-message');
    if (!t || !m) return;
    m.textContent = msg;
    t.className = `toast bg-${type === 'danger' ? 'danger' : type === 'warning' ? 'warning' : 'success'} text-white`;
    new bootstrap.Toast(t, { delay: 4500 }).show();
  }

  console.log('✅ employee-salary.js loaded with customer list + advance salary');
})();
