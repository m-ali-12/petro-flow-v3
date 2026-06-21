// =============================================
// FILE: js/ledger-utils.js
// Shared ledger helpers for Customer/Owner/Employee balances.
// Balance convention:
// - Normal customer: + = Udhaar, - = Advance
// - Owner: same as normal customer (+ = Udhaar/Baqi, - = Advance)
// - Employee: + = Payable/Credit, - = Advance/Debit taken
// =============================================
(function(){
  'use strict';

  const PF = window.PetroLedger = window.PetroLedger || {};
  const sb = () => window.supabaseClient;

  PF.parseNum = function(v){
    const n = parseFloat(String(v ?? '').replace(/,/g,''));
    return Number.isFinite(n) ? n : 0;
  };

  PF.format = function(n){
    return Number(n || 0).toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2});
  };

  PF.getAuthUserId = async function(){
    try {
      const { data } = await sb().auth.getUser();
      return data?.user?.id || null;
    } catch(e) { return null; }
  };

  PF.getOwnerCustomer = async function(){
    const client = sb();
    if (!client) return null;
    let userId = await PF.getAuthUserId();

    try {
      let q = client.from('customers')
        .select('id, sr_no, name, category, balance, user_id')
        .eq('category','Owner')
        .order('sr_no', { ascending:true })
        .limit(1);
      const { data, error } = await q;
      if (!error && data && data[0]) return data[0];
    } catch(e) { console.warn('Owner lookup skipped:', e.message); }

    const row = { sr_no: 0, name: 'Owner', category: 'Owner', balance: 0 };
    if (userId) row.user_id = userId;
    if (window.currentUserProfile?.company_id) row.company_id = window.currentUserProfile.company_id;
    const { data: created, error: createErr } = await client.from('customers').insert([row]).select('id, sr_no, name, category, balance, user_id').single();
    if (createErr) {
      console.warn('Owner create failed:', createErr.message);
      return null;
    }
    return created;
  };

  PF.getOwnerCustomerId = async function(){
    const owner = await PF.getOwnerCustomer();
    return owner?.id || null;
  };

  PF.adjustCustomerBalance = async function(customerId, delta){
    const client = sb();
    const change = PF.parseNum(delta);
    if (!client || !customerId || !change) return true;
    const { data, error } = await client.from('customers').select('balance').eq('id', customerId).maybeSingle();
    if (error) { console.warn('Balance fetch failed:', error.message); return false; }
    const next = PF.parseNum(data?.balance) + change;
    const { error: upErr } = await client.from('customers').update({ balance: next }).eq('id', customerId);
    if (upErr) { console.warn('Balance update failed:', upErr.message); return false; }
    return true;
  };

  PF.adjustEmployeeBalance = async function(employeeId, delta){
    const client = sb();
    const change = PF.parseNum(delta);
    if (!client || !employeeId || !change) return true;
    const { data, error } = await client.from('employees').select('balance').eq('id', employeeId).maybeSingle();
    if (error) { console.warn('Employee balance fetch failed:', error.message); return false; }
    const next = PF.parseNum(data?.balance) + change;
    const { error: upErr } = await client.from('employees').update({ balance: next, updated_at: new Date().toISOString() }).eq('id', employeeId);
    if (upErr) { console.warn('Employee balance update failed:', upErr.message); return false; }
    return true;
  };

  PF.bankFinanceOwnerDelta = function(type, amount){
    // Bank finance entries are bank/cash movements, not Owner khata movements.
    // Owner balance is now managed only through sale/vasooli/cash advance entries.
    return 0;
  };

  PF.employeeBalanceDelta = function(type, amount){
    const amt = PF.parseNum(amount);
    const t = String(type || 'salary_pay').toLowerCase();
    if (t === 'credit') return amt;          // payable/settlement credit to employee
    if (t === 'advance_return') return amt;  // employee returned advance, advance balance reduces
    if (t === 'advance') return -amt;        // advance given to employee
    if (t === 'debit') return -amt;          // manual debit/adjustment
    if (t === 'salary_pay') return 0;        // normal monthly salary pay is not advance balance
    return 0;
  };

  PF.employeeOwnerDelta = function(type, amount){
    // Employee salary/advance affects employee ledger and P&L only.
    // It must not change Owner khata balance.
    return 0;
  };

  PF.transactionBalanceDelta = function(tx, category){
    const type = String(tx?.transaction_type || '').toLowerCase();
    const amount = PF.parseNum(tx?.amount ?? tx?.charges);
    const cat = String(category || tx?.customer_category || '').toLowerCase();

    // Owner account follows the same customer-khata rule:
    // Credit/Advance = Owner/customer ne fuel/cash udhaar liya (baqi increase)
    // Debit/Vasooli = payment received (baqi decrease, extra payment becomes advance)
    if (type === 'credit') return amount;   // customer/owner udhaar increases
    if (type === 'debit') {
      const desc = String(tx?.description || '').toLowerCase();
      const looksLikeCashSale = !!tx?.fuel_type && desc.includes('sale') && !desc.includes('payment');
      if (looksLikeCashSale) return 0;      // cash sale to selected customer, no khata effect
      return -amount;                       // vasooli/receipt reduces udhaar
    }
    if (type === 'advance') return amount;   // cash advance given increases receivable
    if (type === 'advanceused') return amount;
    return 0;
  };

  PF.applyTransactionBalance = async function(payload, reverse){
    if (!payload?.customer_id) return true;
    let category = payload.customer_category;
    if (!category) {
      try {
        const { data } = await sb().from('customers').select('category').eq('id', payload.customer_id).maybeSingle();
        category = data?.category || '';
      } catch(e) {}
    }
    const delta = PF.transactionBalanceDelta(payload, category) * (reverse ? -1 : 1);
    return PF.adjustCustomerBalance(payload.customer_id, delta);
  };

  PF.downloadJSON = function(filename, data){
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  };
})();
