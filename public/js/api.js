window.MarketFlow = window.MarketFlow || {};

(function (MF) {
  MF.state = {
    user: null,
    settings: {
      store_name: 'MarketFlow Supermarket',
      store_address: '',
      store_phone: '',
      currency_symbol: '$',
      tax_enabled: true,
      tax_rate: 7.5,
      receipt_footer: '',
      max_cashier_discount_percent: 10
    },
    currentView: null
  };

  MF.escapeHtml = function (val) {
    if (val === null || val === undefined) return '';
    return String(val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  MF.round2 = function (n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  };

  MF.formatMoney = function (amount) {
    const sym = MF.state.settings?.currency_symbol || '$';
    const num = Number(amount || 0);
    return `${sym}${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  MF.formatDateTime = function (iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return MF.escapeHtml(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  MF.toLocalYMD = function (date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  MF.apiFetch = async function (url, options = {}) {
    const opts = {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    };
    const res = await fetch(url, opts);
    if (res.status === 401 && !options.skipAuthRedirect) {
      window.location.href = '/login.html';
      throw new Error('Authentication required');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  };

  MF.showToast = function (message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const iconMap = {
      success: 'bi-check-circle-fill text-success',
      danger: 'bi-exclamation-octagon-fill text-danger',
      warning: 'bi-exclamation-triangle-fill text-warning',
      info: 'bi-info-circle-fill text-primary'
    };
    const el = document.createElement('div');
    el.className = 'toast align-items-center border bg-white shadow-sm';
    el.setAttribute('role', 'alert');
    el.innerHTML = `
      <div class="d-flex align-items-center p-2 px-3">
        <i class="bi ${iconMap[type] || iconMap.info} me-2 fs-6"></i>
        <div class="toast-body p-0 flex-grow-1 fw-medium">${MF.escapeHtml(message)}</div>
        <button type="button" class="btn-close ms-2" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    `;
    container.appendChild(el);
    const toast = new bootstrap.Toast(el, { delay: 3600 });
    el.addEventListener('hidden.bs.toast', () => el.remove());
    toast.show();
  };

  MF.stockBadge = function (qty, reorderLevel, active = 1) {
    if (Number(active) === 0) {
      return '<span class="badge-status badge-status-muted"><i class="bi bi-pause-circle"></i> Inactive</span>';
    }
    if (qty <= 0) {
      return '<span class="badge-status badge-status-danger"><i class="bi bi-x-circle"></i> Out of Stock</span>';
    }
    if (qty <= reorderLevel) {
      return '<span class="badge-status badge-status-warning"><i class="bi bi-exclamation-triangle"></i> Low Stock</span>';
    }
    return '<span class="badge-status badge-status-success"><i class="bi bi-check-circle"></i> Healthy</span>';
  };

  MF.confirmAction = function ({
    title = 'Confirm Action',
    message = 'Are you sure you want to continue?',
    confirmText = 'Confirm',
    variant = 'primary',
    requireReason = false,
    reasonLabel = 'Reason',
    reasonPlaceholder = 'Enter reason...'
  }) {
    return new Promise((resolve) => {
      const modalEl = document.getElementById('confirmModal');
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      const titleEl = document.getElementById('confirmModalTitle');
      const msgEl = document.getElementById('confirmModalMessage');
      const btnEl = document.getElementById('confirmModalBtn');
      const reasonWrap = document.getElementById('confirmReasonWrap');
      const reasonLabelEl = document.getElementById('confirmReasonLabel');
      const reasonInput = document.getElementById('confirmReasonInput');
      const reasonErr = document.getElementById('confirmReasonError');

      titleEl.textContent = title;
      msgEl.textContent = message;
      btnEl.textContent = confirmText;
      btnEl.className = `btn btn-${variant}`;

      reasonInput.value = '';
      reasonErr.classList.add('d-none');
      if (requireReason) {
        reasonWrap.classList.remove('d-none');
        reasonLabelEl.textContent = reasonLabel;
        reasonInput.placeholder = reasonPlaceholder;
      } else {
        reasonWrap.classList.add('d-none');
      }

      let settled = false;
      const cleanup = () => {
        btnEl.removeEventListener('click', onConfirm);
        modalEl.removeEventListener('hidden.bs.modal', onHidden);
      };

      const onConfirm = () => {
        if (requireReason) {
          const reason = reasonInput.value.trim();
          if (!reason) {
            reasonErr.classList.remove('d-none');
            reasonInput.focus();
            return;
          }
          settled = true;
          cleanup();
          modal.hide();
          resolve({ confirmed: true, reason });
          return;
        }
        settled = true;
        cleanup();
        modal.hide();
        resolve(true);
      };

      const onHidden = () => {
        if (!settled) {
          cleanup();
          resolve(requireReason ? { confirmed: false, reason: '' } : false);
        }
      };

      btnEl.addEventListener('click', onConfirm);
      modalEl.addEventListener('hidden.bs.modal', onHidden);
      modal.show();
      if (requireReason) {
        setTimeout(() => reasonInput.focus(), 200);
      }
    });
  };

  let activeAppModal = null;
  MF.openAppModal = function (html, sizeClass = '') {
    const dialog = document.getElementById('appModalDialog');
    const content = document.getElementById('appModalContent');
    dialog.className = `modal-dialog modal-dialog-centered ${sizeClass}`.trim();
    content.innerHTML = html;
    activeAppModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('appModal'));
    activeAppModal.show();
    return { modal: activeAppModal, content };
  };

  MF.closeAppModal = function () {
    if (activeAppModal) {
      activeAppModal.hide();
    }
  };

  MF.showReceiptModal = function (sale, items, store) {
    const s = store || MF.state.settings || {};
    const printArea = document.getElementById('receiptPrintArea');

    const voidBanner = sale.status === 'voided'
      ? `<div class="alert alert-danger py-1 px-2 text-center fw-bold mb-2">VOIDED SALE${sale.void_reason ? ` — ${MF.escapeHtml(sale.void_reason)}` : ''}</div>`
      : '';

    const itemRows = items.map((it) => `
      <div class="d-flex justify-content-between mb-1">
        <div>
          <div class="fw-semibold">${MF.escapeHtml(it.product_name_snapshot)}</div>
          <div class="text-muted" style="font-size: 11px;">${it.quantity} x ${MF.formatMoney(it.unit_price)} (${MF.escapeHtml(it.sku_snapshot)})</div>
        </div>
        <div class="fw-semibold">${MF.formatMoney(it.line_total)}</div>
      </div>
    `).join('');

    printArea.innerHTML = `
      <div class="receipt-paper">
        ${voidBanner}
        <div class="text-center mb-2">
          <div class="fw-bold fs-6">${MF.escapeHtml(s.store_name || 'MarketFlow Supermarket')}</div>
          ${s.store_address ? `<div>${MF.escapeHtml(s.store_address)}</div>` : ''}
          ${s.store_phone ? `<div>Tel: ${MF.escapeHtml(s.store_phone)}</div>` : ''}
        </div>
        <div class="receipt-divider"></div>
        <div class="d-flex justify-content-between"><span>Receipt #:</span><strong>${MF.escapeHtml(sale.receipt_number)}</strong></div>
        <div class="d-flex justify-content-between"><span>Date:</span><span>${MF.formatDateTime(sale.created_at)}</span></div>
        <div class="d-flex justify-content-between"><span>Cashier:</span><span>${MF.escapeHtml(sale.cashier_name || MF.state.user?.full_name || '')}</span></div>
        <div class="d-flex justify-content-between"><span>Payment:</span><span class="text-uppercase">${MF.escapeHtml(sale.payment_method)}</span></div>
        <div class="receipt-divider"></div>
        ${itemRows}
        <div class="receipt-divider"></div>
        <div class="d-flex justify-content-between"><span>Subtotal</span><span>${MF.formatMoney(sale.subtotal)}</span></div>
        ${Number(sale.discount_total) > 0 ? `<div class="d-flex justify-content-between text-success"><span>Discount</span><span>-${MF.formatMoney(sale.discount_total)}</span></div>` : ''}
        <div class="d-flex justify-content-between"><span>Tax (${Number(sale.tax_rate_snapshot || 0)}%)</span><span>${MF.formatMoney(sale.tax_total)}</span></div>
        <div class="d-flex justify-content-between fw-bold fs-6 mt-1"><span>TOTAL</span><span>${MF.formatMoney(sale.grand_total)}</span></div>
        <div class="receipt-divider"></div>
        <div class="d-flex justify-content-between"><span>Amount Paid</span><span>${MF.formatMoney(sale.amount_paid)}</span></div>
        <div class="d-flex justify-content-between"><span>Change Due</span><span>${MF.formatMoney(sale.change_due)}</span></div>
        ${s.receipt_footer ? `<div class="text-center mt-3 text-muted">${MF.escapeHtml(s.receipt_footer)}</div>` : ''}
      </div>
    `;

    const printBtn = document.getElementById('printReceiptBtn');
    printBtn.onclick = () => {
      document.body.classList.add('printing-receipt');
      const cleanup = () => {
        document.body.classList.remove('printing-receipt');
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      window.print();
      setTimeout(cleanup, 1000);
    };

    bootstrap.Modal.getOrCreateInstance(document.getElementById('receiptModal')).show();
  };
})(window.MarketFlow);
