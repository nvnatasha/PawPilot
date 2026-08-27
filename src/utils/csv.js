export function toCsv(rows, columns) {
  const header = columns.map((column) => escapeCsv(column.header)).join(',');
  const body = rows
    .map((row) => columns.map((column) => escapeCsv(row[column.key] ?? '')).join(','))
    .join('\n');
  return `${header}\n${body}`;
}

export function escapeCsv(value) {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}
