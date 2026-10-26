import * as XLSX from 'xlsx';

export function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    const parts = XLSX.SSF.parse_date_code(value);
    return parts ? new Date(parts.y, parts.m - 1, parts.d) : null;
  }
  const text = String(value ?? '').trim();
  const parts = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (parts) {
    const date = new Date(Number(parts[3]), Number(parts[2]) - 1, Number(parts[1]));
    return date.getDate() === Number(parts[1]) && date.getMonth() === Number(parts[2]) - 1 ? date : null;
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (!iso) return null;
  const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return date.getFullYear() === Number(iso[1]) && date.getMonth() === Number(iso[2]) - 1 && date.getDate() === Number(iso[3]) ? date : null;
}

export function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function parseWorkbook(buffer, now = new Date()) {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames.find(name => name.toLowerCase() === 'transactions') ?? workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  if (!rows.length) throw new Error('This sheet has no transactions. Choose a workbook with Date and Amount columns.');
  const headers = Object.keys(rows[0]);
  if (!headers.includes('Date') || !headers.includes('Amount')) throw new Error('The transaction sheet needs Date and Amount columns. Optional: Direction, Merchant, Category, Card / account, Note.');
  const splits = workbook.Sheets.Splits ? XLSX.utils.sheet_to_json(workbook.Sheets.Splits) : [];
  const splitMap = new Map();
  for (const split of splits) {
    const key = String(split.transaction_id);
    if (!splitMap.has(key)) splitMap.set(key, []);
    splitMap.get(key).push(split);
  }
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  let skipped = 0;
  let splitWarnings = 0;
  const transactions = [];
  rows.forEach((row, index) => {
    const date = parseDate(row.Date);
    const amount = typeof row.Amount === 'number' ? row.Amount : Number(String(row.Amount).replace(/[,₹$£€\s]/g, ''));
    const directionValue = String(row.Direction || '').trim().toLowerCase();
    if (!date || !Number.isFinite(amount) || row.Amount === '' || (directionValue && !['debit', 'credit', 'expense', 'income'].includes(directionValue))) { skipped++; return; }
    const direction = ['credit', 'income'].includes(directionValue) ? 'credit' : 'debit';
    const matchedSplits = splitMap.get(String(row.id)) ?? [];
    const splitTotal = matchedSplits.reduce((total, split) => total + Number(split.Amount), 0);
    const validSplits = matchedSplits.length && matchedSplits.every(split => Number.isFinite(Number(split.Amount)) && Number(split.Amount) >= 0) && Math.abs(splitTotal - Math.abs(amount)) < 0.01;
    if (matchedSplits.length && !validSplits) splitWarnings++;
    const allocations = validSplits ? matchedSplits.map(split => ({ category: String(split.Category || 'Uncategorized'), amount: Number(split.Amount) })) : [{ category: String(row.Category || 'Uncategorized'), amount: Math.abs(amount) }];
    transactions.push({
      id: `${row.id || index}-${index}`, date, month: monthKey(date), amount: Math.abs(amount), direction,
      merchant: String(row.Merchant || row.Description || 'Unknown merchant'),
      category: allocations.length > 1 ? 'Split transaction' : allocations[0].category,
      account: String(row['Card / account'] || row.Account || 'Not specified'), note: String(row.Note || ''),
      allocations, future: date > endOfToday,
    });
  });
  if (!transactions.length) throw new Error('No valid transactions found. Check dates, numeric amounts, and debit/credit directions.');
  transactions.sort((first, second) => second.date - first.date);
  return { transactions, skipped, splitWarnings, sheetName };
}

export function summarize(transactions) {
  const categories = new Map();
  let spent = 0;
  let received = 0;
  for (const transaction of transactions) {
    if (transaction.direction === 'credit') { received += transaction.amount; continue; }
    spent += transaction.amount;
    for (const allocation of transaction.allocations) categories.set(allocation.category, (categories.get(allocation.category) || 0) + allocation.amount);
  }
  return { spent, received, net: received - spent, categories: [...categories].sort((first, second) => second[1] - first[1]), count: transactions.length };
}

export function parseDateRange(start, end) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate || startDate > endDate) throw new RangeError('Choose a valid start date and an end date on or after it.');
  const endExclusive = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1);
  const days = Math.round((Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()) - Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())) / 86400000) + 1;
  return { startDate, endDate, endExclusive, days };
}

export function categoryReport(transactions, { start, end, account = 'all', includeFuture = false }) {
  const { startDate, endDate } = parseDateRange(start, end);
  const months = [];
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  while (cursor <= endDate) {
    months.push(monthKey(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const monthIndexes = new Map(months.map((month, index) => [month, index]));
  const rows = filterTransactions(transactions, { start, end, account, includeFuture, direction: 'debit' });
  const categories = new Map();
  const monthlyTotals = months.map(() => 0);
  for (const row of rows) {
    const index = monthIndexes.get(row.month);
    monthlyTotals[index] += row.amount;
    for (const allocation of row.allocations) {
      if (!categories.has(allocation.category)) categories.set(allocation.category, { name: allocation.category, values: months.map(() => 0), total: 0 });
      const category = categories.get(allocation.category);
      category.values[index] += allocation.amount;
      category.total += allocation.amount;
    }
  }
  return { months, monthlyTotals, categories: [...categories.values()].sort((first, second) => second.total - first.total || first.name.localeCompare(second.name)), spent: monthlyTotals.reduce((total, amount) => total + amount, 0), count: rows.length, expenses: rows };
}

export function topCategoryExpenses(report, category) {
  return report.expenses.filter(row => row.allocations.some(allocation => allocation.category === category)).map(row => ({ ...row, categoryAmount: row.allocations.filter(allocation => allocation.category === category).reduce((total, allocation) => total + allocation.amount, 0) })).sort((first, second) => second.categoryAmount - first.categoryAmount || second.date - first.date || first.id.localeCompare(second.id)).slice(0, 15);
}

export function filterTransactions(transactions, { month = 'all', category = 'all', account = 'all', query = '', includeFuture = false, direction = 'all', start, end, merchants = [] } = {}) {
  const search = query.toLowerCase().trim();
  const range = start !== undefined || end !== undefined ? parseDateRange(start, end) : null;
  const merchantSet = new Set(merchants);
  return transactions.filter(transaction => (!range || (transaction.date >= range.startDate && transaction.date < range.endExclusive)) && (!merchantSet.size || merchantSet.has(transaction.merchant)) && (includeFuture || !transaction.future) && (month === 'all' || transaction.month === month) && (category === 'all' || transaction.allocations.some(allocation => allocation.category === category)) && (account === 'all' || transaction.account === account) && (direction === 'all' || transaction.direction === direction) && (!search || `${transaction.merchant} ${transaction.category} ${transaction.note} ${transaction.account} ${transaction.allocations.map(allocation => allocation.category).join(' ')}`.toLowerCase().includes(search)));
}