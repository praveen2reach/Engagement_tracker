// lib/dateEngine.js
// All date math is done on plain 'YYYY-MM-DD' strings to avoid timezone drift.

function toDate(d) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function toStr(date) {
  return date.toISOString().slice(0, 10);
}

function isWeekend(date) {
  const day = date.getUTCDay(); // 0 = Sun, 6 = Sat
  return day === 0 || day === 6;
}

/**
 * @param {Set<string>} holidaySet - set of 'YYYY-MM-DD' strings
 */
function isWorkingDay(date, holidaySet) {
  return !isWeekend(date) && !holidaySet.has(toStr(date));
}

/**
 * Adds N working days to a start date. Duration is inclusive of the start day
 * itself, i.e. a 1-day task starting Monday ends Monday.
 */
function addWorkingDays(startStr, durationDays, holidaySet) {
  let date = toDate(startStr);
  // if the start itself lands on a non-working day, roll forward to the next working day
  while (!isWorkingDay(date, holidaySet)) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  let remaining = durationDays - 1; // first working day already counts as day 1
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isWorkingDay(date, holidaySet)) {
      remaining -= 1;
    }
  }
  return toStr(date);
}

/** Next working day strictly after the given date */
function nextWorkingDay(dateStr, holidaySet) {
  let date = toDate(dateStr);
  date.setUTCDate(date.getUTCDate() + 1);
  while (!isWorkingDay(date, holidaySet)) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return toStr(date);
}

/**
 * Recalculates planned_start / planned_end for every task in a project,
 * walking the dependency chain in `sequence` order.
 *
 * @param {Array} tasks - [{id, sequence, predecessor_id, dependency_type, duration_days}]
 * @param {string} projectStart - 'YYYY-MM-DD'
 * @param {Set<string>} holidaySet
 * @returns {Map<taskId, {planned_start, planned_end}>}
 */
function cascadeDates(tasks, projectStart, holidaySet) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const result = new Map();
  const ordered = [...tasks].sort((a, b) => a.sequence - b.sequence);

  function resolve(task) {
    if (result.has(task.id)) return result.get(task.id);

    let plannedStart;
    if (!task.predecessor_id || !byId.has(task.predecessor_id)) {
      plannedStart = projectStart;
      // still roll forward if projectStart itself is a non-working day
      let d = toDate(plannedStart);
      while (!isWorkingDay(d, holidaySet)) {
        d.setUTCDate(d.getUTCDate() + 1);
      }
      plannedStart = toStr(d);
    } else {
      const pred = byId.get(task.predecessor_id);
      const predDates = resolve(pred);
      if (task.dependency_type === 'SS') {
        plannedStart = predDates.planned_start;
      } else {
        plannedStart = nextWorkingDay(predDates.planned_end, holidaySet);
      }
    }

    const plannedEnd = addWorkingDays(plannedStart, task.duration_days, holidaySet);
    const dates = { planned_start: plannedStart, planned_end: plannedEnd };
    result.set(task.id, dates);
    return dates;
  }

  for (const t of ordered) resolve(t);
  return result;
}

/** Deviation in working days between planned_end and actual_end (positive = late) */
function deviationDays(plannedEnd, actualEnd, holidaySet) {
  if (!actualEnd) return null;
  let date = toDate(plannedEnd < actualEnd ? plannedEnd : actualEnd);
  const end = toDate(plannedEnd < actualEnd ? actualEnd : plannedEnd);
  let count = 0;
  while (date.getTime() < end.getTime()) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isWorkingDay(date, holidaySet)) count += 1;
  }
  return plannedEnd < actualEnd ? count : -count;
}

/** Is `date` inside the current ISO week (Mon-Sun, UTC)? */
function isInCurrentWeek(dateStr) {
  if (!dateStr) return false;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (today.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - dow);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const d = toDate(dateStr);
  return d.getTime() >= monday.getTime() && d.getTime() <= sunday.getTime();
}

/** Does the task's active window (planned, or actual if present) overlap the current week? */
function isCurrentWeekTask(task) {
  const startStr = task.actual_start || task.planned_start;
  const endStr = task.actual_end || task.planned_end;
  if (!startStr || !endStr) return false;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (today.getUTCDay() + 6) % 7;
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - dow);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const s = toDate(startStr);
  const e = toDate(endStr);
  return s.getTime() <= sunday.getTime() && e.getTime() >= monday.getTime();
}

module.exports = {
  toDate,
  toStr,
  isWorkingDay,
  addWorkingDays,
  nextWorkingDay,
  cascadeDates,
  deviationDays,
  isInCurrentWeek,
  isCurrentWeekTask,
};
