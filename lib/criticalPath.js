// lib/criticalPath.js
//
// Approximate CPM (Critical Path Method): forward pass reuses the already-
// cascaded planned_start/planned_end from the date engine; backward pass
// computes Latest Start/Finish per task by recursing through successors,
// giving each task's Float (slack) in working days. Float = 0 means the
// task is on the Critical Path — any delay to it delays the whole project.
//
// This is a practical approximation, not a formally verified CPM solver:
// it assumes the task graph is a DAG (no circular predecessor chains,
// which the UI doesn't currently prevent but which would be unusual to
// create by accident) and resolves SS (Start-to-Start) constraints via the
// successor's Latest Start rather than full parallel-constraint solving.
// For the linear/branching chains typical of an implementation plan, this
// gives correct, actionable results.

const { toDate, toStr, isWorkingDay, deviationDays } = require('./dateEngine');

function workOrdinal(dateStr, projectStartStr, holidaySet) {
  let date = toDate(projectStartStr);
  while (!isWorkingDay(date, holidaySet)) date.setUTCDate(date.getUTCDate() + 1);
  let count = 1;
  let cur = toStr(date);
  while (cur !== dateStr) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isWorkingDay(date, holidaySet)) count += 1;
    cur = toStr(date);
    if (count > 5000) break; // safety valve against bad data
  }
  return count;
}

/**
 * @param {Array} tasks - full task rows with planned_start/planned_end as 'YYYY-MM-DD' strings
 * @returns {Map<taskId, {ES, EF, LS, LF, float, isCritical}>}
 */
function computeCriticalPath(tasks, projectStart, holidaySet) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const successorsMap = new Map();
  for (const t of tasks) {
    if (t.predecessor_id && byId.has(t.predecessor_id)) {
      if (!successorsMap.has(t.predecessor_id)) successorsMap.set(t.predecessor_id, []);
      successorsMap.get(t.predecessor_id).push(t);
    }
  }

  const forward = new Map();
  let projectEndOrdinal = 1;
  for (const t of tasks) {
    if (!t.planned_start || !t.planned_end) continue;
    const ES = workOrdinal(t.planned_start, projectStart, holidaySet);
    const EF = workOrdinal(t.planned_end, projectStart, holidaySet);
    forward.set(t.id, { ES, EF });
    if (EF > projectEndOrdinal) projectEndOrdinal = EF;
  }

  const memo = new Map();
  function resolveBackward(task) {
    if (memo.has(task.id)) return memo.get(task.id);
    const succs = successorsMap.get(task.id) || [];
    const fwd = forward.get(task.id);
    if (!fwd) return null;

    let LF;
    if (succs.length === 0) {
      LF = projectEndOrdinal;
    } else {
      const candidates = succs
        .map((s) => {
          const sResolved = resolveBackward(s);
          if (!sResolved) return null;
          if (s.dependency_type === 'SS') {
            return sResolved.LS + (task.duration_days - 1);
          }
          return sResolved.LS - 1;
        })
        .filter((v) => v !== null);
      LF = candidates.length ? Math.min(...candidates) : projectEndOrdinal;
    }
    const LS = LF - task.duration_days + 1;
    const float = LS - fwd.ES;
    const result = { ES: fwd.ES, EF: fwd.EF, LS, LF, float, isCritical: float <= 0 };
    memo.set(task.id, result);
    return result;
  }

  for (const t of tasks) resolveBackward(t);
  return memo;
}

/**
 * Rule-based recovery suggestions (standard IT-delivery playbook), only
 * generated for tasks that are BOTH on the critical path AND currently
 * running late — since only those actually threaten the deadline.
 */
function generateRecoverySuggestions(tasks, cpmResult, holidaySet, todayStr) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const successorsMap = new Map();
  for (const t of tasks) {
    if (t.predecessor_id) {
      if (!successorsMap.has(t.predecessor_id)) successorsMap.set(t.predecessor_id, []);
      successorsMap.get(t.predecessor_id).push(t);
    }
  }

  const suggestions = [];
  for (const t of tasks) {
    const cpm = cpmResult.get(t.id);
    if (!cpm || !cpm.isCritical) continue;
    if (!t.planned_end) continue;

    let lateDays = 0;
    if (t.actual_end) {
      lateDays = deviationDays(t.planned_end, t.actual_end, holidaySet);
    } else if (t.status !== 'Completed' && t.planned_end < todayStr) {
      lateDays = deviationDays(t.planned_end, todayStr, holidaySet);
    }
    if (lateDays <= 0) continue;

    const options = [];
    const succs = (successorsMap.get(t.id) || []).filter((s) => s.dependency_type === 'FS');
    if (succs.length) {
      const s = succs[0];
      options.push(
        `Fast-track: overlap "${t.name}" with "${s.name}" (switch to Start-to-Start where scope allows) instead of waiting for full completion — could recover part of the ${lateDays}-day slip.`
      );
    }
    options.push(
      `Crash: add a resource to "${t.name}" to compress the remaining work — typical for IT delivery when a single owner is the bottleneck.`
    );
    options.push(
      `Scope-phase: evaluate deferring a non-critical part of "${t.name}" to a follow-up release to protect the date.`
    );

    suggestions.push({
      task_id: t.id,
      task_name: t.name,
      late_days: lateDays,
      options,
    });
  }
  return suggestions;
}

module.exports = { computeCriticalPath, generateRecoverySuggestions, workOrdinal };
