window.MarketFlow = window.MarketFlow || {};

(function (MF) {
  MF.views = MF.views || {};
  MF.views.sales = async function (container) {
    const isManagerOrAdmin = ['admin', 'manager'].includes(MF.state.user?.role_name);
    let staffList = [];
    if (isManagerOrAdmin) {
      try {
        const res = await MF.apiFetch('/api/users');
        staffList = res.users;
      } catch (_) {}
    }

    container.innerHTML = `
      <div class="mf-card p-3 mb-3">
        <div class="row g-2 align-items-end">
          <div class="col-sm-6 col-md-3">
            <label class="form-label mb-1" style="font-size: 12px; font-weight: 600;">Receipt Number</label>
            <input type="search" id="salesReceiptFilter" class="form-control" placeholder="e.g. MF-2026...">
          </div>
          <div class="col-sm-6 col-md-2">
            <label class="form-label mb-1" style="font-size: 12px; font-weight: 600;">From Date</label>
            <input type="date" id="salesFromFilter" class="form-control">
          </div>
          <div class="col-sm-6 col-md-2">
            <label class="form-label mb-1" style="font-size: 12px; font-weight: 600;">To Date</label>
            <input type="date" id="salesToFilter" class="form-control">
          </div>
          <div class="col-sm-6 col-md-2">
            <label class="form-label mb-1" style="font-size: 12px; font-weight: 600;">Payment</label>
            <select id="salesMethodFilter" class="form-select">
              <option value="">All Methods</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="transfer">Transfer</option>
            </select>
          </div>
          ${isManagerOrAdmin ? `
            <div class="col-sm-6 col-md-3">
              <label class="form-label mb-1" style="font-size: 12px; font-weight: 600;">Cashier</label>
              <select id="salesCashierFilter" class="form-select">
                <option value="">All Staff</option>
                ${staffList.map((u) => `<option value="${u.id}">${MF.escapeHtml(u.full_name)}</option>`).join('')}
              </select>
            </div>
          ` : `
            <div class="col-sm-6 col-md-3">
              <div class="alert alert-info py-2 px-3 mb-0" style="font-size: 12px;">
                Showing your own cashier transactions only.
              </div>
            </div>
          `}
        </div>
      </div>

      <div class="mf-card overflow-hidden">
        <div class="table-responsive">
          <table class="table table-mf">
            <thead>
              <tr>
                <th>Receipt #</th>
                <th>Date &amp; Time</th>
                <th>Cashier</th>
                <th>Items</th>
                <th>Payment</th>
                <th>Grand Total</th>
                <th>Status</th>
                <th class="text-end">Actions</th>
              </tr>
            </thead>
            <tbody id="salesTableBody">
              <tr><td colspan="8" class="text-center py-4 text-muted">Loading transactions...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    const receiptEl = document.getElementById('salesReceiptFilter');
    const fromEl = document.getElementById('salesFromFilter');
    const toEl = document.getElementById('salesToFilter');
    const methodEl = document.getElementById('salesMethodFilter');
    const cashierEl = document.getElementById('salesCashierFilter');
    const tbody = document.getElementById('salesTableBody');

    async function load() {
      const qs = new URLSearchParams();
      if (receiptEl.value.trim()) qs.set('receipt_number', receiptEl.value.trim());
      if (fromEl.value) qs.set('from', fromEl.value);
      if (toEl.value) qs.set('to', toEl.value);
      if (methodEl.value) qs.set('payment_method', methodEl.value);
      if (cashierEl && cashierEl.value) qs.set('cashier_id', cashierEl.value);

      const { sales } = await MF.apiFetch(`/api/sales?${qs.toString()}`);
      if (sales.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-muted">No matching sales transactions found.</td></tr>';
        return;
      }

      tbody.innerHTML = sales.map((s) => `
        <tr>
          <td class="fw-semibold"><code>${MF.escapeHtml(s.receipt_number)}</code></td>
          <td class="text-nowrap" style="font-size: 12px;">${MF.formatDateTime(s.created_at)}</td>
          <td>${MF.escapeHtml(s.cashier_name)}</td>
          <td>${s.item_count}</td>
          <td class="text-uppercase">${MF.escapeHtml(s.payment_method)}</td>
          <td class="fw-bold">${MF.formatMoney(s.grand_total)}</td>
          <td>
            ${s.status === 'voided'
              ? `<span class="badge-status badge-status-danger" title="${MF.escapeHtml(s.void_reason || '')}"><i class="bi bi-slash-circle"></i> Voided</span>`
              : '<span class="badge-status badge-status-success"><i class="bi bi-check-circle"></i> Completed</span>'}
          </td>
          <td class="text-end text-nowrap">
            <button type="button" class="btn btn-sm btn-outline-primary view-sale-btn" data-id="${s.id}">
              <i class="bi bi-receipt"></i> Receipt
            </button>
            ${isManagerOrAdmin && s.status === 'completed' ? `
              <button type="button" class="btn btn-sm btn-outline-danger void-sale-btn" data-id="${s.id}" data-receipt="${MF.escapeHtml(s.receipt_number)}">
                <i class="bi bi-x-octagon"></i> Void
              </button>
            ` : ''}
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.view-sale-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            const detail = await MF.apiFetch(`/api/sales/${btn.dataset.id}`);
            MF.showReceiptModal(detail.sale, detail.items, detail.store);
          } catch (err) {
            MF.showToast(err.message, 'danger');
          }
        });
      });

      tbody.querySelectorAll('.void-sale-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const result = await MF.confirmAction({
            title: `Void Sale ${btn.dataset.receipt}`,
            message: 'Voiding this sale will restore all sold item quantities back to inventory and log an audit entry.',
            confirmText: 'Void Sale & Restore Stock',
            variant: 'danger',
            requireReason: true,
            reasonLabel: 'Reason for Voiding *',
            reasonPlaceholder: 'e.g. Duplicate ring-up or customer cancellation'
          });
          if (!result.confirmed) return;
          try {
            await MF.apiFetch(`/api/sales/${btn.dataset.id}/void`, {
              method: 'POST',
              body: JSON.stringify({ reason: result.reason })
            });
            MF.showToast(`Sale ${btn.dataset.receipt} voided and stock restored`);
            load();
          } catch (err) {
            MF.showToast(err.message, 'danger');
          }
        });
      });
    }

    receiptEl.addEventListener('input', load);
    fromEl.addEventListener('change', load);
    toEl.addEventListener('change', load);
    methodEl.addEventListener('change', load);
    if (cashierEl) cashierEl.addEventListener('change', load);

    await load();
  };
})(window.MarketFlow);
