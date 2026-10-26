import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { parseWorkbook, parseDate, summarize, filterTransactions, categoryReport, topCategoryExpenses, parseDateRange } from './data.js';

function workbook(rows, splits = []) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Transactions');
  if (splits.length) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(splits), 'Splits');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

test('separates debit and credit, skips bad rows, and excludes future entries', () => {
  const result = parseWorkbook(workbook([
    { Date: '2026-10-01', Amount: 100, Direction: 'debit', Category: 'Grocery' },
    { Date: '2026-10-02', Amount: 500, Direction: 'credit' },
    { Date: '2026-12-01', Amount: 30, Direction: 'debit' },
    { Date: 'bad', Amount: 50, Direction: 'debit' },
    { Date: '2026-10-01', Amount: 50, Direction: 'unknown' },
  ]), new Date(2026, 9, 26));
  assert.equal(result.skipped, 2);
  assert.equal(summarize(filterTransactions(result.transactions)).spent, 100);
  assert.equal(summarize(filterTransactions(result.transactions)).received, 500);
  assert.equal(summarize(result.transactions).spent, 130);
});

test('split allocations preserve parent total and category search finds allocations', () => {
  const result = parseWorkbook(workbook([{ id: 1, Date: '2026-10-01', Amount: 100, Direction: 'debit' }], [
    { transaction_id: 1, Category: 'Grocery', Amount: 60 }, { transaction_id: 1, Category: 'Fuel', Amount: 40 },
  ]));
  assert.deepEqual(summarize(result.transactions).categories, [['Grocery', 60], ['Fuel', 40]]);
  assert.equal(filterTransactions(result.transactions, { category: 'Fuel' }).length, 1);
});

test('invalid splits fall back to parent category', () => {
  const result = parseWorkbook(workbook([{ id: 1, Date: '2026-10-01', Amount: 100, Category: 'Grocery' }], [{ transaction_id: 1, Category: 'Fuel', Amount: 200 }]));
  assert.equal(result.splitWarnings, 1);
  assert.deepEqual(summarize(result.transactions).categories, [['Grocery', 100]]);
});

test('accepts Excel and day-first dates and rejects invalid dates', () => {
  assert.equal(parseDate(46320).getFullYear(), 2026);
  assert.equal(parseDate('26/10/2026').getMonth(), 9);
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseDate('2026-02-31'), null);
});

test('real workbook matches independent raw debit and credit totals', async () => {
  const bytes = await readFile(new URL('./tu-expense-2026-10-26.xlsx', import.meta.url));
  const result = parseWorkbook(bytes, new Date(2026, 9, 26));
  const raw = XLSX.utils.sheet_to_json(XLSX.read(bytes).Sheets.Transactions);
  const totals = summarize(result.transactions);
  const debit = raw.filter(row => row.Direction === 'debit').reduce((total, row) => total + Math.abs(row.Amount), 0);
  const credit = raw.filter(row => row.Direction === 'credit').reduce((total, row) => total + Math.abs(row.Amount), 0);
  assert.equal(result.transactions.length, raw.length);
  assert.ok(Math.abs(totals.spent - debit) < 0.01);
  assert.ok(Math.abs(totals.received - credit) < 0.01);
  assert.ok(Math.abs(totals.categories.reduce((total, entry) => total + entry[1], 0) - totals.spent) < 0.01);
  const report = categoryReport(result.transactions, { start: '2026-01-01', end: '2026-12-31', includeFuture: true });
  const yearDebit = raw.filter(row => row.Direction === 'debit' && parseDate(row.Date)?.getFullYear() === 2026).reduce((total, row) => total + Math.abs(row.Amount), 0);
  assert.equal(report.months.length, 12);
  assert.ok(Math.abs(report.spent - yearDebit) < 0.01);
  assert.ok(Math.abs(report.categories.reduce((total, category) => total + category.total, 0) - yearDebit) < 0.01);
  console.log(JSON.stringify({ rows: totals.count, spent: totals.spent, received: totals.received, future: result.transactions.filter(row => row.future).length, skipped: result.skipped }));
});

test('category report uses inclusive partial dates across years, allocations, and zero-filled months', () => {
  const result = parseWorkbook(workbook([
    { id: 1, Date: '2025-12-14', Amount: 999, Direction: 'debit', Category: 'Outside' },
    { id: 2, Date: '2025-12-15', Amount: 100, Direction: 'debit', Category: 'Grocery' },
    { id: 3, Date: '2026-02-10', Amount: 80, Direction: 'debit', Category: 'Split' },
    { id: 4, Date: '2026-02-10', Amount: 500, Direction: 'credit', Category: 'Grocery' },
    { id: 5, Date: '2026-02-11', Amount: 999, Direction: 'debit', Category: 'Outside' },
  ], [{ transaction_id: 3, Category: 'Grocery', Amount: 30 }, { transaction_id: 3, Category: 'Fuel', Amount: 50 }]));
  result.transactions.find(row => row.merchant === 'Unknown merchant' && row.amount === 80).date.setHours(23, 59, 59);
  const report = categoryReport(result.transactions, { start: '2025-12-15', end: '2026-02-10' });
  assert.deepEqual(report.months, ['2025-12', '2026-01', '2026-02']);
  assert.deepEqual(report.monthlyTotals, [100, 0, 80]);
  assert.equal(report.spent, 180);
  assert.equal(report.count, 2);
  assert.deepEqual(report.categories, [{ name: 'Grocery', values: [100, 0, 30], total: 130 }, { name: 'Fuel', values: [0, 0, 50], total: 50 }]);
});

test('category report always sorts by share descending after date and account changes', () => {
  const result = parseWorkbook(workbook([
    { Date: '2026-01-01', Amount: 10, Account: 'A', Category: 'Grocery' },
    { Date: '2026-01-02', Amount: 10, Account: 'A', Category: 'Fuel' },
    { Date: '2026-01-03', Amount: 30, Account: 'A', Category: 'Health' },
    { Date: '2026-01-04', Amount: 80, Account: 'A', Category: 'Bills' },
    { Date: '2026-02-01', Amount: 200, Account: 'B', Category: 'Grocery' },
  ]));
  const range = { start: '2026-01-01', end: '2026-12-31' };
  for (const filters of [range, { ...range, end: '2026-01-31' }, { ...range, account: 'A' }, { ...range, account: 'B' }]) {
    const report = categoryReport(result.transactions, filters);
    const shares = report.categories.map(category => category.total / report.spent * 100);
    assert.deepEqual(shares, [...shares].sort((first, second) => second - first));
  }
  assert.deepEqual(categoryReport(result.transactions, range).categories.map(category => category.name), ['Grocery', 'Bills', 'Health', 'Fuel']);
  assert.deepEqual(categoryReport(result.transactions, { ...range, account: 'A' }).categories.map(category => category.name), ['Bills', 'Health', 'Fuel', 'Grocery']);
});

test('category drill-down ranks the top 15 individual expenses by allocated amount within the report filters', () => {
  const result = parseWorkbook(workbook([
    ...Array.from({ length: 20 }, (unused, index) => ({ id: index + 1, Date: '2026-01-01', Amount: index + 1, Account: 'A', Category: 'Grocery', Merchant: `Shop ${index + 1}` })),
    { id: 21, Date: '2026-01-02', Amount: 1000, Account: 'A', Category: 'Split', Merchant: 'Split shop' },
    { id: 22, Date: '2026-01-02', Amount: 30, Account: 'A', Category: 'Grocery', Merchant: 'Largest grocery' },
    { id: 23, Date: '2026-01-02', Amount: 2000, Account: 'A', Category: 'Grocery', Direction: 'credit' },
    { id: 24, Date: '2026-01-03', Amount: 3000, Account: 'A', Category: 'Grocery' },
    { id: 25, Date: '2026-01-02', Amount: 4000, Account: 'B', Category: 'Grocery' },
  ], [{ transaction_id: 21, Category: 'Grocery', Amount: 2 }, { transaction_id: 21, Category: 'Fuel', Amount: 998 }]));
  const range = { start: '2026-01-01', end: '2026-01-02', account: 'A' };
  const report = categoryReport(result.transactions, range);
  const top = topCategoryExpenses(report, 'Grocery');
  assert.equal(top.length, 15);
  assert.deepEqual(top.map(row => row.categoryAmount), [30, ...Array.from({ length: 14 }, (unused, index) => 20 - index)]);
  assert.equal(topCategoryExpenses(report, 'Fuel')[0].categoryAmount, 998);
  assert.equal(topCategoryExpenses(categoryReport(result.transactions, { ...range, start: '2026-01-02' }), 'Grocery')[1].categoryAmount, 2);
  assert.deepEqual(topCategoryExpenses(report, 'Missing'), []);
  assert.ok(top.reduce((total, row) => total + row.categoryAmount, 0) <= report.categories.find(category => category.name === 'Grocery').total);
});

test('shared date range and merchant checkboxes combine inclusively with other transaction filters', () => {
  const result = parseWorkbook(workbook([
    { Date: '2025-12-31', Amount: 10, Merchant: 'Shop A', Account: 'A', Category: 'Grocery' },
    { Date: '2026-01-01', Amount: 20, Merchant: 'Shop A', Account: 'A', Category: 'Grocery' },
    { Date: '2026-01-02', Amount: 30, Merchant: 'Shop B', Account: 'A', Category: 'Grocery' },
    { Date: '2026-01-02', Amount: 40, Merchant: 'Shop A branch', Account: 'A', Category: 'Grocery' },
    { Date: '2026-01-02', Amount: 50, Merchant: 'Shop A', Account: 'B', Category: 'Grocery' },
    { Date: '2026-01-02', Amount: 60, Merchant: 'Shop A', Account: 'A', Category: 'Fuel' },
    { Date: '2026-01-02', Amount: 70, Merchant: 'Shop A', Account: 'A', Category: 'Grocery', Direction: 'credit' },
    { Date: '2026-01-03', Amount: 80, Merchant: 'Shop A', Account: 'A', Category: 'Grocery' },
    { Date: '2026-12-01', Amount: 90, Merchant: 'Shop A', Account: 'A', Category: 'Grocery' },
  ]), new Date(2026, 9, 26));
  result.transactions.find(row => row.amount === 30).date.setHours(23, 59, 59);
  const filters = { start: '2026-01-01', end: '2026-01-02', account: 'A', category: 'Grocery', direction: 'debit', merchants: ['Shop A', 'Shop B'] };
  assert.deepEqual(filterTransactions(result.transactions, filters).map(row => row.amount).sort((first, second) => first - second), [20, 30]);
  assert.equal(summarize(filterTransactions(result.transactions, { ...filters, merchants: ['Shop A'] })).spent, 20);
  assert.equal(summarize(filterTransactions(result.transactions, { ...filters, merchants: [] })).spent, 90);
  assert.equal(filterTransactions(result.transactions, { ...filters, query: 'Shop B' }).length, 1);
  assert.equal(filterTransactions(result.transactions, { ...filters, merchants: ['Missing'] }).length, 0);
  assert.equal(filterTransactions(result.transactions, { start: '2026-12-01', end: '2026-12-01' }).length, 0);
  assert.equal(filterTransactions(result.transactions, { start: '2026-12-01', end: '2026-12-01', includeFuture: true }).length, 1);
  assert.equal(parseDateRange('2024-02-28', '2024-03-01').days, 3);
  assert.throws(() => filterTransactions(result.transactions, { start: '2026-02-01', end: '2026-01-01' }), RangeError);
});

test('category report respects accounts, future dates, empty ranges, and rejects invalid ranges', () => {
  const result = parseWorkbook(workbook([
    { Date: '2026-10-01', Amount: 100, Account: 'A', Category: 'Grocery' },
    { Date: '2026-10-02', Amount: 50, Account: 'B', Category: 'Fuel' },
    { Date: '2026-12-01', Amount: 30, Account: 'A', Category: 'Grocery' },
  ]), new Date(2026, 9, 26));
  const range = { start: '2026-01-01', end: '2026-12-31', account: 'A' };
  assert.equal(categoryReport(result.transactions, range).spent, 100);
  assert.equal(categoryReport(result.transactions, { ...range, includeFuture: true }).spent, 130);
  assert.deepEqual(categoryReport(result.transactions, { start: '2024-01-01', end: '2024-02-29' }).monthlyTotals, [0, 0]);
  assert.throws(() => categoryReport(result.transactions, { start: '2026-10-02', end: '2026-10-01' }), RangeError);
  assert.throws(() => categoryReport(result.transactions, { start: '', end: '2026-10-01' }), RangeError);
});