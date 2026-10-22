import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, BarChart3, Bell, Boxes,
  BriefcaseBusiness, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp,
  Clock3, CloudUpload, Database, Download, FileSpreadsheet, FileText, Filter, Gauge, Home,
  Layers3, ListFilter, LoaderCircle, Menu, MoreHorizontal, Package, Plus, RefreshCw, Search,
  Settings2, ShieldCheck, ShoppingBag, Sparkles, TrendingDown, TrendingUp, Upload, Users,
  WalletCards, X, Zap,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  API_BASE, buildExportUrl, deleteDataset, errorMessage, fetchDashboard, fetchDatasets,
  fetchRecords, importFile, previewFile,
} from './api';

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: Home, group: 'WORKSPACE' },
  { id: 'explorer', label: 'Sales explorer', icon: ListFilter, group: 'WORKSPACE' },
  { id: 'insights', label: 'Business notes', icon: BriefcaseBusiness, group: 'WORKSPACE' },
  { id: 'import', label: 'Import data', icon: CloudUpload, group: 'DATA TOOLS' },
  { id: 'library', label: 'Data library', icon: Database, group: 'DATA TOOLS' },
];
const COLORS = ['#36594a', '#d87657', '#6e8eb9', '#d3a956', '#8ca79b', '#7c748e'];
const FIELD_META = [
  ['date', 'Order date', true], ['revenue', 'Sales / revenue', false], ['quantity', 'Quantity', false],
  ['unit_price', 'Unit price', false], ['profit', 'Profit', false], ['cost', 'Cost / COGS', false],
  ['discount', 'Discount', false], ['order_id', 'Order ID', false], ['customer', 'Customer', false],
  ['product', 'Product', false], ['category', 'Category', false], ['region', 'Region / state', false],
  ['channel', 'Sales channel', false],
];

const defaultFilters = { date_from: '', date_to: '', category: 'All', region: 'All', channel: 'All' };

function cx(...values) { return values.filter(Boolean).join(' '); }
function formatNumber(value, fraction = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: fraction, minimumFractionDigits: fraction }).format(Number(value));
}
function formatCurrency(value, currency = 'INR', compact = false) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency', currency: currency || 'INR', maximumFractionDigits: compact ? 1 : 0,
      notation: compact && Math.abs(Number(value)) >= 100000 ? 'compact' : 'standard',
    }).format(Number(value));
  } catch {
    return `${currency || 'INR'} ${formatNumber(value)}`;
  }
}
function formatPercent(value, decimals = 1) {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : `${Number(value).toFixed(decimals)}%`;
}
function shortDate(value) {
  if (!value) return '—';
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.valueOf()) ? String(value) : new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
}
function dateRangeText(dataset, filters) {
  if (filters.date_from || filters.date_to) return `${shortDate(filters.date_from || dataset?.date_min)} — ${shortDate(filters.date_to || dataset?.date_max)}`;
  return `${shortDate(dataset?.date_min)} — ${shortDate(dataset?.date_max)}`;
}
function dateStamp() {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
}

function App() {
  const [datasets, setDatasets] = useState([]);
  const [datasetId, setDatasetId] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [activePage, setActivePage] = useState('overview');
  const [filters, setFilters] = useState(defaultFilters);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const notify = useCallback((message, tone = 'success') => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 4200);
  }, []);

  const loadDatasets = useCallback(async () => {
    try {
      const list = await fetchDatasets();
      setDatasets(list);
      setDatasetId((current) => {
        if (current && list.some((item) => String(item.id) === String(current))) return String(current);
        const remembered = window.localStorage.getItem('commerce-ledger-dataset');
        if (remembered && list.some((item) => String(item.id) === remembered)) return remembered;
        const demo = list.find((item) => item.is_demo);
        return String(demo?.id ?? list[0]?.id ?? '');
      });
      setPageError('');
      return list;
    } catch (error) {
      setPageError(`The API could not be reached at ${API_BASE}. Start the backend, then refresh this page. (${errorMessage(error)})`);
      return [];
    }
  }, []);

  useEffect(() => { loadDatasets().then((list) => { if (!list.length) setLoading(false); }); }, [loadDatasets]);

  const selectedDataset = useMemo(() => datasets.find((item) => String(item.id) === String(datasetId)), [datasets, datasetId]);

  useEffect(() => {
    if (datasetId) window.localStorage.setItem('commerce-ledger-dataset', String(datasetId));
  }, [datasetId]);

  useEffect(() => {
    if (!selectedDataset) return;
    setFilters((current) => ({
      ...current,
      date_from: selectedDataset.date_min || '',
      date_to: selectedDataset.date_max || '',
      category: 'All', region: 'All', channel: 'All',
    }));
  }, [datasetId]);

  useEffect(() => {
    if (!datasetId) return;
    let cancelled = false;
    const load = async () => {
      setRefreshing(true);
      try {
        const result = await fetchDashboard(datasetId, filters);
        if (!cancelled) { setDashboard(result); setPageError(''); }
      } catch (error) {
        if (!cancelled) setPageError(errorMessage(error));
      } finally {
        if (!cancelled) { setRefreshing(false); setLoading(false); }
      }
    };
    const timer = window.setTimeout(load, 140);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [datasetId, filters]);

  const goTo = (page) => { setActivePage(page); setMobileNavOpen(false); };
  const onDatasetChange = (value) => { setDatasetId(value); };
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const clearFilters = () => setFilters({ date_from: selectedDataset?.date_min || '', date_to: selectedDataset?.date_max || '', category: 'All', region: 'All', channel: 'All' });

  async function handleDatasetDelete(id) {
    try {
      await deleteDataset(id);
      notify('Dataset and its records were removed.');
      const list = await loadDatasets();
      if (String(datasetId) === String(id)) {
        const demo = list.find((item) => item.is_demo) || list[0];
        setDatasetId(String(demo?.id || ''));
        goTo('overview');
      }
    } catch (error) { notify(errorMessage(error), 'error'); }
  }

  const contentTitle = {
    overview: ['Overview', 'A clear read on sales performance.'],
    explorer: ['Sales explorer', 'Find the pattern in the order-level detail.'],
    insights: ['Business notes', 'A few signals worth bringing to the next review.'],
    import: ['Bring your data in', 'Upload a sales export, check its columns, then submit it for analysis.'],
    library: ['Data library', 'Keep demo and uploaded datasets in one tidy place.'],
  }[activePage] || ['Overview', 'A clear read on sales performance.'];

  return (
    <div className="app-shell">
      <aside className={cx('sidebar', mobileNavOpen && 'sidebar-open')}>
        <div className="brand-lockup">
          <div className="brand-mark"><span className="mark-bar bar-a"/><span className="mark-bar bar-b"/><span className="mark-bar bar-c"/></div>
          <div><div className="brand-name">commerce<span>ledger</span></div><div className="brand-caption">SALES & BUSINESS INTELLIGENCE</div></div>
          <button className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X size={17}/></button>
        </div>
        <div className="workspace-switcher">
          <div className="workspace-avatar">CL</div>
          <div className="workspace-copy"><strong>Commerce workspace</strong><span>Personal analysis</span></div>
          <ChevronDown size={15} className="muted-icon"/>
        </div>
        {['WORKSPACE', 'DATA TOOLS'].map((group) => (
          <nav className="nav-group" key={group} aria-label={group}>
            <div className="nav-label">{group}</div>
            {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
              const Icon = item.icon;
              return <button key={item.id} className={cx('nav-item', activePage === item.id && 'active')} onClick={() => goTo(item.id)}>
                <Icon size={17} strokeWidth={1.85}/><span>{item.label}</span>{item.id === 'import' && <span className="nav-plus"><Plus size={13}/></span>}
              </button>;
            })}
          </nav>
        ))}
        <div className="sidebar-bottom">
          <div className="source-card">
            <div className="source-icon"><Database size={16}/></div>
            <div className="source-copy"><strong>Current data</strong><span>{selectedDataset ? selectedDataset.name : 'Connecting…'}</span></div>
            <span className={cx('source-dot', selectedDataset ? 'dot-live' : '')}/>
          </div>
          <div className="sidebar-help"><CircleHelp size={15}/><span>Built for analysts and decision-makers</span></div>
          <div className="sidebar-footnote">COMMERCE LEDGER <span>·</span> LOCAL WORKSPACE</div>
        </div>
      </aside>
      {mobileNavOpen && <button className="nav-scrim" aria-label="Close navigation overlay" onClick={() => setMobileNavOpen(false)}/>}

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>Commerce Ledger</span><span className="crumb-slash">/</span><strong>{contentTitle[0]}</strong></div>
          <div className="topbar-actions">
            <div className="date-stamp"><CalendarDays size={14}/>{dateStamp()}</div>
            <div className={cx("api-status", pageError && "api-status-offline")}><span className="status-dot"/>{pageError ? "API unavailable" : "API connected"}</div>
            <button className="avatar-button" title="Local workspace">N</button>
            <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu size={19}/></button>
          </div>
        </header>

        <div className="page-content">
          {pageError && <div className="alert alert-error"><CircleHelp size={17}/><div><strong>Something needs attention</strong><span>{pageError}</span></div><button className="text-button" onClick={() => window.location.reload()}>Retry</button></div>}
          {activePage !== 'import' && activePage !== 'library' && (
            <div className="page-heading-row">
              <div><div className="eyebrow"><span className="eyebrow-line"/> BUSINESS PERFORMANCE <span className="eyebrow-dot">/</span> {activePage.toUpperCase()}</div><h1>{contentTitle[1]}</h1><p className="page-subtitle">{selectedDataset ? <>{selectedDataset.is_demo ? 'A sample view' : 'Your uploaded data'} · {dateRangeText(selectedDataset, filters)} · {formatNumber(dashboard?.summary?.records ?? selectedDataset.row_count)} rows in view</> : 'Loading your workspace…'}</p></div>
              <div className="heading-actions"><button className="button button-secondary" onClick={() => goTo('import')}><Upload size={15}/> Import data</button><button className="button button-primary" onClick={() => window.location.href = buildExportUrl('/api/export/summary.csv', { dataset_id: datasetId, ...filters })} disabled={!dashboard}><Download size={15}/> Export summary</button></div>
            </div>
          )}
          {activePage === 'import' && <ImportPage onImported={async (result) => { notify(result.message || 'Your data is ready.'); const list = await loadDatasets(); setDatasets(list); setDatasetId(String(result.dataset.id)); setActivePage('overview'); setMobileNavOpen(false); }} notify={notify}/>}
          {activePage === 'library' && <LibraryPage datasets={datasets} selectedId={datasetId} onSelect={(id) => { onDatasetChange(String(id)); goTo('overview'); }} onDelete={handleDatasetDelete} onGoImport={() => goTo('import')} notify={notify}/>}
          {activePage === 'overview' && <>
            <FilterBar filters={filters} options={dashboard?.options} updateFilter={updateFilter} clearFilters={clearFilters} loading={refreshing}/>
            {loading && !dashboard ? <LoadingState/> : dashboard ? <OverviewPage dashboard={dashboard} selectedDataset={selectedDataset} filters={filters} onExplore={() => goTo('explorer')} onViewInsights={() => goTo('insights')}/> : <EmptyState title="No dataset to show" copy="Import a sales file or use the built-in demo data to get started." action="Import data" onAction={() => goTo('import')}/>}
          </>}
          {activePage === 'explorer' && <>
            <FilterBar filters={filters} options={dashboard?.options} updateFilter={updateFilter} clearFilters={clearFilters} loading={refreshing}/>
            <ExplorerPage datasetId={datasetId} filters={filters} currency={selectedDataset?.currency || 'INR'} notify={notify}/>
          </>}
          {activePage === 'insights' && <>
            <FilterBar filters={filters} options={dashboard?.options} updateFilter={updateFilter} clearFilters={clearFilters} loading={refreshing}/>
            {dashboard && <InsightsPage dashboard={dashboard} currency={selectedDataset?.currency || 'INR'}/>}
          </>}
        </div>
        <footer className="app-footer"><div><span className="footer-mark">CL</span> Commerce Ledger <span className="footer-sep">/</span> A practical portfolio project</div><div>CSV & Excel · SQLite · FastAPI</div></footer>
      </main>
      {toast && <div className={cx('toast', toast.tone === 'error' && 'toast-error')} role="status"><span className="toast-icon">{toast.tone === 'error' ? <X size={15}/> : <Check size={15}/>}</span>{toast.message}<button onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={14}/></button></div>}
    </div>
  );
}

function FilterBar({ filters, options, updateFilter, clearFilters, loading }) {
  const categoryOptions = options?.categories || [];
  const regionOptions = options?.regions || [];
  const channelOptions = options?.channels || [];
  return <div className="filter-bar">
    <div className="filter-heading"><Filter size={15}/><span>Refine view</span>{loading && <LoaderCircle className="spin" size={14}/>}</div>
    <div className="filter-controls">
      <label className="filter-field date-filter"><span>From</span><input aria-label="Start date" type="date" value={filters.date_from || ''} onChange={(e) => updateFilter('date_from', e.target.value)} /></label>
      <label className="filter-field date-filter"><span>To</span><input aria-label="End date" type="date" value={filters.date_to || ''} onChange={(e) => updateFilter('date_to', e.target.value)} /></label>
      <label className="filter-field"><span>Category</span><select value={filters.category} onChange={(e) => updateFilter('category', e.target.value)}><option>All</option>{categoryOptions.map((v) => <option key={v}>{v}</option>)}</select></label>
      <label className="filter-field"><span>Region</span><select value={filters.region} onChange={(e) => updateFilter('region', e.target.value)}><option>All</option>{regionOptions.map((v) => <option key={v}>{v}</option>)}</select></label>
      <label className="filter-field"><span>Channel</span><select value={filters.channel} onChange={(e) => updateFilter('channel', e.target.value)}><option>All</option>{channelOptions.map((v) => <option key={v}>{v}</option>)}</select></label>
      <button className="clear-filters" onClick={clearFilters}><RefreshCw size={13}/> Reset</button>
    </div>
  </div>;
}

function OverviewPage({ dashboard, selectedDataset, filters, onExplore, onViewInsights }) {
  const summary = dashboard.summary;
  const currency = selectedDataset?.currency || 'INR';
  const isProfitKnown = summary.profit !== null;
  const kpis = [
    { label: 'Sales revenue', value: formatCurrency(summary.revenue, currency, true), sub: `${formatNumber(summary.records)} order lines`, icon: WalletCards, tint: 'sage', foot: 'Revenue in current view' },
    { label: 'Net profit', value: isProfitKnown ? formatCurrency(summary.profit, currency, true) : 'Not available', sub: isProfitKnown ? `${formatPercent(summary.margin)} margin` : 'Add profit or cost data', icon: TrendingUp, tint: 'peach', foot: 'After recorded costs' },
    { label: 'Orders', value: formatNumber(summary.orders), sub: `${formatNumber(summary.units)} units`, icon: ShoppingBag, tint: 'blue', foot: 'Distinct order IDs where available' },
    { label: 'Average order value', value: formatCurrency(summary.aov, currency), sub: summary.revenue_change === null ? 'Period comparison unavailable' : `${summary.revenue_change >= 0 ? '+' : ''}${summary.revenue_change}% last-month change`, icon: Gauge, tint: 'gold', foot: 'Sales divided by order count' },
  ];
  const trend = dashboard.trend || [];
  return <div className="content-stack">
    {selectedDataset?.is_demo && <div className="demo-note"><Sparkles size={15}/><span><strong>Sample workspace.</strong> These figures are synthetic and are here to show how the dashboard works. Import your own export to analyse actual sales.</span><button onClick={() => window.location.href = buildExportUrl('/api/export.csv', { dataset_id: selectedDataset.id, ...filters })}>Download sample <ArrowRight size={13}/></button></div>}
    <section className="kpi-grid" aria-label="Sales key performance indicators">
      {kpis.map(({ label, value, sub, icon: Icon, tint, foot }, index) => <article className={cx('kpi-card', `kpi-${tint}`)} key={label}>
        <div className="kpi-top"><span className="kpi-label">{label}</span><span className="kpi-icon"><Icon size={17} strokeWidth={1.8}/></span></div>
        <div className="kpi-value">{value}</div><div className="kpi-sub">{sub}</div><div className="kpi-foot"><span className="kpi-foot-dot"/>{foot}</div>
      </article>)}
    </section>

    <section className="analytics-grid">
      <article className="panel trend-panel">
        <PanelHeading eyebrow="PERFORMANCE OVER TIME" title="Sales, month by month" subtitle="A closer look at the shape of demand." trailing={<span className="unit-label">{currency}</span>}/>
        {trend.length ? <div className="chart-wrap trend-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 8, right: 8, left: -8, bottom: 2 }}>
          <defs><linearGradient id="salesWash" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#537b68" stopOpacity={0.23}/><stop offset="95%" stopColor="#537b68" stopOpacity={0.015}/></linearGradient></defs>
          <CartesianGrid stroke="#eae8e1" strokeDasharray="3 4" vertical={false}/><XAxis dataKey="period" axisLine={false} tickLine={false} tick={{ fill: '#858982', fontSize: 11 }} dy={9}/><YAxis axisLine={false} tickLine={false} tick={{ fill: '#858982', fontSize: 11 }} tickFormatter={(value) => value >= 100000 ? `${(value / 100000).toFixed(1)}L` : value >= 1000 ? `${Math.round(value / 1000)}k` : value} width={43}/><Tooltip content={<ChartTooltip currency={currency} />}/>
          <Area type="monotone" dataKey="revenue" name="Sales" stroke="#36594a" strokeWidth={2.5} fill="url(#salesWash)" activeDot={{ r: 4, strokeWidth: 0 }}/>
          {summary.profit !== null && <Line type="monotone" dataKey="profit" name="Profit" stroke="#d87657" strokeWidth={1.8} dot={false} activeDot={{ r: 3 }}/>} 
        </AreaChart></ResponsiveContainer></div> : <ChartEmpty/>}
        <div className="chart-foot"><span className="legend-dot legend-sales"/> Sales {isProfitKnown && <><span className="legend-dot legend-profit"/> Profit</>}<span className="chart-foot-note">{trend.length} monthly points</span></div>
      </article>
      <article className="panel category-panel">
        <PanelHeading eyebrow="WHERE SALES COME FROM" title="Category mix" subtitle="Which parts of the catalogue pull weight." trailing={<button className="panel-arrow" onClick={onExplore} aria-label="Explore sales"><ArrowUpRight size={17}/></button>}/>
        <div className="category-content">
          {dashboard.categories?.length ? <>
            <div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={dashboard.categories} dataKey="revenue" nameKey="name" innerRadius="65%" outerRadius="88%" paddingAngle={3} stroke="none" cornerRadius={3}>{dashboard.categories.map((entry, idx) => <Cell key={entry.name} fill={COLORS[idx % COLORS.length]}/>)}</Pie><Tooltip content={<ChartTooltip currency={currency}/>} /></PieChart></ResponsiveContainer><div className="donut-center"><span>Categories</span><strong>{dashboard.categories.length}</strong></div></div>
            <div className="category-legend">{dashboard.categories.slice(0, 5).map((item, idx) => <div className="category-legend-row" key={item.name}><span className="category-swatch" style={{ background: COLORS[idx % COLORS.length] }}/><span className="category-legend-name">{item.name}</span><span className="category-share">{formatPercent(item.share, 0)}</span></div>)}</div>
          </> : <ChartEmpty/>}
        </div>
        <button className="panel-text-link" onClick={onExplore}>View all categories <ArrowRight size={14}/></button>
      </article>
    </section>

    <section className="lower-grid">
      <article className="panel regional-panel">
        <PanelHeading eyebrow="REGIONAL PERFORMANCE" title="Where orders land" subtitle="Sales concentration by region." trailing={<span className="mini-count">{dashboard.regions?.length || 0} regions</span>}/>
        {dashboard.regions?.length ? <div className="region-list">{dashboard.regions.slice(0, 5).map((region, idx) => <div className="region-row" key={region.name}><span className="region-number">0{idx + 1}</span><div className="region-main"><div className="region-meta"><strong>{region.name}</strong><span>{formatCurrency(region.revenue, currency, true)}</span></div><div className="progress-track"><span style={{ width: `${Math.min(100, Math.max(0, region.share))}%`, background: COLORS[idx % COLORS.length] }}/></div></div><span className="region-percent">{formatPercent(region.share, 0)}</span></div>)}</div> : <ChartEmpty/>}
      </article>
      <article className="panel business-note-panel">
        <PanelHeading eyebrow="ANALYST NOTEBOOK" title="What stands out" subtitle="Quick observations from the current filters." trailing={<div className="note-icon"><Sparkles size={16}/></div>}/>
        <div className="insight-list">{dashboard.insights?.slice(0, 3).map((item, index) => <div className="insight-row" key={item}><div className={cx('insight-index', `insight-index-${index}`)}>{String(index + 1).padStart(2, '0')}</div><p>{item}</p></div>)}</div>
        <button className="panel-text-link" onClick={onViewInsights}>Open business notes <ArrowRight size={14}/></button>
      </article>
    </section>

    <section className="panel product-panel">
      <PanelHeading eyebrow="PRODUCT PERFORMANCE" title="Top products by sales" subtitle="A quick ranking of product revenue in this view." trailing={<button className="button button-small button-secondary" onClick={onExplore}>Open explorer <ArrowRight size={14}/></button>}/>
      {dashboard.top_products?.length ? <div className="product-table-wrap"><table className="data-table compact-table"><thead><tr><th>Product</th><th>Revenue</th><th>Share of sales</th><th>Profit</th></tr></thead><tbody>{dashboard.top_products.slice(0, 5).map((item, idx) => <tr key={item.name}><td><div className="product-cell"><span className="product-rank">{String(idx + 1).padStart(2, '0')}</span><strong>{item.name}</strong></div></td><td className="numeric-cell">{formatCurrency(item.revenue, currency)}</td><td><div className="share-cell"><div className="share-track"><span style={{ width: `${Math.min(100, item.share)}%` }}/></div><span>{formatPercent(item.share)}</span></div></td><td className="numeric-cell">{formatCurrency(item.profit, currency)}</td></tr>)}</tbody></table></div> : <ChartEmpty/>}
    </section>
  </div>;
}

function PanelHeading({ eyebrow, title, subtitle, trailing }) {
  return <div className="panel-heading"><div><div className="panel-eyebrow">{eyebrow}</div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{trailing && <div className="panel-trailing">{trailing}</div>}</div>;
}
function ChartTooltip({ active, payload, label, currency = 'INR' }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><span className="tooltip-label">{label || payload[0]?.name}</span>{payload.map((item) => <div className="tooltip-item" key={item.dataKey}><span className="tooltip-swatch" style={{ background: item.color || item.fill }}/>{item.name}: <strong>{formatCurrency(item.value, currency)}</strong></div>)}</div>;
}
function ChartEmpty() { return <div className="chart-empty"><div className="empty-chart-icon"><BarChart3 size={21}/></div><strong>Nothing to plot yet</strong><span>Try widening the date range or clearing a filter.</span></div>; }
function LoadingState() { return <div className="loading-card"><LoaderCircle className="spin" size={22}/><strong>Preparing your sales view</strong><span>Reading dataset and refreshing metrics…</span></div>; }
function EmptyState({ title, copy, action, onAction }) { return <div className="empty-state"><div className="empty-state-mark"><Package size={24}/></div><h2>{title}</h2><p>{copy}</p>{action && <button className="button button-primary" onClick={onAction}><Upload size={15}/>{action}</button>}</div>; }

function ExplorerPage({ datasetId, filters, currency, notify }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState({ rows: [], total: 0, pages: 1, page: 1 });
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState({ by: 'date', order: 'desc' });
  const [error, setError] = useState('');
  useEffect(() => setPage(1), [datasetId, filters, search]);
  useEffect(() => {
    if (!datasetId) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await fetchRecords({ dataset_id: datasetId, page, page_size: 15, search, ...filters, sort_by: sort.by, sort_order: sort.order });
        if (!cancelled) { setRecords(data); setError(''); }
      } catch (error) { if (!cancelled) setError(errorMessage(error)); }
      finally { if (!cancelled) setLoading(false); }
    }, 120);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [datasetId, page, search, filters, sort]);
  const toggleSort = (column) => setSort((current) => ({ by: column, order: current.by === column && current.order === 'asc' ? 'desc' : 'asc' }));
  const exportUrl = buildExportUrl('/api/export.csv', { dataset_id: datasetId, ...filters, search });
  return <div className="content-stack explorer-stack">
    <div className="explorer-toolbar"><div><div className="toolbar-title"><FileSpreadsheet size={17}/> Order ledger <span className="table-count">{formatNumber(records.total)} rows</span></div><p>Search, sort and export the records behind the charts.</p></div><div className="explorer-actions"><label className="search-box"><Search size={15}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product, order, region…" aria-label="Search sales records"/>{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={13}/></button>}</label><a className="button button-secondary" href={exportUrl}><Download size={14}/> Export CSV</a></div></div>
    {error && <div className="alert alert-error"><CircleHelp size={16}/>{error}</div>}
    <section className="panel explorer-panel"><div className="table-status"><span>{loading ? <><LoaderCircle className="spin" size={13}/> Updating rows…</> : `Showing ${records.rows.length ? (page - 1) * 15 + 1 : 0}–${Math.min(page * 15, records.total)} of ${formatNumber(records.total)}`}</span><span className="table-status-right">Click a column title to sort</span></div>
      <div className="table-scroll"><table className="data-table explorer-table"><thead><tr>{[['date','Order date'],['order_id','Order ID'],['product','Product'],['category','Category'],['region','Region'],['channel','Channel'],['quantity','Units'],['revenue','Sales'],['profit','Profit']].map(([key, label]) => <th key={key} className={['quantity','revenue','profit'].includes(key) ? 'numeric-cell' : ''}><button className="sort-button" onClick={() => toggleSort(key)}>{label}<span>{sort.by === key ? sort.order === 'asc' ? '↑' : '↓' : '↕'}</span></button></th>)}</tr></thead><tbody>{records.rows.map((row) => <tr key={row.id}><td className="date-cell">{shortDate(row.date)}</td><td><span className="order-code">{row.order_id || `ROW-${row.id}`}</span></td><td><strong>{row.product}</strong></td><td><span className="soft-tag">{row.category}</span></td><td>{row.region}</td><td>{row.channel}</td><td className="numeric-cell">{row.quantity === null ? '—' : formatNumber(row.quantity, 1)}</td><td className="numeric-cell strong-number">{formatCurrency(row.revenue, currency)}</td><td className={cx('numeric-cell', row.profit !== null && row.profit < 0 ? 'negative-number' : '')}>{formatCurrency(row.profit, currency)}</td></tr>)}</tbody></table>{!records.rows.length && <div className="empty-table"><Search size={20}/><strong>No matching rows</strong><span>Try another search or reset the filters.</span></div>}</div>
      <div className="pagination"><span>Page {records.page} of {records.pages}</span><div><button className="page-button" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft size={16}/></button><button className="page-button" disabled={page >= records.pages || loading} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight size={16}/></button></div></div>
    </section>
  </div>;
}

function ImportPage({ onImported, notify }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [datasetName, setDatasetName] = useState('My sales analysis');
  const [currency, setCurrency] = useState('INR');
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');

  const chooseFile = (nextFile) => {
    setError(''); setPreview(null); setMapping({});
    if (!nextFile) return;
    const validExtension = /\.(csv|xlsx|xls)$/i.test(nextFile.name);
    if (!validExtension) { setFile(null); setError('Choose a .csv, .xlsx or .xls file.'); return; }
    if (nextFile.size > 20 * 1024 * 1024) { setFile(null); setError('The maximum file size is 20 MB. Export a smaller date range and try again.'); return; }
    setFile(nextFile);
    const fileStem = nextFile.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    setDatasetName(fileStem || 'My sales analysis');
  };
  const handlePreview = async () => {
    if (!file) { setError('Choose a file first.'); return; }
    setPreviewing(true); setError('');
    try { const result = await previewFile(file); setPreview(result); setMapping(result.suggested_mapping || {}); }
    catch (err) { setError(errorMessage(err)); }
    finally { setPreviewing(false); }
  };
  const validMapping = Boolean(mapping.date && (mapping.revenue || (mapping.quantity && mapping.unit_price)));
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!file) { setError('Choose a file first.'); return; }
    if (!preview) { setError('Preview the file before submitting so you can confirm the columns.'); return; }
    if (!validMapping) { setError('Map an order date and either a sales/revenue column or both quantity and unit price.'); return; }
    setSubmitting(true); setError('');
    try { const result = await importFile({ file, mapping, datasetName, currency }); await onImported(result); }
    catch (err) { setError(errorMessage(err)); }
    finally { setSubmitting(false); }
  };
  const setField = (field, value) => setMapping((current) => { const next = { ...current }; if (!value) delete next[field]; else next[field] = value; return next; });

  return <div className="import-page">
    <div className="page-heading-row import-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> DATA WORKSPACE <span className="eyebrow-dot">/</span> IMPORT</div><h1>Bring your data in.</h1><p className="page-subtitle">A deliberate, two-step import. Nothing is saved until you submit the analysis.</p></div><div className="import-private-note"><ShieldCheck size={17}/><span>Local-first workspace<br/><strong>Your file is stored in this app’s database.</strong></span></div></div>
    <div className="import-layout">
      <form className="panel import-card" onSubmit={handleSubmit}>
        <div className="step-heading"><span className="step-number">01</span><div><h2>Choose a sales export</h2><p>Start with a report from your store, spreadsheet or a public dataset.</p></div><span className="step-state">{file ? <><Check size={13}/> File selected</> : 'Required'}</span></div>
        <div className={cx('drop-zone', dragOver && 'drop-zone-active', file && 'drop-zone-selected')} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); chooseFile(e.dataTransfer.files?.[0]); }}>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => chooseFile(e.target.files?.[0])}/>
          {file ? <><div className="file-type-icon"><FileSpreadsheet size={25}/></div><div className="drop-title">{file.name}</div><div className="drop-hint">{(file.size / 1024).toFixed(file.size < 1024 * 1024 ? 1 : 0)} {file.size < 1024 * 1024 ? 'KB' : 'KB'} · Ready for a column preview</div><div className="selected-file-actions"><button type="button" className="button button-secondary button-small" onClick={() => inputRef.current?.click()}><RefreshCw size={13}/> Replace file</button><button type="button" className="text-button danger-text" onClick={() => { setFile(null); setPreview(null); setMapping({}); if (inputRef.current) inputRef.current.value = ''; }}>Remove</button></div></> : <><div className="upload-icon-wrap"><CloudUpload size={25} strokeWidth={1.6}/></div><div className="drop-title">Drop your sales file here</div><div className="drop-hint">CSV or Excel · Up to 20 MB · First worksheet is read</div><button className="button button-secondary browse-button" type="button" onClick={() => inputRef.current?.click()}><Upload size={14}/> Choose a file</button><span className="drop-or">or drag it into this box</span></>}
        </div>
        <div className="form-grid import-meta-grid"><label className="form-field"><span>Dataset name</span><input value={datasetName} onChange={(e) => setDatasetName(e.target.value)} maxLength={180} placeholder="e.g. Q3 store sales"/></label><label className="form-field"><span>Currency display · label only</span><select value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="INR">INR · Indian rupee</option><option value="USD">USD · US dollar</option><option value="GBP">GBP · Pound sterling</option><option value="EUR">EUR · Euro</option><option value="AED">AED · UAE dirham</option></select><small className="field-hint">Changes formatting only; it does not convert exchange rates.</small></label></div>
        {error && <div className="inline-error"><X size={15}/><span>{error}</span></div>}
        <div className="submit-row"><div className="submit-note"><ShieldCheck size={15}/><span>Nothing changes until you click the analysis button.</span></div><button type="button" className="button button-primary" onClick={handlePreview} disabled={!file || previewing || submitting}>{previewing ? <LoaderCircle className="spin" size={15}/> : <FileText size={15}/>} {previewing ? 'Reading file…' : 'Preview columns'} <ArrowRight size={14}/></button></div>

        {preview && <div className="mapping-section">
          <div className="step-heading second-step"><span className="step-number">02</span><div><h2>Confirm the column mapping</h2><p>We suggest the matches. Check them before you submit.</p></div><span className={cx('step-state', validMapping ? 'state-ready' : 'state-warn')}>{validMapping ? <><Check size={13}/> Ready</> : 'Check fields'}</span></div>
          <div className="mapping-status"><div className="mapping-status-icon"><ListFilter size={16}/></div><div><strong>{formatNumber(preview.row_count)} rows detected</strong><span>{preview.columns.length} columns · sample of first 8 rows below</span></div></div>
          <div className="mapping-grid">{FIELD_META.map(([field, label, required]) => <label className="map-field" key={field}><span>{label}{required && <b>Required</b>}</span><select value={mapping[field] || ''} onChange={(e) => setField(field, e.target.value)}><option value="">{required ? 'Choose a column' : 'Not included'}</option>{preview.columns.map((col) => <option value={col} key={col}>{col}</option>)}</select></label>)}</div>
          <div className="mapping-footnote"><span className="tip-mark">i</span><span>Required: order date and sales/revenue, or both quantity and unit price. If profit or cost is missing, profit metrics will be shown as unavailable rather than guessed.</span></div>
          <div className="preview-table-wrap"><div className="preview-table-heading"><strong>File preview</strong><span>Read-only sample · no edits applied</span></div><div className="table-scroll"><table className="data-table preview-table"><thead><tr>{preview.columns.slice(0, 8).map((col) => <th key={col}>{col}</th>)}</tr></thead><tbody>{preview.preview.slice(0, 5).map((row, idx) => <tr key={idx}>{preview.columns.slice(0, 8).map((col) => <td key={col}>{String(row[col] ?? '—').slice(0, 64)}</td>)}</tr>)}</tbody></table></div></div>
          <div className="submit-final-row"><div className="submit-final-copy"><strong>Everything look right?</strong><span>The file will be saved into your local Commerce Ledger database.</span></div><button type="submit" className="button button-primary button-submit" disabled={!validMapping || submitting}>{submitting ? <><LoaderCircle className="spin" size={16}/> Analysing data…</> : <><Check size={16}/> Submit &amp; analyse data <ArrowRight size={15}/></>}</button></div>
        </div>}
      </form>
      <aside className="import-aside">
        <div className="aside-paper"><div className="aside-section-number">A / DATA CHECKLIST</div><h3>What makes a useful sales file?</h3><p>Start with the date and sales amount. A few extra fields can turn the summary into a useful business conversation.</p><div className="checklist"><div><Check size={14}/><span>Order date and sales amount</span></div><div><Check size={14}/><span>Product, category or SKU</span></div><div><Check size={14}/><span>Region, state or sales channel</span></div><div><Check size={14}/><span>Cost or profit for margin analysis</span></div></div><a className="aside-link" href={`${API_BASE}/api/template.csv`}><Download size={14}/> Download CSV template</a></div>
        <div className="aside-paper aside-paper-muted"><div className="aside-section-number">B / QUICK NOTE</div><h3>Private by design</h3><p>This app runs on your own machine during local development. Uploaded records are stored in SQLite under the project folder, not sent to a third-party analytics service.</p><div className="privacy-foot"><ShieldCheck size={16}/><span>Don't commit customer data or the generated database to GitHub.</span></div></div>
        <div className="aside-paper aside-paper-olive"><div className="aside-section-number">C / NO FILE YET?</div><h3>Use the sample dataset</h3><p>Explore the dashboard with generated sample orders before you connect your own data.</p><button className="text-button aside-text-button" onClick={() => notify('Choose Overview in the left navigation to explore the built-in sample dataset.')}>Explore the sample view <ArrowRight size={14}/></button></div>
      </aside>
    </div>
  </div>;
}

function LibraryPage({ datasets, selectedId, onSelect, onDelete, onGoImport }) {
  return <div className="library-page">
    <div className="page-heading-row"><div><div className="eyebrow"><span className="eyebrow-line"/> DATA WORKSPACE <span className="eyebrow-dot">/</span> LIBRARY</div><h1>Your data, organised.</h1><p className="page-subtitle">Switch between the built-in sample and the sales files you have imported.</p></div><button className="button button-primary" onClick={onGoImport}><Plus size={15}/> Add dataset</button></div>
    <div className="library-summary"><div><span className="summary-kicker">AVAILABLE DATASETS</span><strong>{formatNumber(datasets.length)}</strong></div><div><span className="summary-kicker">IMPORTED ROWS</span><strong>{formatNumber(datasets.filter((d) => !d.is_demo).reduce((sum, d) => sum + d.row_count, 0))}</strong></div><div><span className="summary-kicker">STORAGE</span><strong>SQLite</strong></div></div>
    <div className="dataset-grid">{datasets.map((dataset) => <article className={cx('dataset-card', String(dataset.id) === String(selectedId) && 'dataset-card-active')} key={dataset.id}>
      <div className="dataset-card-top"><div className={cx('dataset-icon', dataset.is_demo ? 'dataset-icon-demo' : 'dataset-icon-user')}>{dataset.is_demo ? <Sparkles size={18}/> : <FileSpreadsheet size={18}/>}</div><div className="dataset-type">{dataset.is_demo ? 'BUILT-IN SAMPLE' : 'UPLOADED DATA'}</div><button className="icon-button" aria-label={`Dataset actions for ${dataset.name}`} title={dataset.is_demo ? "The built-in demo is protected" : "Delete imported dataset"} disabled={dataset.is_demo} onClick={() => { if (!dataset.is_demo && window.confirm(`Delete ${dataset.name} and its saved records?`)) onDelete(dataset.id); }}><MoreHorizontal size={17}/></button></div>
      <h2>{dataset.name}</h2><p className="dataset-description">{dataset.is_demo ? 'Generated orders for exploring the dashboard and its business metrics.' : 'An imported sales dataset saved to your local SQLite database.'}</p>
      <div className="dataset-stats"><div><span>ROWS</span><strong>{formatNumber(dataset.row_count)}</strong>{dataset.dropped_rows > 0 && <small className="dataset-skipped">{formatNumber(dataset.dropped_rows)} skipped</small>}</div><div><span>DATE RANGE</span><strong>{dataset.date_min ? `${shortDate(dataset.date_min)} – ${shortDate(dataset.date_max)}` : '—'}</strong></div></div>
      <div className="dataset-card-foot"><span className="dataset-currency">{dataset.currency} · {dataset.source}</span><button className={cx('button', String(dataset.id) === String(selectedId) ? 'button-soft-active' : 'button-secondary', 'button-small')} onClick={() => onSelect(dataset.id)}>{String(dataset.id) === String(selectedId) ? <><Check size={13}/> In view</> : <>Open dataset <ArrowRight size={13}/></>}</button></div>
    </article>)}</div>
    {!datasets.length && <EmptyState title="Your library is empty" copy="Import a CSV or Excel sales export to add your first dataset." action="Import data" onAction={onGoImport}/>}
  </div>;
}

function InsightsPage({ dashboard, currency }) {
  const summary = dashboard.summary;
  const marginKnown = summary.margin !== null;
  return <div className="content-stack insights-stack">
    <section className="insight-feature"><div className="insight-feature-copy"><div className="feature-kicker"><Sparkles size={14}/> THE ANALYST'S NOTEPAD</div><h2>Good decisions start with better questions.</h2><p>These notes are generated from the current dataset and filters. They describe what is visible in the data—not what caused it.</p><span className="feature-foot">{dashboard.dataset?.is_demo ? 'SAMPLE DATA · FOR DEMONSTRATION' : 'UPLOADED DATA · DESCRIPTIVE ANALYSIS'}</span></div><div className="insight-feature-art"><div className="art-ring ring-one"/><div className="art-ring ring-two"/><div className="art-stat"><span>Sales in view</span><strong>{formatCurrency(summary.revenue, currency, true)}</strong><small>{formatNumber(summary.records)} order lines</small></div></div></section>
    <section className="insight-notes-grid">{dashboard.insights?.map((note, index) => <article className="insight-note-card" key={note}><div className="note-card-top"><span className={cx('note-card-number', `note-card-number-${index % 4}`)}>{String(index + 1).padStart(2, '0')}</span><span className="note-card-kind">{['TREND SIGNAL', 'CATEGORY MIX', 'REGIONAL MIX', 'PROFITABILITY', 'DISCOUNT CHECK'][index] || 'DATA NOTE'}</span></div><p>{note}</p><div className="note-card-source"><span/> Based on current filters</div></article>)}</section>
    <section className="panel decision-panel"><PanelHeading eyebrow="BUSINESS ANALYST VIEW" title="Questions worth taking to a review" subtitle="A few practical prompts to help move from reporting into business analysis."/><div className="decision-list"><div><span className="decision-num">01</span><p><strong>Where did the change happen?</strong><span>Compare category, region and channel before concluding that a total sales change reflects a broad business shift.</span></p></div><div><span className="decision-num">02</span><p><strong>Is higher revenue translating into profit?</strong><span>Check profit margin alongside discounts, unit economics and product mix. Revenue alone doesn't show profitability.</span></p></div><div><span className="decision-num">03</span><p><strong>Is the data complete enough to decide?</strong><span>Confirm date coverage, repeated order IDs, missing cost fields and whether each row represents an order or an order line.</span></p></div><div><span className="decision-num">04</span><p><strong>What evidence would change the decision?</strong><span>Define a comparison period, validate any proposed explanation and agree on one metric to monitor next.</span></p></div></div></section>
    <div className="methodology-note"><ShieldCheck size={17}/><div><strong>How to read these notes</strong><span>Commerce Ledger uses descriptive summaries and simple comparisons. It does not infer causality, run a forecast or make operational decisions. Review the source data before acting.</span></div></div>
  </div>;
}

export default App;
