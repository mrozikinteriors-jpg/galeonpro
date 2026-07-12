(function () {
  const JOURNAL_VERSION = 'v11';
  const STORAGE_PREFIX = 'zespol_worker_journal_v11';
  const NOTE_START = '--- DZIENNIK PRACOWNIKA v11 ---';
  const NOTE_END = '--- KONIEC DZIENNIKA PRACOWNIKA ---';

  const RECEIVER_DEPARTMENTS = [
    'Własny dział',
    'Biała sklejka',
    'Laminaty',
    'Elektrycy',
    'Hydraulika',
    'Lakiernia',
    'Ciecialnia',
    'Magazyn',
    'Inny'
  ];
  const WORK_SCOPES = [
    'Nasz zakres',
    'Pomoc innemu działowi',
    'Poprawka',
    'Postój / blokada',
    'Organizacja / transport'
  ];
  const RESULTS = ['Wykonano', 'Częściowo', 'Nie wykonano', 'W toku'];
  const PROBLEM_TYPES = [
    'Brak materiału',
    'Brak dokumentacji',
    'Błąd projektowy',
    'Kolizja z innym działem',
    'Brak decyzji',
    'Brak elementów',
    'Brak lakieru',
    'Uszkodzenie',
    'Przeciek / nieszczelność',
    'Postój',
    'Inne'
  ];
  const PROBLEM_STATUSES = ['Nowy', 'Zgłoszony', 'W trakcie', 'Rozwiązany', 'Zamknięty'];

  const originalWorkerCard = typeof workerCard === 'function' ? workerCard : null;
  const originalSaveDay = typeof saveDay === 'function' ? saveDay : null;
  const originalToggleObecny = typeof toggleObecny === 'function' ? toggleObecny : null;

  function h(value) {
    if (typeof esc === 'function') return esc(value);
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function q(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function todayTime() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function timeToMinutes(value) {
    if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
    const [hPart, mPart] = value.split(':').map(Number);
    return hPart * 60 + mPart;
  }

  function minutesToHours(mins) {
    if (!Number.isFinite(mins)) return 0;
    return Math.round((mins / 60) * 100) / 100;
  }

  function hoursLabel(mins) {
    const hVal = minutesToHours(mins);
    return `${Number.isInteger(hVal) ? hVal : hVal.toFixed(2).replace(/0$/, '')}h`;
  }

  function minutesBetween(start, end, breakMinutes) {
    const s = timeToMinutes(start);
    const e = timeToMinutes(end);
    if (s == null || e == null || e < s) return null;
    return Math.max(0, e - s - (Number(breakMinutes) || 0));
  }

  function journalDayKey() {
    const date = state?.date || 'no-date';
    const unit = state?.unitId || state?.unitName || 'no-unit';
    return `${STORAGE_PREFIX}:${date}:${unit}`;
  }

  function emptyStore() {
    return {
      version: JOURNAL_VERSION,
      meta: {
        status: 'Roboczy',
        planNextDay: '',
        updatedAt: null,
        closedAt: null,
        reopenedReason: ''
      },
      workers: {}
    };
  }

  function ensureJournalState() {
    const key = journalDayKey();
    if (state.journalKey === key && state.journalStore) return state.journalStore;

    let parsed = null;
    try {
      parsed = JSON.parse(localStorage.getItem(key) || 'null');
    } catch (error) {
      parsed = null;
    }

    if (!parsed || typeof parsed !== 'object') parsed = emptyStore();
    if (!parsed.meta) parsed.meta = emptyStore().meta;
    if (!parsed.workers) parsed.workers = {};
    parsed.version = JOURNAL_VERSION;

    state.journalKey = key;
    state.journalStore = parsed;
    return parsed;
  }

  function defaultJournal(wid) {
    const entry = typeof getEntry === 'function' ? getEntry(wid) : {};
    return {
      obecny: entry.obecny !== false,
      startTime: '',
      endTime: '',
      breakMinutes: 0,
      absenceReason: '',
      note: '',
      segments: [],
      problems: [],
      updatedAt: null
    };
  }

  function getJournal(wid) {
    const store = ensureJournalState();
    if (!store.workers[wid]) store.workers[wid] = defaultJournal(wid);
    const journal = store.workers[wid];
    if (!Array.isArray(journal.segments)) journal.segments = [];
    if (!Array.isArray(journal.problems)) journal.problems = [];
    if (typeof journal.obecny !== 'boolean') {
      const entry = typeof getEntry === 'function' ? getEntry(wid) : {};
      journal.obecny = entry.obecny !== false;
    }
    return journal;
  }

  function persistJournal(wid, rerender) {
    const store = ensureJournalState();
    store.meta.updatedAt = new Date().toISOString();
    if (wid) getJournal(wid).updatedAt = store.meta.updatedAt;
    try {
      localStorage.setItem(state.journalKey, JSON.stringify(store));
    } catch (error) {
      showToast('Nie udało się zapisać lokalnie: ' + error.message, 'error');
    }
    if (typeof markUnsaved === 'function') markUnsaved();
    if (wid) syncEntryFromJournal(wid);
    if (rerender && wid) {
      if (typeof reRenderCard === 'function') reRenderCard(wid);
      renderWorkerJournal();
    }
    if (typeof updateSummary === 'function') updateSummary();
  }

  function syncEntryFromJournal(wid) {
    if (typeof getEntry !== 'function') return;
    const entry = getEntry(wid);
    const journal = getJournal(wid);
    const stats = journalStats(journal);
    entry.obecny = journal.obecny;
    if (journal.obecny && stats.presenceMinutes != null) {
      entry.nadgodziny = Math.max(0, Math.round((stats.presenceMinutes / 60 - 8) * 2) / 2);
    }
    if (!journal.obecny) {
      entry.nadgodziny = 0;
    }
  }

  function segmentMinutes(segment) {
    return minutesBetween(segment.startTime, segment.endTime, segment.breakMinutes);
  }

  function sortSegments(segments) {
    return [...segments].sort((a, b) => (timeToMinutes(a.startTime) || 0) - (timeToMinutes(b.startTime) || 0));
  }

  function findOverlaps(segments) {
    const sorted = sortSegments(segments).filter(s => timeToMinutes(s.startTime) != null && timeToMinutes(s.endTime) != null);
    const overlaps = [];
    for (let i = 1; i < sorted.length; i++) {
      if (timeToMinutes(sorted[i].startTime) < timeToMinutes(sorted[i - 1].endTime)) {
        overlaps.push([sorted[i - 1], sorted[i]]);
      }
    }
    return overlaps;
  }

  function journalStats(journal) {
    const presenceMinutes = journal.obecny
      ? minutesBetween(journal.startTime, journal.endTime, journal.breakMinutes)
      : 0;
    const describedMinutes = journal.segments.reduce((sum, segment) => {
      const mins = segmentMinutes(segment);
      return sum + (mins || 0);
    }, 0);
    const stopMinutes = journal.segments
      .filter(segment => segment.workScope === 'Postój / blokada')
      .reduce((sum, segment) => sum + (segmentMinutes(segment) || 0), 0);
    const helperMinutes = journal.segments
      .filter(segment => segment.workScope === 'Pomoc innemu działowi')
      .reduce((sum, segment) => sum + (segmentMinutes(segment) || 0), 0);
    const diffMinutes = presenceMinutes == null ? null : presenceMinutes - describedMinutes;

    return {
      presenceMinutes,
      describedMinutes,
      diffMinutes,
      overtimeMinutes: Math.max(0, (presenceMinutes || 0) - 8 * 60),
      stopMinutes,
      helperMinutes,
      overlaps: findOverlaps(journal.segments)
    };
  }

  function hasJournalData(journal) {
    return !!(
      journal.startTime ||
      journal.endTime ||
      journal.breakMinutes ||
      journal.absenceReason ||
      journal.note ||
      journal.segments.length ||
      journal.problems.length
    );
  }

  function validateSegment(segment) {
    const errors = [];
    const mins = segmentMinutes(segment);
    if (!segment.startTime || !segment.endTime) errors.push('odcinek bez godziny od-do');
    if (mins == null) errors.push('koniec odcinka wcześniejszy niż początek');
    if ((segment.result === 'Częściowo' || segment.result === 'Nie wykonano') && !segment.reason) {
      errors.push('brak powodu dla pracy częściowej lub niewykonanej');
    }
    if (segment.workScope === 'Pomoc innemu działowi' && !segment.receiverDepartment) {
      errors.push('brak działu odbiorcy przy pomocy innemu działowi');
    }
    if (segment.workScope === 'Postój / blokada' && !segment.reason && !segment.actualWork) {
      errors.push('brak opisu przyczyny postoju');
    }
    return errors;
  }

  function validateWorkerJournal(wid, onlyWhenData) {
    const journal = getJournal(wid);
    const errors = [];
    const hasData = hasJournalData(journal);
    if (onlyWhenData && !hasData) return errors;

    if (journal.obecny) {
      if ((journal.startTime || journal.endTime || journal.segments.length) && (!journal.startTime || !journal.endTime)) {
        errors.push('pracownik obecny bez startu lub końca');
      }
      if (journal.startTime && journal.endTime && journalStats(journal).presenceMinutes == null) {
        errors.push('koniec dnia wcześniejszy niż początek');
      }
    } else {
      if (!journal.absenceReason && hasData) errors.push('brak powodu nieobecności');
      if (journal.segments.length) errors.push('pracownik nieobecny ma wpisane odcinki pracy');
    }

    journal.segments.forEach((segment, index) => {
      validateSegment(segment).forEach(error => errors.push(`odcinek ${index + 1}: ${error}`));
    });

    const stats = journalStats(journal);
    if (stats.overlaps.length) errors.push('nakładające się odcinki pracy');
    if (stats.presenceMinutes != null && stats.describedMinutes > stats.presenceMinutes + 3) {
      errors.push('więcej opisanych godzin niż godzin obecności');
    }
    return errors;
  }

  function cardStatus(wid) {
    const journal = getJournal(wid);
    const stats = journalStats(journal);
    const errors = validateWorkerJournal(wid, true);
    const hasData = hasJournalData(journal);

    if (errors.length) return { className: 'status-error', label: 'Błąd', tone: 'err' };
    if (!hasData) return { className: 'status-empty', label: 'Brak danych', tone: '' };
    if (!journal.obecny) return journal.absenceReason
      ? { className: 'status-complete', label: 'Nieobecny opisany', tone: 'ok' }
      : { className: 'status-draft', label: 'Roboczy', tone: '' };
    if (!journal.startTime || !journal.endTime) return { className: 'status-draft', label: 'Roboczy', tone: '' };
    if (Math.abs(stats.diffMinutes || 0) <= 3) return { className: 'status-complete', label: 'Kompletne', tone: 'ok' };
    if ((stats.diffMinutes || 0) > 3) return { className: 'status-missing', label: 'Brakuje opisu', tone: 'warn' };
    return { className: 'status-error', label: 'Nadmiar godzin', tone: 'err' };
  }

  function cardMini(wid) {
    const journal = getJournal(wid);
    const stats = journalStats(journal);
    const status = cardStatus(wid);
    const time = journal.startTime && journal.endTime ? `${journal.startTime}-${journal.endTime}` : 'brak godzin';
    const diff = stats.diffMinutes == null ? 'różnica: -' : `różnica: ${hoursLabel(stats.diffMinutes)}`;
    const diffTone = stats.diffMinutes == null || Math.abs(stats.diffMinutes) <= 3 ? 'ok' : stats.diffMinutes > 0 ? 'warn' : 'err';
    const problemCount = journal.problems.length + journal.segments.filter(s => s.workScope === 'Postój / blokada').length;

    return `<div class="worker-day-mini">
      <span class="${status.tone}">${h(status.label)}</span>
      <span>${h(time)}</span>
      <span>opisane: ${h(hoursLabel(stats.describedMinutes))}</span>
      <span class="${diffTone}">${h(diff)}</span>
      <span>problemy: ${problemCount}</span>
    </div>`;
  }

  function options(values, selected) {
    return values.map(value => `<option value="${h(value)}" ${value === selected ? 'selected' : ''}>${h(value)}</option>`).join('');
  }

  function installJournalShell() {
    if (!document.getElementById('worker-journal-screen')) {
      document.body.insertAdjacentHTML('beforeend', `
        <div id="worker-journal-screen" class="journal-screen" aria-hidden="true">
          <div id="worker-journal-content"></div>
        </div>
      `);
    }
    const row = document.querySelector('.add-worker-row');
    if (row && !document.getElementById('btn-report-day')) {
      row.insertAdjacentHTML('beforeend', '<button class="btn btn-primary btn-sm" id="btn-report-day" onclick="openDailyReport()">Raport dnia</button>');
    }
  }

  function renderWorkerJournal() {
    const wid = state.activeJournalWorker;
    if (!wid) return;
    const worker = state.workers.find(w => w.id === wid);
    if (!worker) return;

    const entry = typeof getEntry === 'function' ? getEntry(wid) : {};
    const journal = getJournal(wid);
    const stats = journalStats(journal);
    const errors = validateWorkerJournal(wid, true);
    const store = ensureJournalState();
    const closed = store.meta.status === 'Zamknięty';

    const segmentList = sortSegments(journal.segments).map(segment => {
      const mins = segmentMinutes(segment);
      const title = segment.actualWork || segment.plannedWork || segment.workScope || 'Odcinek pracy';
      const meta = [
        segment.area,
        segment.receiverDepartment,
        segment.workScope,
        segment.result,
        segment.reason ? `powód: ${segment.reason}` : ''
      ].filter(Boolean).join(' · ');
      return `<div class="timeline-item" onclick="editSegment('${q(wid)}','${q(segment.id)}')">
        <div class="timeline-top">
          <div>
            <div class="timeline-time">${h(segment.startTime || '--:--')} - ${h(segment.endTime || '--:--')} · ${mins == null ? '-' : h(hoursLabel(mins))}</div>
            <div class="timeline-title">${h(title)}</div>
          </div>
          <div class="timeline-buttons" onclick="event.stopPropagation()">
            <button class="mini-icon-btn" onclick="editSegment('${q(wid)}','${q(segment.id)}')" title="Edytuj">E</button>
            <button class="mini-icon-btn" onclick="deleteSegment('${q(wid)}','${q(segment.id)}')" title="Usuń">X</button>
          </div>
        </div>
        <div class="timeline-meta">${h(meta || 'bez dodatkowego opisu')}</div>
      </div>`;
    }).join('');

    const problemList = journal.problems.map(problem => {
      const lost = (Number(problem.durationMinutes) || 0) * (Number(problem.workerCount) || 1);
      return `<div class="timeline-item problem" onclick="editProblem('${q(wid)}','${q(problem.id)}')">
        <div class="timeline-top">
          <div>
            <div class="timeline-time">${h(problem.reportedAt || '')} · ${h(problem.status || 'Nowy')}</div>
            <div class="timeline-title">${h(problem.type || 'Problem')}: ${h(problem.description || 'bez opisu')}</div>
          </div>
          <div class="timeline-buttons" onclick="event.stopPropagation()">
            <button class="mini-icon-btn" onclick="editProblem('${q(wid)}','${q(problem.id)}')" title="Edytuj">E</button>
            <button class="mini-icon-btn" onclick="deleteProblem('${q(wid)}','${q(problem.id)}')" title="Usuń">X</button>
          </div>
        </div>
        <div class="timeline-meta">${h(problem.area || '')}${problem.responsibleDepartment ? ' · ' + h(problem.responsibleDepartment) : ''}${lost ? ' · utracone: ' + h(hoursLabel(lost)) : ''}</div>
      </div>`;
    }).join('');

    document.getElementById('worker-journal-content').innerHTML = `
      <div class="journal-head">
        <div class="journal-head-row">
          <button class="topbar-btn" onclick="closeWorkerJournal()">Powrót</button>
          <div class="journal-title">
            <h2>${h(worker.name)}</h2>
            <div class="journal-meta">${h(isoToDisplay(state.date))} · ${h(state.unitName || 'bez jednostki')} · ${journal.obecny ? 'Obecny' : 'Nieobecny'} · ${h(store.meta.status || 'Roboczy')}</div>
          </div>
          <button class="topbar-btn" onclick="openDailyReport()">Raport</button>
        </div>
        <div class="sync-line">Zapis lokalny: ${store.meta.updatedAt ? h(new Date(store.meta.updatedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })) : 'brak zmian'}${closed ? ' · dzień zamknięty' : ''}</div>
      </div>
      <div class="journal-body">
        ${errors.length ? `<div class="journal-errors">${errors.map(h).join('<br>')}</div>` : ''}

        <section class="journal-section">
          <div class="journal-section-title">Czas pracy</div>
          <div class="journal-grid">
            <label class="toggle-wrap full" style="min-height:44px;">
              <span class="toggle">
                <input type="checkbox" ${journal.obecny ? 'checked' : ''} onchange="setJournalPresent('${q(wid)}', this.checked)">
                <span class="toggle-slider"></span>
              </span>
              <span class="toggle-label">${journal.obecny ? 'Obecny' : 'Nieobecny'}</span>
            </label>
            <div class="journal-field">
              <label>Od</label>
              <input type="time" value="${h(journal.startTime)}" onchange="setJournalField('${q(wid)}','startTime',this.value)">
            </div>
            <div class="journal-field">
              <label>Do</label>
              <input type="time" value="${h(journal.endTime)}" onchange="setJournalField('${q(wid)}','endTime',this.value)">
            </div>
            <div class="journal-field">
              <label>Przerwa (min)</label>
              <input type="number" min="0" step="5" value="${h(journal.breakMinutes || 0)}" onchange="setJournalField('${q(wid)}','breakMinutes',this.value)">
            </div>
            <div class="journal-field">
              <label>Powód nieobecności</label>
              <input type="text" value="${h(journal.absenceReason)}" placeholder="jeśli nieobecny" onchange="setJournalField('${q(wid)}','absenceReason',this.value)">
            </div>
          </div>
          <div class="journal-stat-grid" style="margin-top:10px;">
            <div class="journal-stat"><strong>${stats.presenceMinutes == null ? '-' : h(hoursLabel(stats.presenceMinutes))}</strong><span>obecność</span></div>
            <div class="journal-stat"><strong>${h(hoursLabel(stats.describedMinutes))}</strong><span>opisane</span></div>
            <div class="journal-stat"><strong>${stats.diffMinutes == null ? '-' : h(hoursLabel(stats.diffMinutes))}</strong><span>różnica</span></div>
          </div>
        </section>

        <section class="journal-section">
          <div class="journal-section-title">Przebieg dnia</div>
          <div class="journal-actions" style="margin-bottom:10px;">
            <button class="btn btn-primary btn-sm" onclick="addNextSegment('${q(wid)}')">Dodaj pracę</button>
            <button class="btn btn-ghost btn-sm" onclick="addStopSegment('${q(wid)}')">Dodaj postój</button>
            <button class="btn btn-ghost btn-sm" onclick="openProblemModal('${q(wid)}')">Dodaj problem</button>
            <button class="btn btn-ghost btn-sm" onclick="openNoteModal('${q(wid)}')">Dodaj notatkę</button>
            <button class="btn btn-ghost btn-sm" onclick="finishNow('${q(wid)}')">Zakończ teraz</button>
          </div>
          <div class="timeline-list">${segmentList || '<div class="empty">Brak odcinków pracy.</div>'}</div>
        </section>

        <section class="journal-section">
          <div class="journal-section-title">Problemy i zdarzenia</div>
          <div class="timeline-list">${problemList || '<div class="empty">Brak problemów.</div>'}</div>
        </section>

        <section class="journal-section">
          <div class="journal-section-title">Notatka pracownika</div>
          <div class="journal-field">
            <textarea onchange="setJournalField('${q(wid)}','note',this.value)" placeholder="Uwagi do dnia">${h(journal.note)}</textarea>
          </div>
        </section>
      </div>
    `;
  }

  function openWorkerJournal(wid) {
    installJournalShell();
    state.activeJournalWorker = wid;
    renderWorkerJournal();
    const screen = document.getElementById('worker-journal-screen');
    screen.classList.add('open');
    screen.setAttribute('aria-hidden', 'false');
  }

  function closeWorkerJournal() {
    const screen = document.getElementById('worker-journal-screen');
    screen.classList.remove('open');
    screen.setAttribute('aria-hidden', 'true');
    state.activeJournalWorker = null;
  }

  function setJournalPresent(wid, value) {
    if (originalToggleObecny) {
      toggleObecny(wid, value);
    } else {
      getJournal(wid).obecny = value;
      persistJournal(wid, true);
    }
    renderWorkerJournal();
  }

  function setJournalField(wid, field, value) {
    const journal = getJournal(wid);
    if (field === 'breakMinutes') journal[field] = Math.max(0, Number(value) || 0);
    else journal[field] = value;
    persistJournal(wid, true);
  }

  function addNextSegment(wid) {
    const journal = getJournal(wid);
    const sorted = sortSegments(journal.segments);
    const start = sorted.length ? (sorted[sorted.length - 1].endTime || sorted[sorted.length - 1].startTime) : (journal.startTime || todayTime());
    openSegmentModal(wid, null, { startTime: start, endTime: '', workScope: 'Nasz zakres', result: 'Wykonano' });
  }

  function addStopSegment(wid) {
    const journal = getJournal(wid);
    const sorted = sortSegments(journal.segments);
    const start = sorted.length ? (sorted[sorted.length - 1].endTime || sorted[sorted.length - 1].startTime) : (journal.startTime || todayTime());
    openSegmentModal(wid, null, {
      startTime: start,
      endTime: '',
      plannedWork: 'Postój',
      actualWork: 'Postój',
      workScope: 'Postój / blokada',
      result: 'Nie wykonano'
    });
  }

  function finishNow(wid) {
    const journal = getJournal(wid);
    const now = todayTime();
    const sorted = sortSegments(journal.segments);
    const open = [...sorted].reverse().find(segment => segment.startTime && !segment.endTime);
    if (open) open.endTime = now;
    else journal.endTime = now;
    if (!journal.startTime) journal.startTime = sorted[0]?.startTime || now;
    persistJournal(wid, true);
  }

  function openSegmentModal(wid, segmentId, preset) {
    const worker = state.workers.find(w => w.id === wid);
    const journal = getJournal(wid);
    const existing = segmentId ? journal.segments.find(segment => segment.id === segmentId) : null;
    const segment = Object.assign({
      id: segmentId || uid('seg'),
      startTime: '',
      endTime: '',
      breakMinutes: 0,
      plannedWork: '',
      actualWork: '',
      area: '',
      receiverDepartment: 'Własny dział',
      workScope: 'Nasz zakres',
      result: 'Wykonano',
      reason: '',
      decisionSource: '',
      notes: '',
      photoNote: '',
      includeReport: true,
      includeHistory: false
    }, preset || {}, existing || {});

    showModal(`${segmentId ? 'Edytuj' : 'Dodaj'} odcinek - ${worker ? worker.name : ''}`,
      `<div class="journal-grid">
        <div class="journal-field"><label>Od</label><input id="seg-start" type="time" value="${h(segment.startTime)}"></div>
        <div class="journal-field"><label>Do</label><input id="seg-end" type="time" value="${h(segment.endTime)}"></div>
        <div class="journal-field"><label>Przerwa w odcinku (min)</label><input id="seg-break" type="number" min="0" step="5" value="${h(segment.breakMinutes || 0)}"></div>
        <div class="journal-field"><label>Obszar / kabina</label><input id="seg-area" value="${h(segment.area || kabinaName(getEntry(wid).kabina) || '')}"></div>
        <div class="journal-field full"><label>Planowana praca</label><input id="seg-planned" value="${h(segment.plannedWork)}"></div>
        <div class="journal-field full"><label>Faktycznie wykonano</label><textarea id="seg-actual">${h(segment.actualWork)}</textarea></div>
        <div class="journal-field"><label>Dział odbiorca</label><select id="seg-dept">${options(RECEIVER_DEPARTMENTS, segment.receiverDepartment)}</select></div>
        <div class="journal-field"><label>Zakres pracy</label><select id="seg-scope">${options(WORK_SCOPES, segment.workScope)}</select></div>
        <div class="journal-field"><label>Wynik</label><select id="seg-result">${options(RESULTS, segment.result)}</select></div>
        <div class="journal-field"><label>Zlecający / źródło</label><input id="seg-source" value="${h(segment.decisionSource)}"></div>
        <div class="journal-field full"><label>Powód niewykonania lub zmiany</label><textarea id="seg-reason">${h(segment.reason)}</textarea></div>
        <div class="journal-field full"><label>Uwagi</label><textarea id="seg-notes">${h(segment.notes)}</textarea></div>
        <div class="journal-field full"><label>Zdjęcia / opis zdjęcia</label><input id="seg-photo" value="${h(segment.photoNote)}" placeholder="np. zdjęcie w telefonie, numer, link"></div>
        <label class="toggle-wrap full"><input id="seg-report" type="checkbox" ${segment.includeReport ? 'checked' : ''}> uwzględnić w raporcie</label>
        <label class="toggle-wrap full"><input id="seg-history" type="checkbox" ${segment.includeHistory ? 'checked' : ''}> uwzględnić w oficjalnej historii</label>
      </div>`,
      `<button class="btn btn-ghost" onclick="closeModal()">Anuluj</button>
       <button class="btn btn-primary" onclick="saveSegment('${q(wid)}','${q(segment.id)}')">Zapisz</button>`
    );
  }

  function readSegmentFromModal(id) {
    return {
      id,
      startTime: document.getElementById('seg-start')?.value || '',
      endTime: document.getElementById('seg-end')?.value || '',
      breakMinutes: Number(document.getElementById('seg-break')?.value || 0),
      plannedWork: document.getElementById('seg-planned')?.value.trim() || '',
      actualWork: document.getElementById('seg-actual')?.value.trim() || '',
      area: document.getElementById('seg-area')?.value.trim() || '',
      receiverDepartment: document.getElementById('seg-dept')?.value || '',
      workScope: document.getElementById('seg-scope')?.value || '',
      result: document.getElementById('seg-result')?.value || '',
      reason: document.getElementById('seg-reason')?.value.trim() || '',
      decisionSource: document.getElementById('seg-source')?.value.trim() || '',
      notes: document.getElementById('seg-notes')?.value.trim() || '',
      photoNote: document.getElementById('seg-photo')?.value.trim() || '',
      includeReport: !!document.getElementById('seg-report')?.checked,
      includeHistory: !!document.getElementById('seg-history')?.checked
    };
  }

  function saveSegment(wid, segmentId) {
    const segment = readSegmentFromModal(segmentId);
    const errors = validateSegment(segment);
    if (errors.length) {
      showToast(errors[0], 'error');
      return;
    }
    const journal = getJournal(wid);
    const index = journal.segments.findIndex(item => item.id === segmentId);
    if (index === -1) journal.segments.push(segment);
    else journal.segments[index] = segment;
    journal.segments = sortSegments(journal.segments);
    closeModal();
    persistJournal(wid, true);
    if (typeof reRenderCard === 'function') reRenderCard(wid);
  }

  function editSegment(wid, segmentId) {
    openSegmentModal(wid, segmentId);
  }

  function deleteSegment(wid, segmentId) {
    const journal = getJournal(wid);
    journal.segments = journal.segments.filter(segment => segment.id !== segmentId);
    persistJournal(wid, true);
    if (typeof reRenderCard === 'function') reRenderCard(wid);
  }

  function openProblemModal(wid, problemId) {
    const worker = state.workers.find(w => w.id === wid);
    const journal = getJournal(wid);
    const existing = problemId ? journal.problems.find(problem => problem.id === problemId) : null;
    const problem = Object.assign({
      id: problemId || uid('prob'),
      type: 'Brak materiału',
      reportedAt: `${state.date || ''} ${todayTime()}`.trim(),
      area: '',
      description: '',
      responsibleDepartment: '',
      reportedTo: '',
      status: 'Nowy',
      workerCount: 1,
      durationMinutes: 0,
      solution: '',
      solvedAt: '',
      photoNote: '',
      includeReport: true
    }, existing || {});

    showModal(`${problemId ? 'Edytuj' : 'Dodaj'} problem - ${worker ? worker.name : ''}`,
      `<div class="journal-grid">
        <div class="journal-field"><label>Typ</label><select id="prob-type">${options(PROBLEM_TYPES, problem.type)}</select></div>
        <div class="journal-field"><label>Status</label><select id="prob-status">${options(PROBLEM_STATUSES, problem.status)}</select></div>
        <div class="journal-field"><label>Data i godzina</label><input id="prob-at" value="${h(problem.reportedAt)}"></div>
        <div class="journal-field"><label>Obszar / kabina</label><input id="prob-area" value="${h(problem.area || kabinaName(getEntry(wid).kabina) || '')}"></div>
        <div class="journal-field full"><label>Opis</label><textarea id="prob-desc">${h(problem.description)}</textarea></div>
        <div class="journal-field"><label>Dział odpowiedzialny</label><input id="prob-dept" value="${h(problem.responsibleDepartment)}"></div>
        <div class="journal-field"><label>Zgłoszono do</label><input id="prob-to" value="${h(problem.reportedTo)}"></div>
        <div class="journal-field"><label>Liczba pracowników</label><input id="prob-count" type="number" min="1" step="1" value="${h(problem.workerCount || 1)}"></div>
        <div class="journal-field"><label>Czas trwania (min)</label><input id="prob-duration" type="number" min="0" step="5" value="${h(problem.durationMinutes || 0)}"></div>
        <div class="journal-field full"><label>Rozwiązanie</label><textarea id="prob-solution">${h(problem.solution)}</textarea></div>
        <div class="journal-field"><label>Data rozwiązania</label><input id="prob-solved" value="${h(problem.solvedAt)}"></div>
        <div class="journal-field"><label>Zdjęcia / opis zdjęcia</label><input id="prob-photo" value="${h(problem.photoNote)}"></div>
        <label class="toggle-wrap full"><input id="prob-report" type="checkbox" ${problem.includeReport ? 'checked' : ''}> uwzględnić w raporcie</label>
      </div>`,
      `<button class="btn btn-ghost" onclick="closeModal()">Anuluj</button>
       <button class="btn btn-primary" onclick="saveProblem('${q(wid)}','${q(problem.id)}')">Zapisz</button>`
    );
  }

  function saveProblem(wid, problemId) {
    const problem = {
      id: problemId,
      type: document.getElementById('prob-type')?.value || 'Inne',
      reportedAt: document.getElementById('prob-at')?.value.trim() || '',
      area: document.getElementById('prob-area')?.value.trim() || '',
      description: document.getElementById('prob-desc')?.value.trim() || '',
      responsibleDepartment: document.getElementById('prob-dept')?.value.trim() || '',
      reportedTo: document.getElementById('prob-to')?.value.trim() || '',
      status: document.getElementById('prob-status')?.value || 'Nowy',
      workerCount: Number(document.getElementById('prob-count')?.value || 1),
      durationMinutes: Number(document.getElementById('prob-duration')?.value || 0),
      solution: document.getElementById('prob-solution')?.value.trim() || '',
      solvedAt: document.getElementById('prob-solved')?.value.trim() || '',
      photoNote: document.getElementById('prob-photo')?.value.trim() || '',
      includeReport: !!document.getElementById('prob-report')?.checked
    };
    if (!problem.description) {
      showToast('Wpisz opis problemu', 'error');
      return;
    }
    const journal = getJournal(wid);
    const index = journal.problems.findIndex(item => item.id === problemId);
    if (index === -1) journal.problems.push(problem);
    else journal.problems[index] = problem;
    closeModal();
    persistJournal(wid, true);
    if (typeof reRenderCard === 'function') reRenderCard(wid);
  }

  function editProblem(wid, problemId) {
    openProblemModal(wid, problemId);
  }

  function deleteProblem(wid, problemId) {
    const journal = getJournal(wid);
    journal.problems = journal.problems.filter(problem => problem.id !== problemId);
    persistJournal(wid, true);
    if (typeof reRenderCard === 'function') reRenderCard(wid);
  }

  function openNoteModal(wid) {
    const journal = getJournal(wid);
    showModal('Notatka pracownika',
      `<div class="journal-field"><label>Notatka</label><textarea id="journal-note-modal">${h(journal.note)}</textarea></div>`,
      `<button class="btn btn-ghost" onclick="closeModal()">Anuluj</button>
       <button class="btn btn-primary" onclick="saveWorkerNote('${q(wid)}')">Zapisz</button>`
    );
  }

  function saveWorkerNote(wid) {
    getJournal(wid).note = document.getElementById('journal-note-modal')?.value.trim() || '';
    closeModal();
    persistJournal(wid, true);
  }

  function stripJournalNote(note) {
    const raw = String(note || '');
    const start = raw.indexOf(NOTE_START);
    const end = raw.indexOf(NOTE_END);
    if (start === -1 || end === -1) return raw.trim();
    return (raw.slice(0, start) + raw.slice(end + NOTE_END.length)).trim();
  }

  function workerNote(wid) {
    const journal = getJournal(wid);
    if (!hasJournalData(journal)) return '';
    const stats = journalStats(journal);
    const lines = [
      NOTE_START,
      `Czas: ${journal.obecny ? `${journal.startTime || '-'}-${journal.endTime || '-'}` : 'nieobecny'}; przerwa: ${journal.breakMinutes || 0} min; obecność: ${stats.presenceMinutes == null ? '-' : hoursLabel(stats.presenceMinutes)}; opisane: ${hoursLabel(stats.describedMinutes)}; różnica: ${stats.diffMinutes == null ? '-' : hoursLabel(stats.diffMinutes)}`
    ];
    if (!journal.obecny && journal.absenceReason) lines.push(`Powód nieobecności: ${journal.absenceReason}`);
    if (journal.note) lines.push(`Notatka: ${journal.note}`);
    if (journal.segments.length) {
      lines.push('Odcinki pracy:');
      sortSegments(journal.segments).forEach(segment => {
        lines.push(`- ${segment.startTime || '-'}-${segment.endTime || '-'} (${hoursLabel(segmentMinutes(segment) || 0)}): ${segment.actualWork || segment.plannedWork || segment.workScope || 'bez opisu'}; ${segment.area || ''}; ${segment.receiverDepartment || ''}; ${segment.workScope || ''}; wynik: ${segment.result || ''}${segment.reason ? '; powód: ' + segment.reason : ''}`);
      });
    }
    if (journal.problems.length) {
      lines.push('Problemy:');
      journal.problems.forEach(problem => {
        lines.push(`- ${problem.type}: ${problem.description}; status: ${problem.status}; dział: ${problem.responsibleDepartment || '-'}; utracone: ${hoursLabel((problem.durationMinutes || 0) * (problem.workerCount || 1))}`);
      });
    }
    lines.push(NOTE_END);
    return lines.join('\n');
  }

  function mergeWorkerNote(existingNote, journalText) {
    const base = stripJournalNote(existingNote);
    if (!journalText) return base;
    return [base, journalText].filter(Boolean).join('\n\n');
  }

  function reportData() {
    ensureJournalState();
    const workers = state.workers || [];
    let present = 0;
    let absent = 0;
    let presenceMinutes = 0;
    let overtimeMinutes = 0;
    let helperMinutes = 0;
    let ownMinutes = 0;
    let stopMinutes = 0;
    let lostMinutes = 0;
    const done = [];
    const partial = [];
    const blocked = [];
    const helper = [];
    const openProblems = [];
    const incomplete = [];

    workers.forEach(worker => {
      const entry = typeof getEntry === 'function' ? getEntry(worker.id) : {};
      const journal = getJournal(worker.id);
      const stats = journalStats(journal);
      const isPresent = journal.obecny && entry.obecny !== false;
      if (isPresent) present++;
      else absent++;
      presenceMinutes += stats.presenceMinutes || 0;
      overtimeMinutes += stats.overtimeMinutes || ((entry.nadgodziny || 0) * 60);
      helperMinutes += stats.helperMinutes || 0;
      stopMinutes += stats.stopMinutes || 0;

      if (cardStatus(worker.id).className !== 'status-complete' && hasJournalData(journal)) {
        incomplete.push(worker.name);
      }

      journal.segments.filter(segment => segment.includeReport !== false).forEach(segment => {
        const row = `${worker.name}: ${segment.actualWork || segment.plannedWork || segment.workScope || 'bez opisu'}${segment.area ? ' - ' + segment.area : ''} (${hoursLabel(segmentMinutes(segment) || 0)})`;
        if (segment.workScope === 'Pomoc innemu działowi') helper.push(`${segment.receiverDepartment || 'inny dział'} - ${row}`);
        else if (segment.workScope === 'Postój / blokada') blocked.push(`${row}${segment.reason ? '; powód: ' + segment.reason : ''}`);
        else ownMinutes += segmentMinutes(segment) || 0;

        if (segment.result === 'Wykonano') done.push(row);
        if (segment.result === 'Częściowo' || segment.result === 'Nie wykonano') {
          partial.push(`${row}${segment.reason ? '; przyczyna: ' + segment.reason : ''}`);
        }
      });

      journal.problems.filter(problem => problem.includeReport !== false).forEach(problem => {
        const lost = (Number(problem.durationMinutes) || 0) * (Number(problem.workerCount) || 1);
        lostMinutes += lost;
        const row = `${problem.type}: ${problem.description || 'bez opisu'}${problem.responsibleDepartment ? ' - ' + problem.responsibleDepartment : ''}${lost ? ' (' + hoursLabel(lost) + ' utracone)' : ''}`;
        if (problem.status !== 'Zamknięty' && problem.status !== 'Rozwiązany') openProblems.push(row);
        if (problem.type === 'Postój') blocked.push(row);
      });
    });

    return { present, absent, presenceMinutes, overtimeMinutes, helperMinutes, ownMinutes, stopMinutes, lostMinutes, done, partial, blocked, helper, openProblems, incomplete };
  }

  function buildReportText() {
    const data = reportData();
    const store = ensureJournalState();
    const unit = state.unitName || 'jednostka';
    const date = typeof isoToDisplay === 'function' ? isoToDisplay(state.date) : state.date;
    const subject = `${unit} - raport prac zespołu - ${date}`;
    const list = rows => rows.length ? rows.map(row => `- ${row}`).join('\n') : '- brak';

    const body = [
      'Dzień dobry,',
      '',
      `Raport prac na jednostce ${unit} z dnia ${date}.`,
      '',
      'OBSADA I GODZINY',
      `- obecni: ${data.present}`,
      `- nieobecni: ${data.absent}`,
      `- łączne roboczogodziny: ${hoursLabel(data.presenceMinutes)}`,
      `- nadgodziny: ${hoursLabel(data.overtimeMinutes)}`,
      '',
      'PRACE WYKONANE',
      list(data.done),
      '',
      'POMOC INNYM DZIAŁOM',
      list(data.helper),
      '',
      'PRACE CZĘŚCIOWE I NIEWYKONANE',
      list(data.partial),
      '',
      'BLOKADY I POSTOJE',
      list(data.blocked),
      '',
      'NAJWAŻNIEJSZE PROBLEMY',
      list(data.openProblems),
      '',
      'KONTROLA DANYCH',
      `- godziny w naszym zakresie: ${hoursLabel(data.ownMinutes)}`,
      `- pomoc innym działom: ${hoursLabel(data.helperMinutes)}`,
      `- postoje: ${hoursLabel(data.stopMinutes)}`,
      `- utracone roboczogodziny: ${hoursLabel(data.lostMinutes)}`,
      `- pracownicy z niepełnym opisem: ${data.incomplete.length ? data.incomplete.join(', ') : 'brak'}`,
      '',
      'PLAN NA KOLEJNY DZIEŃ',
      store.meta.planNextDay || 'Do uzupełnienia.',
      '',
      'Pozdrawiam,',
      'Grzegorz Mrozik'
    ].join('\n');

    return { subject, body };
  }

  function openDailyReport() {
    const store = ensureJournalState();
    const report = buildReportText();
    showModal('Raport dzienny',
      `<div class="form-row">
        <label>Temat</label>
        <input id="report-subject" value="${h(report.subject)}">
      </div>
      <div class="form-row">
        <label>Plan na kolejny dzień</label>
        <textarea id="report-plan" onchange="saveReportPlan(this.value)">${h(store.meta.planNextDay || '')}</textarea>
      </div>
      <div class="form-row">
        <label>Treść raportu</label>
        <textarea id="report-body" class="report-preview">${h(report.body)}</textarea>
      </div>`,
      `<button class="btn btn-ghost" onclick="copyDailyReport()">Kopiuj</button>
       <button class="btn btn-ghost" onclick="gmailDraftInfo()">Szkic Gmail</button>
       <button class="btn btn-primary" onclick="closeJournalDay()">Zamknij dzień</button>`
    );
  }

  function saveReportPlan(value) {
    const store = ensureJournalState();
    store.meta.planNextDay = value;
    persistJournal(null, false);
    const report = buildReportText();
    const body = document.getElementById('report-body');
    if (body) body.value = report.body;
  }

  async function copyDailyReport() {
    const subject = document.getElementById('report-subject')?.value || '';
    const body = document.getElementById('report-body')?.value || '';
    const text = `Temat: ${subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast('Raport skopiowany do schowka', 'success');
    } catch (error) {
      showToast('Nie udało się skopiować. Zaznacz tekst ręcznie.', 'error');
    }
  }

  function gmailDraftInfo() {
    showToast('Szkic Gmail wymaga backendu OAuth. Raport można teraz skopiować.', 'warn');
  }

  function closeJournalDay() {
    const errors = [];
    state.workers.forEach(worker => {
      validateWorkerJournal(worker.id, true).forEach(error => errors.push(`${worker.name}: ${error}`));
    });
    if (errors.length) {
      showModal('Nie można zamknąć dnia',
        `<div class="journal-errors">${errors.map(h).join('<br>')}</div>`,
        '<button class="btn btn-ghost" onclick="closeModal()">Wróć</button>'
      );
      return;
    }
    const store = ensureJournalState();
    store.meta.status = 'Zamknięty';
    store.meta.closedAt = new Date().toISOString();
    persistJournal(null, false);
    showToast('Dzień zamknięty lokalnie. Użyj Zapisz dzień, aby dopisać notatki do Airtable.', 'success');
    openDailyReport();
  }

  function wrapExistingFunctions() {
    if (originalWorkerCard) {
      workerCard = function patchedWorkerCard(worker) {
        let html = originalWorkerCard(worker);
        const status = cardStatus(worker.id);
        html = html.replace(/class="worker-card ([^"]+)"/, `class="worker-card $1 ${status.className}"`);
        html = html.replace('<div class="worker-card-header">', `<div class="worker-card-header" onclick="openWorkerJournal('${q(worker.id)}')">`);
        html = html.replace('<div class="worker-controls">', `<div class="worker-controls" onclick="event.stopPropagation()"><button class="btn btn-sm btn-journal" onclick="openWorkerJournal('${q(worker.id)}')">Dziennik</button>`);
        html = html.replace(/(<div class="worker-role">.*?<\/div>)/, `$1${cardMini(worker.id)}`);
        return html;
      };
    }

    if (originalToggleObecny) {
      toggleObecny = function patchedToggleObecny(wid, value) {
        originalToggleObecny(wid, value);
        const journal = getJournal(wid);
        journal.obecny = value;
        persistJournal(wid, false);
        if (state.activeJournalWorker === wid) renderWorkerJournal();
      };
    }

    if (originalSaveDay) {
      saveDay = async function patchedSaveDay() {
        ensureJournalState();
        (state.workers || []).forEach(worker => {
          const text = workerNote(worker.id);
          if (!text || typeof getEntry !== 'function') return;
          const entry = getEntry(worker.id);
          entry.notatki = mergeWorkerNote(entry.notatki, text);
        });
        await originalSaveDay();
      };
    }
  }

  window.openWorkerJournal = openWorkerJournal;
  window.closeWorkerJournal = closeWorkerJournal;
  window.setJournalPresent = setJournalPresent;
  window.setJournalField = setJournalField;
  window.addNextSegment = addNextSegment;
  window.addStopSegment = addStopSegment;
  window.finishNow = finishNow;
  window.editSegment = editSegment;
  window.deleteSegment = deleteSegment;
  window.saveSegment = saveSegment;
  window.openProblemModal = openProblemModal;
  window.editProblem = editProblem;
  window.deleteProblem = deleteProblem;
  window.saveProblem = saveProblem;
  window.openNoteModal = openNoteModal;
  window.saveWorkerNote = saveWorkerNote;
  window.openDailyReport = openDailyReport;
  window.saveReportPlan = saveReportPlan;
  window.copyDailyReport = copyDailyReport;
  window.gmailDraftInfo = gmailDraftInfo;
  window.closeJournalDay = closeJournalDay;

  wrapExistingFunctions();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installJournalShell);
  } else {
    installJournalShell();
  }
})();
