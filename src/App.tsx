import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import type { AuditModel, AuditSection, Mark, SectionResult, View } from './audit/types';
import { readAuditWorkbook } from './audit/xlsxReader';
import {
  auditIsComplete,
  hasRecordData,
  isRecordComplete,
  setRecordMark,
  summarizeAudit,
  summarizeOverall,
} from './audit/logic';

const STORAGE_KEY = 'calaud-auditoria-v1';

function readDraft(): AuditModel | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as AuditModel & {
      criteria?: Record<string, AuditSection['criteria']>;
      records?: Record<string, AuditSection['records']>;
    };
    if (Array.isArray(value.sections) && value.sections.length) return value;
    if (!value.criteria?.DM?.length || !value.criteria?.HTA?.length || !value.records?.DM || !value.records?.HTA) return null;
    return {
      title: value.title,
      instrumentName: 'Riesgo cardiovascular (RCV)',
      periodStart: value.periodStart,
      periodEnd: value.periodEnd,
      samplingMethod: value.samplingMethod,
      sourceVersion: value.sourceVersion,
      scoring: { numerator: 'C', denominatorMarks: ['C', 'NC'], label: 'Cumple ÷ (Cumple + No cumple); N/A se excluye.' },
      sections: [
        { id: 'DM', name: 'Diabetes mellitus tipo 2', criteria: value.criteria.DM, records: value.records.DM },
        { id: 'HTA', name: 'Hipertensión arterial', criteria: value.criteria.HTA, records: value.records.HTA },
      ],
      updatedAt: value.updatedAt,
    };
  } catch {
    return null;
  }
}

function percent(value: number | null) {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function number(value: number) {
  return new Intl.NumberFormat('es-CO').format(value);
}

function Button({
  children,
  onClick,
  variant = 'secondary',
  type = 'button',
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  const classes = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 border-indigo-600',
    secondary: 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200',
    quiet: 'bg-transparent text-slate-600 hover:bg-slate-100 border-transparent',
    danger: 'bg-rose-50 text-rose-700 hover:bg-rose-100 border-rose-200',
  };
  return <button type={type} disabled={disabled} onClick={onClick} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${classes[variant]}`}>{children}</button>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
    {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
  </article>;
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center sm:p-12">
    <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 text-2xl text-indigo-700">✓</div>
    <h2 className="mt-4 text-xl font-bold text-slate-900">Carga la lista de chequeo para comenzar</h2>
    <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">Carga un instrumento de auditoría compatible. Calaud extrae sus criterios y marcas para preparar la captura, el tablero y un informe revisable por el equipo auditor.</p>
    <p className="mt-2 text-xs text-slate-500">Plantillas incluidas: R-GCAL101-76 (DM/HTA), R-GCAL101-71 (control prenatal) y R-GCAL101-72 (seis etapas de vida).</p>
    <div className="mt-5"><Button variant="primary" onClick={onUpload}>Seleccionar Excel .xlsx</Button></div>
    <p className="mt-4 text-xs text-slate-500">No incluyas nombres, números de historia ni otros identificadores en notas o nombres de archivo.</p>
  </section>;
}

function App() {
  const [audit, setAudit] = useState<AuditModel | null>(readDraft);
  const [view, setView] = useState<View>('dashboard');
  const [sectionId, setSectionId] = useState('');
  const [slot, setSlot] = useState(1);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (audit) localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...audit, updatedAt: new Date().toISOString() }));
    else localStorage.removeItem(STORAGE_KEY);
  }, [audit]);

  const summaries = useMemo(() => audit ? summarizeAudit(audit) : null, [audit]);
  const selectedSection = audit?.sections.find((section) => section.id === sectionId) ?? audit?.sections[0] ?? null;
  const activeSectionId = selectedSection?.id ?? '';
  const activeRecords = selectedSection?.records ?? [];
  const activeRecord = activeRecords[slot - 1] ?? null;
  const activeCriterionIds = selectedSection?.criteria.map((criterion) => criterion.id) ?? [];
  const activeProgress = activeRecord
    ? activeCriterionIds.filter((id) => activeRecord.marks[id] !== null).length
    : 0;
  const activeComplete = activeRecord ? isRecordComplete(activeRecord, activeCriterionIds) : false;
  const overall = summaries && audit ? summarizeOverall(summaries, audit.scoring) : null;

  function uploadClick() {
    setError('');
    inputRef.current?.click();
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setError('');
    if (audit && !window.confirm('Cargar otro archivo reemplazará la auditoría guardada en este navegador. ¿Deseas continuar?')) {
      event.currentTarget.value = '';
      return;
    }
    try {
      const loaded = await readAuditWorkbook(file);
      setAudit(loaded);
      setFileName(file.name);
      setSectionId(loaded.sections[0]?.id ?? '');
      setSlot(1);
      setView('audit');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo leer el archivo.');
    } finally {
      event.currentTarget.value = '';
    }
  }

  function updateMetadata(key: 'title' | 'periodStart' | 'periodEnd' | 'samplingMethod', value: string) {
    setAudit((current) => current ? { ...current, [key]: value, updatedAt: new Date().toISOString() } : current);
  }

  function updateMark(criterionId: string, mark: Mark | null, row: number) {
    setAudit((current) => {
      if (!current) return current;
      const next = { ...current, sections: current.sections.map((section) => ({ ...section })) };
      const section = next.sections.find((item) => item.id === activeSectionId);
      if (!section) return current;
      const records = [...section.records];
      const record = records[slot - 1];
      if (!record) return current;
      const updated = setRecordMark(record, criterionId, mark);
      updated.errors = updated.errors.filter((message) => !message.startsWith(`Fila ${row}:`));
      records[slot - 1] = updated;
      section.records = records;
      next.updatedAt = new Date().toISOString();
      return next;
    });
  }

  function clearCurrentRecord() {
    if (!activeRecord || !window.confirm(`Borrar las marcas del consecutivo ${slot} en ${selectedSection?.name ?? 'esta sección'}?`)) return;
    setAudit((current) => {
      if (!current) return current;
      return {
        ...current,
        sections: current.sections.map((section) => section.id !== activeSectionId ? section : {
          ...section,
          records: section.records.map((record, index) => index === slot - 1
            ? { ...record, marks: Object.fromEntries(activeCriterionIds.map((id) => [id, null])), errors: [] }
            : record),
        }),
        updatedAt: new Date().toISOString(),
      };
    });
  }

  function clearAudit() {
    if (!window.confirm('Se eliminará el avance guardado en este navegador. ¿Continuar?')) return;
    setAudit(null);
    setFileName('');
    setSectionId('');
    setSlot(1);
    setView('dashboard');
  }

  function printReport() {
    window.print();
  }

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="screen-only sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <button className="flex items-center gap-3 text-left" onClick={() => setView('dashboard')} aria-label="Ir al tablero">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-indigo-600 text-lg font-black text-white">C</span>
          <span><span className="block text-sm font-extrabold tracking-tight">Calaud</span><span className="block text-[11px] text-slate-500">Auditoría clínica · {audit?.instrumentName ?? 'local'}</span></span>
        </button>
        <nav className="flex gap-1 overflow-x-auto" aria-label="Secciones">
          {([
            ['dashboard', 'Tablero'],
            ['audit', 'Diligenciar'],
            ['report', 'Informe'],
          ] as [View, string][]).map(([key, label]) => <button key={key} onClick={() => setView(key)} disabled={!audit && key !== 'dashboard'} className={`rounded-xl px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${view === key ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>)}
        </nav>
        <div className="flex items-center gap-2">
          <Button onClick={uploadClick} variant="secondary">Cargar Excel</Button>
          {audit && <Button onClick={clearAudit} variant="quiet">Nueva auditoría</Button>}
        </div>
      </div>
    </header>

    <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={onFileChange} />

    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {error && <div role="alert" className="mb-5 flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><span>{error}</span><button className="font-bold" onClick={() => setError('')}>Cerrar</button></div>}

      {view === 'dashboard' && <Dashboard audit={audit} summaries={summaries} overall={overall} fileName={fileName} onUpload={uploadClick} onGoAudit={() => setView('audit')} onGoReport={() => setView('report')} />}
      {view === 'audit' && audit && <section>
        <PageHeading eyebrow={`Captura · ${audit.instrumentName}`} title="Diligenciar auditoría" subtitle="Marca cada criterio según la revisión humana. Usa sólo el consecutivo de la muestra." />
        <div className="mb-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-4">
          <label className="sm:col-span-2"><span className="mb-1 block text-xs font-semibold text-slate-600">Nombre del informe</span><input className="field" value={audit.title} onChange={(e) => updateMetadata('title', e.target.value)} /></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Periodo desde</span><input className="field" type="date" value={audit.periodStart} onChange={(e) => updateMetadata('periodStart', e.target.value)} /></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Periodo hasta</span><input className="field" type="date" value={audit.periodEnd} onChange={(e) => updateMetadata('periodEnd', e.target.value)} /></label>
          <label className="sm:col-span-4"><span className="mb-1 block text-xs font-semibold text-slate-600">Método de selección de muestra</span><input className="field" value={audit.samplingMethod} onChange={(e) => updateMetadata('samplingMethod', e.target.value)} /></label>
        </div>

        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
          <p><strong>Privacidad:</strong> no registres nombres, documentos, números de historia, fechas de atención ni texto clínico libre. El consecutivo sólo identifica una posición de la muestra.</p>
          {fileName && <p className="shrink-0 text-xs font-medium text-amber-800">Plantilla: {fileName}</p>}
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {audit.sections.map((section) => {
            const result = summaries?.find((item) => item.sectionId === section.id);
            return <button key={section.id} onClick={() => { setSectionId(section.id); setSlot(1); }} className={`rounded-xl border px-4 py-2.5 text-sm font-bold ${activeSectionId === section.id ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>{section.name} <span className="ml-1 text-xs opacity-75">({result?.cases ?? 0}/{section.records.length})</span></button>;
          })}
        </div>

        <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Consecutivos de muestra</p><p className="mt-1 text-sm text-slate-600">Activos: {number(summaries?.find((item) => item.sectionId === activeSectionId)?.cases ?? 0)} · Completos: {number(summaries?.find((item) => item.sectionId === activeSectionId)?.completeCases ?? 0)}</p></div>
            <div className="flex items-center gap-3 text-xs font-semibold text-slate-500"><span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Completo</span><span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-amber-400" />En curso</span></div>
          </div>
          <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-10 lg:grid-cols-13">
            {activeRecords.map((record) => {
              const active = hasRecordData(record);
              const complete = isRecordComplete(record, activeCriterionIds);
              return <button key={record.slot} onClick={() => setSlot(record.slot)} aria-label={`Consecutivo ${record.slot}`} className={`rounded-lg border px-2 py-2 text-sm font-bold ${slot === record.slot ? 'border-indigo-600 ring-2 ring-indigo-100' : 'border-slate-200'} ${complete ? 'bg-emerald-50 text-emerald-800' : active ? 'bg-amber-50 text-amber-800' : 'bg-white text-slate-500'}`}>{record.slot}</button>;
            })}
          </div>
        </div>

        {activeRecord && <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="font-bold text-slate-900">{selectedSection?.name} · consecutivo {slot}</h2><p className="mt-1 text-xs text-slate-500">{activeProgress} de {selectedSection?.criteria.length ?? 0} criterios respondidos · {activeComplete ? 'Completo' : 'Pendiente'}</p></div>
            <div className="flex gap-2"><Button variant="quiet" onClick={clearCurrentRecord}>Limpiar consecutivo</Button><Button variant="primary" onClick={() => setSlot((current) => current < activeRecords.length ? current + 1 : 1)}>Siguiente →</Button></div>
          </div>
          {activeRecord.errors.length > 0 && <div role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"><strong>Revisa marcas del Excel:</strong> {activeRecord.errors.join(' ')}</div>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="w-16 px-4 py-3">N.º</th><th className="px-4 py-3">Criterio</th><th className="w-56 px-4 py-3">Resultado</th></tr></thead>
              <tbody>
                {selectedSection?.criteria.map((criterion) => {
                  const mark = activeRecord.marks[criterion.id] ?? '';
                  return <tr key={criterion.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{criterion.number}{criterion.category && <span className="mt-1 block max-w-28 font-sans text-[10px] leading-4 text-slate-400">{criterion.category}</span>}</td>
                    <td className="px-4 py-3 leading-6 text-slate-800">{criterion.text}</td>
                    <td className="px-4 py-3"><select className="field" aria-label={`Resultado: ${criterion.text}`} value={mark} onChange={(e) => updateMark(criterion.id, (e.target.value || null) as Mark | null, criterion.sheetRow)}><option value="">Pendiente</option><option value="C">Cumple</option><option value="NC">No cumple</option><option value="NA">N/A</option></select></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>}
        <p className="mt-3 text-xs text-slate-500">Los cambios se guardan automáticamente en este navegador. El cálculo excluye N/A del denominador.</p>
      </section>}

      {view === 'report' && audit && summaries && <Report audit={audit} summaries={summaries} overall={overall} onPrint={printReport} />}
    </main>
    <footer className="screen-only mx-auto max-w-7xl px-4 pb-8 text-xs text-slate-400 sm:px-6">Calaud · Herramienta local de apoyo a auditoría. Requiere revisión y aprobación humana.</footer>
  </div>;
}

function PageHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <div className="mb-5"><p className="text-xs font-bold uppercase tracking-[.14em] text-indigo-700">{eyebrow}</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{subtitle}</p></div>;
}

function Dashboard({
  audit, summaries, overall, fileName, onUpload, onGoAudit, onGoReport,
}: {
  audit: AuditModel | null;
  summaries: ReturnType<typeof summarizeAudit> | null;
  overall: number | null;
  fileName: string;
  onUpload: () => void;
  onGoAudit: () => void;
  onGoReport: () => void;
}) {
  if (!audit || !summaries) return <><PageHeading eyebrow="Calaud · Resumen" title="Tablero de auditoría" subtitle="Consolida resultados del instrumento cargado y prepara un informe para revisión." /><EmptyState onUpload={onUpload} /></>;

  const totalCases = summaries.reduce((sum, section) => sum + section.cases, 0);
  const totalCapacity = summaries.reduce((sum, section) => sum + section.recordCapacity, 0);
  const totalComplete = summaries.reduce((sum, section) => sum + section.completeCases, 0);
  const totalC = summaries.reduce((sum, section) => sum + section.cumple, 0);
  const totalNC = summaries.reduce((sum, section) => sum + section.noCumple, 0);
  const totalNA = summaries.reduce((sum, section) => sum + section.noAplica, 0);
  const totalPending = summaries.reduce((sum, section) => sum + section.pending, 0);
  const complete = auditIsComplete(audit);
  return <section>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <PageHeading eyebrow={`Calaud · ${audit.instrumentName}`} title="Tablero de auditoría" subtitle="Resultados acumulados por sección y oportunidades de mejora. La adherencia usa sólo criterios aplicables." />
      <div className="mb-5 flex shrink-0 gap-2"><Button onClick={onGoAudit} variant="primary">Diligenciar</Button><Button onClick={onGoReport}>Ver informe</Button></div>
    </div>
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="rounded-full bg-white px-3 py-1.5 ring-1 ring-slate-200">Instrumento {audit.sourceVersion}</span>{fileName && <span className="rounded-full bg-white px-3 py-1.5 ring-1 ring-slate-200">{fileName}</span>}<span className={`rounded-full px-3 py-1.5 ${complete ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{complete ? 'Captura completa' : 'Borrador · captura parcial'}</span></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Adherencia global" value={percent(overall)} detail={audit.scoring.label} />
      <Metric label="Consecutivos auditados" value={`${totalCases} / ${totalCapacity}`} detail={`${totalComplete} completos`} />
      <Metric label="Marcas cumple" value={number(totalC)} detail={`${number(totalNC)} no cumple`} />
      <Metric label="N/A y pendientes" value={`${number(totalNA)} / ${number(totalPending)}`} detail="N/A excluido del denominador" />
    </div>
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      {summaries.map((result) => <SectionCard key={result.sectionId} result={result} />)}
    </div>
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="font-bold">Criterios con menor adherencia</h2><p className="mt-1 text-xs text-slate-500">Se muestran criterios con al menos una evaluación aplicable.</p></div><span className="text-xs text-slate-400">Actualizado {new Date(audit.updatedAt).toLocaleString('es-CO')}</span></div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">{summaries.map((result) => {
        const opportunities = result.criteria.filter((item) => item.compliance !== null).sort((a, b) => (a.compliance ?? 0) - (b.compliance ?? 0)).slice(0, 5);
        return <div key={result.sectionId} className="rounded-xl bg-slate-50 p-3"><h3 className="text-sm font-bold">{result.sectionName}</h3>{opportunities.length ? <ul className="mt-2 space-y-2">{opportunities.map((item) => <li key={item.criterion.id} className="flex items-start justify-between gap-3 text-xs"><span className="leading-5 text-slate-700"><b className="mr-1 text-slate-400">{item.criterion.number}.</b>{item.criterion.text}</span><b className="shrink-0 text-rose-700">{percent(item.compliance)}</b></li>)}</ul> : <p className="mt-2 text-xs text-slate-500">Aún no hay criterios aplicables diligenciados.</p>}</div>;
      })}</div>
    </section>
    <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">Tablero de trabajo: la muestra debe seleccionarse según el protocolo institucional y una persona auditora debe revisar cada historia. Verifica la versión del instrumento antes de usar los resultados.</p>
  </section>;
}

function SectionCard({ result }: { result: SectionResult }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{result.sectionName}</p><h2 className="mt-1 font-bold text-slate-900">Adherencia</h2></div><span className="rounded-xl bg-indigo-50 px-3 py-2 text-lg font-extrabold text-indigo-700">{percent(result.compliance)}</span></div>
    <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.max(0, Math.min(100, result.compliance ?? 0))}%` }} /></div>
    <div className="mt-4 grid grid-cols-3 gap-2 text-xs"><div><p className="text-slate-500">Consecutivos</p><p className="mt-1 font-bold">{result.cases}/{result.recordCapacity}</p></div><div><p className="text-slate-500">Completos</p><p className="mt-1 font-bold">{result.completeCases}</p></div><div><p className="text-slate-500">Cumple / NC</p><p className="mt-1 font-bold">{result.cumple} / {result.noCumple}</p></div></div>
  </article>;
}

function Report({
  audit, summaries, overall, onPrint,
}: {
  audit: AuditModel;
  summaries: ReturnType<typeof summarizeAudit>;
  overall: number | null;
  onPrint: () => void;
}) {
  const cases = summaries.reduce((sum, section) => sum + section.cases, 0);
  const capacity = summaries.reduce((sum, section) => sum + section.recordCapacity, 0);
  const categories = summaries.flatMap((section) => section.categories
    .filter((category) => category.category !== 'Sin clasificación')
    .map((category) => ({ ...category, sectionName: section.sectionName })));
  const complete = auditIsComplete(audit);
  return <section>
    <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
      <PageHeading eyebrow="Salida automática" title="Informe de auditoría" subtitle="Borrador generado a partir de las marcas registradas en Calaud." />
      <Button variant="primary" onClick={onPrint}>Imprimir / Guardar PDF</Button>
    </div>
    <article className="print-report mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <div className="border-b-2 border-slate-900 pb-4">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-indigo-700">Calaud · Informe de auditoría · {audit.instrumentName}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-slate-950">{audit.title}</h1>
        <p className="mt-2 text-sm text-slate-600">Instrumento: {audit.sourceVersion} · Periodo: {audit.periodStart || 'No indicado'} a {audit.periodEnd || 'No indicado'}</p>
        <p className="mt-1 text-sm text-slate-600">Método de selección: {audit.samplingMethod || 'No indicado'}</p>
      </div>
      <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-950">BORRADOR — requiere revisión, validación y aprobación del equipo auditor antes de su circulación.</div>
      <section className="mt-5">
        <h2 className="text-lg font-bold">Resumen ejecutivo</h2>
        <p className="mt-2 text-sm leading-6">Se registraron {cases} consecutivos auditados de un máximo de {capacity}. La adherencia global es {percent(overall)} sobre criterios aplicables. {complete ? 'La captura de los consecutivos iniciados está completa.' : 'Hay capturas incompletas o no se han diligenciado todas las marcas de los consecutivos iniciados.'}</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">Regla de cálculo: {audit.scoring.label} Las marcas pendientes se reportan por separado.</p>
      </section>
      <section className="mt-5">
        <h2 className="text-lg font-bold">Resultados por sección</h2>
        <div className="mt-2 overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><thead><tr className="border-b border-slate-300 text-xs uppercase text-slate-500"><th className="py-2 pr-3">Sección</th><th className="py-2 pr-3">Adherencia</th><th className="py-2 pr-3">Consecutivos</th><th className="py-2 pr-3">Cumple</th><th className="py-2 pr-3">No cumple</th><th className="py-2">N/A / pendientes</th></tr></thead><tbody>{summaries.map((section) => <tr key={section.sectionId} className="border-b border-slate-100"><td className="py-2 pr-3 font-semibold">{section.sectionName}</td><td className="py-2 pr-3">{percent(section.compliance)}</td><td className="py-2 pr-3">{section.cases}/{section.recordCapacity} ({section.completeCases} completos)</td><td className="py-2 pr-3">{section.cumple}</td><td className="py-2 pr-3">{section.noCumple}</td><td className="py-2">{section.noAplica} / {section.pending}</td></tr>)}</tbody></table></div>
      </section>
      {categories.length > 0 && <section className="mt-6">
        <h2 className="text-lg font-bold">Resultados por estándar o grupo</h2>
        <div className="mt-2 overflow-x-auto"><table className="w-full border-collapse text-left text-xs"><thead><tr className="border-b border-slate-300 uppercase text-slate-500"><th className="py-2 pr-2">Sección</th><th className="py-2 pr-2">Estándar / grupo</th><th className="py-2 pr-2">Criterios</th><th className="py-2 pr-2">Adherencia</th><th className="py-2 pr-2">Cumple / NC</th><th className="py-2">N/A / pendientes</th></tr></thead><tbody>{categories.map((category, index) => <tr key={`${category.sectionName}-${category.category}-${index}`} className="border-b border-slate-100"><td className="py-2 pr-2">{category.sectionName}</td><td className="py-2 pr-2 font-semibold">{category.category}</td><td className="py-2 pr-2">{category.criteriaCount}</td><td className="py-2 pr-2">{percent(category.compliance)}</td><td className="py-2 pr-2">{category.cumple} / {category.noCumple}</td><td className="py-2">{category.noAplica} / {category.pendientes}</td></tr>)}</tbody></table></div>
      </section>}
      {summaries.map((section) => <section key={section.sectionId} className="mt-6">
        <h2 className="text-lg font-bold">Detalle de criterios · {section.sectionName}</h2>
        <div className="mt-2 overflow-x-auto"><table className="w-full border-collapse text-left text-xs"><thead><tr className="border-b border-slate-300 uppercase text-slate-500"><th className="py-2 pr-2">N.º</th><th className="py-2 pr-2">Estándar / grupo</th><th className="py-2 pr-2">Criterio</th><th className="py-2 pr-2">C</th><th className="py-2 pr-2">NC</th><th className="py-2 pr-2">N/A</th><th className="py-2 pr-2">Pend.</th><th className="py-2">Adherencia</th></tr></thead><tbody>{section.criteria.map((item) => <tr key={item.criterion.id} className="border-b border-slate-100 align-top"><td className="py-2 pr-2 font-mono">{item.criterion.number}</td><td className="py-2 pr-2">{item.criterion.category || '—'}</td><td className="py-2 pr-2">{item.criterion.text}</td><td className="py-2 pr-2">{item.cumple}</td><td className="py-2 pr-2">{item.noCumple}</td><td className="py-2 pr-2">{item.noAplica}</td><td className="py-2 pr-2">{item.pendientes}</td><td className="py-2">{percent(item.compliance)}</td></tr>)}</tbody></table></div>
      </section>)}
      <section className="mt-6 border-t border-slate-300 pt-4">
        <h2 className="text-lg font-bold">Notas de validación</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-700">
          <li>La revisión de la historia clínica y la selección de la muestra requieren intervención humana según el protocolo institucional.</li>
          <li>Confirma la versión del instrumento y las reglas de cálculo con el equipo responsable antes de circular los resultados.</li>
          <li>Este prototipo no se conecta a SAHI, no autentica usuarios y guarda el avance sólo en el navegador local.</li>
        </ul>
        <p className="mt-5 text-xs text-slate-500">Generado el {new Date().toLocaleString('es-CO')} · Datos consolidados desde las marcas capturadas en Calaud.</p>
      </section>
    </article>
  </section>;
}

export default App;

