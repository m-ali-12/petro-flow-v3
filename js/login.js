// =============================================
// FILE: js/login.js  v2.0
// LOGIN — role-based, status-aware
// =============================================
(function () {
  'use strict';
  window.addEventListener('DOMContentLoaded', () => waitForSB(initLogin));

  function waitForSB(cb, n = 0) {
    if (window.supabaseClient) return cb();
    if (n > 60) return;
    setTimeout(() => waitForSB(cb, n + 1), 100);
  }

  async function initLogin() {
    try {
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      if (session) {
        const { data: profile } = await window.supabaseClient
          .from('user_profiles').select('status').eq('user_id', session.user.id).maybeSingle();
        if (profile && profile.status === 'active') {
          window.location.replace('index.html'); return;
        }
      }
    } catch {}

    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    if (location.search.includes('reason=rejected'))
      showAlert('Your account has been rejected. Contact the Super Admin.', 'danger');
  }

  async function handleLogin(e) {
    e.preventDefault();
    const email    = document.getElementById('email')?.value?.trim();
    const password = document.getElementById('password')?.value;
    const btn      = document.getElementById('loginBtn');
    if (!email || !password) { showAlert('Please enter email and password', 'warning'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Signing in...';

    try {
      const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const { data: profile } = await window.supabaseClient
        .from('user_profiles').select('*').eq('user_id', data.user.id).maybeSingle();

      if (!profile || profile.status === 'pending') {
        await window.supabaseClient.auth.signOut();
        showAlert('⏳ Your account is pending approval. Please contact your administrator.', 'warning');
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-box-arrow-in-right me-2"></i>Sign In';
        return;
      }
      if (profile.status === 'rejected') {
        await window.supabaseClient.auth.signOut();
        showAlert('❌ Your account was rejected. Contact the Super Admin.', 'danger');
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-box-arrow-in-right me-2"></i>Sign In';
        return;
      }

      showAlert('✅ Login successful! Redirecting...', 'success');
      setTimeout(() => window.location.replace('index.html'), 800);
    } catch (err) {
      showAlert(err.message || 'Login failed. Please try again.', 'danger');
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-box-arrow-in-right me-2"></i>Sign In';
    }
  }

  function showAlert(msg, type) {
    const c = document.getElementById('alert-container');
    if (c) c.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show">
      ${msg}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`;
  }
  console.log('✅ Login.js v2.0 loaded');
})();
