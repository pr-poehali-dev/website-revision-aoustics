import React, { useState, useRef, useEffect } from "react";
import Icon from "@/components/ui/icon";

const PARSER_URL = "https://functions.poehali.dev/484bc619-46b0-40ce-89cb-17cc0beef597";

// --- Types ---
type LogLevel = "info" | "ok" | "warn" | "error" | "bitrix";
type ExportFormat = "json" | "xml" | "csv";
type Tab = "config" | "results" | "logs" | "replacer";

interface LogEntry {
  id: number;
  level: LogLevel;
  msg: string;
}

interface Block {
  tag: string;
  original: string;
  translated: string;
}

interface ParseData {
  url: string;
  meta: { title: string; description: string };
  blocks: Block[];
  links: string[];
  bitrix_components: string[];
  stats: {
    total_blocks: number;
    total_links: number;
    bitrix_count: number;
    html_size_kb: number;
  };
}

// --- Helpers ---
function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-card border border-border rounded-sm ${className}`}>{children}</div>;
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">{title}</h2>
      {subtitle && <p className="text-xs text-muted-foreground/50 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`w-8 h-4 rounded-full relative transition-colors shrink-0 ${checked ? "bg-[hsl(var(--green))]" : "bg-muted border border-border"}`}
    >
      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

function toXml(data: ParseData): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const blocks = data.blocks.map(b =>
    `  <block tag="${esc(b.tag)}">
    <original>${esc(b.original)}</original>
    <translated>${esc(b.translated)}</translated>
  </block>`).join("\n");
  const links = data.links.map(l => `  <link>${esc(l)}</link>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<site url="${esc(data.url)}">
  <meta>
    <title>${esc(data.meta.title)}</title>
    <description>${esc(data.meta.description)}</description>
  </meta>
  <blocks>
${blocks}
  </blocks>
  <links>
${links}
  </links>
</site>`;
}

function toCsv(data: ParseData): string {
  const header = "tag,original,translated";
  const rows = data.blocks.map(b =>
    [b.tag, `"${b.original.replace(/"/g, '""')}"`, `"${b.translated.replace(/"/g, '""')}"`].join(",")
  );
  return [header, ...rows].join("\n");
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// --- Main ---
export default function Index() {
  const [url, setUrl] = useState("https://ex-sound.ru");
  const [activeTab, setActiveTab] = useState<Tab>("config");
  const [running, setRunning] = useState(false);
  const [parsed, setParsed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [parseData, setParseData] = useState<ParseData | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("json");
  const [expandedBlock, setExpandedBlock] = useState<string | null>(null);
  const [doTranslate, setDoTranslate] = useState(true);
  const [sourceLang, setSourceLang] = useState("русского");
  const [targetLang, setTargetLang] = useState("словенский");
  const [targetSite, setTargetSite] = useState("https://acoustics.si");
  const [replacerRows, setReplacerRows] = useState([
    { from: "ex-sound.ru", to: "acoustics.si" },
    { from: "", to: "" },
  ]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logIdRef = useRef(0);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  function addLog(level: LogLevel, msg: string) {
    setLogs(prev => [...prev, { id: logIdRef.current++, level, msg }]);
  }

  async function startParsing() {
    if (running || url.length < 8) return;
    abortRef.current = new AbortController();
    setRunning(true);
    setParsed(false);
    setParseData(null);
    setLogs([]);
    logIdRef.current = 0;
    setProgress(10);
    setActiveTab("logs");

    addLog("info", "Инициализация парсера v2.4.1");
    addLog("info", `Подключение к ${url}...`);
    if (doTranslate) {
      addLog("info", `Перевод: ${sourceLang} → ${targetLang}`);
    }

    try {
      setProgress(20);
      const res = await fetch(PARSER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          translate: doTranslate,
          source_lang: sourceLang,
          target_lang: targetLang,
        }),
        signal: abortRef.current.signal,
      });

      setProgress(80);
      const data = await res.json();

      if (data.error) {
        addLog("error", `Ошибка: ${data.error}`);
        // Show backend logs too
        if (data.logs) {
          data.logs.forEach((l: { level: LogLevel; msg: string }) => addLog(l.level, l.msg));
        }
        setRunning(false);
        return;
      }

      // Show backend logs
      if (data.logs) {
        data.logs.forEach((l: { level: LogLevel; msg: string }) => addLog(l.level, l.msg));
      }

      setProgress(100);
      setParseData(data);
      setParsed(true);
      setTimeout(() => setActiveTab("results"), 600);
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") {
        addLog("error", `Сетевая ошибка: ${e.message}`);
      } else {
        addLog("warn", "Парсинг остановлен пользователем");
      }
    } finally {
      setRunning(false);
    }
  }

  function stopParsing() {
    abortRef.current?.abort();
    setRunning(false);
  }

  function handleExport() {
    if (!parseData) return;

    // Apply replacer rules
    let processedData = { ...parseData };
    const activeRules = replacerRows.filter(r => r.from && r.to);
    if (activeRules.length > 0) {
      processedData = {
        ...processedData,
        blocks: processedData.blocks.map(b => ({
          ...b,
          translated: activeRules.reduce((t, r) => t.split(r.from).join(r.to), b.translated),
          original: activeRules.reduce((t, r) => t.split(r.from).join(r.to), b.original),
        })),
      };
    }

    if (exportFormat === "json") {
      downloadFile(JSON.stringify(processedData, null, 2), "parsed-content.json", "application/json");
    } else if (exportFormat === "xml") {
      downloadFile(toXml(processedData), "parsed-content.xml", "application/xml");
    } else {
      downloadFile(toCsv(processedData), "parsed-content.csv", "text/csv");
    }
  }

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: "config",   label: "Конфигурация",  icon: "Settings2" },
    { id: "results",  label: "Результаты",    icon: "LayoutGrid" },
    { id: "logs",     label: "Журнал",        icon: "Terminal" },
    { id: "replacer", label: "Замена текста", icon: "Replace" },
  ];

  // Group blocks by tag for display
  const blocksByTag = parseData
    ? Object.entries(
        parseData.blocks.reduce((acc, b) => {
          const key = b.tag || "text";
          if (!acc[key]) acc[key] = [];
          acc[key].push(b);
          return acc;
        }, {} as Record<string, Block[]>)
      )
    : [];

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
          <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground shrink-0">
            <Icon name="Globe" size={13} />
            <span>Источник:</span>
          </div>
          <div className="flex-1 flex items-center gap-2 bg-muted border border-border rounded-sm px-3 h-9 focus-within:border-[hsl(var(--green))] transition-colors">
            <input
              className="flex-1 bg-transparent text-sm font-mono outline-none placeholder:text-muted-foreground/40"
              placeholder="https://ex-sound.ru"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === "Enter" && startParsing()}
            />
          </div>
          <Icon name="ArrowRight" size={14} className="text-muted-foreground shrink-0" />
          <div className="flex items-center gap-2 bg-muted border border-border rounded-sm px-3 h-9 w-48 focus-within:border-[hsl(var(--green))] transition-colors">
            <input
              className="flex-1 bg-transparent text-sm font-mono outline-none placeholder:text-muted-foreground/40"
              placeholder="https://acoustics.si"
              value={targetSite}
              onChange={e => setTargetSite(e.target.value)}
            />
          </div>
          {running ? (
            <button
              onClick={stopParsing}
              className="h-9 px-4 bg-destructive text-white text-xs font-mono rounded-sm flex items-center gap-2 hover:opacity-90 transition-opacity"
            >
              <Icon name="Square" size={12} />
              Стоп
            </button>
          ) : (
            <button
              onClick={startParsing}
              disabled={url.length < 8}
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
              <div className="h-full bg-[hsl(var(--green))] transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs font-mono text-muted-foreground mt-1">{progress}% — {progress < 30 ? "загрузка страницы..." : progress < 85 ? "извлечение и перевод текстов..." : "финализация..."}</p>
          </div>
        )}
      </div>

      {/* Layout */}
      <div className="flex-1 max-w-screen-xl mx-auto w-full px-6 py-5 flex gap-5">

        {/* Sidebar */}
        <aside className="w-52 shrink-0 space-y-3 animate-fade-in">

          {/* Translation settings */}
          <Panel>
            <div className="px-3 pt-3 pb-2 border-b border-border flex items-center justify-between">
              <p className="text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">Перевод</p>
              <ToggleSwitch checked={doTranslate} onChange={setDoTranslate} />
            </div>
            <div className="p-3 space-y-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Источник</label>
                <select
                  value={sourceLang}
                  onChange={e => setSourceLang(e.target.value)}
                  className="w-full h-7 bg-muted border border-border rounded-sm px-2 text-xs font-mono text-foreground outline-none focus:border-[hsl(var(--green))] transition-colors"
                >
                  <option value="русского">Русский</option>
                  <option value="английского">Английский</option>
                  <option value="немецкого">Немецкий</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Перевести на</label>
                <select
                  value={targetLang}
                  onChange={e => setTargetLang(e.target.value)}
                  className="w-full h-7 bg-muted border border-border rounded-sm px-2 text-xs font-mono text-foreground outline-none focus:border-[hsl(var(--green))] transition-colors"
                >
                  <option value="словенский">Словенский</option>
                  <option value="английский">Английский</option>
                  <option value="немецкий">Немецкий</option>
                  <option value="французский">Французский</option>
                  <option value="испанский">Испанский</option>
                </select>
              </div>
              {!doTranslate && (
                <p className="text-xs text-muted-foreground/40 italic">перевод отключён</p>
              )}
            </div>
          </Panel>

          {/* Stats */}
          {parsed && parseData && (
            <Panel className="animate-fade-in">
              <div className="px-3 pt-3 pb-2 border-b border-border">
                <p className="text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">Статистика</p>
              </div>
              <div className="p-3 space-y-2">
                {[
                  { label: "Блоков текста", val: parseData.stats.total_blocks, color: "text-green" },
                  { label: "Ссылок", val: parseData.stats.total_links, color: "text-cyan-400" },
                  { label: "Bitrix компон.", val: parseData.stats.bitrix_count, color: "text-purple-400" },
                  { label: "Размер HTML", val: `${parseData.stats.html_size_kb} KB`, color: "text-blue-400" },
                ].map(s => (
                  <div key={s.label} className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{s.label}</span>
                    <span className={`text-xs font-mono font-semibold ${s.color}`}>{s.val}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

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
                onClick={handleExport}
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
                {tab.id === "results" && parseData && (
                  <span className="ml-0.5 px-1 bg-[hsl(var(--green))]/20 rounded text-green">{parseData.stats.total_blocks}</span>
                )}
              </button>
            ))}
          </div>

          {/* CONFIG */}
          {activeTab === "config" && (
            <div className="animate-fade-in space-y-4">
              <Panel className="p-4">
                <SectionHeader title="Задание парсинга" subtitle="Источник и цель" />
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Сайт-источник</label>
                    <input
                      className="w-full h-8 bg-muted border border-border rounded-sm px-3 text-xs font-mono outline-none focus:border-[hsl(var(--green))] transition-colors"
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Целевой сайт</label>
                    <input
                      className="w-full h-8 bg-muted border border-border rounded-sm px-3 text-xs font-mono outline-none focus:border-[hsl(var(--green))] transition-colors"
                      value={targetSite}
                      onChange={e => setTargetSite(e.target.value)}
                    />
                  </div>
                </div>
              </Panel>

              <div className="grid grid-cols-2 gap-4">
                <Panel className="p-4 space-y-3">
                  <SectionHeader title="Перевод" />
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">Включить перевод</label>
                    <ToggleSwitch checked={doTranslate} onChange={setDoTranslate} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Язык источника</label>
                    <select
                      value={sourceLang}
                      onChange={e => setSourceLang(e.target.value)}
                      className="w-full h-8 bg-muted border border-border rounded-sm px-2 text-xs font-mono text-foreground outline-none"
                    >
                      <option value="русского">Русский</option>
                      <option value="английского">Английский</option>
                      <option value="немецкого">Немецкий</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Язык перевода</label>
                    <select
                      value={targetLang}
                      onChange={e => setTargetLang(e.target.value)}
                      className="w-full h-8 bg-muted border border-border rounded-sm px-2 text-xs font-mono text-foreground outline-none"
                    >
                      <option value="словенский">Словенский</option>
                      <option value="английский">Английский</option>
                      <option value="немецкий">Немецкий</option>
                      <option value="французский">Французский</option>
                    </select>
                  </div>
                </Panel>

                <Panel className="p-4 space-y-3">
                  <SectionHeader title="Параметры" />
                  {[
                    { label: "Следовать редиректам",   on: true  },
                    { label: "Распознавать Bitrix-теги", on: true },
                    { label: "Авто-определение кодировки", on: true },
                    { label: "Лимит: 120 блоков",      on: true  },
                  ].map(opt => (
                    <div key={opt.label} className="flex items-center justify-between gap-3">
                      <label className="text-xs text-muted-foreground">{opt.label}</label>
                      <ToggleSwitch checked={opt.on} onChange={() => {}} />
                    </div>
                  ))}
                </Panel>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={startParsing}
                  disabled={url.length < 8 || running}
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
              {!parsed || !parseData ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <div className="w-12 h-12 border border-border rounded-sm flex items-center justify-center mb-4">
                    <Icon name="Scan" size={22} className="text-muted-foreground" />
                  </div>
                  <p className="text-sm font-mono text-muted-foreground">Результаты появятся после парсинга</p>
                  <p className="text-xs text-muted-foreground/40 mt-1">Укажите URL и нажмите «Запустить»</p>
                </div>
              ) : (
                <>
                  {/* Meta */}
                  <Panel className="p-4">
                    <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">Метаданные страницы</p>
                    <div className="space-y-1">
                      <div className="flex gap-3">
                        <span className="text-xs font-mono text-muted-foreground/60 w-20 shrink-0">title</span>
                        <span className="text-xs font-mono text-foreground">{parseData.meta.title || "—"}</span>
                      </div>
                      <div className="flex gap-3">
                        <span className="text-xs font-mono text-muted-foreground/60 w-20 shrink-0">description</span>
                        <span className="text-xs font-mono text-muted-foreground">{parseData.meta.description || "—"}</span>
                      </div>
                      <div className="flex gap-3">
                        <span className="text-xs font-mono text-muted-foreground/60 w-20 shrink-0">url</span>
                        <a href={parseData.url} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-cyan-400 hover:underline">{parseData.url}</a>
                      </div>
                    </div>
                  </Panel>

                  {/* Bitrix */}
                  {parseData.bitrix_components.length > 0 && (
                    <Panel className="p-4 animate-fade-in">
                      <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">Bitrix-компоненты ({parseData.bitrix_components.length})</p>
                      <div className="flex flex-wrap gap-2">
                        {parseData.bitrix_components.map(c => (
                          <span key={c} className="text-xs font-mono text-purple-400 bg-purple-400/10 px-2 py-0.5 rounded-sm border border-purple-400/20">{c}</span>
                        ))}
                      </div>
                    </Panel>
                  )}

                  {/* Text blocks grouped by tag */}
                  <Panel>
                    <div className="px-4 pt-3 pb-2 border-b border-border flex items-center justify-between">
                      <p className="text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">
                        Текстовые блоки ({parseData.blocks.length})
                      </p>
                      <span className="text-xs font-mono text-muted-foreground/50">оригинал → перевод</span>
                    </div>
                    <div className="divide-y divide-border max-h-[420px] overflow-y-auto scrollbar-thin">
                      {blocksByTag.map(([tag, blocks]) => (
                        <div key={tag}>
                          <button
                            onClick={() => setExpandedBlock(expandedBlock === tag ? null : tag)}
                            className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-muted/20 transition-colors"
                          >
                            <span className="text-xs font-mono text-muted-foreground/60 bg-muted px-1.5 py-px rounded-sm w-12 text-center">{tag}</span>
                            <span className="text-xs font-mono text-muted-foreground">{blocks.length} блок{blocks.length === 1 ? "" : blocks.length < 5 ? "а" : "ов"}</span>
                            <Icon name={expandedBlock === tag ? "ChevronUp" : "ChevronDown"} size={11} className="ml-auto text-muted-foreground" />
                          </button>
                          {expandedBlock === tag && (
                            <div className="animate-fade-in">
                              {blocks.slice(0, 20).map((b, i) => (
                                <div key={i} className="px-4 py-2.5 border-t border-border/50 grid grid-cols-2 gap-4 bg-muted/5">
                                  <p className="text-xs text-muted-foreground/80 font-mono leading-relaxed">{b.original}</p>
                                  <p className="text-xs text-foreground font-mono leading-relaxed">{b.translated || <span className="text-muted-foreground/30 italic">—</span>}</p>
                                </div>
                              ))}
                              {blocks.length > 20 && (
                                <div className="px-4 py-2 text-xs font-mono text-muted-foreground/40 text-center border-t border-border/50">
                                  +{blocks.length - 20} блоков — скачайте файл для полного списка
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </Panel>

                  {/* Links */}
                  {parseData.links.length > 0 && (
                    <Panel className="animate-fade-in">
                      <button
                        onClick={() => setExpandedBlock(expandedBlock === "links" ? null : "links")}
                        className="w-full px-4 py-3 flex items-center gap-2 hover:bg-muted/20 transition-colors"
                      >
                        <Icon name="Link2" size={13} className="text-cyan-400" />
                        <span className="text-sm font-mono">Ссылки</span>
                        <span className="text-xs font-mono text-muted-foreground">{parseData.links.length} шт</span>
                        <Icon name={expandedBlock === "links" ? "ChevronUp" : "ChevronDown"} size={11} className="ml-auto text-muted-foreground" />
                      </button>
                      {expandedBlock === "links" && (
                        <div className="border-t border-border px-4 py-3 animate-fade-in flex flex-wrap gap-1.5">
                          {parseData.links.slice(0, 30).map(l => (
                            <span key={l} className="text-xs font-mono text-cyan-400/70 bg-cyan-400/5 px-1.5 py-0.5 rounded-sm border border-cyan-400/15">{l}</span>
                          ))}
                          {parseData.links.length > 30 && (
                            <span className="text-xs font-mono text-muted-foreground/40">+{parseData.links.length - 30} ещё</span>
                          )}
                        </div>
                      )}
                    </Panel>
                  )}
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
                <button onClick={() => setLogs([])} className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
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
                    logs.filter(l => l && l.level).map(log => (
                      <div key={log.id} className={`log-line ${log.level} animate-slide-in`}>
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
                  subtitle="Правила применяются при экспорте файла"
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
                        placeholder="ex-sound.ru"
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
                          placeholder="acoustics.si"
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

              <div className="flex justify-between items-center">
                <p className="text-xs text-muted-foreground font-mono">Правила применяются при скачивании файла</p>
                <button
                  onClick={handleExport}
                  disabled={!parsed}
                  className="h-8 px-4 bg-[hsl(var(--green))] text-black text-xs font-mono font-semibold rounded-sm flex items-center gap-1.5 hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Icon name="Download" size={12} />
                  Скачать с заменами
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-screen-xl mx-auto px-6 h-9 flex items-center justify-between text-xs font-mono text-muted-foreground/30">
          <span>SiteParser Pro — реальный парсинг и перевод</span>
          <span>ex-sound.ru → acoustics.si · JSON · XML · CSV</span>
        </div>
      </footer>
    </div>
  );
}
