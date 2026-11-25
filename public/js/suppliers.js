window.MarketFlow = window.MarketFlow || {};

(function (MF) {
  function openSupplierModal(supplier = null, onSaved) {
    const isEdit = Boolean(supplier);
    const { content } = MF.openAppModal(`
      <div class="modal-header">
        <h5 class="modal-title">${isEdit ? 'Edit Supplier' : 'Add New Supplier'}</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <form id="supplierModalForm">
        <div class="modal-body">
          <div id="supFormError" class="alert alert-danger py-2 px-3 d-none"></div>
          <div class="mb-3">
            <label class="form-label fw-semibold">Company Name *</label>
            <input type="text" class="form-control" name="name" required value="${MF.escapeHtml(supplier?.name || '')}" placeholder="e.g. FreshFarm Distributors">
          </div>
          <div class="row g-2 mb-3">
            <div class="col-sm-6">
              <label class="form-label fw-semibold">Contact Person</label>
              <input type="text" class="form-control" name="contact_person" value="${MF.escapeHtml(supplier?.contact_person || '')}">
            </div>
            <div class="col-sm-6">
              <label class="form-label fw-semibold">Phone</label>
              <input type="text" class="form-control" name="phone" value="${MF.escapeHtml(supplier?.phone || '')}">
            </div>
          </div>
          <div class="mb-3">
            <label class="form-label fw-semibold">Email</label>
            <input type="email" class="form-control" name="email" value="${MF.escapeHtml(supplier?.email || '')}">
          </div>
          <div class="mb-0">
            <label class="form-label fw-semibold">Address</label>
            <input type="text" class="form-control" name="address" value="${MF.escapeHtml(supplier?.address || '')}">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
          <button type="submit" class="btn btn-primary" id="saveSupBtn">${isEdit ? 'Save Changes' : 'Add Supplier'}</button>
        </div>
      </form>
    `);

    const form = content.querySelector('#supplierModalForm');
    const errBox = content.querySelector('#supFormError');
    const saveBtn = content.querySelector('#saveSupBtn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.classList.add('d-none');
      saveBtn.disabled = true;
      const fd = new FormData(form);
      const payload = {
        name: String(fd.get('name') || '').trim(),
        contact_person: String(fd.get('contact_person') || '').trim(),
        phone: String(fd.get('phone') || '').trim(),
        email: String(fd.get('email') || '').trim(),
        address: String(fd.get('address') || '').trim()
      };
      try {
        if (isEdit) {
          await MF.apiFetch(`/api/suppliers/${supplier.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
          });
          MF.showToast(`Updated supplier "${payload.name}"`);
        } else {
          await MF.apiFetch('/api/suppliers', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          MF.showToast(`Added supplier "${payload.name}"`);
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

  MF.views = MF.views || {};
  MF.views.suppliers = async function (container) {
    container.innerHTML = `
      <div class="mf-card p-3 mb-3 d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div>
          <h2 class="h6 mb-0">Supplier Directory</h2>
          <div class="text-muted" style="font-size: 12px;">Maintain vendor contact records for stock deliveries</div>
        </div>
        <button type="button" id="addSupplierBtn" class="btn btn-primary">
          <i class="bi bi-plus-lg"></i> Add Supplier
        </button>
      </div>

      <div class="mf-card overflow-hidden">
        <div class="table-responsive">
          <table class="table table-mf">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Contact Person</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Deliveries</th>
                <th class="text-end">Action</th>
              </tr>
            </thead>
            <tbody id="suppliersTableBody">
              <tr><td colspan="6" class="text-center py-4 text-muted">Loading suppliers...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    const tbody = document.getElementById('suppliersTableBody');

    async function load() {
      const { suppliers } = await MF.apiFetch('/api/suppliers');
      if (suppliers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No suppliers recorded yet.</td></tr>';
        return;
      }

      tbody.innerHTML = suppliers.map((s) => `
        <tr>
          <td>
            <div class="fw-semibold">${MF.escapeHtml(s.name)}</div>
            <div class="text-muted" style="font-size: 12px;">${MF.escapeHtml(s.address || 'No address saved')}</div>
          </td>
          <td>${MF.escapeHtml(s.contact_person || '—')}</td>
          <td>${MF.escapeHtml(s.phone || '—')}</td>
          <td>${MF.escapeHtml(s.email || '—')}</td>
          <td><span class="badge-status badge-status-info">${s.delivery_count} delivery lines</span></td>
          <td class="text-end">
            <button type="button" class="btn btn-sm btn-outline-primary edit-sup-btn" data-id="${s.id}">
              <i class="bi bi-pencil"></i> Edit
            </button>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.edit-sup-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const sup = suppliers.find((s) => s.id === Number(btn.dataset.id));
          openSupplierModal(sup, load);
        });
      });
    }

    document.getElementById('addSupplierBtn').addEventListener('click', () => openSupplierModal(null, load));
    await load();
  };
})(window.MarketFlow);
