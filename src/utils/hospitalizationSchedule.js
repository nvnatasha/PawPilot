import { DAY_SHIFT_HOURS, SHEET_START_HOUR } from '../config/hospitalizationConfig.js';

const HOUR_MS = 60 * 60 * 1000;
const DUE_WINDOW_MINUTES = 30;

export function toSheetDate(date = new Date()) {
  if (typeof date === 'string') {
    return date.slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

export function getSheetDateForTimestamp(timestamp) {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
  const sheetDate = new Date(date);
  if (date.getHours() < SHEET_START_HOUR) {
    sheetDate.setDate(sheetDate.getDate() - 1);
  }

  return toSheetDate(sheetDate);
}

export function addSheetDays(sheetDate, days) {
  const date = new Date(`${sheetDate}T${String(SHEET_START_HOUR).padStart(2, '0')}:00:00`);
  date.setDate(date.getDate() + days);
  return toSheetDate(date);
}

export function sheetWindow(sheetDate) {
  const hours = generateSheetHours(sheetDate);
  return {
    start: hours[0].date,
    end: new Date(hours[23].date.getTime() + HOUR_MS),
  };
}

export function combineDateTime(date, time) {
  return new Date(`${date}T${time || '00:00'}:00`);
}

export function generateSheetHours(sheetDate) {
  const start = new Date(`${sheetDate}T${String(SHEET_START_HOUR).padStart(2, '0')}:00:00`);

  return Array.from({ length: 24 }, (_, index) => {
    const date = new Date(start.getTime() + index * HOUR_MS);
    return {
      index,
      iso: date.toISOString(),
      date,
      time: date.toTimeString().slice(0, 5),
      label: formatHourLabel(date),
      shift: index < DAY_SHIFT_HOURS ? 'Day' : 'Night',
    };
  });
}

export function formatHourLabel(dateOrIso) {
  const date = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso;
  const hour = date.getHours();
  const suffix = hour >= 12 ? 'p' : 'a';
  const hour12 = hour % 12 || 12;
  return `${hour12}${suffix}`;
}

export function formatTime(dateOrIso) {
  if (!dateOrIso) {
    return '';
  }

  const date = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso;
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDateRange(sheetDate) {
  const hours = generateSheetHours(sheetDate);
  const start = hours[0].date;
  const end = hours[23].date;
  const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${startLabel}–${endLabel}`;
}

export function buildSchedule({ scheduleMode, firstDueTime, intervalHours, specificTimes }) {
  if (scheduleMode === 'prn') {
    return {
      type: 'prn',
    };
  }

  if (scheduleMode === 'specificTimes') {
    return {
      type: 'specificTimes',
      times: splitTimes(specificTimes),
    };
  }

  if (scheduleMode === 'once') {
    return {
      type: 'once',
      firstDueTime,
    };
  }

  return {
    type: 'interval',
    firstDueTime,
    intervalHours: Number(intervalHours),
  };
}

export function generateOccurrencesForSchedule(schedule, sheetDate, rowId) {
  const { start: sheetStart, end: sheetEnd } = sheetWindow(sheetDate);
  return generateOccurrencesForScheduleWindow(schedule, sheetStart, sheetEnd, rowId);
}

export function generateOccurrencesForScheduleWindow(
  schedule,
  windowStart,
  windowEnd,
  rowId,
  presentationWindowStart = windowStart,
) {
  if (!schedule) {
    return [];
  }

  if (schedule.type === 'prn') {
    return [];
  }

  if (schedule.type === 'specificTimes') {
    const occurrences = [];
    const cursor = new Date(windowStart);
    cursor.setHours(0, 0, 0, 0);
    while (cursor < windowEnd) {
      for (const time of schedule.times || []) {
        const date = combineDateTime(toSheetDate(cursor), time);
        if (date >= windowStart && date < windowEnd) {
          occurrences.push(buildOccurrence(date, rowId, presentationWindowStart));
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return occurrences;
  }

  if (schedule.type === 'once') {
    const effectiveDate = schedule.firstDueAt
      ? new Date(schedule.firstDueAt)
      : combineDateTime(toSheetDate(windowStart), schedule.firstDueTime);
    const occurrence =
      effectiveDate >= windowStart && effectiveDate < windowEnd
        ? buildOccurrence(effectiveDate, rowId, presentationWindowStart)
        : null;
    return occurrence ? [occurrence] : [];
  }

  const intervalHours = Number(schedule.intervalHours);
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) {
    return [];
  }

  const anchor = schedule.firstDueAt
    ? new Date(schedule.firstDueAt)
    : combineDateTime(toSheetDate(windowStart), schedule.firstDueTime);
  if (Number.isNaN(anchor.getTime())) {
    return [];
  }

  const occurrences = [];
  let current = new Date(anchor);
  while (current < windowStart) {
    current = new Date(current.getTime() + intervalHours * HOUR_MS);
  }
  while (current < windowEnd) {
    occurrences.push(buildOccurrence(current, rowId, presentationWindowStart));
    current = new Date(current.getTime() + intervalHours * HOUR_MS);
  }

  return occurrences;
}

export function getOccurrenceKey(rowId, scheduledAt) {
  return `${rowId}|${new Date(scheduledAt).toISOString()}`;
}

export function getCellStatus({ occurrence, entries = [], row, now = new Date() }) {
  if (!occurrence) {
    return 'empty';
  }

  if (occurrence.statusOverride === 'skipped') {
    return 'skipped';
  }

  if (occurrence.statusOverride === 'held') {
    return 'held';
  }

  const entry = entries.find((item) => item.occurrenceKey === occurrence.key);
  if (entry?.status === 'held') {
    return 'held';
  }
  if (entry?.status === 'discontinued') {
    return 'discontinued';
  }
  if (entry) {
    return 'completed';
  }

  if (row?.discontinuedAt && new Date(occurrence.scheduledAt) > new Date(row.discontinuedAt)) {
    return 'discontinued';
  }

  const scheduled = new Date(occurrence.scheduledAt);
  const diffMinutes = (scheduled.getTime() - now.getTime()) / 60000;

  if (diffMinutes < -DUE_WINDOW_MINUTES) {
    return 'overdue';
  }

  if (Math.abs(diffMinutes) <= DUE_WINDOW_MINUTES || diffMinutes < 0) {
    return 'due';
  }

  return 'upcoming';
}

export function splitTimes(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((time) => time.trim())
    .filter(Boolean);
}

function occurrenceForTime(time, sheetDate, sheetStart, sheetEnd, rowId) {
  if (!time) {
    return null;
  }

  let date = combineDateTime(sheetDate, time);
  if (date < sheetStart) {
    date = new Date(date.getTime() + 24 * HOUR_MS);
  }

  if (date >= sheetStart && date < sheetEnd) {
    return buildOccurrence(date, rowId, sheetStart);
  }

  return null;
}

function buildOccurrence(date, rowId, windowStart = null) {
  const scheduledAt = date.toISOString();
  const base = windowStart || new Date(`${getSheetDateForTimestamp(date)}T08:00:00`);
  return {
    rowId,
    scheduledAt,
    hourIndex: Math.round((date.getTime() - base.getTime()) / HOUR_MS),
    key: getOccurrenceKey(rowId, scheduledAt),
  };
}
