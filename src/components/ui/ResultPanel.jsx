export default function ResultPanel({ label, value, helper }) {
  return (
    <div className="result-panel">
      <span>{label}</span>
      <strong>{value}</strong>
      {helper && <small>{helper}</small>}
    </div>
  );
}
