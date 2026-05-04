import React, { useState, useRef, useEffect } from "react";
import Icon from "@/components/ui/icon";

// --- Types ---
type LogLevel = "info" | "ok" | "warn" | "error" | "bitrix";
type ContentFilter = "html" | "css" | "js" | "images" | "video" | "links" | "text";
type ExportFormat = "json" | "xml" | "csv";
type Tab = "config" | "results" | "logs" | "replacer";

interface LogEntry {
  id: number;
  ts: string;
  level: LogLevel;
  msg: string;
}

interface ParseResult {
  type: ContentFilter;
  count: number;
  size: string;
  items: string[];
}

// --- Mock data ---
const MOCK_LOGS: Omit<LogEntry, "id">[] = [
  { ts: "00:00.001", level: "info",   msg: "Инициализация парсера v2.4.1" },
  { ts: "00:00.045", level: "info",   msg: "Подключение к URL: https://example-bitrix.ru" },
  { ts: "00:00.312", level: "ok",     msg: "HTTP 200 OK — страница загружена (142 KB)" },
  { ts: "00:00.451", level: "info",   msg: "Анализ DOM-структуры..." },
  { ts: "00:00.612", level: "bitrix", msg: "[Bitrix] Обнаружен компонент: bitrix:menu (main_menu)" },
  { ts: "00:00.638", level: "bitrix", msg: "[Bitrix] Обнаружен компонент: bitrix:catalog (catalog_section)" },
  { ts: "00:00.714", level: "bitrix", msg: "[Bitrix] Обнаружен компонент: bitrix:form.result.new (callback_form)" },
  { ts: "00:00.820", level: "ok",     msg: "HTML извлечён: 1 файл (142 KB)" },
  { ts: "00:01.103", level: "info",   msg: "Поиск CSS ресурсов..." },
  { ts: "00:01.244", level: "ok",     msg: "CSS извлечён: 4 файла (38.2 KB)" },
  { ts: "00:01.540", level: "info",   msg: "Поиск JavaScript..." },
  { ts: "00:01.892", level: "warn",   msg: "JS: обнаружен минифицированный файл без source map" },
  { ts: "00:02.001", level: "ok",     msg: "JS извлечён: 7 файлов (214.5 KB)" },
  { ts: "00:02.340", level: "info",   msg: "Сканирование медиафайлов..." },
  { ts: "00:02.891", level: "ok",     msg: "Изображения: 23 файла (1.4 MB)" },
  { ts: "00:03.100", level: "warn",   msg: "Видео: 2 файла недоступны (403 Forbidden)" },
  { ts: "00:03.200", level: "info",   msg: "Извлечение ссылок..." },
  { ts: "00:03.450", level: "ok",     msg: "Ссылок найдено: 87 (внутренних: 64, внешних: 23)" },
  { ts: "00:03.780", level: "info",   msg: "Генерация структуры JSON..." },
  { ts: "00:04.012", level: "ok",     msg: "Парсинг завершён успешно. Время: 4.01 сек." },
];

const MOCK_RESULTS: ParseResult[] = [
  { type: "html",   count: 1,   size: "142 KB",   items: ["index.html"] },
  { type: "css",    count: 4,   size: "38.2 KB",  items: ["style.css", "bitrix.css", "theme.css", "responsive.css"] },
  { type: "js",     count: 7,   size: "214.5 KB", items: ["jquery.min.js", "bx.js", "main.js", "slider.js", "form.js", "analytics.js", "polyfills.js"] },
  { type: "images", count: 23,  size: "1.4 MB",   items: ["logo.svg", "hero.jpg", "bg-pattern.png", "catalog-01.jpg", "catalog-02.jpg", "...+18 файлов"] },
  { type: "video",  count: 1,   size: "0 B",      items: ["video-intro.mp4 (403 Forbidden)"] },
  { type: "links",  count: 87,  size: "",         items: ["/about", "/catalog", "/contacts", "https://vk.com/...", "...+83 ссылки"] },
  { type: "text",   count: 142, size: "24.1 KB",  items: ["H1 (3 шт)", "H2 (12 шт)", "Параграфы (127 шт)"] },
];

const CONTENT_FILTERS: { id: ContentFilter; label: string; icon: string; color: string }[] = [
  { id: "html",   label: "HTML",        icon: "Code2",      color: "text-orange-400" },
  { id: "css",    label: "CSS",         icon: "Paintbrush", color: "text-blue-400" },
  { id: "js",     label: "JavaScript",  icon: "Zap",        color: "text-yellow-400" },
  { id: "images", label: "Изображения", icon: "Image",      color: "text-purple-400" },
  { id: "video",  label: "Видео",       icon: "Play",       color: "text-red-400" },
  { id: "links",  label: "Ссылки",      icon: "Link2",      color: "text-cyan-400" },
  { id: "text",   label: "Текст",       icon: "AlignLeft",  color: "text-green-400" },
];

const BITRIX_COMPONENTS = [
  "bitrix:menu", "bitrix:catalog", "bitrix:catalog.section",
  "bitrix:catalog.element", "bitrix:news", "bitrix:form.result.new",
  "bitrix:search.result", "bitrix:iblock.list",
];

// --- Small helpers ---
function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card border border-border rounded-sm ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      {subtitle && <p className="text-xs text-muted-foreground/50 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function ToggleSwitch({ defaultChecked = false }: { defaultChecked?: boolean }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <button
      onClick={() => setOn(!on)}
      className={`w-8 h-4 rounded-full relative transition-colors shrink-0 ${on ? "bg-[hsl(var(--green))]" : "bg-muted border border-border"}`}
    >
      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

// --- Main ---
export default function Index() {
  const [url, setUrl] = useState("https://");
  const [activeTab, setActiveTab] = useState<Tab>("config");
  const [running, setRunning] = useState(false);
  const [parsed, setParsed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeFilters, setActiveFilters] = useState<ContentFilter[]>(
    ["html", "css", "js", "images", "links", "text"]
  );
  const [exportFormat, setExportFormat] = useState<ExportFormat>("json");
  const [expandedResult, setExpandedResult] = useState<ContentFilter | null>(null);
  const [replacerRows, setReplacerRows] = useState([
    { from: "", to: "" },
    { from: "", to: "" },
  ]);
  const [detectBitrix, setDetectBitrix] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  function toggleFilter(f: ContentFilter) {
    setActiveFilters(prev =>
      prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]
    );
  }

  function startParsing() {
    if (url.length < 12) return;
    setRunning(true);
    setParsed(false);
    setLogs([]);
    setProgress(0);
    setActiveTab("logs");
    let i = 0;
    const iv = setInterval(() => {
      if (i < MOCK_LOGS.length) {
        setLogs(prev => [...prev, { ...MOCK_LOGS[i], id: i }]);
        setProgress(Math.round(((i + 1) / MOCK_LOGS.length) * 100));
        i++;
      } else {
        clearInterval(iv);
        setRunning(false);
        setParsed(true);
        setTimeout(() => setActiveTab("results"), 500);
      }
    }, 200);
  }

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: "config",   label: "Конфигурация",  icon: "Settings2" },
    { id: "results",  label: "Результаты",    icon: "LayoutGrid" },
    { id: "logs",     label: "Журнал",        icon: "Terminal" },
    { id: "replacer", label: "Замена текста", icon: "Replace" },
  ];

  const visibleResults = MOCK_RESULTS.filter(r => activeFilters.includes(r.type));

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">

      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-screen-xl mx-auto px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded-sm bg-[hsl(var(--green))] flex items-center justify-center">
              <Icon name="Scan" size={11} className="text-black" />
            </div>
            <span className="font-mono font-semibold text-sm tracking-tight">SiteParser Pro</span>
            <span className="text-muted-foreground/40 font-mono text-xs">v2.4.1</span>
            <div className="w-px h-4 bg-border mx-1" />
            <span className="flex items-center gap-1.5 text-xs font-mono">
              <span className={`w-1.5 h-1.5 rounded-full ${running ? "bg-[hsl(var(--green))] animate-pulse-dot" : "bg-muted-foreground"}`} />
              <span className={running ? "text-green" : "text-muted-foreground"}>
                {running ? "RUNNING" : "IDLE"}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
            {parsed && <span className="text-green animate-fade-in">✓ Парсинг завершён</span>}
            <span>2026-05-05</span>
          </div>
        </div>
      </header>

      {/* URL Bar */}
      <div className="border-b border-border bg-card/50">
        <div className="max-w-screen-xl mx-auto px-6 py-3 flex gap-3 items-center">
          <div className="flex-1 flex items-center gap-2 bg-muted border border-border rounded-sm px-3 h-9 focus-within:border-[hsl(var(--green))] transition-colors">
            <Icon name="Globe" size={13} className="text-muted-foreground shrink-0" />
            <input
              className="flex-1 bg-transparent text-sm font-mono outline-none placeholder:text-muted-foreground/40"
              placeholder="https://your-bitrix-site.ru"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === "Enter" && startParsing()}
            />
            {url.length > 8 && (
              <button onClick={() => setUrl("https://")} className="text-muted-foreground hover:text-foreground transition-colors">
                <Icon name="X" size={12} />
              </button>
            )}
          </div>
          <select className="h-9 bg-muted border border-border rounded-sm px-2 text-xs font-mono text-foreground outline-none focus:border-[hsl(var(--green))] transition-colors">
            <option value="ru">RU</option>
            <option value="en">EN</option>
            <option value="de">DE</option>
          </select>
          {running ? (
            <button
              onClick={() => setRunning(false)}
              className="h-9 px-4 bg-destructive text-white text-xs font-mono rounded-sm flex items-center gap-2 hover:opacity-90 transition-opacity"
            >
              <Icon name="Square" size={12} />
              Стоп
            </button>
          ) : (
            <button
              onClick={startParsing}
              disabled={url.length < 12}
              className="h-9 px-5 bg-[hsl(var(--green))] text-black text-xs font-mono font-semibold rounded-sm flex items-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Icon name="Play" size={12} />
              Запустить
            </button>
          )}
        </div>
        {running && (
          <div className="max-w-screen-xl mx-auto px-6 pb-3">
            <div className="h-0.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-[hsl(var(--green))] transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs font-mono text-muted-foreground mt-1">{progress}% — обработка страницы...</p>
          </div>
        )}
      </div>

      {/* Layout */}
      <div className="flex-1 max-w-screen-xl mx-auto w-full px-6 py-5 flex gap-5">

        {/* Sidebar */}
        <aside className="w-52 shrink-0 space-y-3 animate-fade-in">

          {/* Filters */}
          <Panel>
            <div className="px-3 pt-3 pb-2 border-b border-border">
              <p className="text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">Контент</p>
            </div>
            <div className="p-2 space-y-px">
              {CONTENT_FILTERS.map(f => (
                <button
                  key={f.id}
                  onClick={() => toggleFilter(f.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs font-mono transition-colors ${
                    activeFilters.includes(f.id)
                      ? "bg-muted/70 text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }`}
                >
                  <span className={`w-1 h-1 rounded-full shrink-0 ${activeFilters.includes(f.id) ? "bg-[hsl(var(--green))]" : "bg-muted-foreground/30"}`} />
                  <Icon name={f.icon} size={12} className={activeFilters.includes(f.id) ? f.color : ""} />
                  <span className="flex-1 text-left">{f.label}</span>
                  {parsed && (
                    <span className="text-muted-foreground/50 tabular-nums">
                      {MOCK_RESULTS.find(r => r.type === f.id)?.count ?? 0}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </Panel>

          {/* Bitrix */}
          <Panel>
            <div className="px-3 pt-3 pb-2 border-b border-border flex items-center justify-between">
              <p className="text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">Bitrix</p>
              <button
                onClick={() => setDetectBitrix(!detectBitrix)}
                className={`w-8 h-4 rounded-full relative transition-colors ${detectBitrix ? "bg-[hsl(var(--green))]" : "bg-muted border border-border"}`}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${detectBitrix ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
            </div>
            <div className="p-3 space-y-1.5">
              {BITRIX_COMPONENTS.slice(0, detectBitrix ? 6 : 2).map(c => (
                <div key={c} className={`text-xs font-mono flex items-center gap-1.5 ${detectBitrix ? "text-purple-400/80" : "text-muted-foreground/40"}`}>
                  <span className="w-1 h-1 rounded-full bg-current shrink-0" />
                  {c}
                </div>
              ))}
              {!detectBitrix && <p className="text-xs text-muted-foreground/30 italic">режим отключён</p>}
            </div>
          </Panel>

          {/* Export */}
          <Panel>
            <div className="px-3 pt-3 pb-2 border-b border-border">
              <p className="text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">Экспорт</p>
            </div>
            <div className="p-3 space-y-2">
              {(["json", "xml", "csv"] as ExportFormat[]).map(f => (
                <button
                  key={f}
                  onClick={() => setExportFormat(f)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-sm text-xs font-mono border transition-colors ${
                    exportFormat === f
                      ? "border-[hsl(var(--green))] bg-[hsl(var(--green))]/10 text-green"
                      : "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon name={f === "json" ? "Braces" : f === "xml" ? "FileCode2" : "Table2"} size={12} />
                  {f.toUpperCase()}
                  {exportFormat === f && <Icon name="Check" size={10} className="ml-auto" />}
                </button>
              ))}
              <button
                disabled={!parsed}
                className="w-full h-8 mt-1 bg-[hsl(var(--green))] text-black text-xs font-mono font-semibold rounded-sm flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Icon name="Download" size={12} />
                Скачать {exportFormat.toUpperCase()}
              </button>
            </div>
          </Panel>
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0 flex flex-col gap-4">

          {/* Tabs */}
          <div className="flex items-center border-b border-border">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-mono border-b-2 -mb-px transition-colors ${
                  activeTab === tab.id
                    ? "border-[hsl(var(--green))] text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon name={tab.icon} size={12} />
                {tab.label}
                {tab.id === "logs" && logs.length > 0 && (
                  <span className="ml-0.5 px-1 bg-muted rounded text-muted-foreground">{logs.length}</span>
                )}
              </button>
            ))}
          </div>

          {/* CONFIG */}
          {activeTab === "config" && (
            <div className="animate-fade-in space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Panel className="p-4 space-y-3">
                  <SectionHeader title="Параметры парсинга" subtitle="Глубина, задержки, лимиты" />
                  {[
                    { label: "Глубина сканирования", val: "3",   unit: "уровней" },
                    { label: "Задержка между запросами", val: "500", unit: "мс" },
                    { label: "Максимум страниц",    val: "100",  unit: "шт" },
                    { label: "Таймаут соединения",  val: "15",   unit: "сек" },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between gap-3">
                      <label className="text-xs text-muted-foreground">{row.label}</label>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <input
                          defaultValue={row.val}
                          className="w-14 h-7 bg-muted border border-border rounded-sm px-2 text-xs font-mono text-right outline-none focus:border-[hsl(var(--green))] transition-colors"
                        />
                        <span className="text-xs text-muted-foreground/50 w-12">{row.unit}</span>
                      </div>
                    </div>
                  ))}
                </Panel>

                <Panel className="p-4 space-y-3">
                  <SectionHeader title="Опции" subtitle="Дополнительные параметры" />
                  {[
                    { label: "Следовать редиректам",       on: true  },
                    { label: "Игнорировать robots.txt",    on: false },
                    { label: "Парсить скрытые элементы",   on: false },
                    { label: "Сохранять структуру URL",    on: true  },
                    { label: "Распознавать Bitrix-теги",   on: true  },
                    { label: "Авто-определение языка",     on: true  },
                  ].map(opt => (
                    <div key={opt.label} className="flex items-center justify-between gap-3">
                      <label className="text-xs text-muted-foreground">{opt.label}</label>
                      <ToggleSwitch defaultChecked={opt.on} />
                    </div>
                  ))}
                </Panel>
              </div>

              <Panel className="p-4">
                <SectionHeader title="Заголовки HTTP" />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">User-Agent</label>
                    <input
                      className="w-full h-8 bg-muted border border-border rounded-sm px-3 text-xs font-mono outline-none focus:border-[hsl(var(--green))] transition-colors"
                      defaultValue="Mozilla/5.0 (compatible; SiteParser/2.4)"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Authorization Bearer</label>
                    <input
                      type="password"
                      className="w-full h-8 bg-muted border border-border rounded-sm px-3 text-xs font-mono outline-none focus:border-[hsl(var(--green))] transition-colors"
                      placeholder="Токен (опционально)"
                    />
                  </div>
                </div>
              </Panel>

              <div className="flex justify-end">
                <button
                  onClick={startParsing}
                  disabled={url.length < 12}
                  className="h-9 px-6 bg-[hsl(var(--green))] text-black text-xs font-mono font-semibold rounded-sm flex items-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Icon name="Play" size={13} />
                  Начать парсинг
                </button>
              </div>
            </div>
          )}

          {/* RESULTS */}
          {activeTab === "results" && (
            <div className="animate-fade-in space-y-3">
              {!parsed ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <div className="w-12 h-12 border border-border rounded-sm flex items-center justify-center mb-4">
                    <Icon name="Scan" size={22} className="text-muted-foreground" />
                  </div>
                  <p className="text-sm font-mono text-muted-foreground">Результаты появятся после парсинга</p>
                  <p className="text-xs text-muted-foreground/40 mt-1">Укажите URL и нажмите «Запустить»</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: "Файлов найдено",     val: "243",      icon: "Files",     color: "text-green" },
                      { label: "Bitrix-компонентов", val: "3",        icon: "Layers",    color: "text-purple-400" },
                      { label: "Общий объём",        val: "1.82 MB",  icon: "HardDrive", color: "text-blue-400" },
                      { label: "Время парсинга",     val: "4.01 сек", icon: "Timer",     color: "text-amber" },
                    ].map((s, i) => (
                      <Panel key={s.label} className="p-3 animate-fade-in" style={{ animationDelay: `${i * 60}ms` } as React.CSSProperties}>
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
                            <p className={`text-lg font-mono font-semibold ${s.color}`}>{s.val}</p>
                          </div>
                          <Icon name={s.icon} size={15} className="text-muted-foreground/30 mt-0.5" />
                        </div>
                      </Panel>
                    ))}
                  </div>

                  <div className="space-y-1.5">
                    {visibleResults.map(r => {
                      const fm = CONTENT_FILTERS.find(f => f.id === r.type)!;
                      const open = expandedResult === r.type;
                      return (
                        <Panel key={r.type} className="overflow-hidden">
                          <button
                            onClick={() => setExpandedResult(open ? null : r.type)}
                            className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/20 transition-colors"
                          >
                            <Icon name={fm.icon} size={13} className={fm.color} />
                            <span className="text-sm font-mono">{fm.label}</span>
                            <span className="text-xs text-muted-foreground font-mono">
                              {r.count} {r.count === 1 ? "файл" : r.count < 5 ? "файла" : "файлов"}
                            </span>
                            {r.size && (
                              <span className="text-xs font-mono text-muted-foreground/50 bg-muted px-1.5 py-px rounded-sm">
                                {r.size}
                              </span>
                            )}
                            <Icon name={open ? "ChevronUp" : "ChevronDown"} size={12} className="ml-auto text-muted-foreground" />
                          </button>
                          {open && (
                            <div className="border-t border-border px-4 py-3 bg-muted/10 animate-fade-in">
                              <div className="flex flex-wrap gap-2">
                                {r.items.map(item => (
                                  <span key={item} className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded-sm border border-border">
                                    {item}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </Panel>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* LOGS */}
          {activeTab === "logs" && (
            <div className="animate-fade-in flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-xs font-mono">
                  {(["ok", "info", "warn", "error", "bitrix"] as LogLevel[]).map(l => (
                    <span key={l} className={`log-line ${l} border-0 p-0 flex items-center gap-1`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {l.toUpperCase()}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => setLogs([])}
                  className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <Icon name="Trash2" size={11} />
                  Очистить
                </button>
              </div>

              <Panel>
                <div className="h-[460px] overflow-y-auto scrollbar-thin p-4 space-y-1">
                  {logs.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-xs font-mono text-muted-foreground/30">Журнал пуст — запустите парсинг</p>
                    </div>
                  ) : (
                    logs.map(log => (
                      <div key={log.id} className={`log-line ${log.level} animate-slide-in`}>
                        <span className="text-muted-foreground/30 mr-3 select-none">{log.ts}</span>
                        <span className="mr-2 opacity-50">[{log.level.toUpperCase()}]</span>
                        {log.msg}
                      </div>
                    ))
                  )}
                  {running && (
                    <div className="log-line info border-0 p-0 pl-2">
                      <span className="animate-pulse-dot text-[hsl(var(--green))]">▋</span>
                    </div>
                  )}
                  <div ref={logsEndRef} />
                </div>
              </Panel>
            </div>
          )}

          {/* REPLACER */}
          {activeTab === "replacer" && (
            <div className="animate-fade-in space-y-4">
              <Panel className="p-4">
                <SectionHeader
                  title="Автозамена текста"
                  subtitle="Замените название компании, домены или любой текст перед экспортом"
                />
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <p className="text-xs font-mono text-muted-foreground/60 uppercase tracking-wider px-1">Найти</p>
                    <p className="text-xs font-mono text-muted-foreground/60 uppercase tracking-wider px-1">Заменить на</p>
                  </div>
                  {replacerRows.map((row, i) => (
                    <div key={i} className="grid grid-cols-2 gap-2 items-center">
                      <input
                        className="h-8 bg-muted border border-border rounded-sm px-3 text-xs font-mono outline-none focus:border-[hsl(var(--green))] transition-colors"
                        placeholder={i === 0 ? "ООО «Старая компания»" : "example.ru"}
                        value={row.from}
                        onChange={e => {
                          const next = [...replacerRows];
                          next[i] = { ...next[i], from: e.target.value };
                          setReplacerRows(next);
                        }}
                      />
                      <div className="flex gap-2">
                        <input
                          className="flex-1 h-8 bg-muted border border-border rounded-sm px-3 text-xs font-mono outline-none focus:border-[hsl(var(--green))] transition-colors"
                          placeholder={i === 0 ? "ООО «Новая компания»" : "newsite.ru"}
                          value={row.to}
                          onChange={e => {
                            const next = [...replacerRows];
                            next[i] = { ...next[i], to: e.target.value };
                            setReplacerRows(next);
                          }}
                        />
                        <button
                          onClick={() => setReplacerRows(prev => prev.filter((_, j) => j !== i))}
                          className="w-8 h-8 border border-border rounded-sm flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
                        >
                          <Icon name="Minus" size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => setReplacerRows(prev => [...prev, { from: "", to: "" }])}
                    className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-[hsl(var(--green))] transition-colors mt-2"
                  >
                    <Icon name="Plus" size={12} />
                    Добавить правило
                  </button>
                </div>
              </Panel>

              <Panel className="p-4">
                <SectionHeader title="Настройки языка" subtitle="Автоматическая локализация контента" />
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Исходный язык", opts: [["auto", "Авто-определение"], ["ru", "Русский"], ["en", "English"]] },
                    { label: "Целевой язык",  opts: [["ru", "Русский"], ["en", "English"], ["de", "Deutsch"], ["fr", "Français"]] },
                    { label: "Режим замены",  opts: [["full", "Полная замена"], ["meta", "Только мета"], ["off", "Отключено"]] },
                  ].map(sel => (
                    <div key={sel.label}>
                      <label className="text-xs text-muted-foreground block mb-1">{sel.label}</label>
                      <select className="w-full h-8 bg-muted border border-border rounded-sm px-2 text-xs font-mono text-foreground outline-none focus:border-[hsl(var(--green))] transition-colors">
                        {sel.opts.map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </Panel>

              <div className="flex justify-between items-center">
                <p className="text-xs text-muted-foreground font-mono">Правила применяются при экспорте</p>
                <button className="h-8 px-4 bg-[hsl(var(--green))] text-black text-xs font-mono font-semibold rounded-sm flex items-center gap-1.5 hover:opacity-90 transition-opacity">
                  <Icon name="Check" size={12} />
                  Сохранить правила
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-screen-xl mx-auto px-6 h-9 flex items-center justify-between text-xs font-mono text-muted-foreground/30">
          <span>SiteParser Pro — автоматический парсер сайтов</span>
          <span>Bitrix · HTML · CSS · JS · JSON · XML · CSV</span>
        </div>
      </footer>
    </div>
  );
}