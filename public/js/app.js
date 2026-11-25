window.MarketFlow = window.MarketFlow || {};

(function (MF) {
  const NAV_ITEMS = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      subtitle: 'Live business overview & stock alerts',
      icon: 'bi-speedometer2',
      roles: ['admin', 'manager']
    },
    {
      id: 'pos',
      label: 'POS Checkout',
      subtitle: 'Fast cashier checkout & receipt printing',
      icon: 'bi-upc-scan',
      roles: ['admin', 'manager', 'cashier']
    },
    {
      id: 'products',
      label: 'Products',
      subtitle: 'Product catalogue, SKUs, pricing & categories',
      icon: 'bi-box-seam',
      roles: ['admin', 'manager', 'inventory_officer']
    },
    {
      id: 'inventory',
      label: 'Inventory',
      subtitle: 'Stock levels, receiving & adjustments',
      icon: 'bi-boxes',
      roles: ['admin', 'manager', 'inventory_officer']
    },
    {
      id: 'suppliers',
      label: 'Suppliers',
      subtitle: 'Vendor directory & delivery contacts',
      icon: 'bi-truck',
      roles: ['admin', 'manager', 'inventory_officer']
    },
    {
      id: 'sales',
      label: 'Sales History',
      subtitle: 'Transactions, receipt reprints & voids',
      icon: 'bi-receipt',
      roles: ['admin', 'manager', 'cashier']
    },
    {
      id: 'reports',
      label: 'Reports',
      subtitle: 'Sales analytics, top products & valuation',
      icon: 'bi-bar-chart-line',
      roles: ['admin', 'manager']
    },
    {
      id: 'admin',
      label: 'Staff & Settings',
      subtitle: 'User roles, store settings & audit log',
      icon: 'bi-shield-lock',
      roles: ['admin', 'manager']
    }
  ];

  function closeMobileSidebar() {
    document.getElementById('sidebar').classList.remove('mobile-open');
    document.getElementById('sidebarBackdrop').classList.remove('show');
  }

  function getPermittedNav(roleName) {
    return NAV_ITEMS.filter((item) => item.roles.includes(roleName));
  }

  function getDefaultView(roleName) {
    if (roleName === 'cashier') return 'pos';
    if (roleName === 'inventory_officer') return 'inventory';
    return 'dashboard';
  }

  MF.navigate = async function (viewId, params = {}) {
    const roleName = MF.state.user?.role_name;
    const allowed = getPermittedNav(roleName);
    let target = allowed.find((item) => item.id === viewId);
    if (!target) {
      target = allowed[0];
    }
    if (!target) return;

    MF.state.currentView = target.id;
    closeMobileSidebar();

    document.querySelectorAll('#sidebarNav .sidebar-link').forEach((el) => {
      el.classList.toggle('active', el.dataset.view === target.id);
    });

    document.getElementById('topbarTitle').textContent = target.label;
    document.getElementById('topbarSubtitle').textContent = target.subtitle;

    const quickPosBtn = document.getElementById('quickPosBtn');
    const canPos = ['admin', 'manager', 'cashier'].includes(roleName);
    quickPosBtn.classList.toggle('d-none', !canPos || target.id === 'pos');

    const mainContent = document.getElementById('mainContent');
    const viewFn = MF.views && MF.views[target.id];
    if (typeof viewFn === 'function') {
      await viewFn(mainContent, params);
    } else {
      mainContent.innerHTML = '<div class="alert alert-warning">View not found.</div>';
    }
  };

  async function bootstrap() {
    try {
      const meRes = await MF.apiFetch('/api/auth/me', { skipAuthRedirect: true });
      MF.state.user = meRes.user;
    } catch (_) {
      window.location.replace('/login.html');
      return;
    }

    try {
      const settingsRes = await MF.apiFetch('/api/settings');
      MF.state.settings = settingsRes.settings;
    } catch (_) {}

    const user = MF.state.user;
    document.getElementById('sidebarStoreName').textContent = MF.state.settings.store_name || 'MarketFlow';
    document.getElementById('sidebarUserName').textContent = user.full_name;
    document.getElementById('sidebarUserRole').textContent = user.role_display_name;
    document.getElementById('topbarRoleBadge').textContent = user.role_display_name;

    const navEl = document.getElementById('sidebarNav');
    const permitted = getPermittedNav(user.role_name);
    navEl.innerHTML = permitted.map((item) => `
      <button type="button" class="sidebar-link" data-view="${item.id}">
        <i class="bi ${item.icon} fs-6"></i>
        <span>${item.id === 'sales' && user.role_name === 'cashier' ? 'My Sales' : item.label}</span>
      </button>
    `).join('');

    navEl.querySelectorAll('.sidebar-link').forEach((btn) => {
      btn.addEventListener('click', () => MF.navigate(btn.dataset.view));
    });

    document.getElementById('quickPosBtn').addEventListener('click', () => MF.navigate('pos'));

    document.getElementById('mobileMenuBtn').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('mobile-open');
      document.getElementById('sidebarBackdrop').classList.toggle('show');
    });
    document.getElementById('sidebarBackdrop').addEventListener('click', closeMobileSidebar);

    document.getElementById('logoutBtn').addEventListener('click', async () => {
      try {
        await MF.apiFetch('/api/auth/logout', { method: 'POST', skipAuthRedirect: true });
      } catch (_) {}
      window.location.href = '/login.html';
    });

    const initialView = getDefaultView(user.role_name);
    await MF.navigate(initialView);
  }

  document.addEventListener('DOMContentLoaded', bootstrap);
})(window.MarketFlow);
