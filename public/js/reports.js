window.MarketFlow = window.MarketFlow || {};

(function (MF) {
  function downloadCsv(filename, rows) {
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function shiftDateStr(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return MF.toLocalYMD(d);
  }

  MF.views = MF.views || {};
  MF.views.reports = async function (container) {
    let activeTab = 'sales';
    let lastSalesReport = null;
    let lastProductReport = null;
    let lastInventoryReport = null;

    let users = [];
    try {
      const uRes = await MF.apiFetch('/api/users');
      users = uRes.users;
    } catch (_) {}

    container.innerHTML = `
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 no-print">
        <ul class="nav nav-pills gap-2" id="reportTabs">
          <li class="nav-item">
            <button type="button" class="nav-link active" data-tab="sales">
              <i class="bi bi-graph-up me-1"></i> Sales Report
            </button>
          </li>
          <li class="nav-item">
            <button type="button" class="nav-link" data-tab="products">
              <i class="bi bi-trophy me-1"></i> Product Performance
            </button>
          </li>
          <li class="nav-item">
            <button type="button" class="nav-link" data-tab="inventory">
              <i class="bi bi-boxes me-1"></i> Inventory Valuation
            </button>
          </li>
        </ul>
        <div class="d-flex gap-2">
          <button type="button" id="exportReportCsvBtn" class="btn btn-outline-primary btn-sm">
            <i class="bi bi-download"></i> Export CSV
          </button>
          <button type="button" id="printReportBtn" class="btn btn-outline-secondary btn-sm">
            <i class="bi bi-printer"></i> Print Report
          </button>
        </div>
      </div>

      <div id="reportFilterCard" class="mf-card p-3 mb-3 no-print">
        <div class="row g-2 align-items-end">
          <div class="col-sm-6 col-md-3">
            <label class="form-label mb-1" style="font-size: 12px; font-weight: 600;">Summary Period</label>
            <select id="repPeriodSelect" class="form-select">
              <option value="daily">Today (Daily)</option>
              <option value="weekly" selected>Last 7 Days (Weekly)</option>
              <option value="monthly">Last 30 Days (Monthly)</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>
          <div class="col-sm-6 col-md-3">
            <label class="form-label mb-1" style="font-size: 12px; font-weight: 600;">From</label>
            <input type="date" id="repFromInput" class="form-control" value="${shiftDateStr(6)}">
          </div>
          <div class="col-sm-6 col-md-3">
            <label class="form-label mb-1" style="font-size: 12px; font-weight: 600;">To</label>
            <input type="date" id="repToInput" class="form-control" value="${MF.toLocalYMD()}">
          </div>
          <div class="col-sm-6 col-md-3" id="repCashierWrap">
            <label class="form-label mb-1" style="font-size: 12px; font-weight: 600;">Cashier</label>
            <select id="repCashierSelect" class="form-select">
              <option value="">All Cashiers</option>
              ${users.map((u) => `<option value="${u.id}">${MF.escapeHtml(u.full_name)}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div id="reportBody"></div>
    `;

    const periodEl = document.getElementById('repPeriodSelect');
    const fromEl = document.getElementById('repFromInput');
    const toEl = document.getElementById('repToInput');
    const cashierEl = document.getElementById('repCashierSelect');
    const cashierWrap = document.getElementById('repCashierWrap');
    const filterCard = document.getElementById('reportFilterCard');
    const reportBody = document.getElementById('reportBody');

    periodEl.addEventListener('change', () => {
      const val = periodEl.value;
      const today = MF.toLocalYMD();
      if (val === 'daily') {
        fromEl.value = today;
        toEl.value = today;
      } else if (val === 'weekly') {
        fromEl.value = shiftDateStr(6);
        toEl.value = today;
      } else if (val === 'monthly') {
        fromEl.value = shiftDateStr(29);
        toEl.value = today;
      }
      renderActiveReport();
    });

    [fromEl, toEl, cashierEl].forEach((el) => el.addEventListener('change', () => {
      if (el !== cashierEl && periodEl.value !== 'monthly') {
        periodEl.value = 'custom';
      }
      renderActiveReport();
    }));

    async function renderSalesReport() {
      const qs = new URLSearchParams();
      qs.set('period', periodEl.value);
      if (fromEl.value) qs.set('from', fromEl.value);
      if (toEl.value) qs.set('to', toEl.value);
      if (cashierEl.value) qs.set('cashier_id', cashierEl.value);

      const data = await MF.apiFetch(`/api/reports/sales?${qs.toString()}`);
      lastSalesReport = data;
      const { summary, by_payment_method, by_cashier, by_period } = data;

      reportBody.innerHTML = `
        <div class="row g-3 mb-3">
          <div class="col-sm-6 col-xl-3">
            <div class="kpi-card">
              <div class="kpi-label">Net Revenue</div>
              <div class="kpi-value" style="color: var(--mf-primary);">${MF.formatMoney(summary.net_revenue)}</div>
              <div class="text-muted" style="font-size: 12px;">${summary.completed_count} completed · ${summary.voided_count} voided</div>
            </div>
          </div>
          <div class="col-sm-6 col-xl-3">
            <div class="kpi-card">
              <div class="kpi-label">Gross Subtotal</div>
              <div class="kpi-value">${MF.formatMoney(summary.gross_subtotal)}</div>
            </div>
          </div>
          <div class="col-sm-6 col-xl-3">
            <div class="kpi-card">
              <div class="kpi-label">Discounts Given</div>
              <div class="kpi-value">${MF.formatMoney(summary.discount_total)}</div>
            </div>
          </div>
          <div class="col-sm-6 col-xl-3">
            <div class="kpi-card">
              <div class="kpi-label">Tax Collected</div>
              <div class="kpi-value">${MF.formatMoney(summary.tax_total)}</div>
            </div>
          </div>
        </div>

        <div class="row g-3 mb-3">
          <div class="col-lg-6">
            <div class="mf-card overflow-hidden h-100">
              <div class="p-3 px-4 border-bottom"><h2 class="h6 mb-0">Breakdown by Payment Method</h2></div>
              <div class="table-responsive">
                <table class="table table-mf">
                  <thead><tr><th>Method</th><th>Transactions</th><th>Total</th></tr></thead>
                  <tbody>
                    ${by_payment_method.length === 0 ? '<tr><td colspan="3" class="text-center py-3 text-muted">No completed sales</td></tr>' : by_payment_method.map((m) => `
                      <tr>
                        <td class="text-uppercase fw-semibold">${MF.escapeHtml(m.payment_method)}</td>
                        <td>${m.transactions}</td>
                        <td class="fw-bold">${MF.formatMoney(m.total_amount)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="col-lg-6">
            <div class="mf-card overflow-hidden h-100">
              <div class="p-3 px-4 border-bottom"><h2 class="h6 mb-0">Breakdown by Cashier</h2></div>
              <div class="table-responsive">
                <table class="table table-mf">
                  <thead><tr><th>Staff Member</th><th>Transactions</th><th>Total</th></tr></thead>
                  <tbody>
                    ${by_cashier.length === 0 ? '<tr><td colspan="3" class="text-center py-3 text-muted">No completed sales</td></tr>' : by_cashier.map((c) => `
                      <tr>
                        <td class="fw-semibold">${MF.escapeHtml(c.cashier_name)}</td>
                        <td>${c.transactions}</td>
                        <td class="fw-bold">${MF.formatMoney(c.total_amount)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div class="mf-card overflow-hidden">
          <div class="p-3 px-4 border-bottom"><h2 class="h6 mb-0">Period Totals (${MF.escapeHtml(data.filters.from || 'All')} to ${MF.escapeHtml(data.filters.to || 'Today')})</h2></div>
          <div class="table-responsive">
            <table class="table table-mf">
              <thead>
                <tr>
                  <th>Date / Period</th>
                  <th>Transactions</th>
                  <th>Subtotal</th>
                  <th>Discounts</th>
                  <th>Tax</th>
                  <th>Net Revenue</th>
                </tr>
              </thead>
              <tbody>
                ${by_period.length === 0 ? '<tr><td colspan="6" class="text-center py-4 text-muted">No sales found in selected range.</td></tr>' : by_period.map((r) => `
                  <tr>
                    <td class="fw-semibold">${MF.escapeHtml(r.label)}</td>
                    <td>${r.transactions}</td>
                    <td>${MF.formatMoney(r.subtotal)}</td>
                    <td>${MF.formatMoney(r.discount_total)}</td>
                    <td>${MF.formatMoney(r.tax_total)}</td>
                    <td class="fw-bold" style="color: var(--mf-primary);">${MF.formatMoney(r.net_revenue)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    async function renderProductsReport() {
      const qs = new URLSearchParams();
      if (fromEl.value) qs.set('from', fromEl.value);
      if (toEl.value) qs.set('to', toEl.value);
      const data = await MF.apiFetch(`/api/reports/top-products?${qs.toString()}`);
      lastProductReport = data;

      reportBody.innerHTML = `
        <div class="mf-card overflow-hidden">
          <div class="p-3 px-4 border-bottom">
            <h2 class="h6 mb-0">Product Sales Performance</h2>
          </div>
          <div class="table-responsive">
            <table class="table table-mf">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Units Sold</th>
                  <th>Orders</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                ${data.products.length === 0 ? '<tr><td colspan="6" class="text-center py-4 text-muted">No product sales in selected range.</td></tr>' : data.products.map((p, idx) => `
                  <tr>
                    <td>#${idx + 1}</td>
                    <td>
                      <div class="fw-semibold">${MF.escapeHtml(p.product_name)}</div>
                      <div class="text-muted" style="font-size: 12px;"><code>${MF.escapeHtml(p.sku)}</code></div>
                    </td>
                    <td>${MF.escapeHtml(p.category_name)}</td>
                    <td class="fw-bold">${p.units_sold}</td>
                    <td>${p.order_appearances}</td>
                    <td class="fw-bold" style="color: var(--mf-primary);">${MF.formatMoney(p.revenue)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    async function renderInventoryReport() {
      const data = await MF.apiFetch('/api/reports/inventory');
      lastInventoryReport = data;
      const { summary, by_category, items } = data;

      reportBody.innerHTML = `
        <div class="row g-3 mb-3">
          <div class="col-sm-6 col-xl-3">
            <div class="kpi-card">
              <div class="kpi-label">Active SKUs / Units</div>
              <div class="kpi-value">${summary.active_skus} / ${summary.total_units}</div>
            </div>
          </div>
          <div class="col-sm-6 col-xl-3">
            <div class="kpi-card">
              <div class="kpi-label">Total Retail Value</div>
              <div class="kpi-value" style="color: var(--mf-primary);">${MF.formatMoney(summary.total_retail_value)}</div>
            </div>
          </div>
          <div class="col-sm-6 col-xl-3">
            <div class="kpi-card">
              <div class="kpi-label">Total Cost Value</div>
              <div class="kpi-value">${MF.formatMoney(summary.total_cost_value)}</div>
            </div>
          </div>
          <div class="col-sm-6 col-xl-3">
            <div class="kpi-card">
              <div class="kpi-label">Low / Out of Stock</div>
              <div class="kpi-value text-warning">${summary.low_stock_count} <span class="fs-6 text-muted">(${summary.out_of_stock_count} zero)</span></div>
            </div>
          </div>
        </div>

        <div class="mf-card overflow-hidden mb-3">
          <div class="p-3 px-4 border-bottom"><h2 class="h6 mb-0">Stock Value by Category</h2></div>
          <div class="table-responsive">
            <table class="table table-mf">
              <thead><tr><th>Category</th><th>Active Products</th><th>Total Units</th><th>Retail Value</th></tr></thead>
              <tbody>
                ${by_category.map((c) => `
                  <tr>
                    <td class="fw-semibold">${MF.escapeHtml(c.category_name)}</td>
                    <td>${c.product_count}</td>
                    <td>${c.total_units}</td>
                    <td class="fw-bold">${MF.formatMoney(c.retail_value)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="mf-card overflow-hidden">
          <div class="p-3 px-4 border-bottom"><h2 class="h6 mb-0">Full Inventory Valuation</h2></div>
          <div class="table-responsive">
            <table class="table table-mf">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Available</th>
                  <th>Reorder At</th>
                  <th>Cost Value</th>
                  <th>Retail Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${items.map((item) => `
                  <tr>
                    <td>
                      <div class="fw-semibold">${MF.escapeHtml(item.name)}</div>
                      <div class="text-muted" style="font-size: 12px;"><code>${MF.escapeHtml(item.sku)}</code></div>
                    </td>
                    <td>${MF.escapeHtml(item.category_name)}</td>
                    <td class="fw-semibold">${item.quantity_available} ${MF.escapeHtml(item.unit)}</td>
                    <td>${item.reorder_level}</td>
                    <td>${MF.formatMoney(item.cost_value)}</td>
                    <td class="fw-bold">${MF.formatMoney(item.retail_value)}</td>
                    <td>${MF.stockBadge(item.quantity_available, item.reorder_level, item.active)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    async function renderActiveReport() {
      filterCard.classList.toggle('d-none', activeTab === 'inventory');
      cashierWrap.classList.toggle('d-none', activeTab !== 'sales');
      if (activeTab === 'sales') {
        await renderSalesReport();
      } else if (activeTab === 'products') {
        await renderProductsReport();
      } else {
        await renderInventoryReport();
      }
    }

    container.querySelectorAll('#reportTabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        container.querySelectorAll('#reportTabs button').forEach((b) => b.classList.toggle('active', b === btn));
        renderActiveReport();
      });
    });

    document.getElementById('exportReportCsvBtn').addEventListener('click', () => {
      if (activeTab === 'sales' && lastSalesReport) {
        const rows = [
          ['Receipt #', 'Date', 'Cashier', 'Payment Method', 'Status', 'Subtotal', 'Discount', 'Tax', 'Grand Total'],
          ...lastSalesReport.transactions.map((t) => [
            t.receipt_number, t.created_at, t.cashier_name, t.payment_method, t.status,
            t.subtotal, t.discount_total, t.tax_total, t.grand_total
          ])
        ];
        downloadCsv(`marketflow-sales-report-${MF.toLocalYMD()}.csv`, rows);
      } else if (activeTab === 'products' && lastProductReport) {
        const rows = [
          ['SKU', 'Product', 'Category', 'Units Sold', 'Orders', 'Revenue'],
          ...lastProductReport.products.map((p) => [
            p.sku, p.product_name, p.category_name, p.units_sold, p.order_appearances, p.revenue
          ])
        ];
        downloadCsv(`marketflow-product-performance-${MF.toLocalYMD()}.csv`, rows);
      } else if (activeTab === 'inventory' && lastInventoryReport) {
        const rows = [
          ['SKU', 'Product', 'Category', 'Quantity', 'Unit', 'Reorder Level', 'Cost Value', 'Retail Value', 'Status'],
          ...lastInventoryReport.items.map((i) => [
            i.sku, i.name, i.category_name, i.quantity_available, i.unit, i.reorder_level, i.cost_value, i.retail_value, i.stock_status
          ])
        ];
        downloadCsv(`marketflow-inventory-report-${MF.toLocalYMD()}.csv`, rows);
      }
    });

    document.getElementById('printReportBtn').addEventListener('click', () => {
      document.body.classList.add('printing-report');
      const cleanup = () => {
        document.body.classList.remove('printing-report');
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      window.print();
      setTimeout(cleanup, 1000);
    });

    await renderActiveReport();
  };
})(window.MarketFlow);
