// =============================================
// FILE: js/settings-page.js
// Settings & Configuration Management
// Handles Fuel/Mobil Price History & Tank Capacity
// =============================================
(function () {
  'use strict';

  // State
  let currentSettings = null;

  // Helpers
  const $ = id => document.getElementById(id);
  const sb = () => window.supabaseClient;
  const fmt = n => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  function showToast(msg, type = 'success') {
    const t = $('liveToast');
    const m = $('toast-message');
    const title = $('toast-title');
    if (!t || !m) return;
    m.textContent = msg;
    title.textContent = type === 'danger' ? 'Error' : type === 'warning' ? 'Warning' : 'Success';
    t.className = `toast bg-${type} text-white`;
    new bootstrap.Toast(t).show();
  }

  // ── Init ─────────────────────────────────────────────────────
  window.addEventListener('DOMContentLoaded', () => {
    // Wait for Supabase & Auth
    function wait() {
      if (window.supabaseClient && window.PETRO_SESSION_READY) {
        init();
      } else {
        setTimeout(wait, 100);
      }
    }
    wait();
  });

  async function init() {
    console.log('⚙️ Settings Page Initializing...');
    await loadSettings();
    bindPricePeriodControls();
    await loadCounts();
  }

  // ── Load Data ────────────────────────────────────────────────
  async function loadSettings() {
    try {
      const { data, error } = await sb()
        .from('settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        console.log('No settings row found yet. Will create one on first save.');
        currentSettings = null;
        return;
      }

      currentSettings = data;

      // Populate current prices
      if ($('current-petrol-price')) $('current-petrol-price').textContent = fmt(data.petrol_price);
      if ($('current-diesel-price')) $('current-diesel-price').textContent = fmt(data.diesel_price);
      if ($('current-car-mobil-price')) $('current-car-mobil-price').textContent = fmt(data.car_mobil_price);
      if ($('current-open-mobil-price')) $('current-open-mobil-price').textContent = fmt(data.open_mobil_price);

      // Populate Inputs (defaults)
      if ($('petrol-price')) $('petrol-price').value = data.petrol_price || '';
      if ($('diesel-price')) $('diesel-price').value = data.diesel_price || '';
      if ($('car-mobil-price')) $('car-mobil-price').value = data.car_mobil_price || '';
      if ($('open-mobil-price')) $('open-mobil-price').value = data.open_mobil_price || '';

      // Price period defaults: flexible 7 / 15 / 30 days from selected start date
      const startDefault = toDateInputValue(new Date());
      if ($('price-validity-days')) $('price-validity-days').value = '15';
      if ($('mobil-validity-days')) $('mobil-validity-days').value = '15';
      if ($('price-start-date')) $('price-start-date').value = startDefault;
      if ($('mobil-start-date')) $('mobil-start-date').value = startDefault;
      updateEndDateFromPeriod('price');
      updateEndDateFromPeriod('mobil');

      // Update time
      if ($('fuel-price-update-time')) {
        $('fuel-price-update-time').textContent = data.updated_at ? new Date(data.updated_at).toLocaleString() : 'Never';
      }
      if ($('mobil-price-update-time')) {
        $('mobil-price-update-time').textContent = data.updated_at ? new Date(data.updated_at).toLocaleString() : 'Never';
      }

      renderHistory();
      await loadTankCapacities();
    } catch (e) {
      console.error('loadSettings error:', e);
      showToast('Error loading settings', 'danger');
    }
  }

  async function loadTankCapacities() {
    try {
      const { data, error } = await sb().from('tanks').select('id, name, fuel_type, capacity');
      if (error) throw error;

      const petrol = data.find(t => t.fuel_type === 'Petrol');
      const diesel = data.find(t => t.fuel_type === 'Diesel');

      if (petrol) {
        if ($('current-petrol-capacity')) $('current-petrol-capacity').textContent = petrol.capacity;
        if ($('petrol-capacity-setting')) $('petrol-capacity-setting').value = petrol.capacity;
      }
      if (diesel) {
        if ($('current-diesel-capacity')) $('current-diesel-capacity').textContent = diesel.capacity;
        if ($('diesel-capacity-setting')) $('diesel-capacity-setting').value = diesel.capacity;
      }
    } catch (e) {
      console.error('loadTankCapacities error:', e);
    }
  }

  async function loadCounts() {
    try {
      const [cust, trans] = await Promise.all([
        sb().from('customers').select('id', { count: 'exact', head: true }),
        sb().from('transactions').select('id', { count: 'exact', head: true })
      ]);
      if ($('total-customers-count')) $('total-customers-count').textContent = cust.count || 0;
      if ($('total-transactions-count')) $('total-transactions-count').textContent = trans.count || 0;
    } catch (e) {}
  }

  function bindPricePeriodControls() {
    if (window.__pricePeriodControlsBound) return;
    window.__pricePeriodControlsBound = true;
    ['price', 'mobil'].forEach(prefix => {
      const startEl = $(prefix + '-start-date');
      const daysEl = $(prefix + '-validity-days');
      if (startEl) startEl.addEventListener('change', () => updateEndDateFromPeriod(prefix));
      if (daysEl) daysEl.addEventListener('change', () => updateEndDateFromPeriod(prefix));
    });
  }

  // ── Rendering History ────────────────────────────────────────
  let editingFuelIndex = null;
  let editingMobilIndex = null;

  function asDate(d) { return new Date(String(d || '') + 'T00:00:00'); }
  function toDateInputValue(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  function addDays(dateStr, daysToAdd) {
    const d = asDate(dateStr);
    d.setDate(d.getDate() + Number(daysToAdd || 0));
    return toDateInputValue(d);
  }
  function inclusiveDays(startDate, endDate) {
    const ms = asDate(endDate).getTime() - asDate(startDate).getTime();
    return Math.floor(ms / 86400000) + 1;
  }
  function updateEndDateFromPeriod(prefix) {
    const startEl = $(prefix + '-start-date');
    const daysEl = $(prefix + '-validity-days');
    const endEl = $(prefix + '-end-date');
    if (!startEl || !daysEl || !endEl || !startEl.value) return;
    const days = parseInt(daysEl.value || '15', 10);
    if (![7, 15, 30].includes(days)) return;
    endEl.value = addDays(startEl.value, days - 1);
  }

  function validateFlexiblePriceRange(startDate, endDate, selectedDays) {
    if (!startDate || !endDate) return 'Start date aur end date dono required hain. Validity 7, 15 ya 30 days select karein.';
    if (asDate(endDate) < asDate(startDate)) return 'End date start date se pehle nahi ho sakti.';
    const days = inclusiveDays(startDate, endDate);
    const allowed = [7, 15, 30];
    if (!allowed.includes(days)) return `Rate range ${days} days ka ban raha hai. Sirf 7, 15 ya 30 days allowed hain.`;
    if (selectedDays && Number(selectedDays) !== days) return `Selected validity ${selectedDays} days hai, lekin date range ${days} days ka hai. End date auto set karein ya validity change karein.`;
    return null;
  }

  function hasOverlap(history, startDate, endDate, skipIndex) {
    const ns = asDate(startDate).getTime();
    const ne = asDate(endDate).getTime();
    return (history || []).some((h, idx) => {
      if (idx === skipIndex) return false;
      const hs = asDate(h.start_date || h.date).getTime();
      const he = asDate(h.end_date || h.start_date || h.date).getTime();
      return ns <= he && ne >= hs;
    });
  }

  function renderHistory() {
    const fuelHistory = currentSettings?.price_history || [];
    const fuelTbody = $('fuel-history-table');
    if (fuelTbody) {
      if (fuelHistory.length === 0) {
        fuelTbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No history yet</td></tr>';
      } else {
        fuelTbody.innerHTML = fuelHistory.map((h, idx) => ({...h, _idx: idx}))
          .sort((a,b) => new Date(b.start_date || b.date) - new Date(a.start_date || a.date))
          .map(h => `
          <tr>
            <td>${h.start_date || h.date || '-'}</td>
            <td>${h.end_date || 'Current'}</td>
            <td class="text-primary fw-bold">Rs. ${fmt(h.petrol)}</td>
            <td class="text-warning fw-bold">Rs. ${fmt(h.diesel)}</td>
            <td class="small text-muted">${h.updated_by || 'Unknown'}</td>
            <td class="text-nowrap">
              <button class="btn btn-sm btn-outline-primary me-1" onclick="editFuelHistory(${h._idx})"><i class="bi bi-pencil"></i></button>
              <button class="btn btn-sm btn-outline-danger" onclick="deleteFuelHistory(${h._idx})"><i class="bi bi-trash"></i></button>
            </td>
          </tr>
        `).join('');
      }
    }

    const mobilHistory = currentSettings?.mobil_history || [];
    const mobilTbody = $('mobil-history-table');
    if (mobilTbody) {
      if (mobilHistory.length === 0) {
        mobilTbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No history yet</td></tr>';
      } else {
        mobilTbody.innerHTML = mobilHistory.map((h, idx) => ({...h, _idx: idx}))
          .sort((a,b) => new Date(b.start_date || b.date) - new Date(a.start_date || a.date))
          .map(h => `
          <tr>
            <td>${h.start_date || h.date || '-'}</td>
            <td>${h.end_date || 'Current'}</td>
            <td class="text-success fw-bold">Rs. ${fmt(h.car)}</td>
            <td class="text-info fw-bold">Rs. ${fmt(h.open)}</td>
            <td class="small text-muted">${h.updated_by || 'Unknown'}</td>
            <td class="text-nowrap">
              <button class="btn btn-sm btn-outline-success me-1" onclick="editMobilHistory(${h._idx})"><i class="bi bi-pencil"></i></button>
              <button class="btn btn-sm btn-outline-danger" onclick="deleteMobilHistory(${h._idx})"><i class="bi bi-trash"></i></button>
            </td>
          </tr>
        `).join('');
      }
    }
  }

  async function upsertSettings(payload) {
    if (currentSettings) {
      return await sb().from('settings').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', currentSettings.id);
    }
    return await sb().from('settings').insert({ ...payload, user_id: window.currentUser?.id || null, updated_at: new Date().toISOString() });
  }

  // ── Actions ──────────────────────────────────────────────────
  window.saveFuelPricesWithHistory = async function () {
    const petrol = parseFloat($('petrol-price').value);
    const diesel = parseFloat($('diesel-price').value);
    const startDate = $('price-start-date').value;
    const endDate = $('price-end-date')?.value || '';

    if (isNaN(petrol) || isNaN(diesel) || !startDate || !endDate) {
      showToast('Please fill prices, start date and end date.', 'warning');
      return;
    }
    const selectedDays = parseInt($('price-validity-days')?.value || '15', 10);
    const rangeError = validateFlexiblePriceRange(startDate, endDate, selectedDays);
    if (rangeError) { showToast(rangeError, 'warning'); return; }

    try {
      const history = [...(currentSettings?.price_history || [])];
      if (hasOverlap(history, startDate, endDate, editingFuelIndex)) {
        showToast('Is date range ka rate already exist karta hai. Pehle old range edit/delete karein.', 'warning');
        return;
      }
      const user = window.currentUserProfile?.full_name || 'Admin';
      const newEntry = { date: startDate, start_date: startDate, end_date: endDate, validity_days: selectedDays, petrol, diesel, updated_by: user, updated_at: new Date().toISOString() };
      if (editingFuelIndex !== null && history[editingFuelIndex]) history[editingFuelIndex] = newEntry;
      else history.push(newEntry);

      const latest = [...history].sort((a,b) => new Date(b.start_date || b.date) - new Date(a.start_date || a.date))[0] || newEntry;
      const { error } = await upsertSettings({ petrol_price: latest.petrol, diesel_price: latest.diesel, price_history: history });
      if (error) throw error;

      editingFuelIndex = null;
      localStorage.setItem('fuel_prices', JSON.stringify({ Petrol: latest.petrol, Diesel: latest.diesel }));
      window.config = window.config || {};
      window.config.FUEL_PRICES = { Petrol: latest.petrol, Diesel: latest.diesel };
      showToast(`✅ Fuel prices saved with ${selectedDays}-day validity!`);
      await loadSettings();
    } catch (e) {
      console.error(e);
      showToast('Error saving fuel prices: ' + e.message, 'danger');
    }
  };

  window.editFuelHistory = function (idx) {
    const h = currentSettings?.price_history?.[idx];
    if (!h) return;
    editingFuelIndex = idx;
    $('petrol-price').value = h.petrol || '';
    $('diesel-price').value = h.diesel || '';
    $('price-start-date').value = h.start_date || h.date || '';
    $('price-end-date').value = h.end_date || '';
    const fuelDays = h.validity_days || (h.end_date ? inclusiveDays(h.start_date || h.date, h.end_date) : 15);
    if ($('price-validity-days')) $('price-validity-days').value = [7,15,30].includes(Number(fuelDays)) ? String(fuelDays) : '15';
    showToast('Fuel history entry edit mode mein aa gayi. Changes karke Save Fuel Prices press karein.', 'warning');
  };

  window.deleteFuelHistory = async function (idx) {
    if (!confirm('Delete this fuel price history entry?')) return;
    const history = [...(currentSettings?.price_history || [])];
    history.splice(idx, 1);
    const latest = [...history].sort((a,b) => new Date(b.start_date || b.date) - new Date(a.start_date || a.date))[0] || {};
    const { error } = await upsertSettings({ petrol_price: latest.petrol || 0, diesel_price: latest.diesel || 0, price_history: history });
    if (error) { showToast('Delete error: ' + error.message, 'danger'); return; }
    editingFuelIndex = null;
    showToast('Fuel history entry deleted.', 'warning');
    await loadSettings();
  };

  window.saveMobilPricesWithHistory = async function () {
    const car = parseFloat($('car-mobil-price').value);
    const open = parseFloat($('open-mobil-price').value);
    const startDate = $('mobil-start-date').value;
    const endDate = $('mobil-end-date')?.value || '';

    if (isNaN(car) || isNaN(open) || !startDate || !endDate) {
      showToast('Please fill mobil prices, start date and end date.', 'warning');
      return;
    }
    const selectedDays = parseInt($('mobil-validity-days')?.value || '15', 10);
    const rangeError = validateFlexiblePriceRange(startDate, endDate, selectedDays);
    if (rangeError) { showToast(rangeError, 'warning'); return; }

    try {
      const history = [...(currentSettings?.mobil_history || [])];
      if (hasOverlap(history, startDate, endDate, editingMobilIndex)) {
        showToast('Is mobil date range ka rate already exist karta hai. Pehle old range edit/delete karein.', 'warning');
        return;
      }
      const user = window.currentUserProfile?.full_name || 'Admin';
      const newEntry = { date: startDate, start_date: startDate, end_date: endDate, validity_days: selectedDays, car, open, updated_by: user, updated_at: new Date().toISOString() };
      if (editingMobilIndex !== null && history[editingMobilIndex]) history[editingMobilIndex] = newEntry;
      else history.push(newEntry);

      const latest = [...history].sort((a,b) => new Date(b.start_date || b.date) - new Date(a.start_date || a.date))[0] || newEntry;
      const { error } = await upsertSettings({ car_mobil_price: latest.car, open_mobil_price: latest.open, mobil_history: history });
      if (error) throw error;
      editingMobilIndex = null;
      showToast(`✅ Mobil prices saved with ${selectedDays}-day validity!`);
      await loadSettings();
    } catch (e) {
      console.error(e);
      showToast('Error saving mobil prices: ' + e.message, 'danger');
    }
  };

  window.editMobilHistory = function (idx) {
    const h = currentSettings?.mobil_history?.[idx];
    if (!h) return;
    editingMobilIndex = idx;
    $('car-mobil-price').value = h.car || '';
    $('open-mobil-price').value = h.open || '';
    $('mobil-start-date').value = h.start_date || h.date || '';
    $('mobil-end-date').value = h.end_date || '';
    const mobilDays = h.validity_days || (h.end_date ? inclusiveDays(h.start_date || h.date, h.end_date) : 15);
    if ($('mobil-validity-days')) $('mobil-validity-days').value = [7,15,30].includes(Number(mobilDays)) ? String(mobilDays) : '15';
    showToast('Mobil history entry edit mode mein aa gayi. Changes karke Save Mobil Prices press karein.', 'warning');
  };

  window.deleteMobilHistory = async function (idx) {
    if (!confirm('Delete this mobil price history entry?')) return;
    const history = [...(currentSettings?.mobil_history || [])];
    history.splice(idx, 1);
    const latest = [...history].sort((a,b) => new Date(b.start_date || b.date) - new Date(a.start_date || a.date))[0] || {};
    const { error } = await upsertSettings({ car_mobil_price: latest.car || 0, open_mobil_price: latest.open || 0, mobil_history: history });
    if (error) { showToast('Delete error: ' + error.message, 'danger'); return; }
    editingMobilIndex = null;
    showToast('Mobil history entry deleted.', 'warning');
    await loadSettings();
  };

  window.updateTankCapacity = async function () {
    const petrolCap = parseFloat($('petrol-capacity-setting').value);
    const dieselCap = parseFloat($('diesel-capacity-setting').value);

    if (isNaN(petrolCap) || isNaN(dieselCap) || petrolCap <= 0 || dieselCap <= 0) {
      showToast('Tank capacity zero se zyada honi chahiye.', 'warning');
      return;
    }

    try {
      const { data: tanks, error: loadErr } = await sb().from('tanks').select('id, fuel_type');
      if (loadErr) throw loadErr;
      const updates = [];
      const pTank = (tanks || []).find(t => t.fuel_type === 'Petrol');
      const dTank = (tanks || []).find(t => t.fuel_type === 'Diesel');
      const common = { updated_at: new Date().toISOString() };
      if (pTank) updates.push(sb().from('tanks').update({ ...common, capacity: petrolCap }).eq('id', pTank.id));
      if (dTank) updates.push(sb().from('tanks').update({ ...common, capacity: dieselCap }).eq('id', dTank.id));
      await Promise.all(updates);
      showToast('✅ Tank capacities updated!');
      await loadTankCapacities();
    } catch (e) {
      console.error(e);
      showToast('Error updating capacity: ' + e.message, 'danger');
    }
  };

  window.exportData = async function () {
    const tables = [
      'settings','customers','transactions','banks','cash_deposits','direct_expense_entries','employees','employee_salary_payments',
      'tanks','tank_readings','mobil_sales','cash_advances','products','users','profiles','companies'
    ];
    const backup = {
      exported_at: new Date().toISOString(),
      project: 'PetroFlow',
      format: 'structure_and_data_json',
      schema: {},
      data: {},
      errors: {}
    };
    showToast('Export start ho raha hai...', 'warning');
    for (const table of tables) {
      try {
        const { data, error } = await sb().from(table).select('*');
        if (error) { backup.errors[table] = error.message; continue; }
        const rows = data || [];
        backup.data[table] = rows;
        const cols = new Set();
        rows.slice(0, 20).forEach(r => Object.keys(r || {}).forEach(k => cols.add(k)));
        backup.schema[table] = { columns: [...cols], row_count: rows.length };
      } catch (e) {
        backup.errors[table] = e.message;
      }
    }
    const stamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    const filename = `petroflow-complete-db-export-${stamp}.json`;
    if (window.PetroLedger?.downloadJSON) window.PetroLedger.downloadJSON(filename, backup);
    else {
      const blob = new Blob([JSON.stringify(backup, null, 2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }
    showToast('✅ Complete DB export JSON download ho gaya.');
  };

  window.clearOldData = function () {
    if (confirm('Are you sure? This will delete all transactions older than 1 year.')) {
      alert('Feature pending: Database cleanup requires direct SQL script for safety.');
    }
  };

  console.log('✅ settings-page.js loaded');
})();
