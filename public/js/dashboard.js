window.MarketFlow = window.MarketFlow || {};

(function (MF) {
  let salesChart = null;

  MF.views = MF.views || {};
  MF.views.dashboard = async function (container) {
    container.innerHTML = `
      <div class="text-center py-5 text-muted">
        <div class="spinner-border text-success mb-2"></div>
        <div>Loading dashboard metrics...</div>
      </div>
    `;

    try {
      const data = await MF.apiFetch('/api/reports/dashboard');
      const { kpis, daily_series, low_stock_products, top_products, recent_sales } = data;

      container.innerHTML = `
        <div class="row g-3 mb-4">
          <div class="col-sm-6 col-xl-3">
            <div class="kpi-card d-flex justify-content-between align-items-start">
              <div>
                <div class="kpi-label">Sales Today</div>
                <div class="kpi-value">${MF.formatMoney(kpis.sales_today)}</div>
                <div class="text-muted mt-1" style="font-size: 12px;">Completed checkout total</div>
              </div>
              <div class="kpi-icon" style="background: #E6F4ED; color: #176B4D;">
                <i class="bi bi-cash-stack"></i>
              </div>
            </div>
          </div>

          <div class="col-sm-6 col-xl-3">
            <div class="kpi-card d-flex justify-content-between align-items-start">
              <div>
                <div class="kpi-label">Transactions Today</div>
                <div class="kpi-value">${kpis.transactions_today}</div>
                <div class="text-muted mt-1" style="font-size: 12px;">Receipts issued today</div>
              </div>
              <div class="kpi-icon" style="background: #E8F1FA; color: #3978B7;">
                <i class="bi bi-receipt-cutoff"></i>
              </div>
            </div>
          </div>

          <div class="col-sm-6 col-xl-3">
            <div class="kpi-card d-flex justify-content-between align-items-start">
              <div>
                <div class="kpi-label">Low-Stock Alerts</div>
                <div class="kpi-value ${kpis.low_stock_count > 0 ? 'text-warning' : ''}">${kpis.low_stock_count}</div>
                <div class="text-muted mt-1" style="font-size: 12px;">${kpis.out_of_stock_count} out of stock</div>
              </div>
              <div class="kpi-icon" style="background: #FEF3DF; color: #D99121;">
                <i class="bi bi-exclamation-triangle"></i>
              </div>
            </div>
          </div>

          <div class="col-sm-6 col-xl-3">
            <div class="kpi-card d-flex justify-content-between align-items-start">
              <div>
                <div class="kpi-label">Active Products</div>
                <div class="kpi-value">${kpis.active_products_count}</div>
                <div class="text-muted mt-1" style="font-size: 12px;">In active catalogue</div>
              </div>
              <div class="kpi-icon" style="background: #F0F5E4; color: #124B38;">
                <i class="bi bi-box-seam"></i>
              </div>
            </div>
          </div>
        </div>

        <div class="row g-3 mb-4">
          <div class="col-lg-8">
            <div class="mf-card p-3 p-md-4 h-100">
              <div class="d-flex justify-content-between align-items-center mb-3">
                <div>
                  <h2 class="h6 mb-0">7-Day Sales Trend</h2>
                  <div class="text-muted" style="font-size: 12px;">Daily completed sales revenue</div>
                </div>
                <button class="btn btn-sm btn-outline-primary" id="dashOpenReportsBtn">
                  <i class="bi bi-bar-chart"></i> Full Reports
                </button>
              </div>
              <div style="height: 260px;">
                <canvas id="dashSalesChart"></canvas>
              </div>
            </div>
          </div>

          <div class="col-lg-4">
            <div class="mf-card p-3 p-md-4 h-100">
              <h2 class="h6 mb-1">Top-Selling Products</h2>
              <div class="text-muted mb-3" style="font-size: 12px;">Last 30 days by units sold</div>
              ${top_products.length === 0 ? '<p class="text-muted mb-0">No sales recorded yet.</p>' : `
                <div class="d-flex flex-column gap-2">
                  ${top_products.map((tp, i) => `
                    <div class="d-flex justify-content-between align-items-center p-2 rounded-2" style="background: #F8FAF9;">
                      <div class="me-2 text-truncate">
                        <div class="fw-semibold text-truncate">${i + 1}. ${MF.escapeHtml(tp.product_name)}</div>
                        <div class="text-muted" style="font-size: 12px;">${tp.units_sold} units sold</div>
                      </div>
                      <div class="fw-semibold text-nowrap" style="color: var(--mf-primary);">${MF.formatMoney(tp.revenue)}</div>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>
          </div>
        </div>

        <div class="row g-3">
          <div class="col-lg-6">
            <div class="mf-card overflow-hidden h-100">
              <div class="p-3 px-4 border-bottom d-flex justify-content-between align-items-center">
                <div>
                  <h2 class="h6 mb-0">Low-Stock Alerts</h2>
                  <div class="text-muted" style="font-size: 12px;">Products at or below reorder threshold</div>
                </div>
                <button class="btn btn-sm btn-outline-primary" id="dashReceiveStockBtn">
                  <i class="bi bi-truck"></i> Receive Stock
                </button>
              </div>
              <div class="table-responsive">
                <table class="table table-mf">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Available</th>
                      <th>Reorder At</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${low_stock_products.length === 0 ? `
                      <tr><td colspan="4" class="text-center text-muted py-4">All active products have healthy stock levels.</td></tr>
                    ` : low_stock_products.map((p) => `
                      <tr>
                        <td>
                          <div class="fw-semibold">${MF.escapeHtml(p.name)}</div>
                          <div class="text-muted" style="font-size: 12px;">${MF.escapeHtml(p.sku)} · ${MF.escapeHtml(p.category_name)}</div>
                        </td>
                        <td class="fw-bold">${p.quantity_available} ${MF.escapeHtml(p.unit)}</td>
                        <td>${p.reorder_level}</td>
                        <td>${MF.stockBadge(p.quantity_available, p.reorder_level, 1)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="col-lg-6">
            <div class="mf-card overflow-hidden h-100">
              <div class="p-3 px-4 border-bottom d-flex justify-content-between align-items-center">
                <div>
                  <h2 class="h6 mb-0">Recent Sales</h2>
                  <div class="text-muted" style="font-size: 12px;">Latest POS receipts</div>
                </div>
                <button class="btn btn-sm btn-outline-primary" id="dashSalesHistoryBtn">
                  <i class="bi bi-list-ul"></i> View All
                </button>
              </div>
              <div class="table-responsive">
                <table class="table table-mf">
                  <thead>
                    <tr>
                      <th>Receipt #</th>
                      <th>Cashier</th>
                      <th>Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${recent_sales.length === 0 ? `
                      <tr><td colspan="4" class="text-center text-muted py-4">No sales recorded yet.</td></tr>
                    ` : recent_sales.map((s) => `
                      <tr>
                        <td>
                          <button type="button" class="btn btn-link p-0 fw-semibold text-decoration-none view-receipt-link" data-id="${s.id}" style="color: var(--mf-primary);">
                            ${MF.escapeHtml(s.receipt_number)}
                          </button>
                          <div class="text-muted" style="font-size: 12px;">${MF.formatDateTime(s.created_at)}</div>
                        </td>
                        <td>${MF.escapeHtml(s.cashier_name)}</td>
                        <td class="fw-semibold">${MF.formatMoney(s.grand_total)}</td>
                        <td>
                          ${s.status === 'voided'
                            ? '<span class="badge-status badge-status-danger"><i class="bi bi-slash-circle"></i> Voided</span>'
                            : '<span class="badge-status badge-status-success"><i class="bi bi-check-circle"></i> Paid</span>'}
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      `;

      document.getElementById('dashOpenReportsBtn').addEventListener('click', () => MF.navigate('reports'));
      document.getElementById('dashReceiveStockBtn').addEventListener('click', () => MF.navigate('inventory', { tab: 'receive' }));
      document.getElementById('dashSalesHistoryBtn').addEventListener('click', () => MF.navigate('sales'));

      container.querySelectorAll('.view-receipt-link').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            const detail = await MF.apiFetch(`/api/sales/${btn.dataset.id}`);
            MF.showReceiptModal(detail.sale, detail.items, detail.store);
          } catch (err) {
            MF.showToast(err.message, 'danger');
          }
        });
      });

      if (salesChart) {
        salesChart.destroy();
      }
      const ctx = document.getElementById('dashSalesChart');
      if (ctx && window.Chart) {
        salesChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: daily_series.map((d) => d.day.slice(5)),
            datasets: [
              {
                label: 'Sales Revenue',
                data: daily_series.map((d) => d.revenue),
                backgroundColor: '#176B4D',
                borderRadius: 6,
                maxBarThickness: 40
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (item) => `Revenue: ${MF.formatMoney(item.raw)}`
                }
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                grid: { color: '#EEF2EF' },
                ticks: {
                  callback: (val) => `${MF.state.settings.currency_symbol}${val}`
                }
              },
              x: {
                grid: { display: false }
              }
            }
          }
        });
      }
    } catch (err) {
      container.innerHTML = `<div class="alert alert-danger">${MF.escapeHtml(err.message)}</div>`;
    }
  };
})(window.MarketFlow);
