import './style.css';
import Chart from 'chart.js/auto';
import { createIcons, Sprout, LayoutDashboard, ArrowLeftRight, NotebookPen, ShieldCheck, UsersRound, Download, Upload, FileSpreadsheet, CalendarDays, WalletCards, Wallet, ArrowDownLeft, Sun, ChartPie, ArrowUpRight, Sparkles, ArrowRight, Search, ChevronLeft, ChevronRight, FolderOpen, HeartHandshake, ShoppingBasket, Utensils, Fuel, ShoppingBag, CircleHelp, TrendingUp, Landmark, ReceiptText } from 'lucide';
import { parseWorkbook, summarize, filterTransactions, monthKey, categoryReport, topCategoryExpenses, parseDateRange } from './data.js';

const iconSet = { Sprout, LayoutDashboard, ArrowLeftRight, NotebookPen, ShieldCheck, UsersRound, Download, Upload, FileSpreadsheet, CalendarDays, WalletCards, Wallet, ArrowDownLeft, Sun, ChartPie, ArrowUpRight, Sparkles, ArrowRight, Search, ChevronLeft, ChevronRight, FolderOpen, HeartHandshake, ShoppingBasket, Utensils, Fuel, ShoppingBag, CircleHelp, TrendingUp, Landmark, ReceiptText };
const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const palette = ['#6f9160', '#b6c994', '#e0b879', '#d99883', '#91bcb0', '#b0b6ca', '#dce1d4'];
const state = { transactions: [], filename: '', view: 'overview', account: 'all', category: 'all', query: '', direction: 'all', includeFuture: false, currency: 'INR', page: 0, trend: 'monthly', budget: 0, merchants: [] };
const currentYear = new Date().getFullYear();
state.reportStart = `${currentYear}-01-01`;
state.reportEnd = `${currentYear}-12-31`;
state.drillCategory = null;
let trendChart;
let categoryChart;
let loadSequence = 0;
let dragDepth = 0;
try {
  const saved = JSON.parse(localStorage.getItem('kinfolk-preferences') || '{}');
  state.budget = Number.isFinite(saved.budget) && saved.budget >= 0 ? saved.budget : 0;
  if (['INR', 'USD', 'EUR', 'GBP'].includes(saved.currency)) state.currency = saved.currency;
} catch { }
$('currency').value = state.currency;

const money = (value, compact = false) => new Intl.NumberFormat(state.currency === 'INR' ? 'en-IN' : 'en-GB', { style: 'currency', currency: state.currency, maximumFractionDigits: compact ? 0 : 2, minimumFractionDigits: 0, ...(compact && Math.abs(value) >= 1000000 ? { notation: 'compact', maximumFractionDigits: 1 } : {}) }).format(value);
const shortDate = date => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const monthLabel = key => key === 'all' ? 'All time' : new Date(`${key}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const icons = () => createIcons({ icons: iconSet });
const dateKey = date => `${monthKey(date)}-${String(date.getDate()).padStart(2, '0')}`;
const commonFilters = () => ({ start: state.reportStart, end: state.reportEnd, account: state.account, includeFuture: state.includeFuture });
const baseRows = () => filterTransactions(state.transactions, commonFilters());
const visibleRows = () => filterTransactions(state.transactions, { ...state, ...commonFilters() });
const currentReport = () => categoryReport(state.transactions, { start: state.reportStart, end: state.reportEnd, account: state.account, includeFuture: state.includeFuture });

function reportYears() {
  const years = [...new Set([currentYear, ...state.transactions.map(row => row.date.getFullYear())])].sort((first, second) => second - first);
  $('report-year').innerHTML = `<option value="custom">Custom range</option>${years.map(year => `<option value="${year}">${year}${year === currentYear ? ' (this year)' : ''}</option>`).join('')}`;
  const selectedYear = state.reportStart.slice(0, 4);
  $('report-year').value = state.reportStart === `${selectedYear}-01-01` && state.reportEnd === `${selectedYear}-12-31` && years.includes(Number(selectedYear)) ? selectedYear : 'custom';
}

function persist() {
  try { localStorage.setItem('kinfolk-preferences', JSON.stringify({ budget: state.budget, currency: state.currency })); } catch { }
}

function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = !message;
}

function options(id, values, first) {
  const previous = $(id).value;
  $(id).innerHTML = `<option value="all">${first}</option>${values.map(value => `<option value="${escape(value)}">${escape(value)}</option>`).join('')}`;
  if (values.includes(previous)) $(id).value = previous;
}

async function load(bufferPromise, filename, silent = false) {
  const sequence = ++loadSequence;
  $('upload-button').disabled = true;
  $('source-tag').textContent = 'Reading...';
  try {
    const result = parseWorkbook(await bufferPromise);
    if (sequence !== loadSequence) return;
    state.transactions = result.transactions;
    state.drillCategory = null;
    reportYears();
    state.filename = filename;
    state.page = 0;
    state.query = '';
    state.category = 'all';
    state.account = 'all';
    state.direction = 'all';
    state.merchants = [];
    $('search').value = '';
    $('merchant-search').value = '';
    $('merchant-menu').open = false;
    $('direction-filter').value = 'all';
    options('account-filter', [...new Set(state.transactions.map(row => row.account))].sort(), 'All accounts');
    $('account-filter').value = 'all';
    options('category-filter', [...new Set(state.transactions.flatMap(row => row.allocations.map(allocation => allocation.category)))].sort(), 'All categories');
    $('category-filter').value = 'all';
    const dates = state.transactions.map(row => row.date);
    $('source-text').textContent = filename;
    $('source-date').textContent = `${shortDate(new Date(Math.min(...dates)))} - ${shortDate(new Date(Math.max(...dates)))} ${new Date(Math.max(...dates)).getFullYear()}`;
    $('nav-count').textContent = state.transactions.length.toLocaleString();
    const messages = [];
    const future = state.transactions.filter(row => row.future).length;
    if (future) messages.push(`${future} future-dated ${future === 1 ? 'transaction is' : 'transactions are'} excluded unless you enable "Include future dates".`);
    if (result.skipped) messages.push(`${result.skipped} rows with invalid dates, amounts, or directions were skipped.`);
    if (result.splitWarnings) messages.push(`${result.splitWarnings} split totals did not match; original transaction categories were retained.`);
    notice(messages.join(' '));
    render();
  } catch (error) {
    if (sequence !== loadSequence) return;
    if (!silent) notice(error.message || 'The file could not be read. Choose a valid Excel or CSV statement.', true);
    render();
  } finally {
    if (sequence === loadSequence) {
      $('upload-button').disabled = false;
      $('source-tag').textContent = state.transactions.length ? `${state.transactions.length.toLocaleString()} transactions` : 'Ready to import';
    }
  }
}

function categoryIcon(category) {
  if (/fuel|transport|travel/i.test(category)) return 'fuel';
  if (/grocery|vegetable|fruit|meat|milk/i.test(category)) return 'shopping-basket';
  if (/food|dining|restaurant/i.test(category)) return 'utensils';
  if (/shopping|gift|cloth/i.test(category)) return 'shopping-bag';
  if (/transfer|bank|salary/i.test(category)) return 'landmark';
  return 'receipt-text';
}

function tableRows(rows, full = false) {
  if (!rows.length) return `<tr><td colspan="${full ? 5 : 4}" class="no-results">No transactions match this view.</td></tr>`;
  return rows.map(row => `<tr><td><div class="merchant-cell"><span class="merchant-icon"><i data-lucide="${categoryIcon(row.category)}"></i></span><div><span class="merchant-name" title="${escape(row.merchant)}">${escape(row.merchant)}</span><span class="merchant-note" title="${escape(row.note || row.account)}">${escape(row.future ? 'Future-dated transaction' : row.note || row.account)}</span></div></div></td><td><span class="category-tag" title="${escape(row.allocations.map(item => `${item.category}: ${money(item.amount)}`).join('; '))}">${escape(row.category)}</span></td>${full ? `<td>${escape(row.account)}</td>` : ''}<td>${shortDate(row.date)} ${row.date.getFullYear()}</td><td class="amount-cell"><span class="amount-value ${row.direction === 'credit' ? 'credit' : ''}">${row.direction === 'credit' ? '+' : '-'}${money(row.amount)}</span></td></tr>`).join('');
}

function periodDays() {
  const range = parseDateRange(state.reportStart, state.reportEnd);
  const today = new Date();
  const end = !state.includeFuture && range.endDate > today ? today : range.endDate;
  return end < range.startDate ? 1 : parseDateRange(state.reportStart, dateKey(end)).days;
}

function budgetMonth() {
  const { startDate, endDate } = parseDateRange(state.reportStart, state.reportEnd);
  return monthKey(startDate) === monthKey(endDate) && startDate.getDate() === 1 && endDate.getDate() === new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate() ? monthKey(startDate) : null;
}

function renderMerchants() {
  const search = $('merchant-search').value.toLowerCase().trim();
  const counts = new Map();
  baseRows().forEach(row => counts.set(row.merchant, (counts.get(row.merchant) || 0) + 1));
  const merchants = [...new Set([...counts.keys(), ...state.merchants])].filter(merchant => merchant.toLowerCase().includes(search)).sort((first, second) => first.localeCompare(second));
  const scroll = $('merchant-options').scrollTop;
  $('merchant-options').innerHTML = merchants.length ? merchants.map(merchant => `<label class="merchant-option"><input type="checkbox" value="${escape(merchant)}" ${state.merchants.includes(merchant) ? 'checked' : ''} /><span>${escape(merchant)}</span><small>${counts.get(merchant) || 0}</small></label>`).join('') : '<p class="merchant-no-results">No matching merchants in this period.</p>';
  $('merchant-options').scrollTop = scroll;
  $('merchant-selection-count').textContent = state.merchants.length ? `${state.merchants.length} selected` : 'All';
  $('merchant-clear').disabled = state.merchants.length === 0;
}

function renderCharts(rows, summary) {
  const buckets = new Map();
  const range = parseDateRange(state.reportStart, state.reportEnd);
  const monthly = state.trend === 'monthly' || range.days > 3660;
  const cursor = new Date(range.startDate);
  if (monthly) cursor.setDate(1);
  while (cursor <= range.endDate) {
    buckets.set(monthly ? monthKey(cursor) : dateKey(cursor), { spent: 0, received: 0 });
    if (monthly) cursor.setMonth(cursor.getMonth() + 1);
    else cursor.setDate(cursor.getDate() + 1);
  }
  document.querySelectorAll('[data-trend]').forEach(button => { const selected = button.dataset.trend === (monthly ? 'monthly' : 'daily'); button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); button.disabled = button.dataset.trend === 'daily' && range.days > 3660; });
  for (const row of [...rows].reverse()) {
    const key = monthly ? row.month : dateKey(row.date);
    if (!buckets.has(key)) buckets.set(key, { spent: 0, received: 0 });
    buckets.get(key)[row.direction === 'debit' ? 'spent' : 'received'] += row.amount;
  }
  const entries = [...buckets].sort((first, second) => first[0].localeCompare(second[0]));
  if (trendChart) trendChart.destroy();
  trendChart = new Chart($('trend-chart'), {
    type: 'line',
    data: { labels: entries.map(([label]) => monthly ? new Date(`${label}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : new Date(`${label}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(range.startDate.getFullYear() !== range.endDate.getFullYear() ? { year: '2-digit' } : {}) })), datasets: [
      { label: 'Spent', data: entries.map(([, value]) => value.spent), borderColor: '#719267', backgroundColor: '#8eac7220', fill: true, tension: .35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 },
      { label: 'Received', data: entries.map(([, value]) => value.received), borderColor: '#bac9af', backgroundColor: '#c3d3b510', fill: true, tension: .35, borderWidth: 1.5, borderDash: [4, 4], pointRadius: 0, pointHoverRadius: 4 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: item => `${item.dataset.label}: ${money(item.raw)}` } } }, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: '#a0aa97', font: { size: 9 }, maxTicksLimit: 10 } }, y: { beginAtZero: true, border: { display: false }, grid: { color: '#f0f3eb' }, ticks: { color: '#a0aa97', font: { size: 9 }, maxTicksLimit: 5, callback: value => money(value, true) } } } },
  });
  $('trend-subtitle').textContent = `${monthly ? 'Monthly' : 'Daily'} totals / ${state.reportStart} to ${state.reportEnd}`;
  $('trend-empty').hidden = rows.length > 0;
  const categories = summary.categories.slice(0, 5);
  if (summary.categories.length > 5) categories.push(['Other categories', summary.categories.slice(5).reduce((sum, [, amount]) => sum + amount, 0)]);
  if (categoryChart) categoryChart.destroy();
  categoryChart = new Chart($('category-chart'), {
    type: 'doughnut',
    data: { labels: categories.length ? categories.map(([name]) => name) : ['No expenses'], datasets: [{ data: categories.length ? categories.map(([, amount]) => amount) : [1], backgroundColor: categories.length ? palette : ['#eef2e9'], borderWidth: 4, borderColor: '#fff', borderRadius: 2, hoverOffset: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '78%', plugins: { legend: { display: false }, tooltip: { enabled: categories.length > 0, callbacks: { label: item => `${item.label}: ${money(item.raw)}` } } } },
  });
  $('donut-total').textContent = money(summary.spent, true);
  $('category-legend').innerHTML = categories.length ? categories.map(([name, amount], index) => `<div class="category-row"><span class="legend-dot" style="background:${palette[index]}"></span><span class="category-name" title="${escape(name)}">${escape(name)}</span><strong>${money(amount, true)}</strong><small>${Math.round(amount / summary.spent * 100)}%</small></div>`).join('') : '<p class="muted">No expenses in this period.</p>';
}

function renderInsights(rows, summary) {
  const insights = [];
  if (summary.categories.length) {
    const [category, amount] = summary.categories[0];
    insights.push(['shopping-basket', 'Your biggest spending area', `<strong>${escape(category)}</strong> accounts for <strong>${Math.round(amount / summary.spent * 100)}%</strong> of spending. A useful place to start your next family money conversation.`]);
  }
  const merchants = new Map();
  rows.filter(row => row.direction === 'debit').forEach(row => merchants.set(row.merchant, (merchants.get(row.merchant) || 0) + 1));
  const repeat = [...merchants].sort((first, second) => second[1] - first[1])[0];
  if (repeat) insights.push(['receipt-text', 'The everyday adds up', `<strong>${escape(repeat[0])}</strong> appears ${repeat[1]} ${repeat[1] === 1 ? 'time' : 'times'} in this period. Small, regular purchases are worth keeping in view.`]);
  if (state.budget && budgetMonth()) {
    const remaining = state.budget - summary.spent;
    insights.push(['heart-handshake', remaining >= 0 ? 'Room in the family budget' : 'Time for a budget check-in', remaining >= 0 ? `<strong>${money(remaining)}</strong> remains against your monthly target of ${money(state.budget)}.` : `Spending is <strong>${money(-remaining)}</strong> above your monthly target. A gentle reset can help.`]);
  } else insights.push(['notebook-pen', 'Give your next month a plan', 'Set a household budget to see how much room remains for the things your family values.']);
  $('insights').innerHTML = insights.map(([icon, title, text]) => `<div class="insight"><span class="insight-icon"><i data-lucide="${icon}"></i></span><div><h3>${title}</h3><p>${text}</p></div></div>`).join('');
}

function renderPlan(summary) {
  const monthly = budgetMonth();
  $('budget-input').value = state.budget || '';
  $('budget-period').textContent = monthly ? monthLabel(monthly) : `${state.reportStart} to ${state.reportEnd}`;
  const remaining = state.budget - summary.spent;
  $('budget-summary').innerHTML = !state.budget ? 'Your monthly budget has not been set yet.' : !monthly ? `Monthly target: <strong>${money(state.budget)}</strong><br>${money(summary.spent)} spent in the selected range. Select a full calendar month for a budget comparison.` : `<strong>${money(Math.abs(remaining))}</strong> ${remaining >= 0 ? 'left in your budget' : 'over your budget'}<br>${money(summary.spent)} spent of ${money(state.budget)}`;
  $('budget-progress-bar').style.width = state.budget && monthly ? `${Math.min(100, summary.spent / state.budget * 100)}%` : '0%';
  $('budget-progress-bar').style.background = remaining < 0 ? '#d99883' : '#84a66c';
  $('budget-note').textContent = state.budget ? 'This target applies to each month. It is saved on this device in the selected currency; changing currency relabels amounts, it does not convert them.' : 'Your target is saved on this device. Your transaction data is not stored.';
  $('budget-categories').innerHTML = summary.categories.length ? summary.categories.map(([category, amount]) => `<div class="budget-category"><span>${escape(category)}</span><div class="category-bar"><span style="width:${summary.spent ? amount / summary.spent * 100 : 0}%"></span></div><strong>${money(amount)}</strong></div>`).join('') : '<p class="muted">No expenses in this period.</p>';
}

function renderCategoryReport() {
  let report;
  try {
    report = currentReport();
  } catch (error) {
    $('report-error').textContent = error.message;
    $('report-error').hidden = false;
    $('report-content').hidden = true;
    $('export-button').disabled = true;
    $('report-range-note').textContent = '';
    return;
  }
  $('report-error').hidden = true;
  $('report-content').hidden = false;
  $('report-total').textContent = money(report.spent);
  $('report-count').textContent = `${report.count.toLocaleString()} expenses / ${report.categories.length} categories`;
  const top = report.categories[0];
  $('report-top-category').textContent = top?.name || 'No expenses';
  $('report-top-category-amount').textContent = top ? `${money(top.total)} / ${report.spent ? (top.total / report.spent * 100).toFixed(1) : 0}% of spending` : 'No recorded spending in this range';
  const peak = report.monthlyTotals.indexOf(Math.max(...report.monthlyTotals));
  $('report-top-month').textContent = report.spent ? monthLabel(report.months[peak]) : 'No expenses';
  $('report-top-month-amount').textContent = report.spent ? money(report.monthlyTotals[peak]) : 'No recorded spending in this range';
  $('report-table-subtitle').textContent = `${state.reportStart} to ${state.reportEnd} / ${state.account === 'all' ? 'All accounts' : state.account}`;
  $('report-table-head').innerHTML = `<tr><th scope="col">Category</th>${report.months.map(month => `<th scope="col">${escape(monthLabel(month))}</th>`).join('')}<th scope="col">Total</th><th scope="col" aria-sort="descending" title="Sorted by share, highest first">Share % <span aria-hidden="true">&#8595;</span></th></tr>`;
  $('report-table-body').innerHTML = report.categories.length ? report.categories.map(category => {
    const highest = Math.max(...category.values);
    return `<tr><th scope="row">${escape(category.name)}</th>${category.values.map((amount, index) => `<td style="background:rgba(111,145,96,${amount && highest ? (.04 + amount / highest * .17).toFixed(3) : 0})" title="${escape(`${category.name} / ${monthLabel(report.months[index])}: ${money(amount)}`)}">${amount ? money(amount) : '<span class="report-zero" aria-label="No recorded expenses">&mdash;</span>'}</td>`).join('')}<td class="report-row-total">${money(category.total)}</td><td>${report.spent ? (category.total / report.spent * 100).toFixed(1) : 0}%</td></tr>`;
  }).join('') : `<tr><td class="no-results" colspan="${report.months.length + 3}">No recorded expenses in this date range.</td></tr>`;
  $('report-table-foot').innerHTML = `<tr><th scope="row">Total spent</th>${report.monthlyTotals.map(amount => `<td>${money(amount)}</td>`).join('')}<td>${money(report.spent)}</td><td>${report.spent ? '100%' : '0%'}</td></tr>`;
  const drilling = state.drillCategory !== null;
  $('report-back').hidden = !drilling;
  $('report-chart-title').textContent = drilling ? `Top 15 expenses / ${state.drillCategory}` : 'Total spending by category';
  $('report-chart').setAttribute('aria-label', drilling ? `Largest individual expenses in ${state.drillCategory}, highest first` : 'Category spending totals and percentage of spending for the selected period');
  if (drilling) {
    const expenses = topCategoryExpenses(report, state.drillCategory);
    const total = report.categories.find(category => category.name === state.drillCategory)?.total || 0;
    const shown = expenses.reduce((sum, row) => sum + row.categoryAmount, 0);
    const count = report.expenses.filter(row => row.allocations.some(allocation => allocation.category === state.drillCategory)).length;
    $('report-chart-subtitle').textContent = `${money(total)} category total / ${expenses.length} of ${count} expenses / ${money(shown)} shown (${total ? (shown / total * 100).toFixed(1) : 0}%) / ${state.reportStart} to ${state.reportEnd}`;
    $('report-empty').hidden = expenses.length > 0;
    $('report-empty').textContent = 'No recorded expenses for this category in the selected range and account.';
    const largest = expenses[0]?.categoryAmount || 0;
    $('report-chart').innerHTML = expenses.map((row, index) => {
      const share = total ? row.categoryAmount / total * 100 : 0;
      const detail = [`${shortDate(row.date)} ${row.date.getFullYear()}`, row.account, row.note, row.categoryAmount !== row.amount ? `Category allocation of ${money(row.amount)} transaction` : ''].filter(Boolean).join(' / ');
      return `<div class="category-total-row expense-drill-row" role="listitem"><span class="category-total-name"><span class="expense-drill-merchant">${index + 1}. ${escape(row.merchant)}</span><small class="expense-drill-meta">${escape(detail)}</small></span><div class="category-total-track" aria-hidden="true"><span style="width:${largest ? (row.categoryAmount / largest * 100).toFixed(4) : 0}%"></span></div><strong class="category-total-amount">${money(row.categoryAmount)}</strong><span class="category-total-share" title="Share of this category's spending">${share.toFixed(1)}%<span class="sr-only"> of category spending</span></span></div>`;
    }).join('');
  } else {
    $('report-chart-subtitle').textContent = `${money(report.spent)} total / ${state.reportStart} to ${state.reportEnd}`;
    $('report-empty').hidden = report.count > 0;
    $('report-empty').textContent = 'No recorded expenses in this date range.';
    const largestTotal = report.categories[0]?.total || 0;
    $('report-chart').innerHTML = report.categories.map(category => {
      const share = report.spent ? category.total / report.spent * 100 : 0;
      const width = largestTotal ? category.total / largestTotal * 100 : 0;
      return `<div role="listitem"><button type="button" class="category-total-row category-drill-button" data-report-category="${escape(category.name)}" aria-label="View top 15 expenses in ${escape(category.name)}"><span class="category-total-name category-drill-label"><span>${escape(category.name)}</span><i data-lucide="chevron-right"></i></span><span class="category-total-track" aria-hidden="true"><span style="width:${width.toFixed(4)}%"></span></span><strong class="category-total-amount">${money(category.total)}</strong><span class="category-total-share">${share.toFixed(1)}%</span></button></div>`;
    }).join('');
  }
}

function render() {
  const hasData = state.transactions.length > 0;
  $('empty-state').hidden = hasData;
  $('dashboard-content').hidden = !hasData;
  $('export-button').disabled = !hasData;
  let range;
  try {
    range = parseDateRange(state.reportStart, state.reportEnd);
  } catch (error) {
    $('report-error').textContent = error.message;
    $('report-error').hidden = false;
    $('dashboard-content').hidden = true;
    $('export-button').disabled = true;
    $('report-range-note').textContent = '';
    icons();
    return;
  }
  $('report-error').hidden = true;
  $('report-range-note').textContent = `${range.days} calendar days / ${state.includeFuture ? 'Future dates included' : 'Future dates excluded'}`;
  if (!hasData) { icons(); return; }
  $('footer-status').textContent = `${state.transactions.length.toLocaleString()} transactions / ${state.includeFuture ? 'Future dates included' : 'Future dates excluded'}`;
  if (state.view === 'reports') {
    renderCategoryReport();
    icons();
    return;
  }
  const rows = state.view === 'transactions' ? visibleRows() : baseRows();
  const summary = summarize(rows);
  $('total-spent').textContent = money(summary.spent);
  $('total-received').textContent = money(summary.received);
  $('net-flow').textContent = money(summary.net);
  $('daily-average').textContent = money(summary.spent / periodDays());
  $('average-foot').textContent = `Across ${periodDays()} calendar days${!state.includeFuture && range.endDate > new Date() ? ' through today' : ''}`;
  $('received-foot').textContent = 'Credits, not necessarily household income';
  $('net-foot').textContent = 'Account activity, not a savings estimate';
  $('spent-comparison').textContent = 'Expenses in this period';
  {
    const previousEnd = new Date(range.startDate);
    previousEnd.setDate(previousEnd.getDate() - 1);
    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousStart.getDate() - periodDays() + 1);
    const previousRows = filterTransactions(state.transactions, { ...(state.view === 'transactions' ? state : {}), ...commonFilters(), start: dateKey(previousStart), end: dateKey(previousEnd) });
    const previousSpent = summarize(previousRows).spent;
    if (previousSpent) {
      const change = (summary.spent - previousSpent) / previousSpent * 100;
      $('spent-comparison').innerHTML = `<span class="${change <= 0 ? 'positive' : 'negative'}">${change > 0 ? '+' : ''}${change.toFixed(1)}%</span> vs previous ${periodDays()} days`;
    }
  }
  $('recent-body').innerHTML = tableRows(rows.slice(0, 5));
  const filtered = visibleRows();
  state.page = Math.min(state.page, Math.max(0, Math.ceil(filtered.length / 15) - 1));
  $('transactions-body').innerHTML = tableRows(filtered.slice(state.page * 15, state.page * 15 + 15), true);
  $('transaction-count').textContent = `${filtered.length.toLocaleString()} transactions / ${money(summarize(filtered).spent)} spent`;
  $('page-info').textContent = filtered.length ? `${state.page * 15 + 1}-${Math.min(filtered.length, state.page * 15 + 15)} of ${filtered.length.toLocaleString()}` : '0 transactions';
  $('previous-page').disabled = state.page === 0;
  $('next-page').disabled = (state.page + 1) * 15 >= filtered.length;
  if (state.view === 'transactions') renderMerchants();
  renderInsights(rows, summary);
  renderPlan(summary);
  if (state.view === 'overview') renderCharts(rows, summary);
  icons();
}

function setView(view) {
  state.view = ['overview', 'transactions', 'reports', 'plan'].includes(view) ? view : 'overview';
  $('merchant-menu').open = false;
  document.querySelector('#dashboard-content > .metrics').hidden = state.view === 'reports';
  document.querySelectorAll('.view').forEach(element => { element.hidden = element.id !== `${state.view}-view`; });
  document.querySelectorAll('[data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === state.view);
    if (button.dataset.view === state.view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
    button.title = button.textContent.trim();
    button.setAttribute('aria-label', button.textContent.trim());
  });
  const titles = { overview: ['Overview', 'Your family, in balance.', 'A clearer view of your money. More space for what matters.'], transactions: ['Transactions', 'Every little thing, accounted for.', 'The everyday purchases and bigger moments, all together.'], reports: ['Category report', 'A year of everyday life.', 'Where your money goes, across the months that make up your year.'], plan: ['Family budget', 'Make room for your kind of life.', 'A thoughtful monthly plan for the people who matter most.'] };
  $('breadcrumb-view').textContent = titles[state.view][0];
  $('page-title').textContent = titles[state.view][1];
  $('page-subtitle').textContent = titles[state.view][2];
  render();
}

function upload(file) {
  if (!file) return;
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { notice('Please choose an Excel (.xlsx, .xls) or CSV file.', true); return; }
  if (file.size > 30 * 1024 * 1024) { notice('Please choose a statement smaller than 30 MB.', true); return; }
  load(file.arrayBuffer(), file.name);
}

function exportReport() {
  const rows = state.view === 'transactions' ? visibleRows() : baseRows();
  const protect = value => /^[=+\-@\t\r]/.test(String(value)) ? `'${value}` : value;
  const csvCell = value => `"${String(protect(value)).replaceAll('"', '""')}"`;
  let records = [['Date', 'Merchant', 'Category', 'Account', 'Direction', 'Amount', 'Currency', 'Note', 'Allocations'], ...rows.map(row => [`${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, '0')}-${String(row.date.getDate()).padStart(2, '0')}`, row.merchant, row.category, row.account, row.direction, row.amount, state.currency, row.note, row.allocations.map(item => `${item.category}: ${item.amount}`).join('; ')])];
  if (state.view === 'reports') {
    const report = currentReport();
    records = [['Category', ...report.months, 'Total', 'Share (%)', 'Currency'], ...report.categories.map(category => [category.name, ...category.values.map(amount => amount.toFixed(2)), category.total.toFixed(2), report.spent ? (category.total / report.spent * 100).toFixed(2) : 0, state.currency]), ['Total spent', ...report.monthlyTotals.map(amount => amount.toFixed(2)), report.spent.toFixed(2), report.spent ? 100 : 0, state.currency]];
  }
  const blob = new Blob(['\ufeff' + records.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = state.view === 'reports' ? `kinfolk-categories-${state.reportStart}-to-${state.reportEnd}.csv` : `kinfolk-${state.reportStart}-to-${state.reportEnd}-report.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { location.hash = button.dataset.view; setView(button.dataset.view); }));
window.addEventListener('hashchange', () => setView(location.hash.slice(1)));
$('upload-button').addEventListener('click', () => $('file-input').click());
$('empty-upload').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', event => { upload(event.target.files[0]); event.target.value = ''; });
$('export-button').addEventListener('click', exportReport);
$('report-chart').addEventListener('click', event => {
  const button = event.target.closest('[data-report-category]');
  if (!button) return;
  state.drillCategory = button.dataset.reportCategory;
  render();
  $('report-chart-title').focus({ preventScroll: true });
  document.querySelector('.report-chart-panel').scrollIntoView({ block: 'start' });
});
$('report-back').addEventListener('click', () => {
  const previous = state.drillCategory;
  state.drillCategory = null;
  render();
  [...$('report-chart').querySelectorAll('[data-report-category]')].find(button => button.dataset.reportCategory === previous)?.focus();
});
$('report-year').addEventListener('change', event => {
  if (event.target.value === 'custom') return;
  state.reportStart = `${event.target.value}-01-01`;
  state.reportEnd = `${event.target.value}-12-31`;
  $('report-start').value = state.reportStart;
  $('report-end').value = state.reportEnd;
  state.page = 0;
  render();
});
for (const [id, key] of [['report-start', 'reportStart'], ['report-end', 'reportEnd']]) {
  $(id).addEventListener('change', event => {
    state[key] = event.target.value;
    state.page = 0;
    $('report-year').value = state.reportStart.slice(0, 4) === state.reportEnd.slice(0, 4) && state.reportStart.endsWith('-01-01') && state.reportEnd.endsWith('-12-31') && [...$('report-year').options].some(option => option.value === state.reportStart.slice(0, 4)) ? state.reportStart.slice(0, 4) : 'custom';
    render();
  });
}
$('view-all').addEventListener('click', () => { location.hash = 'transactions'; setView('transactions'); });
$('plan-button').addEventListener('click', () => { location.hash = 'plan'; setView('plan'); });
for (const [id, key] of [['account-filter', 'account'], ['category-filter', 'category'], ['direction-filter', 'direction']]) {
  $(id).addEventListener('change', event => { state[key] = event.target.value; state.page = 0; render(); });
}
$('search').addEventListener('input', event => { state.query = event.target.value; state.page = 0; render(); });
$('merchant-search').addEventListener('input', renderMerchants);
$('merchant-options').addEventListener('change', event => {
  const checkbox = event.target;
  if (!checkbox.matches('input[type="checkbox"]')) return;
  state.merchants = checkbox.checked ? [...new Set([...state.merchants, checkbox.value])] : state.merchants.filter(merchant => merchant !== checkbox.value);
  state.page = 0;
  const value = checkbox.value;
  render();
  [...$('merchant-options').querySelectorAll('input')].find(input => input.value === value)?.focus({ preventScroll: true });
});
$('merchant-clear').addEventListener('click', () => { state.merchants = []; state.page = 0; render(); });
$('merchant-menu').addEventListener('keydown', event => { if (event.key === 'Escape') { $('merchant-menu').open = false; $('merchant-menu').querySelector('summary').focus(); } });
document.addEventListener('click', event => { if (!$('merchant-menu').contains(event.target)) $('merchant-menu').open = false; });
$('future-toggle').addEventListener('change', event => { state.includeFuture = event.target.checked; state.page = 0; render(); });
$('currency').addEventListener('change', event => { state.currency = event.target.value; persist(); notice('Currency display updated. Amounts are relabeled, not converted using exchange rates.'); render(); });
$('previous-page').addEventListener('click', () => { state.page--; render(); });
$('next-page').addEventListener('click', () => { state.page++; render(); });
document.querySelectorAll('[data-trend]').forEach(button => button.addEventListener('click', () => {
  state.trend = button.dataset.trend;
  document.querySelectorAll('[data-trend]').forEach(item => { item.classList.toggle('selected', item === button); item.setAttribute('aria-pressed', String(item === button)); });
  render();
}));
$('budget-form').addEventListener('submit', event => {
  event.preventDefault();
  const value = Number($('budget-input').value);
  if (Number.isFinite(value) && value >= 0 && value <= 1e12) { state.budget = value; persist(); notice(value ? `Monthly household budget saved: ${money(value)}.` : 'Monthly budget cleared.'); render(); }
});
window.addEventListener('dragenter', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragDepth++; $('drop-overlay').hidden = false; } });
window.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
window.addEventListener('dragleave', event => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop-overlay').hidden = true; });
window.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true; upload(event.dataTransfer?.files[0]); });

Chart.defaults.font.family = 'DM Sans, sans-serif';
Chart.defaults.animation.duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450;
$('report-start').value = state.reportStart;
$('report-end').value = state.reportEnd;
reportYears();
setView(location.hash.slice(1));
if (import.meta.env.DEV) {
  const filename = 'tu-expense-2026-10-26.xlsx';
  load(fetch(`/${filename}`).then(response => { if (!response.ok) throw new Error('Choose a statement to begin.'); return response.arrayBuffer(); }), filename, true);
}