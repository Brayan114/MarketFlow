window.MarketFlow = window.MarketFlow || {};

(function (MF) {
  function movementBadge(type) {
    switch (type) {
      case 'receive':
        return '<span class="badge-status badge-status-success"><i class="bi bi-arrow-down-left-circle"></i> Received</span>';
      case 'sale':
        return '<span class="badge-status badge-status-info"><i class="bi bi-cart-dash"></i> Sale</span>';
      case 'adjustment':
        return '<span class="badge-status badge-status-warning"><i class="bi bi-sliders"></i> Adjustment</span>';
      case 'void_return':
        return '<span class="badge-status badge-status-danger"><i class="bi bi-arrow-counterclockwise"></i> Void Return</span>';
      default:
        return '<span class="badge-status badge-status-muted"><i class="bi bi-flag"></i> Initial</span>';
    }
  }

  function openAdjustModal(item, onAdjusted) {
    const { content } = MF.openAppModal(`
      <div class="modal-header">
        <h5 class="modal-title">Adjust Stock Quantity</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <form id="adjustStockForm">
        <div class="modal-body">
          <div id="adjustError" class="alert alert-danger py-2 px-3 d-none"></div>
          <div class="p-3 rounded-3 bg-light border mb-3">
            <div class="fw-semibold">${MF.escapeHtml(item.name)}</div>
            <div class="text-muted" style="font-size: 12px;">SKU: ${MF.escapeHtml(item.sku)} · Current Stock: <strong>${item.quantity_available} ${MF.escapeHtml(item.unit)}</strong></div>
          </div>
          <div class="mb-3">
            <label class="form-label fw-semibold">New Stock Quantity *</label>
            <input type="number" id="adjustNewQtyInput" class="form-control" min="0" step="1" required value="${item.quantity_available}">
            <div class="form-text" id="adjustDeltaText">Change: 0</div>
          </div>
          <div class="mb-0">
            <label class="form-label fw-semibold">Reason for Adjustment *</label>
            <input type="text" id="adjustReasonInput" class="form-control" required placeholder="e.g. Damaged units removed, physical stock count correction">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
          <button type="submit" class="btn btn-primary" id="saveAdjustBtn">Save Adjustment</button>
        </div>
      </form>
    `);

    const qtyInput = content.querySelector('#adjustNewQtyInput');
    const deltaText = content.querySelector('#adjustDeltaText');
    const reasonInput = content.querySelector('#adjustReasonInput');
    const errBox = content.querySelector('#adjustError');
    const saveBtn = content.querySelector('#saveAdjustBtn');

    qtyInput.addEventListener('input', () => {
      const nextVal = Number(qtyInput.value);
      const delta = Number.isFinite(nextVal) ? nextVal - item.quantity_available : 0;
      deltaText.textContent = `Change: ${delta > 0 ? `+${delta}` : delta} (${item.quantity_available} → ${Number.isFinite(nextVal) ? nextVal : '?'})`;
    });

    content.querySelector('#adjustStockForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.classList.add('d-none');
      saveBtn.disabled = true;
      try {
        await MF.apiFetch('/api/inventory/adjust', {
          method: 'POST',
          body: JSON.stringify({
            product_id: item.id,
            new_quantity: Number(qtyInput.value),
            reason: reasonInput.value.trim()
          })
        });
        MF.closeAppModal();
        MF.showToast(`Adjusted stock for "${item.name}"`);
        if (onAdjusted) onAdjusted();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('d-none');
        saveBtn.disabled = false;
      }
    });
  }

  async function renderOverviewTab(tabBody, prefillStatus = '') {
    tabBody.innerHTML = `
      <div class="mf-card p-3 mb-3">
        <div class="row g-2 align-items-center">
          <div class="col-md-5">
            <input type="search" id="invSearchInput" class="form-control" placeholder="Search product name or SKU...">
          </div>
          <div class="col-md-4">
            <select id="invStatusFilter" class="form-select">
              <option value="" ${prefillStatus === '' ? 'selected' : ''}>All Stock Levels</option>
              <option value="low_stock" ${prefillStatus === 'low_stock' ? 'selected' : ''}>Low &amp; Out of Stock Only</option>
              <option value="out_of_stock" ${prefillStatus === 'out_of_stock' ? 'selected' : ''}>Out of Stock Only</option>
              <option value="healthy" ${prefillStatus === 'healthy' ? 'selected' : ''}>Healthy Stock Only</option>
            </select>
          </div>
          <div class="col-md-3 text-md-end text-muted" style="font-size: 12px;">
            <span id="invCountNote">Loading...</span>
          </div>
        </div>
      </div>

      <div class="mf-card overflow-hidden">
        <div class="table-responsive">
          <table class="table table-mf">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Available</th>
                <th>Reorder Level</th>
                <th>Status</th>
                <th class="text-end">Action</th>
              </tr>
            </thead>
            <tbody id="invTableBody"></tbody>
          </table>
        </div>
      </div>
    `;

    const searchEl = document.getElementById('invSearchInput');
    const statusEl = document.getElementById('invStatusFilter');
    const tbody = document.getElementById('invTableBody');
    const countNote = document.getElementById('invCountNote');

    async function load() {
      const qs = new URLSearchParams();
      if (searchEl.value.trim()) qs.set('search', searchEl.value.trim());
      if (statusEl.value) qs.set('status', statusEl.value);

      const { items } = await MF.apiFetch(`/api/inventory?${qs.toString()}`);
      countNote.textContent = `${items.length} product(s) shown`;

      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No inventory items match your filter.</td></tr>';
        return;
      }

      tbody.innerHTML = items.map((item) => `
        <tr>
          <td>
            <div class="fw-semibold">${MF.escapeHtml(item.name)}</div>
            <div class="text-muted" style="font-size: 12px;"><code>${MF.escapeHtml(item.sku)}</code></div>
          </td>
          <td>${MF.escapeHtml(item.category_name)}</td>
          <td class="fw-bold">${item.quantity_available} ${MF.escapeHtml(item.unit)}</td>
          <td>${item.reorder_level} ${MF.escapeHtml(item.unit)}</td>
          <td>${MF.stockBadge(item.quantity_available, item.reorder_level, item.active)}</td>
          <td class="text-end">
            <button type="button" class="btn btn-sm btn-outline-primary adjust-btn" data-id="${item.id}">
              <i class="bi bi-sliders"></i> Adjust Stock
            </button>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.adjust-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = items.find((i) => i.id === Number(btn.dataset.id));
          openAdjustModal(item, load);
        });
      });
    }

    searchEl.addEventListener('input', load);
    statusEl.addEventListener('change', load);
    await load();
  }

  async function renderReceiveTab(tabBody, onReceived) {
    const [supRes, prodRes] = await Promise.all([
      MF.apiFetch('/api/suppliers'),
      MF.apiFetch('/api/products?active=1')
    ]);
    const suppliers = supRes.suppliers;
    const products = prodRes.products;
    let lines = [];

    tabBody.innerHTML = `
      <div class="row g-3">
        <div class="col-lg-5">
          <div class="mf-card p-3 p-md-4">
            <h2 class="h6 mb-3">1. Delivery Details &amp; Add Items</h2>
            <div id="receiveError" class="alert alert-danger py-2 px-3 d-none"></div>

            <div class="mb-3">
              <label class="form-label fw-semibold">Supplier *</label>
              <select id="recSupplierSelect" class="form-select">
                <option value="">Select supplier...</option>
                ${suppliers.map((s) => `<option value="${s.id}">${MF.escapeHtml(s.name)}</option>`).join('')}
              </select>
            </div>

            <div class="row g-2 mb-3">
              <div class="col-sm-6">
                <label class="form-label fw-semibold">Delivery Reference *</label>
                <input type="text" id="recReferenceInput" class="form-control" value="DEL-${MF.toLocalYMD().replace(/-/g, '')}-01">
              </div>
              <div class="col-sm-6">
                <label class="form-label fw-semibold">Delivery Date</label>
                <input type="date" id="recDateInput" class="form-control" value="${MF.toLocalYMD()}">
              </div>
            </div>

            <div class="mb-3">
              <label class="form-label fw-semibold">Notes (Optional)</label>
              <input type="text" id="recNotesInput" class="form-control" placeholder="e.g. Morning refrigerated delivery">
            </div>

            <hr>
            <h3 class="h6 mb-2">Add Product to Delivery</h3>
            <div class="mb-2">
              <select id="recProductSelect" class="form-select">
                <option value="">Choose product...</option>
                ${products.map((p) => `<option value="${p.id}">${MF.escapeHtml(p.name)} (${MF.escapeHtml(p.sku)}) — Current: ${p.quantity_available}</option>`).join('')}
              </select>
            </div>
            <div class="row g-2">
              <div class="col-7">
                <input type="number" id="recQtyInput" class="form-control" min="1" step="1" placeholder="Quantity received" value="10">
              </div>
              <div class="col-5 d-grid">
                <button type="button" id="recAddLineBtn" class="btn btn-outline-primary">
                  <i class="bi bi-plus-circle"></i> Add Item
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="col-lg-7">
          <div class="mf-card overflow-hidden">
            <div class="p-3 px-4 border-bottom d-flex justify-content-between align-items-center">
              <div>
                <h2 class="h6 mb-0">2. Expected Stock Changes</h2>
                <div class="text-muted" style="font-size: 12px;">Review quantities before confirming stock receipt</div>
              </div>
              <button type="button" id="recSubmitBtn" class="btn btn-primary" disabled>
                <i class="bi bi-check2-circle"></i> Confirm Stock Receipt
              </button>
            </div>
            <div class="table-responsive">
              <table class="table table-mf">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Current</th>
                    <th>Receiving</th>
                    <th>New Stock</th>
                    <th class="text-end">Remove</th>
                  </tr>
                </thead>
                <tbody id="recLinesBody"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;

    const supplierSelect = document.getElementById('recSupplierSelect');
    const refInput = document.getElementById('recReferenceInput');
    const dateInput = document.getElementById('recDateInput');
    const notesInput = document.getElementById('recNotesInput');
    const prodSelect = document.getElementById('recProductSelect');
    const qtyInput = document.getElementById('recQtyInput');
    const addLineBtn = document.getElementById('recAddLineBtn');
    const submitBtn = document.getElementById('recSubmitBtn');
    const linesBody = document.getElementById('recLinesBody');
    const errBox = document.getElementById('receiveError');

    function renderLines() {
      submitBtn.disabled = lines.length === 0;
      if (lines.length === 0) {
        linesBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">No products added to this delivery yet.</td></tr>';
        return;
      }
      linesBody.innerHTML = lines.map((line) => `
        <tr>
          <td>
            <div class="fw-semibold">${MF.escapeHtml(line.name)}</div>
            <div class="text-muted" style="font-size: 12px;"><code>${MF.escapeHtml(line.sku)}</code></div>
          </td>
          <td>${line.current} ${MF.escapeHtml(line.unit)}</td>
          <td class="text-success fw-bold">+${line.quantity}</td>
          <td class="fw-bold">${line.current + line.quantity} ${MF.escapeHtml(line.unit)}</td>
          <td class="text-end">
            <button type="button" class="btn btn-sm btn-outline-danger remove-rec-line" data-id="${line.product_id}">
              <i class="bi bi-trash"></i>
            </button>
          </td>
        </tr>
      `).join('');

      linesBody.querySelectorAll('.remove-rec-line').forEach((btn) => {
        btn.addEventListener('click', () => {
          lines = lines.filter((l) => l.product_id !== Number(btn.dataset.id));
          renderLines();
        });
      });
    }

    addLineBtn.addEventListener('click', () => {
      errBox.classList.add('d-none');
      const pid = Number(prodSelect.value);
      const qty = Number(qtyInput.value);
      const prod = products.find((p) => p.id === pid);
      if (!prod) {
        errBox.textContent = 'Select a product first.';
        errBox.classList.remove('d-none');
        return;
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        errBox.textContent = 'Quantity received must be a positive whole number.';
        errBox.classList.remove('d-none');
        return;
      }
      const existing = lines.find((l) => l.product_id === pid);
      if (existing) {
        existing.quantity += qty;
      } else {
        lines.push({
          product_id: pid,
          name: prod.name,
          sku: prod.sku,
          unit: prod.unit,
          current: prod.quantity_available,
          quantity: qty
        });
      }
      prodSelect.value = '';
      renderLines();
    });

    submitBtn.addEventListener('click', async () => {
      errBox.classList.add('d-none');
      if (!supplierSelect.value) {
        errBox.textContent = 'Please select the delivering supplier.';
        errBox.classList.remove('d-none');
        return;
      }
      submitBtn.disabled = true;
      try {
        const res = await MF.apiFetch('/api/inventory/receive', {
          method: 'POST',
          body: JSON.stringify({
            supplier_id: Number(supplierSelect.value),
            reference: refInput.value.trim(),
            delivery_date: dateInput.value,
            notes: notesInput.value.trim(),
            items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity }))
          })
        });
        MF.showToast(`Received ${res.movements.length} product(s) under ${res.reference}`);
        if (onReceived) onReceived();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('d-none');
        submitBtn.disabled = false;
      }
    });

    renderLines();
  }

  async function renderHistoryTab(tabBody) {
    tabBody.innerHTML = `
      <div class="mf-card p-3 mb-3">
        <div class="row g-2">
          <div class="col-md-5">
            <input type="search" id="movSearchInput" class="form-control" placeholder="Search product, SKU, reference, or reason...">
          </div>
          <div class="col-md-3">
            <select id="movTypeFilter" class="form-select">
              <option value="">All Movement Types</option>
              <option value="receive">Received</option>
              <option value="sale">Sale Deduction</option>
              <option value="adjustment">Adjustment</option>
              <option value="void_return">Void Return</option>
              <option value="initial">Initial Stock</option>
            </select>
          </div>
          <div class="col-md-2">
            <input type="date" id="movFromInput" class="form-control" title="From date">
          </div>
          <div class="col-md-2">
            <input type="date" id="movToInput" class="form-control" title="To date">
          </div>
        </div>
      </div>

      <div class="mf-card overflow-hidden">
        <div class="table-responsive">
          <table class="table table-mf">
            <thead>
              <tr>
                <th>Date</th>
                <th>Product</th>
                <th>Type</th>
                <th>Qty Change</th>
                <th>Before → After</th>
                <th>Reference / Reason</th>
                <th>Staff</th>
              </tr>
            </thead>
            <tbody id="movTableBody"></tbody>
          </table>
        </div>
      </div>
    `;

    const searchEl = document.getElementById('movSearchInput');
    const typeEl = document.getElementById('movTypeFilter');
    const fromEl = document.getElementById('movFromInput');
    const toEl = document.getElementById('movToInput');
    const tbody = document.getElementById('movTableBody');

    async function load() {
      const qs = new URLSearchParams();
      if (searchEl.value.trim()) qs.set('search', searchEl.value.trim());
      if (typeEl.value) qs.set('movement_type', typeEl.value);
      if (fromEl.value) qs.set('from', fromEl.value);
      if (toEl.value) qs.set('to', toEl.value);

      const { movements } = await MF.apiFetch(`/api/inventory/movements?${qs.toString()}`);
      if (movements.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No stock movements match these filters.</td></tr>';
        return;
      }

      tbody.innerHTML = movements.map((m) => `
        <tr>
          <td class="text-nowrap" style="font-size: 12px;">${MF.formatDateTime(m.created_at)}</td>
          <td>
            <div class="fw-semibold">${MF.escapeHtml(m.product_name)}</div>
            <div class="text-muted" style="font-size: 12px;"><code>${MF.escapeHtml(m.sku)}</code></div>
          </td>
          <td>${movementBadge(m.movement_type)}</td>
          <td class="fw-bold ${m.quantity >= 0 ? 'text-success' : 'text-danger'}">${m.quantity >= 0 ? `+${m.quantity}` : m.quantity}</td>
          <td class="text-nowrap">${m.previous_quantity} → <strong>${m.new_quantity}</strong></td>
          <td>
            <div class="fw-medium">${MF.escapeHtml(m.reason || '—')}</div>
            <div class="text-muted" style="font-size: 12px;">
              ${m.reference ? `Ref: <code>${MF.escapeHtml(m.reference)}</code>` : ''}
              ${m.supplier_name ? ` · ${MF.escapeHtml(m.supplier_name)}` : ''}
            </div>
          </td>
          <td>${MF.escapeHtml(m.user_name)}</td>
        </tr>
      `).join('');
    }

    searchEl.addEventListener('input', load);
    typeEl.addEventListener('change', load);
    fromEl.addEventListener('change', load);
    toEl.addEventListener('change', load);
    await load();
  }

  MF.views = MF.views || {};
  MF.views.inventory = async function (container, params = {}) {
    let activeTab = params.tab || 'overview';

    container.innerHTML = `
      <ul class="nav nav-pills mb-3 gap-2" id="inventoryTabs">
        <li class="nav-item">
          <button type="button" class="nav-link ${activeTab === 'overview' ? 'active' : ''}" data-tab="overview">
            <i class="bi bi-boxes me-1"></i> Stock Overview
          </button>
        </li>
        <li class="nav-item">
          <button type="button" class="nav-link ${activeTab === 'receive' ? 'active' : ''}" data-tab="receive">
            <i class="bi bi-truck me-1"></i> Receive Stock
          </button>
        </li>
        <li class="nav-item">
          <button type="button" class="nav-link ${activeTab === 'history' ? 'active' : ''}" data-tab="history">
            <i class="bi bi-clock-history me-1"></i> Movement History
          </button>
        </li>
      </ul>
      <div id="inventoryTabContent"></div>
    `;

    const tabContent = document.getElementById('inventoryTabContent');
    const tabBtns = container.querySelectorAll('#inventoryTabs button');

    async function switchTab(tabName) {
      activeTab = tabName;
      tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === tabName));
      if (tabName === 'overview') {
        await renderOverviewTab(tabContent, params.status || '');
      } else if (tabName === 'receive') {
        await renderReceiveTab(tabContent, () => switchTab('overview'));
      } else {
        await renderHistoryTab(tabContent);
      }
    }

    tabBtns.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
    await switchTab(activeTab);
  };
})(window.MarketFlow);
