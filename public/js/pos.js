window.MarketFlow = window.MarketFlow || {};

(function (MF) {
  let products = [];
  let categories = [];
  let cart = []; // [{ product_id, name, sku, unit, unit_price, quantity, max_stock }]
  let selectedCategoryId = '';
  let searchTerm = '';
  let discountPercent = 0;

  function makeIdempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `mf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function getMaxDiscount() {
    if (MF.state.user?.role_name === 'cashier') {
      return Number(MF.state.settings?.max_cashier_discount_percent ?? 10);
    }
    return 100;
  }

  function calculateTotals() {
    const subtotal = MF.round2(cart.reduce((sum, item) => sum + MF.round2(item.unit_price * item.quantity), 0));
    const maxDisc = getMaxDiscount();
    const clampedDisc = Math.max(0, Math.min(maxDisc, Number(discountPercent) || 0));
    const discountTotal = MF.round2(subtotal * (clampedDisc / 100));
    const taxable = MF.round2(subtotal - discountTotal);
    const taxEnabled = Boolean(MF.state.settings?.tax_enabled);
    const taxRate = taxEnabled ? Number(MF.state.settings?.tax_rate || 0) : 0;
    const taxTotal = taxEnabled ? MF.round2(taxable * (taxRate / 100)) : 0;
    const grandTotal = MF.round2(taxable + taxTotal);
    return { subtotal, discountTotal, taxRate, taxTotal, grandTotal, clampedDisc };
  }

  function addProductToCart(product) {
    if (!product || product.quantity_available <= 0) {
      MF.showToast(`"${product?.name || 'Product'}" is out of stock`, 'warning');
      return;
    }
    const existing = cart.find((c) => c.product_id === product.id);
    if (existing) {
      if (existing.quantity >= product.quantity_available) {
        MF.showToast(`Maximum available stock reached for "${product.name}" (${product.quantity_available})`, 'warning');
        return;
      }
      existing.quantity += 1;
      existing.max_stock = product.quantity_available;
    } else {
      cart.push({
        product_id: product.id,
        name: product.name,
        sku: product.sku,
        unit: product.unit,
        unit_price: product.selling_price,
        quantity: 1,
        max_stock: product.quantity_available
      });
    }
    renderCart();
    renderProductGrid();
  }

  function updateCartQty(productId, delta) {
    const idx = cart.findIndex((c) => c.product_id === productId);
    if (idx === -1) return;
    const item = cart[idx];
    const prod = products.find((p) => p.id === productId);
    const maxAvail = prod ? prod.quantity_available : item.max_stock;
    const nextQty = item.quantity + delta;

    if (nextQty <= 0) {
      cart.splice(idx, 1);
    } else if (nextQty > maxAvail) {
      MF.showToast(`Only ${maxAvail} available in stock for "${item.name}"`, 'warning');
      return;
    } else {
      item.quantity = nextQty;
      item.max_stock = maxAvail;
    }
    renderCart();
    renderProductGrid();
  }

  function renderProductGrid() {
    const grid = document.getElementById('posProductGrid');
    if (!grid) return;

    const term = searchTerm.trim().toLowerCase();
    const filtered = products.filter((p) => {
      if (selectedCategoryId && String(p.category_id) !== String(selectedCategoryId)) return false;
      if (!term) return true;
      return (
        p.name.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term) ||
        (p.barcode && p.barcode.toLowerCase().includes(term))
      );
    });

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="mf-card p-5 text-center text-muted" style="grid-column: 1 / -1;">
          <i class="bi bi-search fs-3 d-block mb-2"></i>
          No matching active products found.
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map((p) => {
      const inCart = cart.find((c) => c.product_id === p.id);
      const outOfStock = p.quantity_available <= 0;
      const stockClass = outOfStock
        ? 'badge-status-danger'
        : (p.quantity_available <= p.reorder_level ? 'badge-status-warning' : 'badge-status-success');

      return `
        <button type="button" class="pos-product-card" data-id="${p.id}" ${outOfStock ? 'disabled' : ''}>
          <div>
            <div class="d-flex justify-content-between align-items-start gap-2 mb-1">
              <span class="text-muted" style="font-size: 11px; font-weight: 600;">${MF.escapeHtml(p.sku)}</span>
              ${inCart ? `<span class="badge rounded-pill text-bg-success">${inCart.quantity} in cart</span>` : ''}
            </div>
            <div class="fw-semibold" style="font-size: 14px; line-height: 1.3;">${MF.escapeHtml(p.name)}</div>
            <div class="text-muted" style="font-size: 12px;">${MF.escapeHtml(p.category_name)}</div>
          </div>
          <div class="d-flex justify-content-between align-items-center pt-2 border-top w-100">
            <span class="fw-bold" style="font-size: 16px; color: var(--mf-primary);">${MF.formatMoney(p.selling_price)}</span>
            <span class="badge-status ${stockClass}" style="font-size: 11px; padding: 2px 8px;">${p.quantity_available} ${MF.escapeHtml(p.unit)}</span>
          </div>
        </button>
      `;
    }).join('');

    grid.querySelectorAll('.pos-product-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const prod = products.find((p) => p.id === Number(btn.dataset.id));
        addProductToCart(prod);
      });
    });
  }

  function renderCart() {
    const listEl = document.getElementById('posCartList');
    const summaryEl = document.getElementById('posCartSummary');
    const checkoutBtn = document.getElementById('posCheckoutBtn');
    const clearBtn = document.getElementById('posClearCartBtn');
    const countBadge = document.getElementById('posCartItemCount');
    if (!listEl) return;

    const totalItems = cart.reduce((sum, i) => sum + i.quantity, 0);
    countBadge.textContent = `${totalItems} item${totalItems === 1 ? '' : 's'}`;
    clearBtn.disabled = cart.length === 0;
    checkoutBtn.disabled = cart.length === 0;

    if (cart.length === 0) {
      listEl.innerHTML = `
        <div class="text-center py-4 text-muted">
          <i class="bi bi-basket2 fs-2 d-block mb-2"></i>
          <div>Cart is empty</div>
          <div style="font-size: 12px;">Click a product or scan a barcode to start a sale.</div>
        </div>
      `;
    } else {
      listEl.innerHTML = cart.map((item) => `
        <div class="pos-cart-row">
          <div class="flex-grow-1 min-w-0">
            <div class="fw-semibold text-truncate">${MF.escapeHtml(item.name)}</div>
            <div class="text-muted" style="font-size: 12px;">${MF.formatMoney(item.unit_price)} / ${MF.escapeHtml(item.unit)}</div>
          </div>
          <div class="pos-qty-control">
            <button type="button" class="pos-qty-dec" data-id="${item.product_id}" aria-label="Decrease quantity">-</button>
            <span>${item.quantity}</span>
            <button type="button" class="pos-qty-inc" data-id="${item.product_id}" aria-label="Increase quantity">+</button>
          </div>
          <div class="text-end" style="min-width: 72px;">
            <div class="fw-semibold">${MF.formatMoney(item.unit_price * item.quantity)}</div>
            <button type="button" class="btn btn-link p-0 text-danger pos-remove-item" data-id="${item.product_id}" style="font-size: 11px; text-decoration: none;">Remove</button>
          </div>
        </div>
      `).join('');

      listEl.querySelectorAll('.pos-qty-dec').forEach((b) =>
        b.addEventListener('click', () => updateCartQty(Number(b.dataset.id), -1))
      );
      listEl.querySelectorAll('.pos-qty-inc').forEach((b) =>
        b.addEventListener('click', () => updateCartQty(Number(b.dataset.id), 1))
      );
      listEl.querySelectorAll('.pos-remove-item').forEach((b) =>
        b.addEventListener('click', () => {
          cart = cart.filter((c) => c.product_id !== Number(b.dataset.id));
          renderCart();
          renderProductGrid();
        })
      );
    }

    const totals = calculateTotals();
    summaryEl.innerHTML = `
      <div class="d-flex justify-content-between mb-1 text-muted">
        <span>Subtotal</span>
        <span>${MF.formatMoney(totals.subtotal)}</span>
      </div>
      ${totals.discountTotal > 0 ? `
        <div class="d-flex justify-content-between mb-1 text-success">
          <span>Discount (${totals.clampedDisc}%)</span>
          <span>-${MF.formatMoney(totals.discountTotal)}</span>
        </div>
      ` : ''}
      <div class="d-flex justify-content-between mb-2 text-muted">
        <span>Tax (${totals.taxRate}%)</span>
        <span>${MF.formatMoney(totals.taxTotal)}</span>
      </div>
      <div class="d-flex justify-content-between pt-2 border-top fw-bold fs-5">
        <span>Grand Total</span>
        <span style="color: var(--mf-primary);">${MF.formatMoney(totals.grandTotal)}</span>
      </div>
    `;
  }

  function openPaymentModal() {
    if (cart.length === 0) return;
    const totals = calculateTotals();
    const idempotencyKey = makeIdempotencyKey();
    let paymentMethod = 'cash';

    const { content } = MF.openAppModal(`
      <div class="modal-header">
        <h5 class="modal-title"><i class="bi bi-credit-card me-2 text-success"></i>Complete Payment</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body">
        <div class="p-3 rounded-3 mb-3 d-flex justify-content-between align-items-center" style="background: var(--mf-primary-soft);">
          <span class="fw-semibold">Amount Due</span>
          <span class="fs-4 fw-bold" style="color: var(--mf-primary);">${MF.formatMoney(totals.grandTotal)}</span>
        </div>

        <label class="form-label fw-semibold">Payment Method</label>
        <div class="btn-group w-100 mb-3" role="group">
          <input type="radio" class="btn-check" name="payMethod" id="payCash" value="cash" checked>
          <label class="btn btn-outline-primary" for="payCash"><i class="bi bi-cash"></i> Cash</label>

          <input type="radio" class="btn-check" name="payMethod" id="payCard" value="card">
          <label class="btn btn-outline-primary" for="payCard"><i class="bi bi-credit-card-2-front"></i> Card</label>

          <input type="radio" class="btn-check" name="payMethod" id="payTransfer" value="transfer">
          <label class="btn btn-outline-primary" for="payTransfer"><i class="bi bi-bank"></i> Transfer</label>
        </div>

        <div id="cashPaymentFields">
          <label for="amountTenderedInput" class="form-label fw-semibold">Amount Tendered (${MF.escapeHtml(MF.state.settings.currency_symbol)})</label>
          <input type="number" step="0.01" min="${totals.grandTotal}" class="form-control mb-2" id="amountTenderedInput" value="${totals.grandTotal.toFixed(2)}">
          <div class="d-flex flex-wrap gap-2 mb-3">
            <button type="button" class="btn btn-sm btn-outline-secondary quick-cash-btn" data-mode="exact">Exact</button>
            <button type="button" class="btn btn-sm btn-outline-secondary quick-cash-btn" data-add="5">+5</button>
            <button type="button" class="btn btn-sm btn-outline-secondary quick-cash-btn" data-add="10">+10</button>
            <button type="button" class="btn btn-sm btn-outline-secondary quick-cash-btn" data-add="20">+20</button>
            <button type="button" class="btn btn-sm btn-outline-secondary quick-cash-btn" data-add="50">+50</button>
          </div>
          <div class="d-flex justify-content-between p-2 px-3 rounded-2 bg-light border">
            <span class="fw-semibold">Change Due</span>
            <strong id="changeDueDisplay" class="fs-5 text-success">${MF.formatMoney(0)}</strong>
          </div>
        </div>

        <div id="nonCashNote" class="alert alert-info py-2 px-3 d-none mb-0" style="font-size: 13px;">
          <i class="bi bi-shield-check me-1"></i>
          Simulated POS settlement: MarketFlow records payment confirmation without storing card details.
        </div>

        <div id="paymentErrorBox" class="alert alert-danger py-2 px-3 mt-3 d-none mb-0"></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
        <button type="button" class="btn btn-primary px-4" id="confirmSaleBtn">
          <span id="saleSpinner" class="spinner-border spinner-border-sm d-none"></span>
          <span>Confirm &amp; Issue Receipt</span>
        </button>
      </div>
    `);

    const cashFields = content.querySelector('#cashPaymentFields');
    const nonCashNote = content.querySelector('#nonCashNote');
    const tenderedInput = content.querySelector('#amountTenderedInput');
    const changeDisplay = content.querySelector('#changeDueDisplay');
    const errBox = content.querySelector('#paymentErrorBox');
    const confirmBtn = content.querySelector('#confirmSaleBtn');
    const spinner = content.querySelector('#saleSpinner');

    function updateCashDisplay() {
      const tendered = Number(tenderedInput.value || 0);
      const change = MF.round2(tendered - totals.grandTotal);
      if (change < 0) {
        changeDisplay.textContent = 'Insufficient';
        changeDisplay.className = 'fs-5 text-danger';
      } else {
        changeDisplay.textContent = MF.formatMoney(change);
        changeDisplay.className = 'fs-5 text-success';
      }
    }

    content.querySelectorAll('input[name="payMethod"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        paymentMethod = radio.value;
        errBox.classList.add('d-none');
        if (paymentMethod === 'cash') {
          cashFields.classList.remove('d-none');
          nonCashNote.classList.add('d-none');
        } else {
          cashFields.classList.add('d-none');
          nonCashNote.classList.remove('d-none');
        }
      });
    });

    tenderedInput.addEventListener('input', updateCashDisplay);
    content.querySelectorAll('.quick-cash-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.mode === 'exact') {
          tenderedInput.value = totals.grandTotal.toFixed(2);
        } else {
          const add = Number(btn.dataset.add || 0);
          tenderedInput.value = MF.round2(totals.grandTotal + add).toFixed(2);
        }
        updateCashDisplay();
      });
    });

    confirmBtn.addEventListener('click', async () => {
      errBox.classList.add('d-none');
      const amountPaid = paymentMethod === 'cash' ? Number(tenderedInput.value) : totals.grandTotal;
      if (paymentMethod === 'cash' && (!Number.isFinite(amountPaid) || MF.round2(amountPaid) < totals.grandTotal)) {
        errBox.textContent = 'Cash tendered must cover the grand total.';
        errBox.classList.remove('d-none');
        return;
      }

      confirmBtn.disabled = true;
      spinner.classList.remove('d-none');

      try {
        const res = await MF.apiFetch('/api/sales', {
          method: 'POST',
          body: JSON.stringify({
            items: cart.map((c) => ({ product_id: c.product_id, quantity: c.quantity })),
            discount_percent: totals.clampedDisc,
            payment_method: paymentMethod,
            amount_paid: amountPaid,
            idempotency_key: idempotencyKey
          })
        });

        MF.closeAppModal();
        cart = [];
        discountPercent = 0;
        const discEl = document.getElementById('posDiscountInput');
        if (discEl) discEl.value = '0';

        await refreshProducts();
        MF.showToast(`Sale ${res.sale.receipt_number} completed!`, 'success');
        MF.showReceiptModal(res.sale, res.items, res.store);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('d-none');
        confirmBtn.disabled = false;
        spinner.classList.add('d-none');
      }
    });
  }

  async function refreshProducts() {
    const [prodRes, catRes] = await Promise.all([
      MF.apiFetch('/api/products?active=1'),
      MF.apiFetch('/api/categories')
    ]);
    products = prodRes.products;
    categories = catRes.categories;

    // Sync cart limits with latest stock
    const byId = new Map(products.map((p) => [p.id, p]));
    cart = cart.filter((c) => {
      const p = byId.get(c.product_id);
      if (!p || p.quantity_available <= 0) return false;
      c.max_stock = p.quantity_available;
      c.unit_price = p.selling_price;
      if (c.quantity > p.quantity_available) c.quantity = p.quantity_available;
      return true;
    });

    renderCategoryPills();
    renderProductGrid();
    renderCart();
  }

  function renderCategoryPills() {
    const wrap = document.getElementById('posCategoryPills');
    if (!wrap) return;
    wrap.innerHTML = `
      <button type="button" class="pos-pill ${selectedCategoryId === '' ? 'active' : ''}" data-cat="">All Products</button>
      ${categories.map((c) => `
        <button type="button" class="pos-pill ${String(selectedCategoryId) === String(c.id) ? 'active' : ''}" data-cat="${c.id}">
          ${MF.escapeHtml(c.name)}
        </button>
      `).join('')}
    `;
    wrap.querySelectorAll('.pos-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedCategoryId = btn.dataset.cat;
        renderCategoryPills();
        renderProductGrid();
      });
    });
  }

  MF.views = MF.views || {};
  MF.views.pos = async function (container) {
    const maxDisc = getMaxDiscount();
    container.innerHTML = `
      <div class="pos-layout">
        <div>
          <div class="mf-card p-3 mb-3">
            <div class="input-group mb-3">
              <span class="input-group-text bg-white"><i class="bi bi-upc-scan text-success fs-5"></i></span>
              <input
                type="search"
                id="posSearchInput"
                class="form-control pos-search-input"
                placeholder="Scan barcode or search by product name / SKU (press Enter to quick-add)..."
                autocomplete="off"
              >
            </div>
            <div id="posCategoryPills" class="pos-category-pills"></div>
          </div>

          <div id="posProductGrid" class="pos-product-grid">
            <div class="text-muted p-4">Loading catalogue...</div>
          </div>
        </div>

        <div class="pos-cart-panel">
          <div class="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom">
            <div>
              <h2 class="h6 mb-0">Current Sale Cart</h2>
              <span id="posCartItemCount" class="text-muted" style="font-size: 12px;">0 items</span>
            </div>
            <button type="button" id="posClearCartBtn" class="btn btn-sm btn-outline-danger" disabled>
              <i class="bi bi-trash"></i> Clear
            </button>
          </div>

          <div id="posCartList" class="pos-cart-list mb-3"></div>

          <div class="mb-3">
            <label for="posDiscountInput" class="form-label mb-1" style="font-size: 12px; font-weight: 600;">
              Discount % (Max ${maxDisc}% for ${MF.escapeHtml(MF.state.user?.role_display_name || '')})
            </label>
            <input
              type="number"
              id="posDiscountInput"
              class="form-control"
              min="0"
              max="${maxDisc}"
              step="0.5"
              value="${discountPercent}"
            >
          </div>

          <div id="posCartSummary" class="mb-3"></div>

          <button type="button" id="posCheckoutBtn" class="btn btn-primary w-100 py-2 fs-6" disabled>
            <i class="bi bi-check2-circle"></i> Process Payment
          </button>
        </div>
      </div>
    `;

    const searchInput = document.getElementById('posSearchInput');
    const discInput = document.getElementById('posDiscountInput');
    const clearBtn = document.getElementById('posClearCartBtn');
    const checkoutBtn = document.getElementById('posCheckoutBtn');

    searchInput.addEventListener('input', (e) => {
      searchTerm = e.target.value;
      renderProductGrid();
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = searchInput.value.trim().toLowerCase();
      if (!q) return;

      const exact = products.find(
        (p) => (p.barcode && p.barcode.toLowerCase() === q) || p.sku.toLowerCase() === q
      );
      if (exact) {
        addProductToCart(exact);
        searchInput.value = '';
        searchTerm = '';
        renderProductGrid();
        return;
      }

      const matches = products.filter(
        (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
      );
      if (matches.length === 1) {
        addProductToCart(matches[0]);
        searchInput.value = '';
        searchTerm = '';
        renderProductGrid();
      }
    });

    discInput.addEventListener('input', () => {
      const val = Number(discInput.value);
      if (!Number.isFinite(val) || val < 0) {
        discountPercent = 0;
      } else if (val > maxDisc) {
        discountPercent = maxDisc;
        discInput.value = String(maxDisc);
        MF.showToast(`Discount capped at ${maxDisc}% for your role`, 'warning');
      } else {
        discountPercent = val;
      }
      renderCart();
    });

    clearBtn.addEventListener('click', async () => {
      const ok = await MF.confirmAction({
        title: 'Clear Cart',
        message: 'Remove all items from the current POS cart?',
        confirmText: 'Clear Cart',
        variant: 'danger'
      });
      if (ok) {
        cart = [];
        renderCart();
        renderProductGrid();
      }
    });

    checkoutBtn.addEventListener('click', openPaymentModal);

    await refreshProducts();
    searchInput.focus();
  };
})(window.MarketFlow);
