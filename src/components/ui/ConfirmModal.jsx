export default function ConfirmModal({ title, message, confirmLabel, onCancel, onConfirm }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div aria-modal="true" className="modal" role="dialog" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="ghost-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="danger-button" onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
