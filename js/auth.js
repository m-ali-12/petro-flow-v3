// =============================================
// FILE: js/auth.js  v2.0
// ROLE-BASED AUTHENTICATION (ACTIVE)
// Roles: super_admin, admin, manager, employee
// Multi-admin approval flow included
// =============================================
(function () {
  'use strict';
  if (window.PETRO_AUTH_LOADED) return;
  window.PETRO_AUTH_LOADED = true;

  const path = window.location.pathname;
  const isAuthPage = /login|signup|forgot-password/.test(path);

  // ── Role permission map ──────────────────────────────────────
  window.ROLE_PERMISSIONS = {
    super_admin: {
      label: 'Super Admin', badge: 'danger',
      canApproveAdmins: true, canManageUsers: true,
      canViewAllData: true,   canEditPrices: true,
      canDeleteTransactions: true, canViewReports: true,
      canManageBanks: true,  canManageRent: true, canAccessSettings: true
    },
    admin: {
      label: 'Admin', badge: 'warning',
      canApproveAdmins: false, canManageUsers: true,
      canViewAllData: true,    canEditPrices: true,
      canDeleteTransactions: false, canViewReports: true,
      canManageBanks: true,   canManageRent: true, canAccessSettings: true
    },
    manager: {
      label: 'Manager', badge: 'info',
      canApproveAdmins: false, canManageUsers: false,
      canViewAllData: true,    canEditPrices: false,
      canDeleteTransactions: false, canViewReports: true,
      canManageBanks: true,   canManageRent: false, canAccessSettings: false
    },
    employee: {
      label: 'Employee', badge: 'secondary',
      canApproveAdmins: false, canManageUsers: false,
      canViewAllData: false,   canEditPrices: false,
      canDeleteTransactions: false, canViewReports: false,
      canManageBanks: false,  canManageRent: false, canAccessSettings: false
    }
  };

  window.currentUser        = null;
  window.currentUserProfile = null;
  window.userRole           = null;
  window.userPermissions    = {};

  window.addEventListener('DOMContentLoaded', () => waitForSupabase(init));

  function waitForSupabase(cb, n = 0) {
    if (window.supabaseClient) return cb();
    if (n > 80) return console.error('Supabase timeout');
    setTimeout(() => waitForSupabase(cb, n + 1), 100);
  }

  async function init() {
    if (isAuthPage) return;
    try {
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      if (!session) { window.location.replace('login.html'); return; }

      window.currentUser = session.user;
      const profile = await loadProfile(session.user.id);

      if (!profile) { showPendingPage(null); return; }
      if (profile.status === 'pending')  { showPendingPage(profile); return; }
      if (profile.status === 'rejected') {
        await window.supabaseClient.auth.signOut();
        window.location.replace('login.html?reason=rejected');
        return;
      }

      window.currentUserProfile = profile;
      window.userRole           = profile.role;
      window.userPermissions    = window.ROLE_PERMISSIONS[profile.role] || window.ROLE_PERMISSIONS.employee;
      applyRoleUI(profile);
    } catch (err) {
      console.error('Auth error:', err);
      window.location.replace('login.html');
    }
  }

  async function loadProfile(userId) {
    try {
      const { data } = await window.supabaseClient
        .from('user_profiles').select('*').eq('user_id', userId).maybeSingle();
      return data;
    } catch { return null; }
  }

  function applyRoleUI(profile) {
    const p = window.ROLE_PERMISSIONS[profile.role] || {};
    const holder = document.getElementById('user-role-badge');
    if (holder) {
      holder.innerHTML =
        `<span class="badge bg-${p.badge}">${p.label}</span>
         <span class="ms-2 small text-muted">${profile.full_name || ''}</span>`;
    }
    // Hide elements that require a missing permission
    document.querySelectorAll('[data-require-permission]').forEach(el => {
      if (!window.userPermissions[el.dataset.requirePermission]) el.style.display = 'none';
    });
    // Hide elements that require a specific role
    document.querySelectorAll('[data-require-role]').forEach(el => {
      const roles = el.dataset.requireRole.split(',').map(r => r.trim());
      if (!roles.includes(profile.role)) el.style.display = 'none';
    });
  }

  function showPendingPage(profile) {
    document.body.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
           background:linear-gradient(135deg,#667eea,#764ba2);font-family:'Segoe UI',sans-serif">
        <div style="background:#fff;border-radius:20px;padding:40px 50px;max-width:460px;text-align:center;
             box-shadow:0 10px 40px rgba(0,0,0,.25)">
          <div style="font-size:64px">⏳</div>
          <h4 style="margin:16px 0 8px;color:#333">Account Pending Approval</h4>
          <p style="color:#888;line-height:1.6">Your account is awaiting approval from an <strong>Admin</strong>
            or <strong>Super Admin</strong>. Please contact your pump administrator.</p>
          ${profile ? `<p style="margin-top:12px"><strong>Requested Role:</strong>
            <span class="badge bg-secondary">${profile.role}</span></p>` : ''}
          <button onclick="window.handleLogout()"
            style="margin-top:24px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;
            border:none;border-radius:10px;padding:11px 32px;cursor:pointer;font-weight:600;font-size:15px">
            ← Back to Login
          </button>
        </div>
      </div>`;
  }

  window.handleLogout = async function () {
    try { await window.supabaseClient.auth.signOut(); } catch {}
    window.currentUser = window.currentUserProfile = null;
    window.location.href = 'login.html';
  };

  window.hasPermission = perm => !!(window.userPermissions && window.userPermissions[perm]);
  window.isRole = (...roles) => roles.includes(window.userRole);

  console.log('✅ Auth v2.0 (role-based) loaded');
})();
