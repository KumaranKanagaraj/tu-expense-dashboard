# Kinfolk - Family Expense Dashboard

A vanilla HTML, CSS, and JavaScript dashboard with local Excel/CSV import, Chart.js reports, transaction search, and a monthly household budget.

## Run

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. In development, the supplied `tu-expense-2026-10-26.xlsx` is opened automatically when present. Upload another statement with the upload button or drag and drop. Upload replaces the active dataset rather than merging it, avoiding duplicate imports.

```sh
npm test
npm run build
```

The production build is in `dist`. Serve that folder with a static web server. The production build does **not** include your workbook; choose a file to begin. Do not publish your project root or financial statements. The real-workbook integration test requires the original workbook in the project root.

## Workbook Format

The `Transactions` sheet (or the first sheet) needs `Date` and `Amount` headers. Optional headers: `Direction`, `Merchant` (or `Description`), `Category`, `Card / account` (or `Account`), `Note`, and `id`.

- Dates: Excel date cells, Excel serial dates, ISO dates (`YYYY-MM-DD`), or day-first `DD/MM/YYYY` dates.
- Direction: `debit` / `expense` or `credit` / `income`. Missing direction means expense. Amounts are treated as positive magnitudes; direction determines money in/out.
- Optional `Splits` sheet: `transaction_id`, `Category`, `Amount`. Valid split allocations must total the parent amount; mismatches retain the parent category and display a warning.
- Unknown directions, invalid amounts, and invalid dates are skipped with a visible warning.
- Future-dated transactions are excluded by default. Toggle them on when reviewing planned entries.

## Report Definitions

- **Shared dates:** Year, From, and To controls apply to Overview, Transactions, Category report, and Family budget. The inclusive range stays selected when switching pages. Invalid or incomplete dates hide stale results and disable export. The old month selector has been removed.
- **Total spent:** debit transactions in the selected date range/account. On Transactions, search, category, direction, and selected merchants also filter the summary cards.
- **Money received:** credits, which can include transfers, refunds, or reimbursements; not assumed to be earned income.
- **Net cash flow:** received minus spent. This is not a savings or account-balance calculation. Transfers are not automatically identified or excluded.
- **Daily average:** expenses divided by inclusive calendar days in the selected range, capped at today when future dates are excluded (minimum one day for future-only selections). Missing transactions cannot be inferred.
- **Period comparison:** selected spending versus the immediately preceding equal number of elapsed calendar days, using the same account and transaction filters. The overview chart supports daily or monthly totals across the range, including zero-filled periods; daily mode is unavailable for ranges longer than 3,660 days.
- **Family budget:** one user-defined monthly spending limit. Comparison is available when the selected range is one full calendar month. Other ranges show spending and the monthly target separately, without treating it as a multi-month or prorated budget. No budget is invented. Setting zero clears the target.
- **Merchant checkboxes:** on Transactions, open Merchants and select one or more exact merchant names. Checked names are combined with OR; date, account, search, category, and direction filters still apply. No selections means all merchants. Merchant search narrows checkbox choices, not transaction results. Selected merchants remain selected across date/account changes, even if they have no matching transactions. Clear selection restores all merchants. Counts beside merchants reflect the selected dates and account. Merchant selection affects transaction summary cards, pagination, and CSV export, but not other pages.
- **Category filter:** includes transactions with a matching split allocation; the transaction list and export retain the full parent transaction amount.
- **Currency selector:** changes formatting only. No currency conversion takes place; workbooks must use a single currency.
- **Category drill-down:** select a category bar to see its 15 largest individual expenses, sorted by the amount allocated to that category. Includes merchant, date, account, note, amount, and percentage of the category's total. Split transactions rank by the selected allocation, not the full parent amount. Date range, account, and future-date filters remain active. The summary states how much of the category total the displayed expenses cover. Use All categories to return; the monthly comparison table remains unchanged.
- **Category report:** uses the shared year or inclusive custom date range, including cross-year ranges. Each category has a column for every month, a range total, and a spending share. Split expenses use their category allocations. The horizontal chart shows every category's cumulative spending over the selected period, sorted by total, with its actual amount and percentage of total spending. Bar lengths are relative to the largest category. The monthly comparison table remains separate. Shared account and future-date filters apply. Missing months show no recorded expenses, not a guarantee of zero real-world spending. Partial boundary months include only selected dates. Export on this page downloads the category/month matrix for the selected range.
- **CSV export:** exports the selected date range/account, plus transaction search/category/direction/merchant filters when on the Transactions tab. Includes allocation detail and guards spreadsheet formula prefixes.

## Privacy

Transaction parsing happens in your browser. Transactions are not uploaded, persisted, or sent to a backend. Only budget and currency preferences are saved to this browser's local storage. Fonts load from Google Fonts, and the family photo loads from Unsplash; these external requests do not contain financial data. Dependencies are bundled locally. Financial workbook files are excluded from Git and the production bundle.