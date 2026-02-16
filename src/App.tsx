import { useEffect, useMemo, useState } from 'react';
import { CZECH_MONTHS, WEEKDAY_SHORT } from './constants';
import { generateSchedule } from './scheduler';
import { loadState, saveState } from './storage';
import type { Doctor, PreferenceValue, ScheduleResult } from './types';
import { daysInMonth, weekdayMondayIndex } from './utils/date';

const PREF_LABELS: Record<PreferenceValue, string> = {
  0: 'Bez omezení',
  1: 'Nemůže',
  2: 'Nechce',
  3: 'Chce',
};

const PREF_SHORT: Record<PreferenceValue, string> = {
  0: 'OK',
  1: 'X',
  2: 'Ne',
  3: 'Chci',
};

const PREF_CLASS: Record<PreferenceValue, string> = {
  0: 'bg-white text-slate-700 border-slate-200',
  1: 'bg-rose-100 text-rose-800 border-rose-300',
  2: 'bg-amber-100 text-amber-800 border-amber-300',
  3: 'bg-emerald-100 text-emerald-800 border-emerald-300',
};
const PREF_VALUES: PreferenceValue[] = [0, 1, 2, 3];

function roleLabel(role: Doctor['role']): string {
  if (role === 'primar') {
    return 'Primář';
  }
  if (role === 'zastupce') {
    return 'Zástupce';
  }
  return 'Běžný';
}

function cyclePref(current: PreferenceValue): PreferenceValue {
  if (current === 3) {
    return 0;
  }
  return (current + 1) as PreferenceValue;
}

function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function monthCells(year: number, month: number, dayCount: number): Array<number | null> {
  const firstWeekday = weekdayMondayIndex(year, month, 1);
  const cells: Array<number | null> = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= dayCount; day += 1) {
    cells.push(day);
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

export default function App() {
  const initial = useMemo(() => loadState(), []);

  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [doctors, setDoctors] = useState<Doctor[]>(initial.doctors);
  const [maxShiftsByDoctor, setMaxShiftsByDoctor] = useState(initial.maxShiftsByDoctor);
  const [targetShiftsByDoctor, setTargetShiftsByDoctor] = useState(initial.targetShiftsByDoctor);
  const [preferences, setPreferences] = useState(initial.preferences);
  const [locks, setLocks] = useState(initial.locks);
  const [previousMonthLastTwo, setPreviousMonthLastTwo] = useState(initial.previousMonthLastTwo);
  const [seed, setSeed] = useState(initial.seed);
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [activeDoctorId, setActiveDoctorId] = useState(initial.doctors[0]?.id ?? 1);

  const dayCount = useMemo(() => daysInMonth(year, month), [year, month]);
  const cells = useMemo(() => monthCells(year, month, dayCount), [year, month, dayCount]);
  const activeDoctor = useMemo(() => doctors.find((d) => d.id === activeDoctorId) ?? doctors[0], [doctors, activeDoctorId]);

  useEffect(() => {
    if (!doctors.some((d) => d.id === activeDoctorId)) {
      setActiveDoctorId(doctors[0]?.id ?? 1);
    }
  }, [doctors, activeDoctorId]);

  useEffect(() => {
    saveState({
      year,
      month,
      doctors,
      maxShiftsByDoctor,
      targetShiftsByDoctor,
      preferences,
      locks,
      previousMonthLastTwo,
      seed,
    });
  }, [year, month, doctors, maxShiftsByDoctor, targetShiftsByDoctor, preferences, locks, previousMonthLastTwo, seed]);

  const updateDoctorName = (id: number, name: string) => {
    setDoctors((prev) => prev.map((d) => (d.id === id ? { ...d, name } : d)));
  };

  const updateMaxShifts = (doctorId: number, value: string) => {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    setMaxShiftsByDoctor((prev) => ({ ...prev, [doctorId]: safe }));
    setTargetShiftsByDoctor((prev) => ({
      ...prev,
      [doctorId]: Math.min(Math.max(0, prev[doctorId] ?? safe), safe),
    }));
  };

  const updateTargetShifts = (doctorId: number, value: string) => {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    const doctor = doctors.find((d) => d.id === doctorId);
    const maxForDoctor =
      doctor?.role === 'primar'
        ? 1
        : doctor?.role === 'zastupce'
          ? 2
          : Math.max(0, Math.floor(maxShiftsByDoctor[doctorId] ?? 5));
    setTargetShiftsByDoctor((prev) => ({ ...prev, [doctorId]: Math.min(safe, maxForDoctor) }));
  };

  const setPref = (doctorId: number, day: number) => {
    setPreferences((prev) => {
      const current = (prev[doctorId]?.[day] ?? 0) as PreferenceValue;
      const next = cyclePref(current);
      return {
        ...prev,
        [doctorId]: {
          ...(prev[doctorId] ?? {}),
          [day]: next,
        },
      };
    });
  };

  const runGeneration = () => {
    const next = generateSchedule({
      year,
      month,
      doctors,
      maxShiftsByDoctor,
      targetShiftsByDoctor,
      preferences,
      locks,
      previousMonthLastTwo,
      seed: seed.trim() || undefined,
    });
    setResult(next);
  };

  const exportCsv = () => {
    if (!result || !result.ok) {
      return;
    }
    const lines = ['den,datum,lekar'];
    for (let day = 1; day <= dayCount; day += 1) {
      const doctor = doctors.find((d) => d.id === result.assignments[day]);
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      lines.push(`${day},${date},"${doctor?.name ?? ''}"`);
    }
    downloadCsv(lines.join('\n'), `sluzby-${year}-${String(month).padStart(2, '0')}.csv`);
  };

  const lockedCount = useMemo(
    () => Array.from({ length: dayCount }, (_, idx) => idx + 1).filter((day) => locks[day] != null).length,
    [locks, dayCount],
  );

  const toggleLockFromResult = (day: number) => {
    if (!result || !result.ok) {
      return;
    }
    const assignedDoctorId = result.assignments[day];
    setLocks((prev) => ({
      ...prev,
      [day]: prev[day] === assignedDoctorId ? null : assignedDoctorId,
    }));
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 text-slate-900">
      <h1 className="mb-4 text-2xl font-bold">Měsíční přehled sloužících lékařů</h1>

      <div className="no-print space-y-6">
        <section className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">1) Měsíc + rok</h2>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2">
              <span>Měsíc</span>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="rounded border border-slate-300 px-2 py-1"
              >
                {CZECH_MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span>Rok</span>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-28 rounded border border-slate-300 px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-2">
              <span>Seed (volitelný)</span>
              <input
                type="text"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1"
                placeholder="např. pokus-2"
              />
            </label>
          </div>
        </section>

        <section className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">2) Lékaři (fixní pořadí #1–#10)</h2>
          <div className="mb-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            Limity: Primář má pevně max 1, Zástupce pevně max 2, ostatním nastavíš max ručně.
            U každého lékaře lze navíc zadat požadovaný počet služeb.
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {doctors.map((doctor) => (
              <div key={doctor.id} className="rounded border border-slate-200 p-2">
                <div className="mb-2 flex items-center gap-2">
                  <span className="w-10 text-sm text-slate-600">#{doctor.order}</span>
                  <input
                    type="text"
                    value={doctor.name}
                    onChange={(e) => updateDoctorName(doctor.id, e.target.value)}
                    className="flex-1 rounded border border-slate-300 px-2 py-1"
                  />
                  <span className="text-xs uppercase text-slate-500">{roleLabel(doctor.role)}</span>
                </div>
                <label className="mb-2 flex items-center gap-2 text-sm">
                  <span>Max služeb/měsíc</span>
                  <input
                    type="number"
                    min={0}
                    value={doctor.role === 'primar' ? 1 : doctor.role === 'zastupce' ? 2 : (maxShiftsByDoctor[doctor.id] ?? 5)}
                    onChange={(e) => updateMaxShifts(doctor.id, e.target.value)}
                    disabled={doctor.role === 'primar' || doctor.role === 'zastupce'}
                    className="w-20 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <span>Požadovaný počet služeb</span>
                  <input
                    type="number"
                    min={0}
                    value={targetShiftsByDoctor[doctor.id] ?? 0}
                    onChange={(e) => updateTargetShifts(doctor.id, e.target.value)}
                    className="w-20 rounded border border-slate-300 px-2 py-1"
                  />
                </label>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">3) Minulý měsíc – poslední 2 dny</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-2">
              <span className="w-48 text-sm">Předposlední den měsíce</span>
              <select
                value={previousMonthLastTwo.penultimateDoctorId ?? ''}
                onChange={(e) =>
                  setPreviousMonthLastTwo((prev) => ({
                    ...prev,
                    penultimateDoctorId: e.target.value ? Number(e.target.value) : null,
                  }))
                }
                className="flex-1 rounded border border-slate-300 px-2 py-1"
              >
                <option value="">Nezadáno</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2">
              <span className="w-48 text-sm">Poslední den měsíce</span>
              <select
                value={previousMonthLastTwo.lastDoctorId ?? ''}
                onChange={(e) =>
                  setPreviousMonthLastTwo((prev) => ({
                    ...prev,
                    lastDoctorId: e.target.value ? Number(e.target.value) : null,
                  }))
                }
                className="flex-1 rounded border border-slate-300 px-2 py-1"
              >
                <option value="">Nezadáno</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-600">Lékař z posledního dne minulého měsíce nemůže sloužit den 1.</p>
        </section>

        <section className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">4) Požadavky a dostupnost</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            {doctors.map((doctor) => (
              <button
                key={doctor.id}
                type="button"
                onClick={() => setActiveDoctorId(doctor.id)}
                className={`rounded-full border px-3 py-1 text-sm ${
                  activeDoctor?.id === doctor.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-800'
                }`}
              >
                #{doctor.order} {doctor.name}
              </button>
            ))}
          </div>

          <div className="mb-3 grid gap-2 text-xs sm:grid-cols-4">
            {PREF_VALUES.map((value) => {
              return (
                <div key={value} className={`rounded border px-2 py-1 ${PREF_CLASS[value]}`}>
                  {PREF_SHORT[value]} = {PREF_LABELS[value]}
                </div>
              );
            })}
          </div>

          <p className="mb-3 text-sm text-slate-600">
            Aktivní lékař: <span className="font-medium">{activeDoctor?.name}</span>. Kliknutím na den přepínáš stav:
            Bez omezení → Nemůže → Nechce → Chce.
          </p>

          <div className="grid grid-cols-7 gap-1 border border-slate-200 p-2">
            {WEEKDAY_SHORT.map((d) => (
              <div key={d} className="p-2 text-center text-xs font-semibold text-slate-600">
                {d}
              </div>
            ))}
            {cells.map((day, idx) => {
              if (!day || !activeDoctor) {
                return <div key={idx} className="min-h-20 rounded bg-slate-50" />;
              }
              const pref = (preferences[activeDoctor.id]?.[day] ?? 0) as PreferenceValue;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setPref(activeDoctor.id, day)}
                  className={`min-h-20 rounded border p-2 text-left ${PREF_CLASS[pref]}`}
                  title={`${activeDoctor.name}: ${PREF_LABELS[pref]}`}
                >
                  <div className="text-xs font-semibold">{day}</div>
                  <div className="mt-1 text-xs">{PREF_SHORT[pref]}</div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">5) Generování</h2>
          <div className="mb-3 text-sm text-slate-600">Aktuálně zamčeno dní: {lockedCount}</div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={runGeneration}
              className="rounded bg-slate-900 px-4 py-2 text-white"
            >
              Generovat rozpis
            </button>
            <button type="button" onClick={() => window.print()} className="rounded bg-slate-200 px-4 py-2">
              Tisk A4
            </button>
            <button type="button" onClick={exportCsv} className="rounded bg-slate-200 px-4 py-2">
              Export CSV
            </button>
          </div>
        </section>
      </div>

      <section className="mt-6 rounded-lg bg-white p-4 shadow-sm print:shadow-none">
        <h2 className="mb-2 text-xl font-semibold">
          Služby – {CZECH_MONTHS[month - 1]} {year}
        </h2>

        {!result && <p className="text-slate-600">Rozpis zatím nebyl vygenerován.</p>}

        {result && !result.ok && (
          <div>
            <p className="mb-2 font-semibold text-rose-700">Rozpis nelze vytvořit.</p>
            <ul className="list-disc pl-5 text-sm text-rose-700">
              {result.conflicts.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        {result && result.ok && (
          <>
            <div className="grid grid-cols-7 gap-1 border border-slate-200 p-2 text-sm">
              {WEEKDAY_SHORT.map((d) => (
                <div key={d} className="p-2 text-center font-semibold">
                  {d}
                </div>
              ))}
              {cells.map((day, idx) => (
                <div key={idx} className="min-h-24 border border-slate-100 p-2">
                  {day && (
                    <>
                      <div className="text-xs font-semibold text-slate-600">{day}</div>
                      <div className="mt-1 text-sm">
                        {doctors.find((d) => d.id === result.assignments[day])?.name ?? '—'}
                      </div>
                      <div className="no-print mt-2">
                        <button
                          type="button"
                          onClick={() => toggleLockFromResult(day)}
                          className="rounded border border-slate-300 px-2 py-1 text-xs"
                        >
                          {locks[day] === result.assignments[day] ? 'Odemknout' : 'Zamknout'}
                        </button>
                      </div>
                      {locks[day] != null && (
                        <div className="mt-1 text-xs font-medium text-blue-700">
                          Zamčeno: {doctors.find((d) => d.id === locks[day])?.name}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4">
              <h3 className="mb-2 text-lg font-semibold">Statistiky</h3>
              <ul className="space-y-1 text-sm">
                {doctors.map((doctor) => (
                  <li key={doctor.id}>
                    {doctor.name}: služeb {result.stats.totalByDoctor[doctor.id] ?? 0} / cíl{' '}
                    {targetShiftsByDoctor[doctor.id] ?? 0}, víkendy {result.stats.weekendByDoctor[doctor.id] ?? 0}
                  </li>
                ))}
                <li className="pt-1 font-medium">Pá+Ne párování: {result.stats.friSunPairings}</li>
              </ul>

              <p className="mt-4 text-xs text-slate-500">
                Vygenerováno: {new Date().toLocaleString('cs-CZ')}
                {result.seedUsed ? ` | seed: ${result.seedUsed}` : ''}
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
