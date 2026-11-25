window.MarketFlow = window.MarketFlow || {};

(function (MF) {
  let cachedCategories = [];

  async function loadCategories() {
    const res = await MF.apiFetch('/api/categories');
    cachedCategories = res.categories;
    return cachedCategories;
  }

  function openProductModal(product = null, onSaved) {
    const isEdit = Boolean(product);
    const categoryOptions = cachedCategories.map((c) => `
      <option value="${c.id}" ${product && Number(product.category_id) === c.id ? 'selected' : ''}>
        ${MF.escapeHtml(c.name)}
      </option>
    `).join('');

    const { content } = MF.openAppModal(`
      <div class="modal-header">
        <h5 class="modal-title">${isEdit ? 'Edit Product' : 'Add New Product'}</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <form id="productModalForm">
        <div class="modal-body">
          <div id="productFormError" class="alert alert-danger py-2 px-3 d-none"></div>
          <div class="row g-3">
            <div class="col-12">
              <label class="form-label fw-semibold">Product Name *</label>
              <input type="text" class="form-control" name="name" required value="${MF.escapeHtml(product?.name || '')}" placeholder="e.g. Whole Fresh Milk 1L">
            </div>
            <div class="col-md-6">
              <label class="form-label fw-semibold">SKU *</label>
              <input type="text" class="form-control" name="sku" required value="${MF.escapeHtml(product?.sku || '')}" placeholder="e.g. DAI-005">
            </div>
            <div class="col-md-6">
              <label class="form-label fw-semibold">Barcode (Optional)</label>
              <input type="text" class="form-control" name="barcode" value="${MF.escapeHtml(product?.barcode || '')}" placeholder="e.g. 8901000099">
            </div>
            <div class="col-md-6">
              <label class="form-label fw-semibold">Category *</label>
              <select class="form-select" name="category_id" required>
                <option value="">Select category...</option>
                ${categoryOptions}
              </select>
            </div>
            <div class="col-md-6">
              <label class="form-label fw-semibold">Unit *</label>
              <input type="text" class="form-control" name="unit" required value="${MF.escapeHtml(product?.unit || 'pcs')}" placeholder="pcs, bottle, kg, pack">
            </div>
            <div class="col-md-4">
              <label class="form-label fw-semibold">Selling Price *</label>
              <input type="number" step="0.01" min="0" class="form-control" name="selling_price" required value="${product ? Number(product.selling_price).toFixed(2) : ''}">
            </div>
            <div class="col-md-4">
              <label class="form-label fw-semibold">Cost Price</label>
              <input type="number" step="0.01" min="0" class="form-control" name="cost_price" value="${product ? Number(product.cost_price).toFixed(2) : '0.00'}">
            </div>
            <div class="col-md-4">
              <label class="form-label fw-semibold">Reorder Level *</label>
              <input type="number" step="1" min="0" class="form-control" name="reorder_level" required value="${product ? product.reorder_level : 10}">
            </div>
            ${!isEdit ? `
              <div class="col-md-6">
                <label class="form-label fw-semibold">Initial Stock Quantity</label>
                <input type="number" step="1" min="0" class="form-control" name="initial_stock" value="0">
              </div>
            ` : ''}
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
          <button type="submit" class="btn btn-primary" id="saveProductBtn">${isEdit ? 'Save Changes' : 'Create Product'}</button>
        </div>
      </form>
    `, 'modal-lg');

    const form = content.querySelector('#productModalForm');
    const errBox = content.querySelector('#productFormError');
    const saveBtn = content.querySelector('#saveProductBtn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.classList.add('d-none');
      saveBtn.disabled = true;

      const fd = new FormData(form);
      const payload = {
        name: String(fd.get('name') || '').trim(),
        sku: String(fd.get('sku') || '').trim(),
        barcode: String(fd.get('barcode') || '').trim() || null,
        category_id: Number(fd.get('category_id')),
        unit: String(fd.get('unit') || 'pcs').trim(),
        selling_price: Number(fd.get('selling_price')),
        cost_price: Number(fd.get('cost_price') || 0),
        reorder_level: Number(fd.get('reorder_level'))
      };
      if (!isEdit) {
        payload.initial_stock = Number(fd.get('initial_stock') || 0);
      }

      try {
        if (isEdit) {
          await MF.apiFetch(`/api/products/${product.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
          });
          MF.showToast(`Updated "${payload.name}"`);
        } else {
          await MF.apiFetch('/api/products', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          MF.showToast(`Created product "${payload.name}"`);
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

  function openCategoryModal(onChanged) {
    const renderBody = () => `
      <div class="modal-header">
        <h5 class="modal-title">Manage Product Categories</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body">
        <div id="catError" class="alert alert-danger py-2 px-3 d-none"></div>
        <form id="addCatForm" class="row g-2 mb-3">
          <div class="col-sm-5">
            <input type="text" class="form-control" name="name" placeholder="New category name..." required>
          </div>
          <div class="col-sm-5">
            <input type="text" class="form-control" name="description" placeholder="Short description...">
          </div>
          <div class="col-sm-2 d-grid">
            <button type="submit" class="btn btn-primary">Add</button>
          </div>
        </form>
        <div class="table-responsive" style="max-height: 300px;">
          <table class="table table-mf table-sm">
            <thead>
              <tr>
                <th>Category</th>
                <th>Description</th>
                <th>Products</th>
              </tr>
            </thead>
            <tbody>
              ${cachedCategories.map((c) => `
                <tr>
                  <td class="fw-semibold">${MF.escapeHtml(c.name)}</td>
                  <td class="text-muted">${MF.escapeHtml(c.description || '—')}</td>
                  <td>${c.product_count ?? 0}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button>
      </div>
    `;

    const { content } = MF.openAppModal(renderBody(), 'modal-lg');

    const bindForm = () => {
      const form = content.querySelector('#addCatForm');
      const errBox = content.querySelector('#catError');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errBox.classList.add('d-none');
        const fd = new FormData(form);
        try {
          await MF.apiFetch('/api/categories', {
            method: 'POST',
            body: JSON.stringify({
              name: String(fd.get('name') || '').trim(),
              description: String(fd.get('description') || '').trim()
            })
          });
          await loadCategories();
          MF.showToast('Category added');
          content.innerHTML = renderBody();
          bindForm();
          if (onChanged) onChanged();
        } catch (err) {
          errBox.textContent = err.message;
          errBox.classList.remove('d-none');
        }
      });
    };
    bindForm();
  }

  MF.views = MF.views || {};
  MF.views.products = async function (container) {
    await loadCategories();

    container.innerHTML = `
      <div class="mf-card p-3 mb-3">
        <div class="row g-2 align-items-center">
          <div class="col-md-4">
            <input type="search" id="prodSearchInput" class="form-control" placeholder="Search name, SKU, or barcode...">
          </div>
          <div class="col-sm-6 col-md-3">
            <select id="prodCategoryFilter" class="form-select">
              <option value="">All Categories</option>
              ${cachedCategories.map((c) => `<option value="${c.id}">${MF.escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="col-sm-6 col-md-2">
            <select id="prodActiveFilter" class="form-select">
              <option value="all">All Status</option>
              <option value="1" selected>Active Only</option>
              <option value="0">Inactive Only</option>
            </select>
          </div>
          <div class="col-md-3 d-flex justify-content-md-end gap-2">
            <button type="button" id="manageCatsBtn" class="btn btn-outline-primary">
              <i class="bi bi-tags"></i> Categories
            </button>
            <button type="button" id="addProductBtn" class="btn btn-primary">
              <i class="bi bi-plus-lg"></i> Add Product
            </button>
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
                <th>Selling Price</th>
                <th>Cost</th>
                <th>Stock</th>
                <th>Status</th>
                <th class="text-end">Actions</th>
              </tr>
            </thead>
            <tbody id="productsTableBody">
              <tr><td colspan="7" class="text-center py-4 text-muted">Loading products...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    const searchInput = document.getElementById('prodSearchInput');
    const catFilter = document.getElementById('prodCategoryFilter');
    const activeFilter = document.getElementById('prodActiveFilter');
    const tbody = document.getElementById('productsTableBody');

    async function loadTable() {
      const qs = new URLSearchParams();
      if (searchInput.value.trim()) qs.set('search', searchInput.value.trim());
      if (catFilter.value) qs.set('category_id', catFilter.value);
      qs.set('active', activeFilter.value);

      const { products } = await MF.apiFetch(`/api/products?${qs.toString()}`);
      if (products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No products match your filter.</td></tr>';
        return;
      }

      tbody.innerHTML = products.map((p) => `
        <tr>
          <td>
            <div class="fw-semibold">${MF.escapeHtml(p.name)}</div>
            <div class="text-muted" style="font-size: 12px;">
              SKU: <code>${MF.escapeHtml(p.sku)}</code>
              ${p.barcode ? ` · Barcode: <code>${MF.escapeHtml(p.barcode)}</code>` : ''}
            </div>
          </td>
          <td>${MF.escapeHtml(p.category_name)}</td>
          <td class="fw-semibold">${MF.formatMoney(p.selling_price)}</td>
          <td class="text-muted">${MF.formatMoney(p.cost_price)}</td>
          <td>
            <span class="fw-semibold">${p.quantity_available}</span> ${MF.escapeHtml(p.unit)}
            <div class="text-muted" style="font-size: 11px;">Reorder at ${p.reorder_level}</div>
          </td>
          <td>${MF.stockBadge(p.quantity_available, p.reorder_level, p.active)}</td>
          <td class="text-end text-nowrap">
            <button type="button" class="btn btn-sm btn-outline-primary edit-prod-btn" data-id="${p.id}">
              <i class="bi bi-pencil"></i> Edit
            </button>
            <button type="button" class="btn btn-sm btn-outline-${p.active ? 'danger' : 'success'} toggle-prod-btn" data-id="${p.id}" data-active="${p.active}" data-name="${MF.escapeHtml(p.name)}">
              ${p.active ? 'Deactivate' : 'Activate'}
            </button>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.edit-prod-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const prod = products.find((p) => p.id === Number(btn.dataset.id));
          openProductModal(prod, loadTable);
        });
      });

      tbody.querySelectorAll('.toggle-prod-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const currentlyActive = Number(btn.dataset.active) === 1;
          const ok = await MF.confirmAction({
            title: currentlyActive ? 'Deactivate Product' : 'Activate Product',
            message: `${currentlyActive ? 'Deactivate' : 'Reactivate'} "${btn.dataset.name}"? ${currentlyActive ? 'Inactive products cannot be sold at POS.' : 'Product will become available for POS sales again.'}`,
            confirmText: currentlyActive ? 'Deactivate' : 'Activate',
            variant: currentlyActive ? 'danger' : 'primary'
          });
          if (!ok) return;
          try {
            await MF.apiFetch(`/api/products/${btn.dataset.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ active: currentlyActive ? 0 : 1 })
            });
            MF.showToast(`Product ${currentlyActive ? 'deactivated' : 'activated'}`);
            loadTable();
          } catch (err) {
            MF.showToast(err.message, 'danger');
          }
        });
      });
    }

    searchInput.addEventListener('input', loadTable);
    catFilter.addEventListener('change', loadTable);
    activeFilter.addEventListener('change', loadTable);

    document.getElementById('addProductBtn').addEventListener('click', () => openProductModal(null, loadTable));
    document.getElementById('manageCatsBtn').addEventListener('click', () => {
      openCategoryModal(() => {
        catFilter.innerHTML = `
          <option value="">All Categories</option>
          ${cachedCategories.map((c) => `<option value="${c.id}">${MF.escapeHtml(c.name)}</option>`).join('')}
        `;
        loadTable();
      });
    });

    await loadTable();
  };
})(window.MarketFlow);
