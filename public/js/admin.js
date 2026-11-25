window.MarketFlow = window.MarketFlow || {};

(function (MF) {
  function openUserModal(roles, user = null, onSaved) {
    const isEdit = Boolean(user);
    const isAdminUser = MF.state.user?.role_name === 'admin';
    const selectableRoles = roles.filter((r) => isAdminUser || r.name !== 'admin' || (user && user.role_id === r.id));

    const { content } = MF.openAppModal(`
      <div class="modal-header">
        <h5 class="modal-title">${isEdit ? 'Edit Staff Account' : 'Create Staff Account'}</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <form id="userModalForm">
        <div class="modal-body">
          <div id="userFormError" class="alert alert-danger py-2 px-3 d-none"></div>
          <div class="mb-3">
            <label class="form-label fw-semibold">Full Name *</label>
            <input type="text" class="form-control" name="full_name" required value="${MF.escapeHtml(user?.full_name || '')}">
          </div>
          <div class="mb-3">
            <label class="form-label fw-semibold">Email *</label>
            <input type="email" class="form-control" name="email" ${isEdit ? 'disabled' : 'required'} value="${MF.escapeHtml(user?.email || '')}">
          </div>
          <div class="mb-3">
            <label class="form-label fw-semibold">Role *</label>
            <select class="form-select" name="role_id" required>
              ${selectableRoles.map((r) => `
                <option value="${r.id}" ${user && user.role_id === r.id ? 'selected' : ''}>
                  ${MF.escapeHtml(r.display_name)}
                </option>
              `).join('')}
            </select>
          </div>
          <div class="mb-0">
            <label class="form-label fw-semibold">${isEdit ? 'New Password (leave blank to keep current)' : 'Password * (min 6 characters)'}</label>
            <input type="password" class="form-control" name="password" ${isEdit ? '' : 'required minlength="6"'} placeholder="${isEdit ? 'Optional password reset' : 'Create password'}">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
          <button type="submit" class="btn btn-primary" id="saveUserBtn">${isEdit ? 'Save Changes' : 'Create Account'}</button>
        </div>
      </form>
    `);

    const form = content.querySelector('#userModalForm');
    const errBox = content.querySelector('#userFormError');
    const saveBtn = content.querySelector('#saveUserBtn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.classList.add('d-none');
      saveBtn.disabled = true;

      const fd = new FormData(form);
      const payload = {
        full_name: String(fd.get('full_name') || '').trim(),
        role_id: Number(fd.get('role_id'))
      };
      const pwd = String(fd.get('password') || '');
      if (pwd) payload.password = pwd;
      if (!isEdit) payload.email = String(fd.get('email') || '').trim();

      try {
        if (isEdit) {
          await MF.apiFetch(`/api/users/${user.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
          });
          MF.showToast(`Updated staff account "${payload.full_name}"`);
        } else {
          await MF.apiFetch('/api/users', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          MF.showToast(`Created staff account "${payload.full_name}"`);
        }
        MF.closeAppModal();
        if (onSaved) onSaved();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('d-none');
        saveBtn.disabled = false;
      }
    });
  }

  async function renderStaffTab(tabBody) {
    const [rolesRes, usersRes] = await Promise.all([
      MF.apiFetch('/api/roles'),
      MF.apiFetch('/api/users')
    ]);
    const roles = rolesRes.roles;
    const users = usersRes.users;

    tabBody.innerHTML = `
      <div class="mf-card p-3 mb-3 d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div>
          <h2 class="h6 mb-0">Staff Accounts &amp; Role Assignment</h2>
          <div class="text-muted" style="font-size: 12px;">Least-privilege access: assign each staff member only the role required</div>
        </div>
        <button type="button" id="addStaffBtn" class="btn btn-primary">
          <i class="bi bi-person-plus"></i> Add Staff Account
        </button>
      </div>

      <div class="mf-card overflow-hidden">
        <div class="table-responsive">
          <table class="table table-mf">
            <thead>
              <tr>
                <th>Staff Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th class="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${users.map((u) => {
                const isSelf = u.id === MF.state.user?.id;
                const lockedAdmin = u.role_name === 'admin' && MF.state.user?.role_name !== 'admin';
                return `
                  <tr>
                    <td class="fw-semibold">${MF.escapeHtml(u.full_name)} ${isSelf ? '<span class="badge text-bg-light border ms-1">You</span>' : ''}</td>
                    <td><code>${MF.escapeHtml(u.email)}</code></td>
                    <td><span class="badge-status badge-status-info">${MF.escapeHtml(u.role_display_name)}</span></td>
                    <td>
                      ${u.status === 'active'
                        ? '<span class="badge-status badge-status-success"><i class="bi bi-check-circle"></i> Active</span>'
                        : '<span class="badge-status badge-status-muted"><i class="bi bi-slash-circle"></i> Inactive</span>'}
                    </td>
                    <td style="font-size: 12px;">${MF.formatDateTime(u.created_at)}</td>
                    <td class="text-end text-nowrap">
                      <button type="button" class="btn btn-sm btn-outline-primary edit-user-btn" data-id="${u.id}" ${lockedAdmin ? 'disabled' : ''}>
                        <i class="bi bi-pencil"></i> Edit
                      </button>
                      ${!isSelf && !lockedAdmin ? `
                        <button type="button" class="btn btn-sm btn-outline-${u.status === 'active' ? 'danger' : 'success'} toggle-user-btn" data-id="${u.id}" data-status="${u.status}" data-name="${MF.escapeHtml(u.full_name)}">
                          ${u.status === 'active' ? 'Deactivate' : 'Activate'}
                        </button>
                      ` : ''}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('addStaffBtn').addEventListener('click', () => {
      openUserModal(roles, null, () => renderStaffTab(tabBody));
    });

    tabBody.querySelectorAll('.edit-user-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = users.find((u) => u.id === Number(btn.dataset.id));
        openUserModal(roles, target, () => renderStaffTab(tabBody));
      });
    });

    tabBody.querySelectorAll('.toggle-user-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const isActive = btn.dataset.status === 'active';
        const ok = await MF.confirmAction({
          title: isActive ? 'Deactivate Staff Account' : 'Activate Staff Account',
          message: `${isActive ? 'Deactivate' : 'Reactivate'} "${btn.dataset.name}"?`,
          confirmText: isActive ? 'Deactivate' : 'Activate',
          variant: isActive ? 'danger' : 'primary'
        });
        if (!ok) return;
        try {
          await MF.apiFetch(`/api/users/${btn.dataset.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: isActive ? 'inactive' : 'active' })
          });
          MF.showToast(`User ${isActive ? 'deactivated' : 'activated'}`);
          renderStaffTab(tabBody);
        } catch (err) {
          MF.showToast(err.message, 'danger');
        }
      });
    });
  }

  async function renderSettingsTab(tabBody) {
    const { settings } = await MF.apiFetch('/api/settings');
    MF.state.settings = settings;

    const currencies = ['$', '₦', '£', '€', '₵', 'KES '];
    tabBody.innerHTML = `
      <div class="mf-card p-3 p-md-4" style="max-width: 720px;">
        <h2 class="h6 mb-1">Store &amp; POS Configuration</h2>
        <p class="text-muted mb-3" style="font-size: 13px;">Settings apply to receipt headers, currency display, tax calculation, and cashier discount limits.</p>
        <div id="settingsError" class="alert alert-danger py-2 px-3 d-none"></div>

        <form id="storeSettingsForm">
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label fw-semibold">Store Name *</label>
              <input type="text" class="form-control" name="store_name" required value="${MF.escapeHtml(settings.store_name)}">
            </div>
            <div class="col-md-6">
              <label class="form-label fw-semibold">Store Phone</label>
              <input type="text" class="form-control" name="store_phone" value="${MF.escapeHtml(settings.store_phone)}">
            </div>
            <div class="col-12">
              <label class="form-label fw-semibold">Store Address</label>
              <input type="text" class="form-control" name="store_address" value="${MF.escapeHtml(settings.store_address)}">
            </div>
            <div class="col-md-4">
              <label class="form-label fw-semibold">Currency Symbol</label>
              <select class="form-select" name="currency_symbol">
                ${currencies.map((sym) => `<option value="${sym}" ${settings.currency_symbol === sym ? 'selected' : ''}>${sym}</option>`).join('')}
              </select>
            </div>
            <div class="col-md-4">
              <label class="form-label fw-semibold">Tax Rate (%)</label>
              <input type="number" step="0.1" min="0" max="50" class="form-control" name="tax_rate" value="${settings.tax_rate}">
            </div>
            <div class="col-md-4">
              <label class="form-label fw-semibold">Max Cashier Discount (%)</label>
              <input type="number" step="1" min="0" max="100" class="form-control" name="max_cashier_discount_percent" value="${settings.max_cashier_discount_percent}">
            </div>
            <div class="col-12">
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="taxEnabledSwitch" name="tax_enabled" ${settings.tax_enabled ? 'checked' : ''}>
                <label class="form-check-label fw-semibold" for="taxEnabledSwitch">Enable Tax Calculation on POS Sales</label>
              </div>
            </div>
            <div class="col-12">
              <label class="form-label fw-semibold">Receipt Footer Message</label>
              <input type="text" class="form-control" name="receipt_footer" value="${MF.escapeHtml(settings.receipt_footer)}">
            </div>
          </div>

          <div class="mt-4">
            <button type="submit" class="btn btn-primary" id="saveSettingsBtn">
              <i class="bi bi-check2-circle"></i> Save Store Settings
            </button>
          </div>
        </form>
      </div>
    `;

    const form = document.getElementById('storeSettingsForm');
    const errBox = document.getElementById('settingsError');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.classList.add('d-none');
      const fd = new FormData(form);
      try {
        const res = await MF.apiFetch('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify({
            store_name: String(fd.get('store_name') || '').trim(),
            store_phone: String(fd.get('store_phone') || '').trim(),
            store_address: String(fd.get('store_address') || '').trim(),
            currency_symbol: String(fd.get('currency_symbol') || '$'),
            tax_rate: Number(fd.get('tax_rate')),
            max_cashier_discount_percent: Number(fd.get('max_cashier_discount_percent')),
            tax_enabled: document.getElementById('taxEnabledSwitch').checked,
            receipt_footer: String(fd.get('receipt_footer') || '').trim()
          })
        });
        MF.state.settings = res.settings;
        document.getElementById('sidebarStoreName').textContent = res.settings.store_name;
        MF.showToast('Store settings saved');
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('d-none');
      }
    });
  }

  async function renderAuditTab(tabBody) {
    tabBody.innerHTML = `
      <div class="mf-card p-3 mb-3">
        <div class="row g-2">
          <div class="col-md-4">
            <select id="auditEntityFilter" class="form-select">
              <option value="">All Entities</option>
              <option value="sale">Sales</option>
              <option value="product">Products</option>
              <option value="inventory">Inventory</option>
              <option value="user">Users &amp; Auth</option>
              <option value="supplier">Suppliers</option>
              <option value="settings">Settings</option>
            </select>
          </div>
          <div class="col-md-4">
            <select id="auditActionFilter" class="form-select">
              <option value="">All Actions</option>
              <option value="SALE_COMPLETED">Sale Completed</option>
              <option value="SALE_VOIDED">Sale Voided</option>
              <option value="PRICE_CHANGED">Price Changed</option>
              <option value="STOCK_RECEIVED">Stock Received</option>
              <option value="STOCK_ADJUSTED">Stock Adjusted</option>
              <option value="USER_CREATED">User Created</option>
              <option value="USER_STATUS_CHANGED">User Status Changed</option>
              <option value="USER_LOGIN">User Login</option>
              <option value="SETTINGS_UPDATED">Settings Updated</option>
            </select>
          </div>
        </div>
      </div>

      <div class="mf-card overflow-hidden">
        <div class="table-responsive">
          <table class="table table-mf">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Staff</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody id="auditTableBody"></tbody>
          </table>
        </div>
      </div>
    `;

    const entityEl = document.getElementById('auditEntityFilter');
    const actionEl = document.getElementById('auditActionFilter');
    const tbody = document.getElementById('auditTableBody');

    async function load() {
      const qs = new URLSearchParams();
      if (entityEl.value) qs.set('entity_type', entityEl.value);
      if (actionEl.value) qs.set('action', actionEl.value);
      const { logs } = await MF.apiFetch(`/api/audit-logs?${qs.toString()}`);

      if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">No audit logs match your filter.</td></tr>';
        return;
      }

      tbody.innerHTML = logs.map((l) => `
        <tr>
          <td class="text-nowrap" style="font-size: 12px;">${MF.formatDateTime(l.created_at)}</td>
          <td>
            <div class="fw-semibold">${MF.escapeHtml(l.user_name)}</div>
            <div class="text-muted" style="font-size: 11px;">${MF.escapeHtml(l.role_display_name)}</div>
          </td>
          <td><code>${MF.escapeHtml(l.action)}</code></td>
          <td class="text-uppercase" style="font-size: 12px;">${MF.escapeHtml(l.entity_type)}${l.entity_id ? ` #${MF.escapeHtml(l.entity_id)}` : ''}</td>
          <td>${MF.escapeHtml(l.details)}</td>
        </tr>
      `).join('');
    }

    entityEl.addEventListener('change', load);
    actionEl.addEventListener('change', load);
    await load();
  }

  MF.views = MF.views || {};
  MF.views.admin = async function (container) {
    let activeTab = 'staff';

    container.innerHTML = `
      <ul class="nav nav-pills mb-3 gap-2" id="adminTabs">
        <li class="nav-item">
          <button type="button" class="nav-link active" data-tab="staff">
            <i class="bi bi-people me-1"></i> Staff &amp; Roles
          </button>
        </li>
        <li class="nav-item">
          <button type="button" class="nav-link" data-tab="settings">
            <i class="bi bi-gear me-1"></i> Store Settings
          </button>
        </li>
        <li class="nav-item">
          <button type="button" class="nav-link" data-tab="audit">
            <i class="bi bi-shield-check me-1"></i> Audit Trail
          </button>
        </li>
      </ul>
      <div id="adminTabBody"></div>
    `;

    const tabBody = document.getElementById('adminTabBody');
    const btns = container.querySelectorAll('#adminTabs button');

    async function switchTab(tab) {
      activeTab = tab;
      btns.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
      if (tab === 'staff') {
        await renderStaffTab(tabBody);
      } else if (tab === 'settings') {
        await renderSettingsTab(tabBody);
      } else {
        await renderAuditTab(tabBody);
      }
    }

    btns.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
    await switchTab(activeTab);
  };
})(window.MarketFlow);
