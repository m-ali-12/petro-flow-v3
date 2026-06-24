/**
 * daily-readings.js  v3.0
 * Khalid & Sons Petroleum — Daily Machine Readings
 *
 * ─── DB THEORY (transactions-COMPLETE-v5.js se samjha) ───────────
 *   transactions table key fields:
 *     charges    = amount (NOT NULL) — yahan cash sale store hogi
 *     amount     = same as charges (NOT NULL constraint)
 *     liters     = total liters sold
 *     unit_price = rate per liter
 *     fuel_type  = 'Petrol' | 'Diesel'
 *     transaction_type = 'CashSale'
 *     entry_method     = 'machine_reading'
 *     description      = JSON string with full reading details
 *
 *   settings table:
 *     price_history = JSONB array [{date, petrol, diesel, updated_by}]
 *     Sabse latest entry sorted by date desc = current price
 *     (settings-page.js ka logic exactly yahi hai)
 *
 *   Credit transactions (customer udhaar):
 *     transaction_type = 'Credit', fuel_type = 'Petrol'/'Diesel'
 *     charges = sale amount
 *     (transactions-COMPLETE-v5.js handleNewSale line 2628-2633)
 *
 * ─── SUMMARY CARDS LOGIC ─────────────────────────────────────────
 *   Machine Reading page pe summary cards:
 *     GROSS REVENUE  = sum of (liters * rate) for all CashSale readings
 *     CREDIT / UDHAAR AUTO = sum of auto credit stored in description JSON
 *     CASH IN HAND (NET) = sum of charges (cash in hand sale amount)
 *     TOTAL LITERS   = sum of liters field
 *
 *   NOTE: Customer Credit transactions (jab transaction page pe sale enter
 *   hoti hai) woh alag table mein hain. Daily readings page pe sirf
 *   machine reading se calculated udhaar dikhti hai jo user khud darj karta hai.
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════
     HELPERS
  ═══════════════════════════════════════════════════════════ */
  const el   = id => document.getElementById(id);
  const fmt  = n  => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtL = n  => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const fmtD = d  => {
    if (!d) return '—';
    try {
      return new Date(d + 'T00:00:00').toLocaleDateString('en-PK', {
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
      });
    } catch(e) { return d; }
  };

  // Business date must stay Pakistan/local date.
  // Supabase stores timestamptz in UTC; if we save 2026-06-21T00:00:01+05:00,
  // it returns as 2026-06-20T19:00:01Z and simple split('T')[0] shows previous day.
  // These helpers prevent the one-day-back issue without changing old data.
  const BUSINESS_TZ = 'Asia/Karachi';

  function partsYMD(dateObj) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(dateObj).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function todayYMD() {
    return partsYMD(new Date());
  }

  function businessDateFromTimestamp(ts) {
    if (!ts) return '';
    // Date-only strings are already business dates.
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(ts))) return String(ts);
    try { return partsYMD(new Date(ts)); } catch(e) { return String(ts).split('T')[0] || ''; }
  }

  function businessTimestamp(dateStr) {
    // Noon PKT keeps the same date even on pages that still use split('T')[0].
    return dateStr ? `${dateStr}T12:00:00+05:00` : null;
  }

  function showToast(type, title, msg) {
    const t = el('liveToast');
    if (!t) { alert(title + ': ' + msg); return; }
    el('toast-title').textContent   = title;
    el('toast-message').textContent = msg;
    t.className = 'toast ' + (
      type === 'success' ? 'bg-success text-white' :
      type === 'danger'  ? 'bg-danger text-white'  :
                           'bg-warning text-dark'
    );
    new bootstrap.Toast(t, { delay: 3500 }).show();
  }

  /* ═══════════════════════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════════════════════ */
  let _rows        = [];
  let _creditRows  = [];
  let _reconMap    = {};
  let _petrolCount = 0;
  let _dieselCount = 0;

  async function getOwnerId() {
    if (window.PetroLedger?.getOwnerCustomerId) return await window.PetroLedger.getOwnerCustomerId();
    return null;
  }

  async function adjustOwnerCash(delta) {
    const ownerId = await getOwnerId();
    if (!ownerId || !delta) return true;
    if (window.PetroLedger?.adjustCustomerBalance) {
      return await window.PetroLedger.adjustCustomerBalance(ownerId, delta);
    }
    return true;
  }

  // Stock rule for this workflow:
  // Daily Reading page saves ONLY cash sale stock deduction.
  // Customer credit liters are entered from Transactions > New Sale and deducted there.
  // This avoids double-minus when total machine liters include both cash + credit.
  function splitCashAndCreditLiters(totalLiters, rate, udhaarAmount) {
    const total = Math.max(0, parseFloat(totalLiters) || 0);
    const price = parseFloat(rate) || 0;
    const udhaar = Math.max(0, parseFloat(udhaarAmount) || 0);
    const creditLiters = price > 0 ? Math.min(total, udhaar / price) : 0;
    const cashLiters = Math.max(0, total - creditLiters);
    return {
      totalLiters: parseFloat(total.toFixed(3)),
      creditLiters: parseFloat(creditLiters.toFixed(3)),
      cashLiters: parseFloat(cashLiters.toFixed(3))
    };
  }

  // New workflow requested by user:
  // Daily Reading me Credit amount type nahi karna. Operator total liters + actual
  // Cash in Hand enter karega. Credit/Udhaar automatically calculate hoga:
  // Credit = Gross Sale - Cash in Hand. Old saved data untouched rahega because
  // purani rows description.meta.udhaar se render hoti rahengi.
  function calcFromCashInHand(totalLiters, rate, cashInputRaw) {
    const total = Math.max(0, parseFloat(totalLiters) || 0);
    const price = Math.max(0, parseFloat(rate) || 0);
    const gross = parseFloat((total * price).toFixed(2));

    const raw = cashInputRaw == null ? '' : String(cashInputRaw).trim();
    // Blank field ka matlab: full cash sale. Agar actual zero cash ho to 0 type karein.
    const entered = raw === '' ? gross : Math.max(0, parseFloat(raw) || 0);
    const cash = parseFloat(Math.min(gross, entered).toFixed(2));
    const credit = parseFloat(Math.max(0, gross - cash).toFixed(2));
    const overCash = parseFloat(Math.max(0, entered - gross).toFixed(2));
    return { gross, cash, credit, entered, overCash };
  }

  function totalLitersForReading(row) {
    const m = row?.meta || {};
    return parseFloat(m.total_liters ?? m.liters ?? row?.liters) || 0;
  }


  function rowDate(row) {
    return businessDateFromTimestamp(row?.created_at);
  }

  function reconKey(date, fuel) {
    return `${date || ''}|${fuel || ''}`;
  }

  function parseTxnDescription(desc) {
    try { return JSON.parse(desc || '{}') || {}; } catch (e) { return {}; }
  }

  function amountForTxn(row) {
    return parseFloat(row?.charges ?? row?.amount ?? 0) || 0;
  }

  function litersForCreditTxn(row) {
    const direct = parseFloat(row?.liters);
    if (!isNaN(direct) && direct > 0) return direct;
    const amount = amountForTxn(row);
    const rate = parseFloat(row?.unit_price) || 0;
    return rate > 0 ? amount / rate : 0;
  }

  function expectedCreditLitersForReading(row) {
    const m = row?.meta || {};
    const direct = parseFloat(m.credit_liters_machine);
    if (!isNaN(direct) && direct >= 0) return direct;
    const udhaar = parseFloat(m.udhaar) || 0;
    const rate = parseFloat(m.rate || row?.unit_price) || 0;
    return rate > 0 ? udhaar / rate : 0;
  }

  function buildCreditReconciliation(readings, creditRows) {
    const map = {};

    function ensure(date, fuel) {
      const key = reconKey(date, fuel);
      if (!map[key]) {
        map[key] = {
          key, date, fuel,
          expectedAmount: 0,
          expectedLiters: 0,
          assignedAmount: 0,
          assignedLiters: 0,
          readingCount: 0,
          txnCount: 0,
          status: 'clear',
          label: 'Cash Only',
          amountDiff: 0,
          litersDiff: 0
        };
      }
      return map[key];
    }

    (readings || []).forEach(r => {
      const date = rowDate(r);
      const fuel = r.fuel_type || r.meta?.fuel_type || '';
      if (!date || !fuel) return;
      const bucket = ensure(date, fuel);
      bucket.expectedAmount += parseFloat(r.meta?.udhaar) || 0;
      bucket.expectedLiters += expectedCreditLitersForReading(r);
      bucket.readingCount += 1;
    });

    (creditRows || []).forEach(t => {
      const date = rowDate(t);
      const fuel = t.fuel_type || '';
      if (!date || !fuel) return;
      const bucket = ensure(date, fuel);
      bucket.assignedAmount += amountForTxn(t);
      bucket.assignedLiters += litersForCreditTxn(t);
      bucket.txnCount += 1;
    });

    Object.values(map).forEach(b => {
      b.expectedAmount = parseFloat(b.expectedAmount.toFixed(2));
      b.expectedLiters = parseFloat(b.expectedLiters.toFixed(3));
      b.assignedAmount = parseFloat(b.assignedAmount.toFixed(2));
      b.assignedLiters = parseFloat(b.assignedLiters.toFixed(3));
      b.amountDiff = parseFloat((b.expectedAmount - b.assignedAmount).toFixed(2));
      b.litersDiff = parseFloat((b.expectedLiters - b.assignedLiters).toFixed(3));

      const amountTol = 2; // rupees rounding tolerance
      const literTol = Math.max(0.1, Math.abs(b.expectedLiters) * 0.001); // 0.1L or 0.1%

      if (b.expectedAmount <= amountTol && b.assignedAmount <= amountTol) {
        b.status = 'clear'; b.label = 'Cash Only';
      } else if (b.expectedAmount <= amountTol && b.assignedAmount > amountTol) {
        b.status = 'unlinked'; b.label = 'Unlinked Credit';
      } else if (b.assignedAmount <= amountTol) {
        b.status = 'pending'; b.label = 'Pending Credit';
      } else if (b.assignedAmount > b.expectedAmount + amountTol || (b.expectedLiters > 0 && b.assignedLiters > b.expectedLiters + literTol)) {
        b.status = 'over'; b.label = 'Over Credit';
      } else if (Math.abs(b.amountDiff) <= amountTol && (b.expectedLiters <= 0 || Math.abs(b.litersDiff) <= literTol)) {
        b.status = 'matched'; b.label = 'Matched';
      } else {
        b.status = 'partial'; b.label = 'Partial';
      }
    });

    return map;
  }

  function reconBadge(bucket) {
    const b = bucket || { status: 'clear', label: 'Cash Only' };
    const styles = {
      matched: 'background:#d4edda;color:#155724;',
      clear: 'background:#e2e3e5;color:#495057;',
      pending: 'background:#fff3cd;color:#856404;',
      partial: 'background:#fff3cd;color:#856404;',
      over: 'background:#f8d7da;color:#721c24;',
      unlinked: 'background:#cfe2ff;color:#084298;'
    };
    const icons = { matched:'✅', clear:'—', pending:'⏳', partial:'⚠️', over:'🚫', unlinked:'🔗' };
    return `<span class="badge" style="${styles[b.status] || styles.clear}">${icons[b.status] || ''} ${b.label}</span>`;
  }

  function stockDeductedLitersForReading(row) {
    const m = row?.meta || {};
    if (m.stock_mode === 'cash_only_daily_reading') {
      return parseFloat(m.stock_deducted_liters ?? m.cash_liters ?? row?.liters) || 0;
    }
    // Old daily-reading rows did not deduct stock. Do not reverse/double-adjust them.
    return 0;
  }

  async function adjustTankStock(fuelType, deltaLiters) {
    const sb = window.supabaseClient;
    const delta = parseFloat(deltaLiters) || 0;
    if (!sb || !fuelType || !delta) return true;

    try {
      const companyId = window.currentUserProfile?.company_id || null;
      let q = sb.from('tanks').select('id,current_stock,company_id').eq('fuel_type', fuelType);
      if (companyId) q = q.eq('company_id', companyId);

      let { data: tank, error } = await q.maybeSingle();
      if (error && /company_id|schema cache|column/i.test(error.message || '')) {
        ({ data: tank, error } = await sb.from('tanks').select('id,current_stock').eq('fuel_type', fuelType).maybeSingle());
      }
      if (error) throw error;
      if (!tank?.id) { console.warn('Tank not found for stock adjustment:', fuelType); return false; }

      const current = parseFloat(tank.current_stock) || 0;
      const next = Math.max(0, parseFloat((current + delta).toFixed(3)));
      const { error: updError } = await sb
        .from('tanks')
        .update({ current_stock: next, last_updated: new Date().toISOString() })
        .eq('id', tank.id);
      if (updError) throw updError;
      return true;
    } catch (e) {
      console.warn('Tank stock adjustment skipped:', e.message);
      return false;
    }
  }

  /* ═══════════════════════════════════════════════════════════
     SETTINGS — PRICE HISTORY (exact same logic as settings-page.js)
     price_history JSONB array: [{date, petrol, diesel, updated_by}]
     Sort by date desc → index 0 = latest price
  ═══════════════════════════════════════════════════════════ */
  async function loadPrices() {
    const sb = window.supabaseClient;
    if (!sb) return;
    try {
      // Load all settings, no user_id filter (settings-page.js bhi yahi karta hai)
      const { data, error } = await sb
        .from('settings')
        .select('price_history, petrol_price, diesel_price')
        .limit(1)
        .maybeSingle();

      if (error) { console.warn('Settings load error:', error.message); return; }
      if (!data) { console.warn('No settings row found'); return; }

      let petrolPrice = 0;
      let dieselPrice = 0;

      // price_history JSONB array se latest price nikalo (settings-page.js ka exact logic)
      if (data.price_history && data.price_history.length > 0) {
        const today = new Date();
        const sorted = [...data.price_history].map(h => ({...h, start: h.start_date || h.date, end: h.end_date || ''}))
          .filter(h => h.start)
          .sort((a, b) => new Date(b.start) - new Date(a.start));
        const latest = sorted.find(h => new Date(h.start) <= today && (!h.end || today <= new Date(h.end + 'T23:59:59'))) || sorted[0];
        petrolPrice = parseFloat(latest.petrol) || 0;
        dieselPrice = parseFloat(latest.diesel) || 0;
        console.log('Prices from price_history:', latest.start, latest.end ? ('to '+latest.end) : 'current', '→ Petrol:', petrolPrice, 'Diesel:', dieselPrice);
      }
      // Fallback: direct columns (purani entries ke liye)
      else if (data.petrol_price || data.diesel_price) {
        petrolPrice = parseFloat(data.petrol_price) || 0;
        dieselPrice = parseFloat(data.diesel_price) || 0;
        console.log('Prices from columns:', petrolPrice, dieselPrice);
      }

      if (el('add-petrol-price')) el('add-petrol-price').value = petrolPrice || '';
      if (el('add-diesel-price')) el('add-diesel-price').value = dieselPrice || '';
      if (el('petrol-price-hint')) el('petrol-price-hint').textContent = `Settings: Rs.${petrolPrice}/L`;
      if (el('diesel-price-hint')) el('diesel-price-hint').textContent = `Settings: Rs.${dieselPrice}/L`;

    } catch (e) {
      console.warn('loadPrices exception:', e.message);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     DATE RANGE
  ═══════════════════════════════════════════════════════════ */
  function getRange() {
    const period = el('period-select')?.value || 'this_month';
    const now    = new Date();
    const Y = now.getFullYear(), M = now.getMonth(), D = now.getDate();
    const pad = v => String(v).padStart(2, '0');
    const ds  = (yr, mo, dy) => `${yr}-${pad(mo + 1)}-${pad(dy)}`;

    let from, to;
    switch (period) {
      case 'today':
        from = to = ds(Y, M, D); break;
      case 'this_week': {
        const s = new Date(Y, M, D - now.getDay());
        from = ds(s.getFullYear(), s.getMonth(), s.getDate());
        to   = ds(Y, M, D); break;
      }
      case 'this_month':
        from = ds(Y, M, 1); to = ds(Y, M, D); break;
      case 'last_month': {
        const lm = new Date(Y, M, 0);
        from = ds(Y, M - 1, 1);
        to   = ds(lm.getFullYear(), lm.getMonth(), lm.getDate()); break;
      }
      case 'this_year':
        from = ds(Y, 0, 1); to = ds(Y, M, D); break;
      case 'since_april':
        from = `${Y}-04-01`; to = ds(Y, M, D); break;
      case 'all_time':
        from = '2020-01-01'; to = ds(Y, M, D); break;
      case 'custom':
        from = el('date-from')?.value || ds(Y, M, 1);
        to   = el('date-to')?.value   || ds(Y, M, D); break;
      default:
        from = '2020-01-01'; to = ds(Y, M, D);
    }
    return { from, to };
  }

  function setPeriodLabel() {
    const map = {
      today: 'Aaj ki readings',
      this_week: 'Is hafte ki readings',
      this_month:   'Is mahine ki readings',
      last_month:   'Pichle mahine ki readings',
      since_april:  'April 2026 se ab tak ki readings',
      all_time:     'Tamam entries',
      this_year: 'Is saal ki readings',
      custom: 'Custom range'
    };
    const lbl = el('range-label');
    if (lbl) lbl.textContent = map[el('period-select')?.value] || '';
  }

  /* ═══════════════════════════════════════════════════════════
     MACHINE CARD HTML
  ═══════════════════════════════════════════════════════════ */
  function machineHTML(fuel, num) {
    const cls    = fuel.toLowerCase();
    const prefix = fuel === 'Petrol' ? 'p' : 'd';
    const removeBtn = num > 1
      ? `<button type="button" class="btn btn-sm btn-outline-danger ms-auto py-0"
           onclick="DR.removeMachine('${fuel}',${num})"><i class="bi bi-trash"></i></button>`
      : '';

    return `
      <div class="machine-card" id="machine-card-${cls}-${num}">
        <div class="mc-head ${cls}">
          <i class="bi bi-droplet-fill"></i>
          ${fuel} Machine #${num}
          ${removeBtn}
        </div>
        <div class="mc-body">
          <div class="row g-3">
            <div class="col-md-4">
              <label class="form-label small fw-semibold">Liters Bika (24 Hours) <span class="text-danger">*</span></label>
              <input type="number" id="${prefix}-li-${num}" class="form-control"
                step="0.001" placeholder="Total liters sold" oninput="DR.calcMachine('${fuel}',${num})" 
                style="border:2px solid ${fuel==='Petrol'?'#198754':'#f1c40f'};">
            </div>
            <div class="col-md-4">
              <label class="form-label small fw-semibold">
                Cash in Hand (Rs)
              </label>
              <input type="number" id="${prefix}-ud-${num}" class="form-control"
                step="0.01" placeholder="Blank = full cash" oninput="DR.calcMachine('${fuel}',${num})">
              <small class="text-muted">Credit auto: Gross - Cash in Hand</small>
            </div>
            <div class="col-md-4">
              <label class="form-label small fw-semibold">Testing (L)</label>
              <input type="number" id="${prefix}-te-${num}" class="form-control"
                step="0.001" placeholder="0.000" oninput="DR.calcMachine('${fuel}',${num})">
            </div>
          </div>
          <div class="live-calc" id="calc-${cls}-${num}">
            <span class="text-muted">Total liters enter karein — result yahan dikhega</span>
          </div>
        </div>
      </div>`;
  }

  function initMachines() {
    _petrolCount = 1;
    _dieselCount = 1;
    if (el('petrol-machines-wrap')) el('petrol-machines-wrap').innerHTML = machineHTML('Petrol', 1);
    if (el('diesel-machines-wrap')) el('diesel-machines-wrap').innerHTML = machineHTML('Diesel', 1);
    if (el('grand-total-box')) el('grand-total-box').style.display = 'none';
    if (el('add-notes')) el('add-notes').value = '';
  }

  /* ═══════════════════════════════════════════════════════════
     LIVE CALCULATIONS
  ═══════════════════════════════════════════════════════════ */
  window.DR = window.DR || {};

  DR.addMachine = function(fuel) {
    const wrap = el(fuel.toLowerCase() + '-machines-wrap');
    if (!wrap) return;
    if (fuel === 'Petrol') { _petrolCount++; wrap.insertAdjacentHTML('beforeend', machineHTML('Petrol', _petrolCount)); }
    else                   { _dieselCount++; wrap.insertAdjacentHTML('beforeend', machineHTML('Diesel', _dieselCount)); }
  };

  DR.removeMachine = function(fuel, num) {
    const card = el('machine-card-' + fuel.toLowerCase() + '-' + num);
    if (card) card.remove();
    DR.recalcAll();
  };

  DR.calcMachine = function(fuel, num) {
    const p   = fuel === 'Petrol' ? 'p' : 'd';
    const cls = fuel.toLowerCase();

    const litersInput = parseFloat(el(`${p}-li-${num}`)?.value) || 0;
    const cashRaw = el(`${p}-ud-${num}`)?.value ?? '';
    const te = parseFloat(el(`${p}-te-${num}`)?.value) || 0;
    const pr = parseFloat(el(fuel === 'Petrol' ? 'add-petrol-price' : 'add-diesel-price')?.value) || 0;

    const liters = Math.max(0, litersInput - te);
    const calc = calcFromCashInHand(liters, pr, cashRaw);
    const gross = calc.gross;
    const cash = calc.cash;
    const ud = calc.credit;

    const badge = el(`calc-${cls}-${num}`);
    if (!badge) return;

    badge.innerHTML = `
      <div class="row text-center g-0">
        <div class="col-3">
          <div class="small text-muted">Liters (Net)</div>
          <div class="fw-bold text-primary">${fmtL(liters)} L</div>
        </div>
        <div class="col-3">
          <div class="small text-muted">Gross Sale</div>
          <div class="fw-bold">Rs.${fmt(gross)}</div>
        </div>
        <div class="col-3">
          <div class="small text-muted">Credit Auto (−)</div>
          <div class="fw-bold text-danger">Rs.${fmt(ud)}</div>
        </div>
        <div class="col-3">
          <div class="small text-muted">✅ Cash in Hand</div>
          <div class="fw-bold ${cash >= 0 ? 'profit-pos' : 'profit-neg'}">Rs.${fmt(cash)}</div>
        </div>
      </div>`;

    DR.updateGrandTotal();
  };

  DR.recalcAll = function() {
    for (let i = 1; i <= _petrolCount; i++) DR.calcMachine('Petrol', i);
    for (let i = 1; i <= _dieselCount; i++) DR.calcMachine('Diesel', i);
  };

  DR.updateGrandTotal = function() {
    let totL = 0, totG = 0, totC = 0;

    for (let i = 1; i <= _petrolCount; i++) {
      if (!el(`p-li-${i}`)) continue;
      const liInput = parseFloat(el(`p-li-${i}`)?.value) || 0;
      const cashRaw = el(`p-ud-${i}`)?.value ?? '';
      const te = parseFloat(el(`p-te-${i}`)?.value) || 0;
      const pr = parseFloat(el('add-petrol-price')?.value) || 0;
      const li = Math.max(0, liInput - te);
      const calc = calcFromCashInHand(li, pr, cashRaw);
      totL += li; totG += calc.gross; totC += calc.cash;
    }
    for (let i = 1; i <= _dieselCount; i++) {
      if (!el(`d-li-${i}`)) continue;
      const liInput = parseFloat(el(`d-li-${i}`)?.value) || 0;
      const cashRaw = el(`d-ud-${i}`)?.value ?? '';
      const te = parseFloat(el(`d-te-${i}`)?.value) || 0;
      const pr = parseFloat(el('add-diesel-price')?.value) || 0;
      const li = Math.max(0, liInput - te);
      const calc = calcFromCashInHand(li, pr, cashRaw);
      totL += li; totG += calc.gross; totC += calc.cash;
    }

    const gtBox = el('grand-total-box');
    if (totG > 0 && gtBox) {
      gtBox.style.display = '';
      el('gt-liters').textContent = fmtL(totL) + ' L';
      el('gt-gross').textContent  = 'Rs. ' + fmt(totG);
      el('gt-cash').textContent   = 'Rs. ' + fmt(totC);
    }
  };

  /* ═══════════════════════════════════════════════════════════
     SAVE — transactions table exact same format as transactions-COMPLETE-v5.js
     charges = amount = NET cash sale value (NOT NULL required)
     liters  = total liters
     unit_price = rate per liter
     fuel_type = 'Petrol'/'Diesel'
     description = JSON with full reading details
  ═══════════════════════════════════════════════════════════ */
  DR.save = async function() {
    const sb = window.supabaseClient;
    if (!sb) { showToast('danger', 'Error', 'Database connect nahi'); return; }

    const date = el('add-date')?.value;
    if (!date) { showToast('warning', 'Zaroorat!', 'Taareekh zaroor daalein'); return; }

    const petrolRate = parseFloat(el('add-petrol-price')?.value) || 0;
    const dieselRate = parseFloat(el('add-diesel-price')?.value) || 0;
    const notes      = el('add-notes')?.value || '';

    // User ID (optional, may be null)
    let userId = null;
    try {
      const { data: au } = await sb.auth.getUser();
      userId = au?.user?.id || null;
    } catch(e) { /* auth optional */ }

    // PKT midnight timestamp
    const createdAt = businessTimestamp(date);
    // Daily reading cash is business revenue, not Owner khata.
    // Keep CashSale rows without customer_id so Owner balance does not change automatically.
    const ownerId = null;
    let totalCashForOwner = 0;

    const inserts = [];

    /* ── Petrol machines ── */
    for (let i = 1; i <= _petrolCount; i++) {
      const liEl = el(`p-li-${i}`);
      if (!liEl || liEl.value === '') continue;
      const litersRaw = parseFloat(liEl.value);
      if (isNaN(litersRaw) || litersRaw <= 0) continue;

      const te    = parseFloat(el(`p-te-${i}`)?.value) || 0;
      const cashRaw = el(`p-ud-${i}`)?.value ?? '';
      const liters = parseFloat(Math.max(0, litersRaw - te).toFixed(3));
      const calc = calcFromCashInHand(liters, petrolRate, cashRaw);
      const gross = calc.gross;
      const cash = calc.cash;
      const ud = calc.credit;
      const split  = splitCashAndCreditLiters(liters, petrolRate, ud);
      // Do not add daily cash to Owner khata; P&L reads this CashSale as income.
      // Stock: only cash liters are deducted here; credit liters are deducted from Transactions > New Sale.

      inserts.push({
        ...(ownerId ? { customer_id: ownerId } : {}),
        transaction_type: 'CashSale',
        fuel_type:        'Petrol',
        entry_method:     'machine_reading',
        charges:          cash,
        amount:           cash,
        liters:           split.cashLiters,
        unit_price:       petrolRate,
        description:      JSON.stringify({
          machine: i,
          liters_input: litersRaw,
          liters,
          total_liters: split.totalLiters,
          cash_liters: split.cashLiters,
          credit_liters_machine: split.creditLiters,
          stock_deducted_liters: split.cashLiters,
          stock_mode: 'cash_only_daily_reading',
          rate:    petrolRate,
          gross,
          udhaar:  ud,
          cash_in_hand: cash,
          cash_in_hand_entered: calc.entered,
          cash_input_mode: 'cash_in_hand_auto_credit',
          testing: te,
          notes
        }),
        payment_method: 'Cash',
        created_at:     createdAt,
        ...(userId ? { user_id: userId } : {})
      });
    }

    /* ── Diesel machines ── */
    for (let i = 1; i <= _dieselCount; i++) {
      const liEl = el(`d-li-${i}`);
      if (!liEl || liEl.value === '') continue;
      const litersRaw = parseFloat(liEl.value);
      if (isNaN(litersRaw) || litersRaw <= 0) continue;

      const te    = parseFloat(el(`d-te-${i}`)?.value) || 0;
      const cashRaw = el(`d-ud-${i}`)?.value ?? '';
      const liters = parseFloat(Math.max(0, litersRaw - te).toFixed(3));
      const calc = calcFromCashInHand(liters, dieselRate, cashRaw);
      const gross = calc.gross;
      const cash = calc.cash;
      const ud = calc.credit;
      const split  = splitCashAndCreditLiters(liters, dieselRate, ud);
      // Do not add daily cash to Owner khata; P&L reads this CashSale as income.
      // Stock: only cash liters are deducted here; credit liters are deducted from Transactions > New Sale.

      inserts.push({
        ...(ownerId ? { customer_id: ownerId } : {}),
        transaction_type: 'CashSale',
        fuel_type:        'Diesel',
        entry_method:     'machine_reading',
        charges:          cash,
        amount:           cash,
        liters:           split.cashLiters,
        unit_price:       dieselRate,
        description:      JSON.stringify({
          machine: i,
          liters_input: litersRaw,
          liters,
          total_liters: split.totalLiters,
          cash_liters: split.cashLiters,
          credit_liters_machine: split.creditLiters,
          stock_deducted_liters: split.cashLiters,
          stock_mode: 'cash_only_daily_reading',
          rate:    dieselRate,
          gross,
          udhaar:  ud,
          cash_in_hand: cash,
          cash_in_hand_entered: calc.entered,
          cash_input_mode: 'cash_in_hand_auto_credit',
          testing: te,
          notes
        }),
        payment_method: 'Cash',
        created_at:     createdAt,
        ...(userId ? { user_id: userId } : {})
      });
    }

    if (!inserts.length) {
      showToast('warning', 'Zaroorat!', 'Kam az kam ek machine ki opening aur closing reading daalein');
      return;
    }

    try {
      const { error } = await sb.from('transactions').insert(inserts);
      if (error) throw error;
      // Owner khata is not touched here. CashSale is included in Profit & Loss only.

      const stockByFuel = inserts.reduce((acc, row) => {
        let meta = {};
        try { meta = JSON.parse(row.description || '{}'); } catch(e) {}
        const l = parseFloat(meta.stock_deducted_liters ?? row.liters) || 0;
        if (l > 0) acc[row.fuel_type] = (acc[row.fuel_type] || 0) + l;
        return acc;
      }, {});
      for (const [fuel, litersToDeduct] of Object.entries(stockByFuel)) {
        await adjustTankStock(fuel, -litersToDeduct);
      }

      showToast('success', 'Saved! ✅', `${inserts.length} machine reading(s) save ho gayi. Cash in hand ke mutabiq cash liters stock se minus ho gaye; auto credit liters Transactions page se minus honge.`);

      const modal = bootstrap.Modal.getInstance(el('addReadingModal'));
      if (modal) modal.hide();

      initMachines();
      DR.load();

    } catch (e) {
      console.error('DR.save error:', e);
      showToast('danger', 'Save Error', e.message);
    }
  };

  /* ═══════════════════════════════════════════════════════════
     LOAD — readings + is period mein Credit transactions bhi
     CashSale = machine reading se aaya cash
     Credit = customer transactions se aaya udhaar (transaction page se)
  ═══════════════════════════════════════════════════════════ */
  DR.load = async function() {
    const sb = window.supabaseClient;
    if (!sb) { setTimeout(DR.load, 200); return; }

    setPeriodLabel();
    const { from, to } = getRange();
    const fuelFilter = el('filter-fuel')?.value || '';

    const tbody = el('readings-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="11" class="text-center py-4 text-muted">
      <div class="spinner-border spinner-border-sm me-2"></div>Loading...
    </td></tr>`;

    try {
      // Machine readings query
      let q = sb.from('transactions')
        .select('id, customer_id, transaction_type, fuel_type, charges, amount, liters, unit_price, description, created_at, entry_method')
        .eq('transaction_type', 'CashSale')
        .eq('entry_method', 'machine_reading')
        .gte('created_at', from + 'T00:00:00+05:00')
        .lte('created_at', to   + 'T23:59:59+05:00')
        .order('created_at', { ascending: false });

      if (fuelFilter) q = q.eq('fuel_type', fuelFilter);

      const { data: readingsData, error: readingsErr } = await q;
      if (readingsErr) throw readingsErr;

      // Customer non-cash fuel transactions for reconciliation.
      // Credit + AdvanceUsed dono stock ko transaction page se minus karte hain.
      let creditQ = sb.from('transactions')
        .select('id, customer_id, transaction_type, fuel_type, charges, amount, liters, unit_price, description, created_at')
        .in('transaction_type', ['Credit', 'AdvanceUsed'])
        .gte('created_at', from + 'T00:00:00+05:00')
        .lte('created_at', to   + 'T23:59:59+05:00');

      if (fuelFilter) creditQ = creditQ.eq('fuel_type', fuelFilter);

      const { data: creditData, error: creditErr } = await creditQ;
      if (creditErr) console.warn('Credit reconciliation load skipped:', creditErr.message);

      // Parse machine readings
      _rows = (readingsData || []).map(r => {
        let meta = {};
        try { meta = JSON.parse(r.description || '{}'); } catch(e) {}
        return { ...r, meta };
      });
      _creditRows = (creditData || []).map(t => ({ ...t, meta: parseTxnDescription(t.description) }));
      _reconMap = buildCreditReconciliation(_rows, _creditRows);

      renderTable();
      renderDailySummary();
      renderSummaryCards();

    } catch (e) {
      console.error('DR.load error:', e);
      if (tbody) tbody.innerHTML = `<tr><td colspan="11" class="text-center py-3 text-danger">
        Error: ${e.message}
      </td></tr>`;
    }
  };

  /* ═══════════════════════════════════════════════════════════
     RENDER TABLE
  ═══════════════════════════════════════════════════════════ */
  function renderTable() {
    const tbody = el('readings-tbody');
    const count = el('table-count');
    if (count) count.textContent = `${_rows.length} records`;

    if (!_rows.length) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="11" class="text-center py-4 text-muted">
        Is period mein koi reading nahi — "Nai Reading Darj Karein" se add karein
      </td></tr>`;
      if (el('readings-tfoot')) el('readings-tfoot').innerHTML = '';
      return;
    }

    let totL = 0, totG = 0, totU = 0, totC = 0;

    const html = _rows.map(r => {
      const m      = r.meta;
      const liters = totalLitersForReading(r);
      const rate   = parseFloat(r.unit_price) || m.rate || 0;
      const gross  = m.gross  || (liters * rate);
      const udhaar = m.udhaar || 0;
      const cash   = parseFloat(r.charges) || 0;
      const dateStr = rowDate(r);

      totL += liters; totG += gross; totU += udhaar; totC += cash;

      const fBadge = r.fuel_type === 'Petrol'
        ? '<span class="badge" style="background:#d4edda;color:#155724;padding:4px 10px;">⛽ Petrol</span>'
        : '<span class="badge" style="background:#fff3cd;color:#856404;padding:4px 10px;">🛢 Diesel</span>';

      const hasOpenClose = (m.opening || m.closing);
      const openCloseInfo = hasOpenClose 
        ? `<div class="small text-muted" style="font-size:10px;">O: ${fmtL(m.opening)} | C: ${fmtL(m.closing)}</div>`
        : '';

      return `<tr>
        <td><strong>${fmtD(dateStr)}</strong></td>
        <td>${fBadge}</td>
        <td class="text-center">M#${m.machine || 1}</td>
        <td class="text-end">
          <div class="text-primary fw-bold">${fmtL(liters)} L</div>
          ${openCloseInfo}
        </td>
        <td class="text-end">Rs.${fmt(rate)}</td>
        <td class="text-end">Rs.${fmt(gross)}</td>
        <td class="text-end text-danger">Rs.${fmt(udhaar)}</td>
        <td class="text-end fw-bold ${cash >= 0 ? 'profit-pos' : 'profit-neg'}">Rs.${fmt(cash)}</td>
        <td class="text-center">${reconBadge(_reconMap[reconKey(dateStr, r.fuel_type)])}</td>
        <td class="text-center no-print">
          <button class="btn btn-sm btn-outline-primary me-1" onclick="DR.openEdit(${r.id})" title="Edit Reading">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger" onclick="DR.del(${r.id})" title="Delete">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>`;
    }).join('');

    if (tbody) tbody.innerHTML = html;
    if (el('readings-tfoot')) el('readings-tfoot').innerHTML = `
      <tr class="tfoot-total">
        <td colspan="3"><strong>TOTAL (${_rows.length} entries)</strong></td>
        <td class="text-end text-primary fw-bold">${fmtL(totL)} L</td>
        <td></td>
        <td class="text-end fw-bold">Rs.${fmt(totG)}</td>
        <td class="text-end text-danger fw-bold">Rs.${fmt(totU)}</td>
        <td class="text-end fw-bold profit-pos">Rs.${fmt(totC)}</td>
        <td class="text-center">Credit reconciliation</td>
        <td class="no-print"></td>
      </tr>`;
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER DAILY SUMMARY
  ═══════════════════════════════════════════════════════════ */
  function renderDailySummary() {
    const days = {};

    _rows.forEach(r => {
      const d = rowDate(r) || '?';
      if (!days[d]) days[d] = { petrolL: 0, dieselL: 0, petrolCash: 0, dieselCash: 0, expected: 0, assigned: 0, pending: 0, over: 0, statuses: [] };
      const liters = totalLitersForReading(r);
      const cash   = parseFloat(r.charges) || 0;

      if (r.fuel_type === 'Petrol') {
        days[d].petrolL    += liters;
        days[d].petrolCash += cash;
      } else {
        days[d].dieselL    += liters;
        days[d].dieselCash += cash;
      }
    });

    Object.values(_reconMap || {}).forEach(b => {
      const d = b.date || '?';
      if (!days[d]) days[d] = { petrolL: 0, dieselL: 0, petrolCash: 0, dieselCash: 0, expected: 0, assigned: 0, pending: 0, over: 0, statuses: [] };
      days[d].expected += b.expectedAmount || 0;
      days[d].assigned += b.assignedAmount || 0;
      if ((b.expectedAmount || 0) > (b.assignedAmount || 0)) days[d].pending += (b.expectedAmount - b.assignedAmount);
      if ((b.assignedAmount || 0) > (b.expectedAmount || 0)) days[d].over += (b.assignedAmount - b.expectedAmount);
      days[d].statuses.push(b.status);
    });

    const tbody = el('daily-tbody');
    const keys  = Object.keys(days).sort().reverse();

    if (!keys.length) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="text-center py-3 text-muted">Koi data nahi</td></tr>';
      return;
    }

    function dayBadge(day) {
      if (day.statuses.includes('over')) return reconBadge({status:'over', label:'Over Credit'});
      if (day.statuses.includes('unlinked')) return reconBadge({status:'unlinked', label:'Unlinked Credit'});
      if (day.statuses.includes('pending') || day.statuses.includes('partial')) return reconBadge({status:'partial', label:'Credit Pending'});
      if (day.statuses.includes('matched')) return reconBadge({status:'matched', label:'Matched'});
      return reconBadge({status:'clear', label:'Cash Only'});
    }

    if (tbody) tbody.innerHTML = keys.map(d => {
      const day   = days[d];
      const total = day.petrolCash + day.dieselCash;
      return `<tr>
        <td><strong>${fmtD(d)}</strong></td>
        <td class="text-end text-success">${fmtL(day.petrolL)} L</td>
        <td class="text-end" style="color:#856404">${fmtL(day.dieselL)} L</td>
        <td class="text-end text-success">Rs.${fmt(day.petrolCash)}</td>
        <td class="text-end" style="color:#856404">Rs.${fmt(day.dieselCash)}</td>
        <td class="text-end fw-bold ${total >= 0 ? 'profit-pos' : 'profit-neg'}">Rs.${fmt(total)}</td>
        <td class="text-end text-danger">Rs.${fmt(day.expected)}</td>
        <td class="text-end text-primary">Rs.${fmt(day.assigned)}</td>
        <td class="text-center">${dayBadge(day)}</td>
      </tr>`;
    }).join('');
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER SUMMARY CARDS
     Machine readings se:
       GROSS REVENUE  = liters * rate
       CREDIT AUTO (machine) = Gross Sale - Cash in Hand
       CASH IN HAND NET  = cash amount entered/capped by gross
       TOTAL LITERS   = liters field
     Plus info note agar credit transactions bhi hain is period mein
  ═══════════════════════════════════════════════════════════ */
  function renderSummaryCards() {
    let totL = 0, totG = 0, totU = 0, totC = 0;

    _rows.forEach(r => {
      totL += totalLitersForReading(r);
      totG += r.meta.gross         || 0;
      totU += r.meta.udhaar        || 0;
      totC += parseFloat(r.charges) || 0;
    });

    const assignedCredit = Object.values(_reconMap || {}).reduce((sum, b) => sum + (b.assignedAmount || 0), 0);
    const pendingCredit  = Object.values(_reconMap || {}).reduce((sum, b) => sum + Math.max(0, (b.expectedAmount || 0) - (b.assignedAmount || 0)), 0);
    const overCredit     = Object.values(_reconMap || {}).reduce((sum, b) => sum + Math.max(0, (b.assignedAmount || 0) - (b.expectedAmount || 0)), 0);

    if (el('sum-cash'))   el('sum-cash').textContent   = 'Rs. ' + fmt(totC);
    if (el('sum-liters')) el('sum-liters').textContent = fmtL(totL) + ' L';
    if (el('sum-gross'))  el('sum-gross').textContent  = 'Rs. ' + fmt(totG);

    // IMPORTANT: Credit card daily reading ka auto credit amount dikhata hai.
    // Customer-wise assigned credit note ke taur par show hota hai, double count nahi hota.
    if (el('sum-udhaar')) el('sum-udhaar').textContent = 'Rs. ' + fmt(totU);

    const udhaarCard = el('sum-udhaar')?.closest('.s-card');
    if (udhaarCard) {
      const existingNote = udhaarCard.querySelector('.udhaar-note');
      if (existingNote) existingNote.remove();
      const note = document.createElement('small');
      note.className = 'text-muted udhaar-note d-block mt-1';
      note.style.fontSize = '10px';
      note.innerHTML = `Customer assigned: Rs.${fmt(assignedCredit)}<br>${pendingCredit > 0 ? 'Pending: Rs.' + fmt(pendingCredit) : overCredit > 0 ? 'Over: Rs.' + fmt(overCredit) : 'Matched / clear'}`;
      udhaarCard.appendChild(note);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     EDIT
  ═══════════════════════════════════════════════════════════ */
  DR.openEdit = function(id) {
    const r = _rows.find(x => x.id === id);
    if (!r) return;
    const m = r.meta;

    el('edit-txn-id').value  = id;
    el('edit-date').value    = rowDate(r);
    el('edit-rate').value    = parseFloat(r.unit_price) || m.rate    || 0;
    el('edit-liters').value  = m.liters_input || m.total_liters || m.liters || 0;
    el('edit-udhaar').value  = m.cash_in_hand ?? r.charges ?? Math.max(0, (m.gross || 0) - (m.udhaar || 0));
    el('edit-testing').value = m.testing || 0;

    DR.calcEditBadge();
    new bootstrap.Modal(el('editReadingModal')).show();
  };

  DR.calcEditBadge = function() {
    const liInput = parseFloat(el('edit-liters')?.value) || 0;
    const cashRaw = el('edit-udhaar')?.value ?? '';
    const te = parseFloat(el('edit-testing')?.value) || 0;
    const pr = parseFloat(el('edit-rate')?.value)    || 0;

    const li = Math.max(0, liInput - te);
    const calc = calcFromCashInHand(li, pr, cashRaw);
    const gr = calc.gross;
    const ca = calc.cash;
    const ud = calc.credit;

    const badge = el('edit-calc-badge');
    if (badge) badge.innerHTML = `
      <strong>${fmtL(li)} L</strong> bika &nbsp;|&nbsp;
      Gross: <strong>Rs.${fmt(gr)}</strong> &nbsp;|&nbsp;
      Cash in Hand: <strong class="${ca >= 0 ? 'profit-pos' : 'profit-neg'}">Rs.${fmt(ca)}</strong> &nbsp;|&nbsp;
      Auto Credit: <span class="text-danger">Rs.${fmt(ud)}</span>`;
  };

  DR.update = async function() {
    const sb = window.supabaseClient;
    const id = parseInt(el('edit-txn-id')?.value);
    if (!sb || !id) return;

    const liInput = parseFloat(el('edit-liters')?.value) || 0;
    const cashRaw = el('edit-udhaar')?.value ?? '';
    const te = parseFloat(el('edit-testing')?.value) || 0;
    const pr = parseFloat(el('edit-rate')?.value)    || 0;
    const date = el('edit-date')?.value;

    const li   = parseFloat(Math.max(0, liInput - te).toFixed(3));
    const calc = calcFromCashInHand(li, pr, cashRaw);
    const gr = calc.gross;
    const cash = calc.cash;
    const ud = calc.credit;
    const split = splitCashAndCreditLiters(li, pr, ud);

    const orig     = _rows.find(r => r.id === id);
    const origMeta = orig?.meta || {};

    const newMeta = {
      ...origMeta,
      liters_input: liInput,
      liters: li,
      total_liters: split.totalLiters,
      cash_liters: split.cashLiters,
      credit_liters_machine: split.creditLiters,
      stock_deducted_liters: split.cashLiters,
      stock_mode: 'cash_only_daily_reading',
      rate: pr,
      gross: gr, udhaar: ud, cash_in_hand: cash, cash_in_hand_entered: calc.entered, cash_input_mode: 'cash_in_hand_auto_credit', testing: te
    };

    try {
      const { error } = await sb.from('transactions').update({
        charges:    cash,
        amount:     cash,
        liters:     split.cashLiters,
        unit_price: pr,
        description: JSON.stringify(newMeta),
        ...(date ? { created_at: businessTimestamp(date) } : {})
      }).eq('id', id);

      if (error) throw error;
      const oldStockDeducted = stockDeductedLitersForReading(orig);
      const stockDelta = oldStockDeducted - split.cashLiters;
      if (stockDelta) await adjustTankStock(orig?.fuel_type || newMeta.fuel_type, stockDelta);

      showToast('success', 'Updated ✅', 'Reading update ho gayi aur stock cash-in-hand liters ke mutabiq adjust ho gaya');
      bootstrap.Modal.getInstance(el('editReadingModal'))?.hide();
      DR.load();

    } catch (e) {
      showToast('danger', 'Update Error', e.message);
    }
  };

  /* ═══════════════════════════════════════════════════════════
     DELETE
  ═══════════════════════════════════════════════════════════ */
  DR.del = async function(id) {
    if (!confirm('Yeh reading delete karein? Is reading ka deducted cash stock wapas add ho jayega.')) return;
    const sb = window.supabaseClient;
    try {
      const existing = _rows.find(r => String(r.id) === String(id));
      const oldStockDeducted = stockDeductedLitersForReading(existing);
      const { error } = await sb.from('transactions').delete().eq('id', id);
      if (error) throw error;
      if (oldStockDeducted) await adjustTankStock(existing?.fuel_type, oldStockDeducted);
      showToast('success', 'Deleted', 'Reading delete ho gayi aur deducted cash stock wapas add ho gaya');
      DR.load();
    } catch (e) {
      showToast('danger', 'Delete Error', e.message);
    }
  };

  /* ═══════════════════════════════════════════════════════════
     INIT — same pattern as transactions-COMPLETE-v5.js
  ═══════════════════════════════════════════════════════════ */
  function tryInit() {
    if (!window.supabaseClient) { setTimeout(tryInit, 200); return; }
    console.log('✅ daily-readings.js init with supabaseClient');
    initMachines();
    loadPrices();
    DR.load();
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Default dates
    const today = todayYMD();
    const now   = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;

    if (el('add-date'))  el('add-date').value  = today;
    if (el('date-from')) el('date-from').value = monthStart;
    if (el('date-to'))   el('date-to').value   = today;

    // Period select — custom range toggle
    el('period-select')?.addEventListener('change', function() {
      const cr = el('custom-range');
      if (cr) cr.style.display = this.value === 'custom' ? '' : 'none';
      if (this.value !== 'custom') DR.load();
    });

    // Modal open → reload prices + reset date
    el('addReadingModal')?.addEventListener('show.bs.modal', () => {
      el('add-date').value = todayYMD();
      loadPrices();
    });

    tryInit();
  });

})();